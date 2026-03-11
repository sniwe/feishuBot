# mgmt layout

All management assets are packaged under `mgmt/projMap/`.

- `projMap/map.json`: canonical project map artifact.
- `projMap/threads/`: thread discovery/cache for `::init`.
- `projMap/state/`: generated tracker state/history (`thread-map-deltas.json`).
- `projMap/modules/thread-map-tracker/`: reusable JS module for map delta tracking.
- `projMap/scripts/generate-map.ps1`: map generator and tracker orchestrator.
- `projMap/scripts/track-map-update.js`: runner for thread+map delta tracking.
