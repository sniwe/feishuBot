# Global Mgmt

This directory contains global governance, indexing, initialization, propagation, refactor orchestration, and visualization assets.

## Canonical Scripts

- `scripts\bootstrap-machine.ps1`: new-machine bootstrap and path rebasing
- `scripts\registry-upsert.ps1`: project registry upsert/update
- `scripts\map-sync.ps1`: regenerate `meta-map.json` from active projects
- `scripts\init-project.ps1`: initialize project mgmt/bootstrap package
- `scripts\refactor-global.ps1`: global `::refactor` dry-run/apply orchestration

## First Run On A New Machine

From the cloned global `mgmt` directory:

```powershell
& .\scripts\bootstrap-machine.ps1
```

Optional (if old root is known and differs):

```powershell
& .\scripts\bootstrap-machine.ps1 -OldUserRoot 'C:\Users\OldName'
```

## Outputs Maintained Here

- `projects-index.json`
- `meta-map.json`
- `propagation-report.json`
- `refactor-global-report.json`

## Visualization

Generate and view local graph payloads:

```powershell
& .\visualization\generate-graph-data.ps1
Start-Process (Join-Path (Resolve-Path .\visualization).Path 'index.html')
```
