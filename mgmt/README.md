# Global Mgmt

This directory contains global governance, indexing, initialization, propagation, refactor orchestration, and visualization assets.

## Canonical Scripts

- `scripts\bootstrap-machine.ps1`: new-machine bootstrap and path rebasing
- `scripts\registry-upsert.ps1`: project registry upsert/update
- `scripts\map-sync.ps1`: regenerate `meta-map.json` from active projects
- `scripts\init-project.ps1`: initialize project mgmt/bootstrap package
- `scripts\ingest-project.ps1`: ingest an untracked external project into a new governed project boundary
- `scripts\refactor-global.ps1`: global `::refactor` dry-run/apply orchestration
- `scripts\sync-pull.ps1`: pull latest + run bootstrap refresh
- `scripts\sync-push.ps1`: pull/rebase + bootstrap + commit + push

## First Run On A New Machine

From the cloned global `mgmt` directory:

```powershell
& .\scripts\bootstrap-machine.ps1
```

Recommended one-shot gate (bootstrap + auto-sync setup + machine-local flag):

```powershell
& .\scripts\ensure-machine-setup.ps1
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

## Daily Multi-Machine Sync

On a machine before editing:

```powershell
& .\scripts\sync-pull.ps1
```

After edits on that machine:

```powershell
& .\scripts\sync-push.ps1 -Message "describe your changes"
```

## Global Project Ingest (`::ingest`)

When a user provides a directory path for a project that is not yet tracked, run:

```powershell
& .\scripts\ingest-project.ps1 -SourceProjectPath 'C:\path\to\external-project'
```

Dry-run analysis (no mutations):

```powershell
& .\scripts\ingest-project.ps1 -SourceProjectPath 'C:\path\to\external-project' -DryRun
```

## Auto Sync Every 5 Minutes

### Option A (Requested): AutoHotkey loop (both machines)

Install and start now:

```powershell
& .\scripts\install-auto-sync-ahk.ps1 -StartNow
```

This installs startup auto-run of:
- `mgmt\automation\repo-auto-sync.ahk`
- which executes `mgmt\scripts\auto-sync-tick.ps1` every 5 minutes.

### Option B (Recommended): Windows Task Scheduler

Install scheduled task:

```powershell
& .\scripts\install-auto-sync-task.ps1
```

Reason recommended:
- survives user-session edge cases better than an AHK loop
- no dependency on AHK runtime process stability
- simpler operational visibility in Task Scheduler
