# AGENTS.md

## Scope and Path Variables

Use dynamic roots so instructions are portable.

- `USER_ROOT`: user home directory (example on this machine: `C:\Users\Qub`)
- `WORKSPACE_ROOT`: active project root (current working project)
- `MGMT_DIR`: `${WORKSPACE_ROOT}\mgmt`
- `PROJMAP_DIR`: `${MGMT_DIR}\projMap` (default project-scoped management package)
- `SRC_DIR`: `${WORKSPACE_ROOT}\src`
- `BACKEND_DIR`: `${SRC_DIR}\backend`
- `FRONTEND_DIR`: `${SRC_DIR}\frontend`
- `PUBLIC_DIR`: `${SRC_DIR}\public`
- `GLOBAL_MGMT_DIR`: `${USER_ROOT}\mgmt`
- `SESSIONS_ROOT`: `${USER_ROOT}\.codex\sessions`

Resolve paths from these variables first, then from explicit user-provided absolute paths.

## Machine Setup Gate

Before executing any other workflow instructions, verify machine setup state and auto-sync installation.

- Required preflight command:
  - `${GLOBAL_MGMT_DIR}\scripts\ensure-machine-setup.ps1`
- Default policy:
  - if setup flag is missing/invalid for current machine, run setup automatically before continuing.
  - persist machine-local setup state in `${GLOBAL_MGMT_DIR}\state\machine-setup.<COMPUTERNAME>.json`.
- Default auto-sync mode for setup gate is `task` (Task Scheduler). `ahk` remains supported when explicitly requested.

## Default Project AGENTS Generation

For every new project, generate a project-scoped `AGENTS.md` at:

- `${WORKSPACE_ROOT}\AGENTS.md`

This project-scoped file must be created by default as a modified derivative of this global file, with project-specific path bindings and instructions adjusted to `${WORKSPACE_ROOT}` and `${MGMT_DIR}` while preserving global standards and precedence.

When generating project-scoped `${WORKSPACE_ROOT}\AGENTS.md` files, do not include global bootstrap command guidance. Omit global-only command sections/references (including `::mapSync`, `::propUpd`, `::gitSync`, `::ingest`, and any `${USER_ROOT}`-scope behavior under `::refactor`) from the generated project-scoped derivative.

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

- All project files and directories must be placed under `${BACKEND_DIR}`, `${FRONTEND_DIR}`, or `${PUBLIC_DIR}` unless they are management assets under `${MGMT_DIR}` or the project-scoped `${WORKSPACE_ROOT}\AGENTS.md`.
- During initialization and propagation, coerce any non-exempt project paths into one of the three `${SRC_DIR}` subdirectories.

Project `.gitignore` governance:

- Project-scoped `${WORKSPACE_ROOT}\AGENTS.md` files must create and automatically maintain `${WORKSPACE_ROOT}\.gitignore`.
- The maintained `.gitignore` must cover project-scope unwieldy, generated, and private/sensitive artifacts (for example local caches, large transient outputs, machine-local secrets, and runtime state files) while preserving intentional tracked source and management files.
- During initialization and propagation, update `.gitignore` idempotently (no duplicate entries, preserve project-specific rules outside governed sections).

Project-scope management bootstrap under `${PROJMAP_DIR}` must include:

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

Project-scoped `mgmt\README.md` should document this package as:

