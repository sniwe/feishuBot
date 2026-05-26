# mgmt layout

All management assets are packaged under `mgmt/projMap/`, `mgmt/toDo/`, `mgmt/errFix/`, and `mgmt/DLs/`.

- `projMap/map.json`: canonical project map artifact.
- `projMap/threads/`: thread discovery/cache for `::init`.
- `projMap/state/`: generated tracker state/history (`thread-map-deltas.json`).
- `projMap/modules/thread-map-tracker/`: reusable JS module for map delta tracking.
- `projMap/scripts/generate-map.ps1`: map generator and tracker orchestrator.
- `projMap/scripts/track-map-update.js`: runner for thread+map delta tracking.
- `toDo/` and `errFix/`: queue folders maintained with ordinal blank sentinels. If a blank sentinel is missing or gets content, the maintenance script creates the next ordinal blank `.txt` so at least one empty file always remains.
- `toDo/done/` and `errFix/fixed/`: manual completion destinations for cleared queue items.
- When the watcher detects a newly arrived `toDo/done/*.txt` or `errFix/fixed/*.txt`, it copies `projMap/map.json` to the same base filename with a `.json` extension and records the source `.txt` path in a bucket-specific state file so the snapshot does not retrigger itself.
- `DLs/`: mirrored Downloads staging area refreshed by the background queue worker and renamed `dl-1.ext`, `dl-2.ext`, ... in newest-first ordinal order while preserving each file's original extension.

DLs mirror rules:

- mirror files from `C:\Users\Qub\Downloads` whose `CreationTime` is the current date
- also mirror any `C:\Users\Qub\Downloads\...` path referenced anywhere under `mgmt\toDo\` or `mgmt\errFix\`
- keep the mirror sorted newest-first by creation time, rename entries `dl-1.ext`, `dl-2.ext`, ... by ordinal position while preserving each file's original extension, and refresh it idempotently
