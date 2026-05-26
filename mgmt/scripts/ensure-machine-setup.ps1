param(
    [string]$GlobalMgmtDir = "",
    [ValidateSet("task","ahk","none")][string]$AutoSyncMode = "task",
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$GLOBAL_MGMT_DIR = if ([string]::IsNullOrWhiteSpace($GlobalMgmtDir)) {
    Split-Path -Parent $PSScriptRoot
} else {
    [IO.Path]::GetFullPath($GlobalMgmtDir)
}

$USER_ROOT = if ($env:USERPROFILE) { $env:USERPROFILE } else { [Environment]::GetFolderPath("UserProfile") }
$stateDir = Join-Path $GLOBAL_MGMT_DIR "state"
New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
$machineName = $env:COMPUTERNAME
$flagPath = Join-Path $stateDir ("machine-setup.{0}.json" -f $machineName)
$nowIso = (Get-Date).ToString("o")

$bootstrapScript = Join-Path $GLOBAL_MGMT_DIR "scripts\bootstrap-machine.ps1"
$taskInstaller = Join-Path $GLOBAL_MGMT_DIR "scripts\install-auto-sync-task.ps1"
$ahkInstaller = Join-Path $GLOBAL_MGMT_DIR "scripts\install-auto-sync-ahk.ps1"

foreach ($p in @($bootstrapScript, $taskInstaller, $ahkInstaller)) {
    if (!(Test-Path -LiteralPath $p)) {
        throw "Missing required setup script: $p"
    }
}

function Test-AutoSyncConfigured {
    param([string]$Mode)
    if ($Mode -eq "none") { return $true }
    if ($Mode -eq "task") {
        return [bool](Get-ScheduledTask -TaskName "CodexRepoAutoSync" -ErrorAction SilentlyContinue)
    }
    if ($Mode -eq "ahk") {
        $startupDir = [Environment]::GetFolderPath("Startup")
        return (Test-Path -LiteralPath (Join-Path $startupDir "Repo Auto Sync.lnk"))
    }
    return $false
}

function Remove-AutoSyncArtifacts {
    param([string]$GlobalMgmtDir)

    $taskName = "CodexRepoAutoSync"
    $startupDir = [Environment]::GetFolderPath("Startup")
    $startupLnk = Join-Path $startupDir "Repo Auto Sync.lnk"

    cmd /c "schtasks /Delete /TN ""$taskName"" /F >nul 2>&1" | Out-Null
    if (Test-Path -LiteralPath $startupLnk) {
        Remove-Item -LiteralPath $startupLnk -Force -ErrorAction SilentlyContinue
    }
}

$existing = $null
if (Test-Path -LiteralPath $flagPath) {
    try { $existing = Get-Content -LiteralPath $flagPath -Raw | ConvertFrom-Json } catch { $existing = $null }
}

$desiredMode = $AutoSyncMode
if ($existing -and $existing.PSObject.Properties.Name -contains "auto_sync_mode") {
    $existingMode = [string]$existing.auto_sync_mode
    if ($existingMode -in @("task", "ahk", "none")) {
        $desiredMode = $existingMode
    }
}

$shouldDisableAutoSync = $desiredMode -eq "none"
if ($shouldDisableAutoSync) {
    Remove-AutoSyncArtifacts -GlobalMgmtDir $GLOBAL_MGMT_DIR
}

$needsSetup = $Force -or $null -eq $existing -or -not (Test-AutoSyncConfigured -Mode $desiredMode)

if ($needsSetup) {
    if ($desiredMode -eq "task" -or $desiredMode -eq "ahk") {
        & $bootstrapScript -GlobalMgmtDir $GLOBAL_MGMT_DIR | Out-Null
        if ($desiredMode -eq "task") {
            & $taskInstaller -GlobalMgmtDir $GLOBAL_MGMT_DIR | Out-Null
        } elseif ($desiredMode -eq "ahk") {
            & $ahkInstaller -GlobalMgmtDir $GLOBAL_MGMT_DIR -StartNow | Out-Null
        }
    }

    $payload = [ordered]@{
        id = "machine-setup"
        machine = $machineName
        user = $env:USERNAME
        user_root = $USER_ROOT
        global_mgmt_dir = $GLOBAL_MGMT_DIR
        auto_sync_mode = $desiredMode
        setup_completed_at = $nowIso
        force = [bool]$Force
    }
    $payload | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $flagPath -Encoding UTF8
}

if ($shouldDisableAutoSync -and -not $needsSetup) {
    $payload = [ordered]@{
        id = "machine-setup"
        machine = $machineName
        user = $env:USERNAME
        user_root = $USER_ROOT
        global_mgmt_dir = $GLOBAL_MGMT_DIR
        auto_sync_mode = $desiredMode
        setup_completed_at = $nowIso
        force = [bool]$Force
    }
    $payload | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $flagPath -Encoding UTF8
}

[pscustomobject]@{
    ok = $true
    machine = $machineName
    setup_required = [bool]$needsSetup
    auto_sync_mode = $desiredMode
    flag_path = $flagPath
    setup_verified_at = (Get-Date).ToString("o")
} | ConvertTo-Json -Depth 6
