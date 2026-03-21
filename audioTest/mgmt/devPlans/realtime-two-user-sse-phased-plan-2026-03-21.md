# audEp Realtime (2-User Same Channel) - Phased Implementation Plan

Date: 2026-03-21
Project Root: C:\Users\Qub\audioTest
Scope: Add low-complexity realtime collaboration for two concurrent users in one shared channel/session.

## 1) Current Starting Point (From Code Scan)

Backend (`src/backend/server.js`):
- HTTP server is Node core `http`, not Express.
- Session APIs are request/response only:
  - `GET /api/sessions`
  - `GET /api/session?id=...`
  - `POST /api/session`
  - `DELETE /api/session?id=...`
- Auth is token + username via headers/query (`x-audio-user`, `x-audio-auth`), validated by `requireAuthUser` + `resolveAuthenticatedUser`.
- Session ownership is enforced with `isOwnedByUser(record.owner === authUser)`.
- No websocket/SSE realtime transport exists today.
- Saves overwrite full session record with `savedAt` timestamp; no revision/optimistic concurrency guard.

Frontend (`src/frontend/app.js`):
- State is local in-memory object (`state`) with save queue (`state.saveQueue`).
- `enqueueAutoSave()` serializes changes and calls `saveSessionState()` -> `POST /api/session`.
- List refresh is pull-based only (`loadPersistedAudioCards()`), triggered on login/save/delete/open flows.
- No background poll loop, no EventSource/WebSocket, no inbound remote-change handler.

Conclusion:
- Current model supports persistence, not live co-edit updates.
- Lowest-friction realtime path is SSE server push + existing POST save API.

## 2) Target Realtime Behavior (MVP)

Goal for MVP:
- Two users connected to the same channel receive near-instant "session updated" signals.
- On signal, non-editing client reloads latest session and updates UI.
- Editing client should not thrash itself from its own events.

MVP constraints:
- Keep existing auth.
- Keep existing POST/GET session contract with minimal additive fields.
- No external infra (Redis/pubsub/service) required.
- Single server process assumption is acceptable.

## 3) Data and Protocol Decisions

### 3.1 Channel identity
- Use `sessionId` as the default channel key (`channelId = sessionId`).
- Before a session exists (new upload pre-first-save), no realtime subscription is required.

### 3.2 Event transport
- Add `GET /api/realtime?channel=<sessionId>` SSE endpoint.
- Required SSE headers:
  - `Content-Type: text/event-stream`
  - `Cache-Control: no-cache, no-transform`
  - `Connection: keep-alive`
- Keep-alive ping every 20-30s to prevent idle proxy close.

### 3.3 Event payload shape
- Event name: `session_updated`
- Data JSON:
  - `sessionId`
  - `updatedAt` (ISO)
  - `revision` (number, monotonic)
  - `actor` (username)

### 3.4 Revision / conflict strategy
- Add server-managed `revision` integer to session record.
- On save:
  - read previous record revision (default `0`)
  - write `revision = previous + 1`
- Client stores `state.activeRevision`.
- Save request includes `baseRevision` (client last known).
- If `baseRevision < currentRevision`, return `409 conflict` with current summary.
- Conflict handling MVP: client fetches latest and shows "Remote changes loaded" message.

## 4) Phase Plan

## Phase 0 - Preparation and Guardrails

Deliverables:
- Feature flag env var: `REALTIME_ENABLED` (default `false` for safe rollout).
- Logging hooks for realtime connect/disconnect/broadcast counts.
- Minimal docs note in `mgmt/README.md` (or dedicated dev note) for how to run with realtime.

Tasks:
1. Add config constants in backend (`REALTIME_ENABLED`, ping interval).
2. Define in-memory hub structures:
   - `Map<channelId, Set<client>>`
   - client metadata: `{ id, username, res, connectedAt }`
3. Add helper functions:
   - `subscribeRealtime(ctx)`
   - `unsubscribeRealtime(ctx)`
   - `broadcastRealtime(ctx)`
   - `writeSseEvent(ctx)`

Exit criteria:
- Server starts with feature disabled and behavior unchanged.

## Phase 1 - Backend SSE Endpoint

Deliverables:
- New authenticated route: `GET /api/realtime?channel=<id>`.
- SSE connection lifecycle handling.

Tasks:
1. Route wiring in `routeRequest` before static handler.
2. Validate auth via existing `requireAuthUser`.
3. Validate `channel` (normalize + non-empty).
4. Send SSE headers and initial `connected` event.
5. Register `req.on("close")` cleanup.
6. Start/maintain heartbeat comments or ping events.
7. Enforce max clients per channel (e.g., 2 hard cap for this project scope).