- canonical map at `${PROJMAP_DIR}\map.json`
- thread discovery/cache in `${PROJMAP_DIR}\threads\`
- map delta state/history in `${PROJMAP_DIR}\state\`
- reusable tracking module in `${PROJMAP_DIR}\modules\thread-map-tracker\`
- orchestration scripts in `${PROJMAP_DIR}\scripts\`

Automatic global indexing on project initialization:

- Whenever a new project is initialized, immediately upsert it into `${GLOBAL_MGMT_DIR}\projects-index.json`.
- Required registry fields for the new project entry:
  - `id` (stable, derived from project folder name unless user specifies another id)
  - `name`
  - `projectRoot` (absolute)
  - `mapPath` (absolute, default `${WORKSPACE_ROOT}\mgmt\projMap\map.json`)
  - `status` (`active`)
  - `updated` (ISO timestamp)
- After registry upsert, run `::mapSync` in the same initialization flow.
- Result: each newly initialized project is indexed immediately for all later `::mapSync` runs.
- New projects are immediately eligible for `::propUpd` governance checks and propagation.

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

### 2) Project Map (`map.json`)

When code changes in a project:

- Update `${PROJMAP_DIR}\map.json` by default.
- Ensure top-level `updated` is refreshed (ISO timestamp).
- Node shape:
  - `id`, `type`, `name`, `summary`, `features`, `edges`, `critical`, `files`, `children`
- `features` entries include:
  - `summary` (single line)
  - `flow` (ordered edge id list)
- `edges` entries include:
  - `id`, `kind`, `from`, `to`, optional `via`, optional `note`
- Do not use `dependsOn` or `contextLinks`.

### 3) Meta Map and Registry

For workspace-level updates:

- Maintain `${GLOBAL_MGMT_DIR}\projects-index.json` as authoritative project list.
- Maintain `${GLOBAL_MGMT_DIR}\meta-map.json` (preferred) or existing configured file.
- Only summarize project maps in meta map; do not inline full source maps.
- Keep `sources` statuses for malformed/missing maps and continue processing.

### 4) Thread Bootstrap (`::init`)

On user command `::init`:

- Read local current datetime.
- Resolve session day directory under `${SESSIONS_ROOT}`.
- Scan recent rollout files by `LastWriteTime` descending.
- Parse first `session_meta` and extract `payload.id` as `thread_id`.
- Write cache at `${PROJMAP_DIR}\threads\current-thread.json` with:
  - `thread_id`
  - `turn_index` initialized (typically `0` for bootstrap)
  - timestamp and selected source file metadata
- Use `${PROJMAP_DIR}\threads\resolve-init-thread.ps1` as default resolver script location.

### 5) Global Map Sync Bootstrap (`::mapSync`)

On user command `::mapSync`:

- Ensure `${GLOBAL_MGMT_DIR}\projects-index.json` exists. If missing, create:
  - `id: "projects-index"`
  - `root: "${USER_ROOT}"`
  - `updated: <ISO timestamp>`
  - `projects: []`
- Ensure `${GLOBAL_MGMT_DIR}\meta-map.json` exists. If missing, create:
  - `id: "meta-map"`
  - `type: "meta"`
  - `name: "Qub Workspace Project Map Index"`
  - `summary: "Aggregated index of project maps under ${USER_ROOT}"`
  - `root: "${USER_ROOT}"`
  - `updated: <ISO timestamp>`
  - `stats` with zeroed counters
  - `sources: []`, `nodes: []`, `edges: []`, `children: []`
- Load registry projects from `${GLOBAL_MGMT_DIR}\projects-index.json` as primary discovery.
- For each active project, resolve canonical map path:
  - `${WORKSPACE_ROOT}\mgmt\projMap\map.json` (project default)
  - fallback `${WORKSPACE_ROOT}\mgmt\map.json` (legacy)
- Update `${GLOBAL_MGMT_DIR}\meta-map.json` with project summaries only (no full project map inlining).
- Add `indexes` edges from each source descriptor to its project node.
- Keep malformed/missing maps in `sources` with status (`parse_error` or `missing`) and continue processing.
- Refresh top-level `updated` and `stats` on every successful sync.
- This command is also invoked automatically after new-project initialization registry upsert.
- For cloned environments on new machines, use `${GLOBAL_MGMT_DIR}\scripts\bootstrap-machine.ps1` to rebase registry paths before first sync.

### 6) Project Propagation Bootstrap (`::propUpd`)

On user command `::propUpd`:

- Use `${GLOBAL_MGMT_DIR}\projects-index.json` as the authoritative project set to identify which projects are checked.
- Compare each project-scoped `${WORKSPACE_ROOT}\AGENTS.md` against current global `${USER_ROOT}\AGENTS.md` project-initialization governance specs.
- Determine alignment status per project (`aligned`, `drifted`, `missing_agents`, `error`) and capture reason codes.
- For drifted projects, propagate in this order:
  - update project `${WORKSPACE_ROOT}\AGENTS.md` governed sections first
  - then update `${MGMT_DIR}` / `${PROJMAP_DIR}` bootstrap files and subdirectories required by current global standards
  - then re-validate project alignment after edits
- Orchestrate using sub-agents only:
  - one coordinator/planner sub-agent builds the project task graph and execution plan
  - one worker sub-agent per project performs compare/apply/validate for its assigned project
  - coordinator aggregates outcomes and writes final report
- Discovery source precedence:
  - primary: `${GLOBAL_MGMT_DIR}\projects-index.json` (`status: active` projects)
  - when a valid global index exists, enforce scope to direct child project roots under `${USER_ROOT}` only
  - optional bounded fallback discovery when registry missing or explicitly enabled:
    - root scope must be `${USER_ROOT}` only
    - default discovery depth is one level below `${USER_ROOT}` (no recursive descent into nested trees such as `Downloads\...` unless explicitly requested)
    - include patterns `**\AGENTS.md`, `**\mgmt\projMap\map.json`, `**\mgmt\map.json`
    - exclude heavy/system paths and dependency caches (`C:\Windows`, `C:\Program Files*`, `.git`, `node_modules`, `.venv`, `dist`, `build`)
- Reporting artifacts:
  - write propagation report to `${GLOBAL_MGMT_DIR}\propagation-report.json`
  - include per-project: `projectRoot`, `status_before`, `status_after`, `changes_applied`, `changed_files`, `errors`, `started_at`, `finished_at`
  - include top-level summary counts and run metadata
- Safety and idempotency:
  - support dry-run mode (`apply: false`) that computes diffs and report only
  - default mode is non-destructive and limited to governed files/sections
  - preserve project-specific overrides outside globally governed sections
  - repeated runs with no drift must produce no file mutations
- After propagation:
  - if at least one project changed successfully, invoke `::mapSync` once at end to refresh global registry/meta-map references
  - if no project changed, still emit report and skip `::mapSync` unless explicitly requested

### 7) Project Refactor Bootstrap (`::refactor`)

On user command `::refactor`:

- Trigger scope is determined by current directory:
  - If invoked from `${USER_ROOT}`, treat as global bootstrap and refactor across all active projects in `${GLOBAL_MGMT_DIR}\projects-index.json`.
  - If invoked from within a specific project root (`${WORKSPACE_ROOT}`), run project-local bootstrap and refactor only that project's `${SRC_DIR}`.
  - Do not trigger cross-project refactor when current directory is a project root.
- Scope refactor operations to `${SRC_DIR}` only unless explicitly directed otherwise.
- Optimize code for modular organization while preserving the existing `${BACKEND_DIR}`, `${FRONTEND_DIR}`, and `${PUBLIC_DIR}` structure.
- Apply branch/leaf node atomicity: leaf modules should implement one small concern with minimal surface area.
- Prefer small, concern-separated files and nested subdirectories over monolithic modules.
- Module code may use arbitrary nesting depth when it improves clarity and separation of concerns.
- Preserve all pre-defined constraints during refactor, including:
  - Context Object Pattern function contracts from `context_obj_pattern.md`
  - side effects routed through `ctx.deps`
  - project file placement constraints under `${SRC_DIR}` (except `${MGMT_DIR}` and `${WORKSPACE_ROOT}\AGENTS.md`)
- Global `::refactor` orchestration should use `${GLOBAL_MGMT_DIR}\scripts\refactor-global.ps1`.
- Default execution mode is assessment-only (dry-run) and must emit `${GLOBAL_MGMT_DIR}\refactor-global-report.json` without mutating project files.
- Apply mode is explicit and plan-driven (via `-Apply` with optional `-PlanPath`); plan entries should include extraction targets and migration details (`sourceProjectId`, `targetProjectId`, `targetProjectRoot`, optional `exports`, optional `consumers`, optional `modulePaths`).
- During global assessment, perform balanced best-practice evaluation of modular boundaries and identify candidate reusable components for extraction into shared projects.
- When extraction is approved in apply mode:
  - initialize new project(s) through `${GLOBAL_MGMT_DIR}\scripts\init-project.ps1`
  - upsert/update registry entries through `${GLOBAL_MGMT_DIR}\scripts\registry-upsert.ps1`
  - mark extracted projects as `projectType: shared-component` with lineage/sharing metadata in `${GLOBAL_MGMT_DIR}\projects-index.json`:
    - `extraction.mode`, `extraction.sourceProjects`, `extraction.extractedAt`
    - `sharing.exports`, `sharing.consumers`
  - migrate planned module paths into the shared project boundary and preserve clear ownership/contracts
  - update affected project dependencies/contracts to consume extracted boundaries
  - run `${GLOBAL_MGMT_DIR}\scripts\map-sync.ps1` once at end of successful apply sequence.
- After refactor edits, update `${PROJMAP_DIR}\map.json` and refresh top-level `updated` timestamp.

### 8) Automatic Sync Governance

After each successful file edit, trigger non-blocking background sync.

- Global scope (${USER_ROOT} context):
  - invoke ${GLOBAL_MGMT_DIR}\scripts\sync-push.ps1 in background after edits to governed files.
  - default should be non-blocking and not interrupt current task flow.
- Project scope (${WORKSPACE_ROOT} context):
  - trigger project-level background sync after edits to project files (${SRC_DIR}, ${MGMT_DIR}, ${WORKSPACE_ROOT}\AGENTS.md, ${WORKSPACE_ROOT}\.gitignore).
  - use canonical sync entrypoint ${GLOBAL_MGMT_DIR}\scripts\sync-push.ps1 (or project-local wrapper when present).
- Safety constraints:
  - preserve idempotency and avoid duplicate concurrent sync jobs for the same workspace.
  - if background sync fails, continue local task and record concise failure reason for next sync attempt.

### 9) Global Git Sync Bootstrap (`::gitSync`)

On user command `::gitSync`:

- Run canonical bidirectional sync entrypoint `${GLOBAL_MGMT_DIR}\scripts\auto-sync-tick.ps1`.
- Behavior must be pull-first to ingest remote updates before local publish:
  - `git pull --rebase --autostash`
  - detect local managed changes
  - stage/commit managed changes only
  - `git push`
- Managed scope must be constrained to governed paths:
  - `${USER_ROOT}\AGENTS.md`
  - `${USER_ROOT}\.gitignore`
  - `${GLOBAL_MGMT_DIR}\`
  - active project roots from `${GLOBAL_MGMT_DIR}\projects-index.json`
- Must use lock-guarding to avoid overlapping runs on the same machine/session.
- `::gitSync` should be safe to run repeatedly and should perform no mutations when there are no managed changes.
- If pull encounters conflicts, preserve local changes safely (stash/autostash), emit concise conflict diagnostics, and do not discard user edits.

### 10) Global Project Ingest Bootstrap (`::ingest`)

On user command `::ingest`:

- Require an explicit source directory path that points to a project not currently tracked in `${GLOBAL_MGMT_DIR}\projects-index.json`.
- Resolve and validate the source path as absolute; fail with a clear error if missing/invalid or already tracked.
- Build a project-understanding snapshot before mutation:
  - recursive file inventory (with common heavy/build/cache directories excluded)
  - extension/language distribution
  - bucketed target plan across `${BACKEND_DIR}`, `${FRONTEND_DIR}`, `${PUBLIC_DIR}`
- Initialize a new governed project boundary using `${GLOBAL_MGMT_DIR}\scripts\init-project.ps1` so the result conforms to current project initialization and tracking rules.
- Ingest source files into the initialized project under `${SRC_DIR}` only, preserving relative structure under bucketed ingest paths.
- Write ingest report artifacts under project management state (for example `${PROJMAP_DIR}\state\ingest-report.json`) summarizing source analysis and copied file counts.
- Ensure the new project is upserted into `${GLOBAL_MGMT_DIR}\projects-index.json` and included in `${GLOBAL_MGMT_DIR}\meta-map.json` through normal init/map-sync flow.
- Scope: global-only bootstrap command; do not include `::ingest` sections in project-scoped generated `AGENTS.md`.

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

