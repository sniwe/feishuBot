param(
    [string]$RepoRoot = "",
    [string]$Message = "",
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
    if (-not $NoBootstrap) {
        & (Join-Path $GLOBAL_MGMT_DIR "scripts\bootstrap-machine.ps1") | Out-Null
    }

    $status = & git status --porcelain
    if ([string]::IsNullOrWhiteSpace(($status | Out-String))) {
        Write-Output "No local changes to push."
        exit 0
    }

    git add -A -- .

    Push-Location $REPO_ROOT
    try {
        & git diff --cached --quiet
        $hasStaged = ($LASTEXITCODE -ne 0)
    } finally {
        Pop-Location
    }

    if ($hasStaged) {
        $commitMessage = if ([string]::IsNullOrWhiteSpace($Message)) {
            "sync-push: $($env:COMPUTERNAME) $(Get-Date -Format s)"
        } else {
            $Message
        }
        git commit -m $commitMessage
    }

    git push
    Write-Output "Sync push complete."
}
finally {
    Pop-Location
}
