# Guide: Required Framework Edits After Global `::refactor` Extraction Rule

## Why this guide exists
Global `::refactor` now allows/mandates extracting reusable modules into new shared projects. For mapping and management to remain functional, initialization, registry, meta-map, and seed docs/scripts must be aligned.

## Inspection Summary (current state)
- Global rule exists in `C:\Users\Qub\AGENTS.md` under `::refactor`.
- Project map standard in AGENTS is `mgmt\projMap\map.json`.
- `C:\Users\Qub\mgmt\map_file_gen.md` still documents legacy `mgmt\map.txt`.
- `C:\Users\Qub\mgmt\meta_map_file_gen.md` still documents legacy `meta-map.txt` and `mgmt\map.txt` precedence.
- `C:\Users\Qub\mgmt\project_struct_and_module_org.md` still references `mgmt\map.txt`.
- No canonical global scripts currently exist for `::init` project bootstrap, `::mapSync`, or global `::refactor` extraction orchestration.
- `C:\Users\Qub\mgmt\meta-map.json` is currently inconsistent with `projects-index.json` (2 active projects in index, but `active_projects: 0` and empty sources/nodes/edges).
- Project-scoped `.gitignore` governance was added globally, but current project AGENTS derivatives have not been re-propagated to include it.
- Seed guide issue: `C:\Users\Qub\mgmt\toy-map-app\mgmt\projMap\threads\README.md` shows command path under `mgmt\threads` instead of `mgmt\projMap\threads`.

## Required Edits (must-do to keep mapping/management functional)

### 1) Normalize guide docs to JSON/projMap standard
Files to edit:
- `C:\Users\Qub\mgmt\map_file_gen.md`
- `C:\Users\Qub\mgmt\meta_map_file_gen.md`
- `C:\Users\Qub\mgmt\project_struct_and_module_org.md`

Edits:
- Replace `mgmt\map.txt` with `${PROJMAP_DIR}\map.json` (fallback `${MGMT_DIR}\map.json` only for legacy).
- Replace `meta-map.txt` with `meta-map.json`.
- Ensure all examples, discovery patterns, and schema snippets are JSON-based.
- Keep `edges` as single relationship source; include cross-project mapping expectations for extracted/shared projects.

