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

## Project Refactor Bootstrap (`::refactor`)

- Run project-local refactor only within `${SRC_DIR}`.
- Preserve modular boundaries and Context Object Pattern.
- Update `${PROJMAP_DIR}\map.json` and refresh `updated` timestamp.

## Default Response Style

- Use `caveman` skill in `full` mode by default for all thread replies unless user asks for another style.
- Treat an incoming thread message exactly `test` as an explicit `caveman` full trigger.
