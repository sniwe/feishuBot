# Repository Guidelines

## Project Structure & Module Organization
Use vanilla `.js` by default unless task requires otherwise.
Use hierarchical modular folders with clear separation of concerns.
Use aggregator files for composition and import/export boundaries.
Use Context Object Pattern for cross-module interactions (see `${GLOBAL_MGMT_DIR}\context_obj_pattern.md`, fallback `${MGMT_DIR}\context_obj_pattern.md`).

Default source layout:
- `${SRC_DIR}\backend`
- `${SRC_DIR}\frontend`
- `${SRC_DIR}\public`

Project code/assets must remain under `${SRC_DIR}` (except `${MGMT_DIR}` and `${WORKSPACE_ROOT}\AGENTS.md`).

## Project Map Generation (`mgmt/projMap/map.json`)
Maintain map at `${PROJMAP_DIR}\map.json` (legacy fallback `${MGMT_DIR}\map.json`).
- Keep `updated` current.
- Use `edges` as single relationship source.
- Node and edge schemas follow `map_file_gen.md`.
- Update map after code changes, including module extraction to shared projects.

## Shared-Project Refactor Considerations
During global refactor assessments:
- Identify modules with stable interfaces and multi-project reuse value.
- Prefer extracting these into `shared-component` projects.
- Update consumer projects to depend on extracted boundaries/contracts.
- Keep per-project maps and global meta-map consistent after extraction.

## Management Packaging
Project management assets should remain under `${PROJMAP_DIR}`:
- `map.json`
- `threads/`
- `state/`
- `modules/thread-map-tracker/`
- `scripts/`
