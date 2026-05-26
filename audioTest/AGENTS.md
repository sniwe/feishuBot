# AGENTS.md

## Scope and Path Variables

Use dynamic roots. Keep portable.

- `USER_ROOT`: user home directory (default `C:\Users\Qub`)
- `WORKSPACE_ROOT`: project root (current project)
- `MGMT_DIR`: `${WORKSPACE_ROOT}\mgmt`
- `PROJMAP_DIR`: `${MGMT_DIR}\projMap` (default project-scoped management package)
- `SRC_DIR`: `${WORKSPACE_ROOT}\src`
- `BACKEND_DIR`: `${SRC_DIR}\backend`
- `FRONTEND_DIR`: `${SRC_DIR}\frontend`
- `PUBLIC_DIR`: `${SRC_DIR}\public`
- `GLOBAL_MGMT_DIR`: `${USER_ROOT}\mgmt`
- `SESSIONS_ROOT`: `${USER_ROOT}\.codex\sessions`

Resolve paths from these variables first, then from explicit user-provided absolute paths.

## Default Response Style

- Use `caveman` skill in `full` mode by default for all thread replies unless user asks for another style.
- Treat an incoming thread message exactly `test` as an explicit `caveman` full trigger.

## Default Project AGENTS Generation

For new project, make project `AGENTS.md` at:

- `${WORKSPACE_ROOT}\AGENTS.md`

Make project copy of this file. Bind paths to `${WORKSPACE_ROOT}` and `${MGMT_DIR}`. Keep global rules.

Project `AGENTS.md` must also init mgmt queue folders under `${MGMT_DIR}`:

