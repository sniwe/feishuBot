## Map File Generation (`mgmt/projMap/map.json`)

Maintain a hierarchical JSON map of features and relationships for each project, with unified `edges`.

- Project root: use active workspace root as `<project_root>`.
- Canonical location: `<project_root>\mgmt\projMap\map.json`
- Legacy fallback location: `<project_root>\mgmt\map.json`
- Update top-level `updated` (ISO 8601) whenever modified.

### Node Shape

Project map top-level should include:
- `id`, `type`, `name`, `summary`, `root`, `updated`, `nodes`, `edges`, `children`

Each `nodes[]` entry:
- `id`, `type`, `name`, `summary`, `features`, `edges`, `critical`, `files`, `children`

Each `features[]` entry:
- `summary` (single line)
- `flow` (ordered array of edge ids)

Each `edges[]` entry:
- `id`, `kind` (`depends`, `context`, `io`, `control`), `from`, `to`, optional `via`, optional `note`

Rules:
- Use `edges` as the single source of relationships.
- Do not use `dependsOn` or `contextLinks`.
- Prefer Context Object Pattern evidence for `context` and `via` fields.

### Update Triggers

- Update map whenever project code changes.
- Update map when refactor extracts or consumes shared component projects.
- Keep module/file lists current for moved or renamed assets.

### Shared-Project Extraction Mapping

When modules are extracted into a new shared project:
- Source project map must remove extracted internal module nodes and add dependency edges to shared boundaries.
- Shared project map must add exported module nodes and any surfaced contract/interface nodes.
- Use `depends` edges from consumer project modules to shared project interfaces/modules.
- Add concise `note`/`via` describing contract evidence.

### Optional Flow Visualization

If visualization tooling exists:
- Script path: `<project_root>\mgmt\vis\generate-flow.mjs`
- Run after map update.

Setup:
- Ensure Node.js is installed when using visualization.