### 2) Add canonical global scripts for deterministic behavior
Create under `C:\Users\Qub\mgmt\scripts\`:
- `init-project.ps1`
- `map-sync.ps1`
- `refactor-global.ps1`
- `registry-upsert.ps1` (or helper module)

Minimum behavior requirements:
- `init-project.ps1`:
  - scaffolds `${WORKSPACE_ROOT}\AGENTS.md`, `${WORKSPACE_ROOT}\.gitignore`, and `${WORKSPACE_ROOT}\mgmt\projMap\...` required bootstrap files.
  - upserts project in `projects-index.json`.
  - invokes `map-sync.ps1` once.
- `map-sync.ps1`:
  - reads active projects from `projects-index.json`.
  - resolves canonical map path (`mgmt\projMap\map.json`, then legacy fallback).
  - writes `meta-map.json` summaries + `indexes` edges.
  - preserves malformed/missing source entries with status, no hard fail.
- `refactor-global.ps1`:
  - runs assessment across active projects.
  - supports dry-run and apply modes.
  - when extraction approved: initializes new shared project, migrates modules, updates source/consumer contracts/imports, upserts registry, then triggers one `map-sync` at end.

### 3) Extend registry schema for extracted/shared projects
File to edit:
- `C:\Users\Qub\mgmt\projects-index.json` structure definition in docs and writers.

Add required fields for new extracted projects:
- `projectType`: `application | shared-component`
- `extraction`: object for lineage, minimum:
  - `mode`: `native | extracted`
  - `sourceProjects`: string[] (empty for native)
  - `extractedAt`: ISO timestamp (nullable)
- `sharing`: object for connectivity, minimum:
  - `exports`: string[] (public module surfaces)
  - `consumers`: string[] (project ids, optional/derived)

Reason:
- Without lineage/type metadata, `::refactor` extraction outcomes cannot be tracked or validated by governance and meta-map.

### 4) Extend meta-map generation for cross-project sharing visibility
File to edit:
- `C:\Users\Qub\mgmt\meta_map_file_gen.md` (and implementation in new `map-sync.ps1`).

Required output behavior:
- Include project summary nodes for shared-component projects.
- Add cross-project edges for extracted sharing relationships, minimum supported kinds:
  - `indexes` (source -> project)
  - `depends` (consumer project -> shared project)
  - `control` or `context` only when evidenced by map/contracts
- Add concise `note`/`via` evidence for inferred cross-project edges.

### 5) Update project-scoped AGENTS derivative governance template
Files affected:
- Global generator logic (wherever project AGENTS derivatives are produced)
- Existing project AGENTS via propagation (`::propUpd`)

Required changes:
- Ensure generated project AGENTS include `.gitignore` auto-maintenance governance.
- Ensure generated project AGENTS continue excluding global bootstrap command sections.
- Ensure local `::refactor` section stays project-local only, while still allowing consumption of shared components.

### 6) Add project `.gitignore` seed + governed block maintenance
Applies to every project root:
- `${WORKSPACE_ROOT}\.gitignore`

Minimum governed entries:
- `mgmt/projMap/threads/current-thread.json`
- `mgmt/projMap/state/thread-map-deltas.json`
- `.env`
- `.env.*`
- transient build/cache outputs relevant to project stack

Rules:
- idempotent updates
- no duplicate lines
- preserve project-specific rules outside governed block

### 7) Fix seed/guide path defects
File to edit:
- `C:\Users\Qub\mgmt\toy-map-app\mgmt\projMap\threads\README.md`

Required fix:
- Correct command path examples to `...\mgmt\projMap\threads\resolve-init-thread.ps1` and related cache paths.

### 8) Introduce shared-project seed package
Create reusable template at (recommended):
- `C:\Users\Qub\mgmt\templates\shared-project\`

Include at minimum:
- `AGENTS.md` (project-scoped derivative, no global bootstrap commands)
- `.gitignore` with governed block markers
- `mgmt\README.md`
- full `mgmt\projMap` bootstrap package
- `src\backend`, `src\frontend`, `src\public` directories (empty allowed)

Reason:
- extraction during global `::refactor` must initialize consistently, not ad hoc.

## Implementation Order (safe sequence)
1. Update guide docs (`map_file_gen.md`, `meta_map_file_gen.md`, `project_struct_and_module_org.md`).
2. Build canonical scripts under `mgmt\scripts` (`registry-upsert`, `map-sync`, `init-project`, `refactor-global`).
3. Add shared-project template + `.gitignore` governed block template.
4. Run `::propUpd` to push AGENTS/.gitignore governance into existing projects.
5. Run `::mapSync` and verify meta-map non-empty and consistent.
6. Perform one dry-run global `::refactor` and confirm extraction plan artifacts.

## Acceptance Checks
- `projects-index.json` entries include `projectType`, `extraction`, and `sharing` fields.
- `meta-map.json` contains:
  - non-zero `active_projects` for active registry entries
  - `sources` entries for each active project
  - `indexes` edges for each source
  - cross-project dependency edges for shared components when applicable
- New project initialization creates:
  - project AGENTS
  - project `.gitignore`
  - full `mgmt\projMap` bootstrap tree
  - immediate registry upsert + successful map sync
- Global `::refactor` dry-run outputs extraction decisions without mutating files.
- Global `::refactor` apply mode can initialize a shared project, migrate module(s), update references, and keep maps/registry/meta-map coherent.

## Immediate Quick Fixes You Can Apply First
- Align all `*.md` guides off `map.txt`/`meta-map.txt` to `map.json`/`meta-map.json`.
- Correct toy seed thread README path under `projMap`.
- Re-run propagation so project AGENTS include `.gitignore` governance.
- Rebuild `meta-map.json` with a canonical `map-sync` script (current file is inconsistent with registry).
