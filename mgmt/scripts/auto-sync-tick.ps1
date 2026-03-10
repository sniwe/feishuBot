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

function Get-ManagedPathspecs {
    $specs = @("AGENTS.md", ".gitignore", "mgmt")
    $indexPath = Join-Path $GLOBAL_MGMT_DIR "projects-index.json"
    if (Test-Path -LiteralPath $indexPath) {
        try {
            $idx = Get-Content -LiteralPath $indexPath -Raw | ConvertFrom-Json
            foreach ($p in @($idx.projects | Where-Object { $_.status -eq "active" })) {
                $root = [string]$p.projectRoot
                if ([string]::IsNullOrWhiteSpace($root)) { continue }
                $leaf = Split-Path -Leaf $root
                if (-not [string]::IsNullOrWhiteSpace($leaf)) {
                    $specs += $leaf
                }
            }
        } catch {}
    }
    return @($specs | Select-Object -Unique)
}

try {
    $pathspecs = Get-ManagedPathspecs

    # Bidirectional sync: ingest remote commits before inspecting local changes.
    Invoke-Git -Args @("pull", "--rebase", "--autostash")

    Push-Location $REPO_ROOT
    try {
        $status = & git status --porcelain -- @pathspecs
    } finally {
        Pop-Location
    }

    if ([string]::IsNullOrWhiteSpace(($status | Out-String))) { exit 0 }

    Invoke-Git -Args (@("add", "-A", "--") + $pathspecs)

    Push-Location $REPO_ROOT
    try {
        & git diff --cached --quiet -- @pathspecs
        $hasStaged = ($LASTEXITCODE -ne 0)
    } finally {
        Pop-Location
    }

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
