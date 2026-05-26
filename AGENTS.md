# AGENTS.md

## Scope and Path Variables

Use dynamic roots. Keep portable.

- `USER_ROOT`: user home directory (example on this machine: `C:\Users\Qub`)
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

## Machine Setup Gate

First, verify machine setup and auto-sync.

- Required preflight command:
  - `${GLOBAL_MGMT_DIR}\scripts\ensure-machine-setup.ps1`
- Default policy:
  - if setup flag bad, run setup before continue.
  - save machine setup state in `${GLOBAL_MGMT_DIR}\state\machine-setup.<COMPUTERNAME>.json`.
- Auto-sync default `task`. `ahk` only when asked.

## Default Project AGENTS Generation

For new project, make project `AGENTS.md` at:

- `${WORKSPACE_ROOT}\AGENTS.md`

Make project copy of this file. Bind paths to `${WORKSPACE_ROOT}` and `${MGMT_DIR}`. Keep global rules.

No global bootstrap commands in project file. Skip `::mapSync`, `::propUpd`, `::gitSync`, `::ingest`, and `${USER_ROOT}`-scope `::refactor` bits.

Project `AGENTS.md` must also init mgmt queue folders under `${MGMT_DIR}`:

- `${MGMT_DIR}\toDo\`
- `${MGMT_DIR}\errFix\`
- `${MGMT_DIR}\logs\`

`toDo` and `errFix` must always contain at least one blank `.txt` file. Use ordinal file names starting at `1.txt` and continue in sequence. If a previously created file gains content, create the next ordinal file as a new blank `.txt` so a blank sentinel is always present.

`toDo` blocks nest by blank lines. Use tabs for children. Nested lines continue parent block.

- `${MGMT_DIR}\toDo\done\` is the manual spot for done `toDo` items.
- `${MGMT_DIR}\errFix\fixed\` is the manual spot for done `errFix` items.
- `${MGMT_DIR}\logs\` stores runtime console logs grouped by capture date and ordinal runtime instance.

`logs\` use `YYMMDD` dirs. One ordinal `.txt` per run.

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

Project-root task runner governance:

- Maintain `${WORKSPACE_ROOT}\package.json` as a workspace command entrypoint when the project uses nested npm packages.
- Provide forwarding scripts at project root for operational commands so they work from `${WORKSPACE_ROOT}` (example: map `launch:oms` to `${SRC_DIR}\backend\ingest\oms` when that package and script exist).
- Keep forwarding scripts idempotent during initialization/refactor/propagation and avoid duplicate script keys.

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

Automatic global indexing on project initialization:

- When init new project, upsert it into `${GLOBAL_MGMT_DIR}\projects-index.json`.
- Need fields:
  - `id` (stable, derived from project folder name unless user specifies another id)
  - `name`
  - `projectRoot` (absolute)
  - `mapPath` (absolute, default `${WORKSPACE_ROOT}\mgmt\projMap\map.json`)
  - `status` (`active`)
  - `updated` (ISO timestamp)
- After upsert, run `::mapSync` same flow.
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
- Init or refresh project `${WORKSPACE_ROOT}\AGENTS.md` from global copy. Include `${MGMT_DIR}\toDo\` and `${MGMT_DIR}\errFix\` blank-file rules.
- Project init also needs `${MGMT_DIR}\toDo\done\` and `${MGMT_DIR}\errFix\fixed\` move rules.
- After thread bootstrap, verify workspace-root run-script forwarding is present for discovered nested launch packages so root-level commands remain valid (including `launch:oms` when `${SRC_DIR}\backend\ingest\oms\package.json` exposes that script).

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
- This command also runs after new-project registry upsert.
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
  - If run from `${USER_ROOT}`, treat as global bootstrap across active projects.
  - If run inside a project root, do project-local bootstrap only.
  - No cross-project refactor from project root.
- Keep refactor in `${SRC_DIR}` unless asked otherwise.
- Optimize code for modular organization while preserving the existing `${BACKEND_DIR}`, `${FRONTEND_DIR}`, and `${PUBLIC_DIR}` structure.
- Apply branch/leaf node atomicity: leaf modules should implement one small concern with minimal surface area.
- Prefer small, concern-separated files and nested subdirectories over monolithic modules.
- Module code may use arbitrary nesting depth when it improves clarity and separation of concerns.
- Keep all refactor constraints, including:
  - Context Object Pattern function contracts from `context_obj_pattern.md`
  - side effects routed through `ctx.deps`
  - project file placement constraints under `${SRC_DIR}` (except `${MGMT_DIR}` and `${WORKSPACE_ROOT}\AGENTS.md`)
- Preserve and/or regenerate `${WORKSPACE_ROOT}\package.json` forwarding scripts for nested operational entrypoints so commands stay runnable from project root after structural changes (including `launch:oms` when applicable).
- Global `::refactor` orchestration should use `${GLOBAL_MGMT_DIR}\scripts\refactor-global.ps1`.
- Default mode: dry-run. Emit `${GLOBAL_MGMT_DIR}\refactor-global-report.json`. No file changes.
- Apply mode is explicit and plan-driven. Plan entries need extraction targets and migration details.
- During global assessment, check module boundaries and find reusable pieces.
- When extraction is approved in apply mode:
  - initialize new project(s) through `${GLOBAL_MGMT_DIR}\scripts\init-project.ps1`
  - upsert/update registry entries through `${GLOBAL_MGMT_DIR}\scripts\registry-upsert.ps1`
  - mark extracted projects as `projectType: shared-component` with lineage/sharing metadata in `${GLOBAL_MGMT_DIR}\projects-index.json`:
    - `extraction.mode`, `extraction.sourceProjects`, `extraction.extractedAt`
    - `sharing.exports`, `sharing.consumers`
  - migrate planned module paths into the shared project boundary and preserve clear ownership/contracts
  - update affected project dependencies/contracts to consume extracted boundaries
  - run `${GLOBAL_MGMT_DIR}\scripts\map-sync.ps1` once at end of successful apply sequence.
- After refactor, update `${PROJMAP_DIR}\map.json` and top `updated`.

### 8) Automatic Sync Governance

After each file edit, kick non-blocking background sync.

- Global scope (${USER_ROOT} context):
  - invoke ${GLOBAL_MGMT_DIR}\scripts\sync-push.ps1 in background after edits to governed files.
  - default should be non-blocking and not interrupt current task flow.
- Project scope (${WORKSPACE_ROOT} context):
  - trigger project-level background sync after edits to project files (${SRC_DIR}, ${MGMT_DIR}, ${WORKSPACE_ROOT}\AGENTS.md, ${WORKSPACE_ROOT}\.gitignore).
  - Use canonical sync entrypoint `${GLOBAL_MGMT_DIR}\scripts\sync-push.ps1` or project wrapper.
- Safety constraints:
  - preserve idempotency and avoid duplicate concurrent sync jobs for the same workspace.
  - if background sync fails, continue local task and record concise failure reason for next sync attempt.

### 9) Global Git Sync Bootstrap (`::gitSync`)

On user command `::gitSync`:

- Run canonical bidirectional sync entrypoint `${GLOBAL_MGMT_DIR}\scripts\auto-sync-tick.ps1`.
- Pull first. Then publish.
  - `git pull --rebase --autostash`
  - detect local managed changes
  - stage/commit managed changes only
  - `git push`
- Managed scope must be constrained to governed paths:
  - `${USER_ROOT}\AGENTS.md`
  - `${USER_ROOT}\.gitignore`
  - `${GLOBAL_MGMT_DIR}\`
  - active project roots from `${GLOBAL_MGMT_DIR}\projects-index.json`
- Use lock guard. No overlap.
- `::gitSync` should be safe to run repeatedly and should perform no mutations when there are no managed changes.
- If pull conflict, stash safe. Report short conflict. Keep user edits.

### 10) Global Project Ingest Bootstrap (`::ingest`)

On user command `::ingest`:

- Need explicit source dir path for untracked project.
- Resolve source path absolute. Fail clear if missing, bad, or tracked.
- Build project snapshot before change:
  - recursive file inventory (with common heavy/build/cache directories excluded)
  - extension/language distribution
  - bucketed target plan across `${BACKEND_DIR}`, `${FRONTEND_DIR}`, `${PUBLIC_DIR}`
- Init new governed project boundary with `${GLOBAL_MGMT_DIR}\scripts\init-project.ps1`.
- Ingest source files into `${SRC_DIR}` only. Keep relative shape.
- Write ingest report in project state, like `${PROJMAP_DIR}\state\ingest-report.json`.
- Upsert new project into `${GLOBAL_MGMT_DIR}\projects-index.json` and `${GLOBAL_MGMT_DIR}\meta-map.json` through normal init/map-sync.
- Global-only bootstrap. No `::ingest` in project `AGENTS.md`.

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