- `${MGMT_DIR}\toDo\`
- `${MGMT_DIR}\errFix\`
- `${MGMT_DIR}\DLs\`
- `${MGMT_DIR}\logs\`

`toDo` and `errFix` must always contain at least one blank `.txt` file. Use ordinal file names starting at `1.txt` and continue in sequence. If a previously created file gains content, create the next ordinal file as a new blank `.txt` so a blank sentinel is always present.

`toDo` blocks nest by blank lines. Use tabs for children. Nested lines continue parent block.

- `${MGMT_DIR}\toDo\done\` is the manual spot for done `toDo` items.
- `${MGMT_DIR}\errFix\fixed\` is the manual spot for done `errFix` items.
- `${MGMT_DIR}\DLs\` mirrors download files for the current day and referenced download paths, sorted newest-first by the queue maintenance worker and renamed `dl-1.ext`, `dl-2.ext`, ... in ordinal order while preserving each file's original extension.
- `${MGMT_DIR}\logs\` stores runtime console logs grouped by capture date and ordinal runtime instance.

Runtime log rules:

- Log all user actions, state shifts, and script changes.
- Mirror same log stream to `${MGMT_DIR}\logs\YYMMDD\N.txt`.
- Create active log file in day dir. Keep append-only.
- If same-day restart, use next ordinal.
- Hard refresh or `Ctrl+F5` means new run. Start new log target.

Default project packaging under `${MGMT_DIR}`:

- `${PROJMAP_DIR}\map.json`
- `${PROJMAP_DIR}\threads\`
- `${PROJMAP_DIR}\state\`
- `${PROJMAP_DIR}\modules\`
- `${PROJMAP_DIR}\scripts\`

Default project source packaging under `${SRC_DIR}`:

- `${BACKEND_DIR}\`
- `${FRONTEND_DIR}\`
- `${PUBLIC_DIR}\`

Project file placement constraint:

- Put project files under `${BACKEND_DIR}`, `${FRONTEND_DIR}`, or `${PUBLIC_DIR}`. Only skip for `${MGMT_DIR}` assets or project `${WORKSPACE_ROOT}\AGENTS.md`.
- During init and propagation, move non-exempt paths into `${SRC_DIR}`.


Project `.gitignore` governance:

- Project `${WORKSPACE_ROOT}\AGENTS.md` must create and keep `${WORKSPACE_ROOT}\.gitignore`.
- Keep `.gitignore` on big junk, generated stuff, secrets, runtime state. Keep tracked source and mgmt files.
- During init and propagation, update `.gitignore` same way every time. No dupes.

Project bootstrap under `${PROJMAP_DIR}` needs:

- `threads\README.md`
- `threads\resolve-init-thread.ps1`
- `threads\current-thread.json` (generated/updated at runtime)
- `state\thread-map-deltas.json` (generated/updated at runtime)
- `modules\thread-map-tracker\index.js`
- `modules\thread-map-tracker\tracker.js`
- `modules\thread-map-tracker\delta.js`
- `modules\thread-map-tracker\io.js`
- `scripts\generate-map.ps1`
- `scripts\track-map-update.js`

Project `mgmt\README.md` should say:

- canonical map at `${PROJMAP_DIR}\map.json`
- thread discovery/cache in `${PROJMAP_DIR}\threads\`
- map delta state/history in `${PROJMAP_DIR}\state\`
- reusable tracking module in `${PROJMAP_DIR}\modules\thread-map-tracker\`
- orchestration scripts in `${PROJMAP_DIR}\scripts\`

## Source Files and Interaction Model

These markdown sources define one combined operating model:

1. `${GLOBAL_MGMT_DIR}\project_struct_and_module_org.md` (fallback `${MGMT_DIR}\project_struct_and_module_org.md`)
- Baseline repo conventions.
- Declares vanilla `.js`, modular hierarchy, clear separation of concerns, and aggregator files.
- Points to Context Object Pattern for all cross-module interactions.
- Apply this module organization standard across `${BACKEND_DIR}`, `${FRONTEND_DIR}`, and `${PUBLIC_DIR}` by default.

2. `${GLOBAL_MGMT_DIR}\context_obj_pattern.md` (fallback `${MGMT_DIR}\context_obj_pattern.md`)
- Function contract standard.
- Every authored function uses one parameter object: `ctx`.
- `ctx` namespaces:
  - `data?` for runtime inputs/config
  - `ui?` for optional UI handles
  - `deps` for all capabilities/side effects
- No free globals or side-effectful imports inside functions.

3. `${GLOBAL_MGMT_DIR}\map_file_gen.md` (fallback `${MGMT_DIR}\map_file_gen.md`)
- Per-project architecture map maintenance.
- Canonical project map path should be `${PROJMAP_DIR}\map.json` (fallback `${MGMT_DIR}\map.json` for legacy projects).
- Relationships are unified under `edges` only (`depends`, `context`, `io`, `control`).
- Update map whenever project code changes.
- Optional flow generation via `${MGMT_DIR}\vis\generate-flow.mjs`.

4. `${GLOBAL_MGMT_DIR}\meta_map_file_gen.md` (or project-local equivalent if present)
- Cross-project meta index strategy.
- Maintains global registry/index and normalized project summaries.
- Uses `edges` as single relationship source, including `indexes` edges source->project.
- Drives incremental refresh and bounded discovery.

5. `${PROJMAP_DIR}\threads\README.md` (fallback `${GLOBAL_MGMT_DIR}\threads\README.md`, then `${MGMT_DIR}\threads\README.md`)
- Runtime thread bootstrap behavior for `::init`.
- Uses current local datetime to choose `${SESSIONS_ROOT}\yyyy\MM\dd`.
- Scans latest `rollout-*.jsonl`, extracts `session_meta.payload.id`, and caches thread state.

## Unified Implementation Rules

### 1) Code Authoring

- Use vanilla JavaScript (`.js`) unless user requests otherwise.
- Keep modules focused; use aggregator files for composition.
- Enforce the existing module organization rules in `${BACKEND_DIR}`, `${FRONTEND_DIR}`, and `${PUBLIC_DIR}`.
- Do not place project code/assets outside `${SRC_DIR}` except for `${MGMT_DIR}` and `${WORKSPACE_ROOT}\AGENTS.md`; relocate non-exempt paths into `${BACKEND_DIR}`, `${FRONTEND_DIR}`, or `${PUBLIC_DIR}`.
- All generated functions must follow Context Object Pattern:
  - `@param {{ data?: object, ui?: object, deps: object }} ctx`
  - destructure `const { data = {}, ui = {}, deps } = ctx`
- Route side effects through `ctx.deps` only.
- If a dependency is missing, provide a brief dep proposal before coding.
- Log all runtime-visible actions to console and `${MGMT_DIR}\logs\YYMMDD\N.txt` when local logger exists.

### 2) Project Map (`map.json`)

When code changes in a project:

- Update `${PROJMAP_DIR}\map.json` by default.
- Refresh top-level `updated` (ISO time).
- Node shape:
  - `id`, `type`, `name`, `summary`, `features`, `edges`, `critical`, `files`, `children`
- `features` entries include:
  - `summary` (single line)
  - `flow` (ordered edge id list)
- `edges` entries include:
  - `id`, `kind`, `from`, `to`, optional `via`, optional `note`
- No `dependsOn` or `contextLinks`.

### 3) Meta Map and Registry

For workspace updates:

- Maintain `${GLOBAL_MGMT_DIR}\projects-index.json` as authoritative project list.
- Maintain `${GLOBAL_MGMT_DIR}\meta-map.json` (preferred) or existing configured file.
- Summarize project maps only. No full source maps.
- Keep `sources` statuses for malformed/missing maps and continue processing.

### 4) Thread Bootstrap (`::init`)

On user command `::init`:

- Read local datetime.
- Resolve session day dir under `${SESSIONS_ROOT}`.
- Scan rollout files by `LastWriteTime` desc.
- Parse first `session_meta`. Get `payload.id` as `thread_id`.
- Write cache at `${PROJMAP_DIR}\threads\current-thread.json` with:
  - `thread_id`
  - `turn_index` initialized (typically `0` for bootstrap)
  - timestamp and selected source file metadata
- Use `${PROJMAP_DIR}\threads\resolve-init-thread.ps1` as default resolver.
- Ensure project-local initialization enforces the `${MGMT_DIR}\toDo\` and `${MGMT_DIR}\errFix\` ordinal blank-file rules defined above, including the `${MGMT_DIR}\toDo\done\` and `${MGMT_DIR}\errFix\fixed\` subdir guidance.
- Ensure project-local initialization also maintains `${MGMT_DIR}\DLs\` as the mirrored Downloads staging area, populated from files in `${USER_ROOT}\Downloads` whose created date is the current date and from any referenced download paths found anywhere under `${MGMT_DIR}\toDo\` or `${MGMT_DIR}\errFix\`, with mirrored files renamed `dl-1.ext`, `dl-2.ext`, ... in newest-first ordinal order while preserving each file's original extension.

### 5) Project Refactor Bootstrap (`::refactor`)

On user command `::refactor`:

- Trigger scope is project-local only.
- Run refactor only for current project `${SRC_DIR}`.
- Do not trigger cross-project refactor from a project-scoped AGENTS workflow.
- Keep refactor in `${SRC_DIR}` unless asked otherwise.
- Optimize code for modular organization while preserving the existing `${BACKEND_DIR}`, `${FRONTEND_DIR}`, and `${PUBLIC_DIR}` structure.
- Apply branch/leaf node atomicity: leaf modules should implement one small concern with minimal surface area.
- Prefer small, concern-separated files and nested subdirectories over monolithic modules.
- Module code may use arbitrary nesting depth when it improves clarity and separation of concerns.
- Keep all refactor constraints, including:
  - Context Object Pattern function contracts from `context_obj_pattern.md`
  - side effects routed through `ctx.deps`
  - project file placement constraints under `${SRC_DIR}` (except `${MGMT_DIR}` and `${WORKSPACE_ROOT}\AGENTS.md`)
- After refactor, update `${PROJMAP_DIR}\map.json` and top `updated`.

### 6) Automatic Sync Governance

After each successful file edit, trigger non-blocking project-level background sync.

- Trigger scope:
  - apply to edits under ${SRC_DIR}, ${MGMT_DIR}, ${WORKSPACE_ROOT}\AGENTS.md, and ${WORKSPACE_ROOT}\.gitignore.
- Sync entrypoint:
  - use canonical ${GLOBAL_MGMT_DIR}\scripts\sync-push.ps1 (or a project-local wrapper if explicitly configured).
- Runtime behavior:
  - Run in background. Do not block task.
  - No duplicate sync jobs for same workspace.
  - If sync fail, keep going. Save short failure state for next retry.
- Queue maintenance behavior:
  - when the project is active in VS Code, the queue worker mirrors matching files from `${USER_ROOT}\Downloads` into `${MGMT_DIR}\DLs\`.
  - files are included if their creation date is today or if any path under `${USER_ROOT}\Downloads` is referenced anywhere inside files under `${MGMT_DIR}\toDo\` or `${MGMT_DIR}\errFix\`.
  - mirrored items are sorted newest-first in `${MGMT_DIR}\DLs\`, renamed `dl-1.ext`, `dl-2.ext`, ... by ordinal position while preserving each file's original extension, and refreshed idempotently.
## Operational Precedence

When instructions overlap, apply in this order:

1. User prompt/task requirements
2. `context_obj_pattern.md` for function signatures and side-effect boundaries
3. `project_struct_and_module_org.md` for codebase structure
4. `map_file_gen.md` for per-project map updates
5. `meta_map_file_gen.md` for global indexing and cross-project links
6. `threads/README.md` for init-time thread discovery and cache bootstrap

## Dynamic Path Rules

- Never hardcode a single project root when project context is dynamic.
- Build paths from `WORKSPACE_ROOT` and `USER_ROOT` variables.
- If a path is missing, fail with a clear message that includes resolved absolute path.
- Prefer `${PROJMAP_DIR}\map.json` (or `${MGMT_DIR}\map.json` for legacy) over `.txt`.

## Minimal Runtime Snippet (Path Resolution)

```powershell
$USER_ROOT = if ($env:USERPROFILE) { $env:USERPROFILE } else { [Environment]::GetFolderPath('UserProfile') }
$WORKSPACE_ROOT = (Get-Location).Path
$MGMT_DIR = Join-Path $WORKSPACE_ROOT 'mgmt'
$PROJMAP_DIR = Join-Path $MGMT_DIR 'projMap'
$SRC_DIR = Join-Path $WORKSPACE_ROOT 'src'
$BACKEND_DIR = Join-Path $SRC_DIR 'backend'
$FRONTEND_DIR = Join-Path $SRC_DIR 'frontend'
$PUBLIC_DIR = Join-Path $SRC_DIR 'public'
$GLOBAL_MGMT_DIR = Join-Path $USER_ROOT 'mgmt'
$SESSIONS_ROOT = Join-Path $USER_ROOT '.codex\sessions'
```

## Project Terms (Persistent)

- `audEps`: audio episode/session items shown in the library list (`audio-cards`).
- `audSegs`: selected checkpoint span segments within a loaded `audEp` (mapped to `selectedSpanIndex` + checkpoint series).



