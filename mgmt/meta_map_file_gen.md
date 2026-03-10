## Meta Map Generation (`mgmt/meta-map.json`)

Maintain a global hierarchical JSON meta map that indexes project maps under `${USER_ROOT}`.

- Meta map location: `${GLOBAL_MGMT_DIR}\meta-map.json`
- Project registry location: `${GLOBAL_MGMT_DIR}\projects-index.json`
- Update top-level `updated` (ISO 8601) on every refresh.

### Purpose

- Provide one efficient index for per-project maps.
- Make cross-project relationships visible without inlining full project maps.
- Support incremental refresh from authoritative registry.

### Registry (Primary Source)

Use `${GLOBAL_MGMT_DIR}\projects-index.json` as authoritative.

Top-level fields:
- `id`, `root`, `updated`, `projects`

`projects[]` required fields:
- `id`, `name`, `projectRoot`, `mapPath`, `status`, `updated`
- `projectType`: `application | shared-component`
- `extraction`:
  - `mode`: `native | extracted`
  - `sourceProjects`: string[]
  - `extractedAt`: ISO timestamp or `null`
- `sharing`:
  - `exports`: string[]
  - `consumers`: string[]

### Map Resolution

For each active project:
1. `${WORKSPACE_ROOT}\mgmt\projMap\map.json`
2. `${WORKSPACE_ROOT}\mgmt\map.json` (legacy fallback)
3. `projects[].mapPath` as last fallback

### JSON Shape (Meta)

Top-level object:
- `id`, `type`, `name`, `summary`, `root`, `updated`, `stats`, `sources`, `nodes`, `edges`, `children`

`stats` minimum:
- `total_projects`, `active_projects`, `sources_total`, `sources_ok`, `sources_missing`, `sources_parse_error`, `cross_edges`

`sources[]`:
- `id`, `projectId`, `projectRoot`, `mapPath`, `status` (`ok|parse_error|missing|skipped`), optional `error`, `updated`

`nodes[]` (project summary):
- `id`, `type: project`, `name`, `projectType`, `summary`, `projectRoot`, `mapPath`, optional `critical`, optional `children`

`edges[]`:
- `id`, `kind` (`depends|context|io|control|indexes`), `from`, `to`, optional `via`, optional `note`

Rules:
- Always add one `indexes` edge from each source id to its project node.
- Add cross-project sharing edges for extracted shared components:
  - Consumer project -> shared project (`depends`) when consumer/source evidence exists.
  - Optional `context`/`control` only when explicit map/contract evidence exists.
- Do not introduce `dependsOn` or `contextLinks`.

### Discovery and Fault Tolerance

- Primary: registry only.
- Optional bounded fallback scan when registry is missing or explicitly enabled.
- On malformed/missing maps, keep `sources` entry with status and continue processing.
- Deduplicate edges by `(kind, from, to, via)`.

### Maintenance Workflow

- Refresh meta map whenever project map or registry changes.
- Upsert registry on project initialization, extraction, archive, or move.
- For global `::refactor` extraction workflows, run one final meta refresh at end.
