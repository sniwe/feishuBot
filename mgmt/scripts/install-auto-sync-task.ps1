param(
    [string]$GlobalMgmtDir = "",
    [string]$TaskName = "CodexRepoAutoSync"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$GLOBAL_MGMT_DIR = if ([string]::IsNullOrWhiteSpace($GlobalMgmtDir)) {
    Split-Path -Parent $PSScriptRoot
} else {
    [IO.Path]::GetFullPath($GlobalMgmtDir)
}

$tickScript = Join-Path $GLOBAL_MGMT_DIR "scripts\auto-sync-tick.ps1"
if (!(Test-Path -LiteralPath $tickScript)) {
    throw "Missing tick script: $tickScript"
}

$taskRun = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$tickScript`""

# Delete existing task if present, then recreate with 5-minute cadence.
cmd /c "schtasks /Delete /TN ""$TaskName"" /F >nul 2>&1" | Out-Null
cmd /c "schtasks /Create /TN ""$TaskName"" /SC MINUTE /MO 5 /TR ""$taskRun"" /F" | Out-Null
cmd /c "schtasks /Run /TN ""$TaskName""" | Out-Null

[pscustomobject]@{
    ok = $true
    mode = "task_scheduler"
    taskName = $TaskName
    script = $tickScript
} | ConvertTo-Json -Depth 5
