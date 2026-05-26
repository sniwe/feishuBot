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
- Maintain `${MGMT_DIR}\toDo\` and `${MGMT_DIR}\errFix\` as management queue folders. Each must always contain at least one blank ordinal `.txt` file (`1.txt`, `2.txt`, ...). When any previously created ordinal file gains content, create the next ordinal blank `.txt` so a blank sentinel is always present.
  - `toDo` blocks nest by blank lines. Use tabs for children. Nested lines continue parent block.
- `${MGMT_DIR}\toDo\done\` is the manual destination for completed `toDo` items, and `${MGMT_DIR}\errFix\fixed\` is the manual destination for completed `errFix` items.
- Maintain `${MGMT_DIR}\logs\` as a runtime console log sink. Logs must be captured under `${MGMT_DIR}\logs\YYMMDD\N.txt`, where `YYMMDD` is the capture date and `N` is a 1-based ordinal file for that runtime instance.
- Emit comprehensive console logging for all user actions, state transitions, and state changes, and capture the same stream to the active `${MGMT_DIR}\logs\YYMMDD\N.txt` file (append-only for that runtime instance).
- Keep project code/assets under `${SRC_DIR}` subdirectories.
- Create and auto-maintain `${WORKSPACE_ROOT}\.gitignore` for generated/unwieldy/private artifacts.
- Use Context Object Pattern for authored functions.
- Update `${PROJMAP_DIR}\map.json` after code changes.

## Thread Bootstrap (`::init`)

- Ensure project-local `AGENTS.md` initialization includes (and does not omit) the `${MGMT_DIR}\toDo\` and `${MGMT_DIR}\errFix\` ordinal blank-file rules, including the `${MGMT_DIR}\toDo\done\` and `${MGMT_DIR}\errFix\fixed\` subdir guidance.
- During `::init`, enforce that both `${MGMT_DIR}\toDo\` and `${MGMT_DIR}\errFix\` exist and each contains at least one blank ordinal `.txt` file (create `1.txt` if empty; if the last ordinal has content, create the next blank ordinal), and keep the manual completion subdirs available.

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

## Default Response Style

- Use `caveman` skill in `full` mode by default unless user asks for another style.
