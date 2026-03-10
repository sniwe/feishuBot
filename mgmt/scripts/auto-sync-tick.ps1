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
$lockPath = Join-Path $stateDir "auto-sync.lock"
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

try {
    Push-Location $REPO_ROOT
    $status = (& git status --porcelain)
    Pop-Location

    if ([string]::IsNullOrWhiteSpace(($status | Out-String))) {
        exit 0
    }

    Invoke-Git -Args @("add", "-A")

    Push-Location $REPO_ROOT
    & git diff --cached --quiet
    $hasStaged = ($LASTEXITCODE -ne 0)
    Pop-Location

    if ($hasStaged) {
        $hostName = $env:COMPUTERNAME
        $msg = "${CommitMessagePrefix}: $hostName $(Get-Date -Format s)"
        Invoke-Git -Args @("commit", "-m", $msg)
    }

    # Rebase with autostash to absorb remote updates, then push.
    Invoke-Git -Args @("pull", "--rebase", "--autostash")
    Invoke-Git -Args @("push")
}
finally {
    if (Test-Path -LiteralPath $lockPath) {
        Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
    }
}
