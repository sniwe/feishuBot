# Minimum Changes for Multi-Computer GitHub Portability (Updated)

## Goal
Keep global governance (`AGENTS.md` + `mgmt`) portable across machines while preserving current automation (`::mapSync`, `::propUpd`, `::refactor`) and map integrity.

## What changed since last version
Your framework now includes:
- Canonical scripts under `mgmt\scripts\`:
  - `bootstrap-machine.ps1`
  - `registry-upsert.ps1`
  - `map-sync.ps1`
  - `init-project.ps1`
  - `refactor-global.ps1`
- Shared-project template under `mgmt\templates\shared-project\`
- Project `.gitignore` governance (auto-maintained block)
- Updated global `::refactor` behavior (dry-run default, plan-driven apply)
- Local-file visualization package under `mgmt\visualization\`

These must be considered in portability setup.

## Minimum required changes

### 1) Keep root/path rules machine-neutral
In global `AGENTS.md`, avoid requiring literal `C:\Users\Qub` as a hard dependency.

Use this model:
- `USER_ROOT`: resolved from environment
- `GLOBAL_MGMT_DIR = ${USER_ROOT}\mgmt` (or explicit repo root strategy if you standardize one)
- `WORKSPACE_ROOT`: per-project root

Treat `C:\Users\Qub` as an example, not a required value.

### 2) Preserve canonical script entrypoints
Do not fork behavior into ad hoc commands on each machine.
Use these scripts as authoritative entrypoints after clone:
- `mgmt\scripts\bootstrap-machine.ps1`
- `mgmt\scripts\registry-upsert.ps1`
- `mgmt\scripts\map-sync.ps1`
- `mgmt\scripts\init-project.ps1`
- `mgmt\scripts\refactor-global.ps1`

Portability requirement: ensure PowerShell execution policy allows these scripts in your internal environment.

### 3) Keep `projects-index.json` schema compatible
`projects-index.json` now carries more than path metadata. Each project entry should retain:
- `id`, `name`, `projectRoot`, `mapPath`, `status`, `updated`
- `projectType`
- `extraction` (`mode`, `sourceProjects`, `extractedAt`)
- `sharing` (`exports`, `consumers`)

On a new machine, path rebasing must update `projectRoot` and `mapPath` while preserving the extra fields.

### 4) Run canonical map rebuild after path rebasing
After cloning + path normalization, run:
- `& <repo>\mgmt\scripts\bootstrap-machine.ps1`

This will:
- rebase `projects-index.json` roots/paths for the current machine
- keep schema fields (`projectType`, `extraction`, `sharing`) intact
- run canonical `map-sync.ps1`
- regenerate visualization payloads when available

Expected outcome:
- `mgmt\meta-map.json` refreshed
- `sources/nodes/edges` consistent with active projects
- no stale `missing` entries for moved paths

### 5) Keep project-scoped AGENTS derivative rules intact
Project AGENTS generation/propagation must continue to enforce:
- no global bootstrap command instructions in project files
- local-only project `::refactor` instructions
- governed `.gitignore` creation/maintenance

If needed after clone, run `::propUpd` from global scope to re-align project AGENTS.

### 6) Include templates and visualization in repo portability scope
Also include and sync:
- `mgmt\templates\shared-project\` (required by extraction/init workflows)
- `mgmt\visualization\` (if you rely on map visualization)

After clone, regenerate visualization payload:
- `& <repo>\mgmt\visualization\generate-graph-data.ps1`

## Minimal first-run checklist on a new machine
1. Clone private repo to desired local path.
2. Run `& <repo>\mgmt\scripts\bootstrap-machine.ps1`.
3. Confirm rebased paths in `mgmt\projects-index.json`.
4. Optionally run `::propUpd` to enforce project AGENTS + `.gitignore` governance.
5. Regenerate visualization data if used.

## Practical bottom line
If you only do three things:
1. Rebase `projects-index.json` paths without dropping new schema fields.
2. Use canonical scripts (`map-sync.ps1`, `init-project.ps1`, `refactor-global.ps1`) as the only operational entrypoints.
3. Re-run sync/propagation so maps, AGENTS, and `.gitignore` governance are machine-consistent.
