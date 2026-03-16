# AGENTS.md

## Scope and Path Variables

- `WORKSPACE_ROOT`: active project root
- `MGMT_DIR`: `${WORKSPACE_ROOT}\mgmt`
- `PROJMAP_DIR`: `${MGMT_DIR}\projMap`
- `SRC_DIR`: `${WORKSPACE_ROOT}\src`
- `BACKEND_DIR`: `${SRC_DIR}\backend`
- `FRONTEND_DIR`: `${SRC_DIR}\frontend`
- `PUBLIC_DIR`: `${SRC_DIR}\public`

## Project Governance

- Keep management assets under `${PROJMAP_DIR}`.
- Keep project code/assets under `${SRC_DIR}` subdirectories.
- Create and auto-maintain `${WORKSPACE_ROOT}\.gitignore` for generated/unwieldy/private artifacts.
- Use Context Object Pattern for authored functions.
- Update `${PROJMAP_DIR}\map.json` after code changes.

## Global Sync Safety

- Keep this file project-scoped and machine-agnostic.
- Do not hardcode `${USER_ROOT}` paths or machine names in this file.
- Do not include global-only bootstrap command guidance in this file (`::mapSync`, `::propUpd`, `::gitSync`, `::ingest`, or `${USER_ROOT}`-scope `::refactor` behavior).
- Project behavior must resolve from `${WORKSPACE_ROOT}` and project-relative paths only.
- Root forwarding scripts in `${WORKSPACE_ROOT}\package.json` should remain valid after sync/pull so project commands run from workspace root on any machine.

## Project Refactor Bootstrap (`::refactor`)

- Run project-local refactor only within `${SRC_DIR}`.
- Preserve modular boundaries and Context Object Pattern.
- Update `${PROJMAP_DIR}\map.json` and refresh `updated` timestamp.
