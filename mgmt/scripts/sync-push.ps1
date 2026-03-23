param(
    [string]$RepoRoot = "",
    [string]$Message = "",
    [switch]$NoPull,
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
    $isQubtop = ([string]::Equals($env:COMPUTERNAME, "QUBTOP", [System.StringComparison]::OrdinalIgnoreCase))
    $effectiveNoPull = $NoPull -or $isQubtop

    if (-not $effectiveNoPull) {
        git pull --rebase --autostash
    } elseif ($isQubtop) {
        Write-Output "Skipping pull on QUBTOP (push-only policy)."
    }

    if (-not $NoBootstrap) {
        & (Join-Path $GLOBAL_MGMT_DIR "scripts\bootstrap-machine.ps1") | Out-Null
    }

    # This machine is configured as receive-only. Never publish local changes.
    Write-Output "Push disabled on this machine. Pull completed; no commit/push performed."
    exit 0
}
finally {
    Pop-Location
}
