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
    if (-not $NoPull) {
        git pull --rebase
    }

    if (-not $NoBootstrap) {
        & (Join-Path $GLOBAL_MGMT_DIR "scripts\bootstrap-machine.ps1") | Out-Null
    }

    git add -A
    $status = git status --porcelain
    if ([string]::IsNullOrWhiteSpace(($status | Out-String))) {
        Write-Output "No changes to commit."
        exit 0
    }

    $commitMsg = if ([string]::IsNullOrWhiteSpace($Message)) {
        "sync: update workspace state $(Get-Date -Format s)"
    } else {
        $Message
    }

    git commit -m $commitMsg
    git push
    Write-Output "Sync push complete."
}
finally {
    Pop-Location
}
