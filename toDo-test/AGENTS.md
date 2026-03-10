# AGENTS.md

## Scope and Path Variables

Use dynamic roots so instructions are portable.

- `USER_ROOT`: user home directory (default `C:\Users\Qub`)
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

## Default Project AGENTS Generation

For every new project, generate a project-scoped `AGENTS.md` at:

- `${WORKSPACE_ROOT}\AGENTS.md`

This project-scoped file must be created by default as a modified derivative of this global file, with project-specific path bindings and instructions adjusted to `${WORKSPACE_ROOT}` and `${MGMT_DIR}` while preserving global standards and precedence.

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

### 5) Project Refactor Bootstrap (`::refactor`)

On user command `::refactor`:

- Trigger scope is project-local only.
- Run refactor only for the current project's `${SRC_DIR}`.
- Do not trigger cross-project refactor from a project-scoped AGENTS workflow.
- Scope refactor operations to `${SRC_DIR}` only unless explicitly directed otherwise.
- Optimize code for modular organization while preserving the existing `${BACKEND_DIR}`, `${FRONTEND_DIR}`, and `${PUBLIC_DIR}` structure.
- Apply branch/leaf node atomicity: leaf modules should implement one small concern with minimal surface area.
- Prefer small, concern-separated files and nested subdirectories over monolithic modules.
- Module code may use arbitrary nesting depth when it improves clarity and separation of concerns.
- Preserve all pre-defined constraints during refactor, including:
  - Context Object Pattern function contracts from `context_obj_pattern.md`
  - side effects routed through `ctx.deps`
  - project file placement constraints under `${SRC_DIR}` (except `${MGMT_DIR}` and `${WORKSPACE_ROOT}\AGENTS.md`)
- After refactor edits, update `${PROJMAP_DIR}\map.json` and refresh top-level `updated` timestamp.
### 6) Automatic Sync Governance

After each successful file edit, trigger non-blocking project-level background sync.

- Trigger scope:
  - apply to edits under ${SRC_DIR}, ${MGMT_DIR}, ${WORKSPACE_ROOT}\AGENTS.md, and ${WORKSPACE_ROOT}\.gitignore.
- Sync entrypoint:
  - use canonical ${GLOBAL_MGMT_DIR}\scripts\sync-push.ps1 (or a project-local wrapper if explicitly configured).
- Runtime behavior:
  - run in background and do not block current task execution.
  - avoid launching duplicate concurrent sync jobs for the same project workspace.
  - on sync failure, continue local workflow and surface concise failure state for the next retry.
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



