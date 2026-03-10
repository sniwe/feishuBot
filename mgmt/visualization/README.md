# Visualization

This package builds a single canvas-based flowchart view across all active project maps.

## Output

- `graph-data.json`: generated aggregate graph model
- `graph-data.js`: browser-ready local payload (`window.__GRAPH_DATA__`)
- `index.html`: canvas viewer
- `app.js`: renderer and interaction logic
- `styles.css`: visual style

## Generate Graph Data

```powershell
& .\generate-graph-data.ps1
```

## Open Viewer

No server required. Open directly from local filesystem:

```powershell
Start-Process (Join-Path (Get-Location) "index.html")
```

## Notes

- Uses `mgmt\projects-index.json` as source of active projects (resolved from current global `mgmt` clone path).
- Reads each project's `mgmt\projMap\map.json` (or fallback `mgmt\map.json`).
- Canvas style is intentionally Mermaid-like (grouped subgraphs, directed edges, clean labels).
