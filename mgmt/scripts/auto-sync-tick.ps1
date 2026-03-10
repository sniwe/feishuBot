param(
    [string]$RepoRoot = "",
    [string]$GlobalMgmtDir = "",
    [string]$CommitMessagePrefix = "auto-sync",
    [int]$LockTimeoutMinutes = 15
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$GLOBAL_MGMT_DIR = if ([string]::IsNullOrWhiteSpace($GlobalMgmtDir)) {
    Split-Path -Parent $PSScriptRoot
} else {
    [IO.Path]::GetFullPath($GlobalMgmtDir)
}
$REPO_ROOT = if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    Split-Path -Parent $GLOBAL_MGMT_DIR
} else {
    [IO.Path]::GetFullPath($RepoRoot)
}

if (!(Test-Path -LiteralPath (Join-Path $REPO_ROOT ".git"))) {
    throw "Not a git repository root: $REPO_ROOT"
}

$stateDir = Join-Path $GLOBAL_MGMT_DIR "state"
New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
$lockPath = Join-Path $env:TEMP ("codex-auto-sync-{0}.lock" -f $env:USERNAME)
$now = Get-Date

if (Test-Path -LiteralPath $lockPath) {
    try {
        $lockTime = (Get-Item -LiteralPath $lockPath).LastWriteTime
        if ($now -lt $lockTime.AddMinutes($LockTimeoutMinutes)) {
            exit 0
        }
    } catch {}
}

"$($now.ToString('o'))" | Set-Content -LiteralPath $lockPath -Encoding UTF8

function Invoke-Git {
    param(
        [Parameter(Mandatory = $true)][string[]]$Args,
        [switch]$AllowFailure
    )
    Push-Location $REPO_ROOT
    try {
        & git @Args
        if ($LASTEXITCODE -ne 0 -and -not $AllowFailure) {
            throw "git $($Args -join ' ') failed with exit code $LASTEXITCODE"
        }
    } finally {
        Pop-Location
    }
}

function Get-ManagedAddPaths {
    $paths = @("mgmt/scripts", "mgmt/automation")
    $indexPath = Join-Path $GLOBAL_MGMT_DIR "projects-index.json"
    if (Test-Path -LiteralPath $indexPath) {
        try {
            $index = Get-Content -LiteralPath $indexPath -Raw | ConvertFrom-Json
            foreach ($p in @($index.projects)) {
                if ([string]::Equals([string]$p.status, "active", [System.StringComparison]::OrdinalIgnoreCase) -and
                    -not [string]::IsNullOrWhiteSpace([string]$p.projectRoot)) {
                    $projectRoot = [IO.Path]::GetFullPath([string]$p.projectRoot)
                    if ($projectRoot.StartsWith($REPO_ROOT, [System.StringComparison]::OrdinalIgnoreCase)) {
                        $rel = $projectRoot.Substring($REPO_ROOT.Length).TrimStart('\','/')
                        if (-not [string]::IsNullOrWhiteSpace($rel)) {
                            $paths += $rel.Replace('\','/')
                        }
                    }
                }
            }
        } catch {
            # Keep auto-sync resilient even if index parse fails.
        }
    }
    return @($paths | Sort-Object -Unique)
}

try {
    # Rebase first to avoid creating local commits that immediately conflict.
    Invoke-Git -Args @("pull", "--rebase", "--autostash")

    Push-Location $REPO_ROOT
    $status = (& git status --porcelain)
    Pop-Location

    if ([string]::IsNullOrWhiteSpace(($status | Out-String))) {
        exit 0
    }

    # Stage tracked edits first. This avoids permission failures from unrelated
    # unreadable files under a home-directory git root.
    Invoke-Git -Args @("add", "-u")

    # Stage untracked files only from governed/managed roots.
    foreach ($pathSpec in (Get-ManagedAddPaths)) {
        $full = Join-Path $REPO_ROOT ($pathSpec -replace '/', '\')
        if (Test-Path -LiteralPath $full) {
            Invoke-Git -Args @("add", "--all", "--", $pathSpec)
        }
    }

    Push-Location $REPO_ROOT
    & git diff --cached --quiet
    $hasStaged = ($LASTEXITCODE -ne 0)
    Pop-Location

    if ($hasStaged) {
        $hostName = $env:COMPUTERNAME
        $msg = "${CommitMessagePrefix}: $hostName $(Get-Date -Format s)"
        Invoke-Git -Args @("commit", "-m", $msg)
    }

    Invoke-Git -Args @("push")
}
finally {
    if (Test-Path -LiteralPath $lockPath) {
        Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
    }
}
