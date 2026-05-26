param(
    [string]$RepoRoot = "",
    [switch]$NoBootstrap
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$GLOBAL_MGMT_DIR = Split-Path -Parent $PSScriptRoot
$DEFAULT_REPO_ROOT = Split-Path -Parent $GLOBAL_MGMT_DIR

function Resolve-RepoRoot {
    param(
        [Parameter()][string]$ExplicitRepoRoot,
        [Parameter()][string]$FallbackRepoRoot
    )

    if (-not [string]::IsNullOrWhiteSpace($ExplicitRepoRoot)) {
        return [IO.Path]::GetFullPath($ExplicitRepoRoot)
    }

    try {
        $gitRoot = & git rev-parse --show-toplevel 2>$null
        if (-not [string]::IsNullOrWhiteSpace(($gitRoot | Out-String))) {
            return [IO.Path]::GetFullPath(($gitRoot | Out-String).Trim())
        }
    } catch {
        # Ignore and fall back below.
    }

    return [IO.Path]::GetFullPath($FallbackRepoRoot)
}

$REPO_ROOT = Resolve-RepoRoot -ExplicitRepoRoot $RepoRoot -FallbackRepoRoot $DEFAULT_REPO_ROOT

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
