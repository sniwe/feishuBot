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

    function Get-ManagedPathspecs {
        $specs = @("AGENTS.md", ".gitignore", "mgmt")
        $indexPath = Join-Path $GLOBAL_MGMT_DIR "projects-index.json"
        if (Test-Path -LiteralPath $indexPath) {
            try {
                $idx = Get-Content -LiteralPath $indexPath -Raw | ConvertFrom-Json
                foreach ($p in @($idx.projects | Where-Object { $_.status -eq "active" })) {
                    $projectRoot = [string]$p.projectRoot
                    if ([string]::IsNullOrWhiteSpace($projectRoot)) { continue }
                    $fullProjectRoot = [IO.Path]::GetFullPath($projectRoot)
                    $fullRepoRoot = [IO.Path]::GetFullPath($REPO_ROOT)
                    if (-not $fullProjectRoot.StartsWith($fullRepoRoot, [System.StringComparison]::OrdinalIgnoreCase)) { continue }
                    $relative = $fullProjectRoot.Substring($fullRepoRoot.Length).TrimStart('\', '/')
                    if (-not [string]::IsNullOrWhiteSpace($relative)) {
                        $specs += $relative
                    }
                }
            } catch {}
        }
        return @($specs | Select-Object -Unique)
    }

    $pathspecs = Get-ManagedPathspecs
    $status = git status --porcelain -- @pathspecs
    if ([string]::IsNullOrWhiteSpace(($status | Out-String))) {
        Write-Output "No changes to commit."
        exit 0
    }

    git add -A -- @pathspecs
    git diff --cached --quiet -- @pathspecs
    if ($LASTEXITCODE -eq 0) {
        Write-Output "No staged managed changes to commit."
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
