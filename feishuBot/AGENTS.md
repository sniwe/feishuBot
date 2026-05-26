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
- Maintain management queue folders under `${MGMT_DIR}`:
  - `${MGMT_DIR}\toDo\`
  - `${MGMT_DIR}\errFix\`
  - `${MGMT_DIR}\logs\`
  Each dir need one blank `.txt`. Use `1.txt`, `2.txt`, etc. If one gets content, make next blank sentinel.

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

## Thread Bootstrap (`::init`)

- During project-local `::init`, ensure the `${MGMT_DIR}\toDo\` and `${MGMT_DIR}\errFix\` ordinal blank-file rules are initialized and enforced, including the `${MGMT_DIR}\toDo\done\` and `${MGMT_DIR}\errFix\fixed\` subdir guidance.

## Project Refactor Bootstrap (`::refactor`)

- Run project-local refactor only within `${SRC_DIR}`.
- Preserve modular boundaries and Context Object Pattern.
- Update `${PROJMAP_DIR}\map.json` and refresh `updated` timestamp.

## Default Response Style

- Use `caveman` skill in `full` mode by default unless user asks for another style.