Exit criteria:
- Two browser tabs can connect and stay connected.
- Disconnection releases client from hub.

## Phase 2 - Broadcast on Session Mutation

Deliverables:
- Broadcast `session_updated` for create/update/delete flows.

Tasks:
1. In `handlePostSession` after successful write:
   - compute/write `revision`
   - emit broadcast to `channel=sessionId`
2. In `handleDeleteSession` broadcast `session_deleted`.
3. Ensure actor username included; clients can ignore self-origin if needed.
4. Keep behavior no-op when `REALTIME_ENABLED=false`.

Exit criteria:
- Save from tab A emits event received in tab B within ~1s local.

## Phase 3 - Frontend Realtime Client

Deliverables:
- EventSource connection management tied to active session.

Tasks:
1. Add realtime state fields:
   - `realtimeSource`, `realtimeChannelId`, `activeRevision`, `lastRemoteEventAt`, backoff counters.
2. Add connect/disconnect helpers:
   - `startRealtimeForSession(sessionId)`
   - `stopRealtime()`
3. Include auth in query params for SSE (`username`, `authToken`) using existing auth model.
4. Handle `session_updated`:
   - if actor is current user and revision <= local activeRevision, ignore
   - else fetch latest via `GET /api/session?id=...` and apply
5. Reconnect strategy:
   - exponential backoff up to max (e.g., 10s)
   - stop on logout or leaving player
6. UX cues:
   - transient status text: "Remote update received"
   - optional subtle sync indicator (connected/reconnecting/offline)

Exit criteria:
- Two users on same session see updates reflected automatically without manual refresh.

## Phase 4 - Conflict and Safety Handling

Deliverables:
- Basic optimistic concurrency to avoid silent overwrite.

Tasks:
1. Add `baseRevision` to save payload from client.
2. Backend returns `409` when stale base detected.
3. Frontend handles `409`:
   - fetch latest
   - re-apply local intent minimally (optional for MVP; can defer)
   - show explicit "conflict resolved by loading latest" message
4. Prevent save storms:
   - dedupe by comparing signatures before writing/broadcasting.

Exit criteria:
- Concurrent edits no longer overwrite silently.

## Phase 5 - Validation, Hardening, and Rollout

Deliverables:
- Test checklist + rollout toggle strategy.

Tasks:
1. Manual two-user matrix:
   - both logged in, same session open
   - save from A -> B updates
   - save from B -> A updates
   - near-simultaneous saves -> conflict path tested
   - logout/token expiry while SSE connected
2. Resilience checks:
   - server restart (auto reconnect)
   - network drop/recover
3. Performance sanity:
   - no unbounded listener growth
   - per-channel client set cleaned on disconnect
4. Rollout:
   - enable `REALTIME_ENABLED=1` in dev first
   - keep fallback behavior (manual pull still works)

Exit criteria:
- Stable two-user realtime collaboration in one channel for normal flows.

## 5) File-Level Change Plan

Backend:
- `src/backend/server.js`
  - add realtime hub constants/state
  - add SSE route handler and helpers
  - add revision handling in session save/delete flows
  - add broadcast calls

Frontend:
- `src/frontend/app.js`
  - add realtime client lifecycle helpers
  - wire open session -> connect; close/logout -> disconnect
  - add inbound event handler to refresh/apply session
  - add revision propagation in save/load logic

Optional docs:
- `mgmt/README.md` (or a new `mgmt/devPlans/realtime-runbook.md`)

## 6) Risks and Mitigations

Risk: current owner isolation (`owner === authUser`) blocks true shared session between different users.
- Mitigation: decide channel sharing model early:
  - Option A: both collaborators use same account for MVP.
  - Option B: add explicit collaborator allowlist per session (recommended next step).

Risk: remote storage mode (`SESSION_STORE=remote`) may not support realtime events.
- Mitigation: implement SSE in local server first; for remote mode either proxy events or disable realtime until remote supports compatible events.

Risk: full-session reload on every event may disrupt active cursor/playback.
- Mitigation: preserve `currentTime`, selection indices where possible during `applySavedSession` on remote updates.

## 7) Recommended Implementation Order (Practical)

1. Phase 1 backend SSE connect/disconnect.
2. Phase 2 broadcast on save.
3. Phase 3 frontend EventSource and remote reload.
4. Phase 4 revision/conflict guard.
5. Phase 5 hardening + rollout.

This order gets visible realtime quickly, then adds correctness guarantees.
