param(
    [string]$RepoRoot = "",
    [switch]$NoBootstrap
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$GLOBAL_MGMT_DIR = Split-Path -Parent $PSScriptRoot
$DEFAULT_REPO_ROOT = Split-Path -Parent $GLOBAL_MGMT_DIR
$REPO_ROOT = if ([string]::IsNullOrWhiteSpace($RepoRoot)) { $DEFAULT_REPO_ROOT } else { [IO.Path]::GetFullPath($RepoRoot) }

if (!(Test-Path -LiteralPath (Join-Path $REPO_ROOT ".git"))) {
    throw "Not a git repo root: $REPO_ROOT"
}

Push-Location $REPO_ROOT
try {
    git pull --rebase

    if (-not $NoBootstrap) {
        & (Join-Path $GLOBAL_MGMT_DIR "scripts\bootstrap-machine.ps1") | Out-Null
    }

    Write-Output "Sync pull complete."
}
finally {
    Pop-Location
}
