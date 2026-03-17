param(
    [string]$RepoRoot = "",
    [string]$GlobalMgmtDir = "",
    [string]$CommitMessagePrefix = "auto-sync",
    [int]$LockTimeoutMinutes = 15
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Initialize-FocusInterop {
    if ("CodexNativeFocus" -as [type]) { return }
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class CodexNativeFocus
{
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("kernel32.dll")]
    public static extern uint GetCurrentThreadId();

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool BringWindowToTop(IntPtr hWnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@
}

function Get-FocusSnapshot {
    if (-not [Environment]::UserInteractive) { return $null }
    try {
        Initialize-FocusInterop
        $handle = [CodexNativeFocus]::GetForegroundWindow()
        if ($handle -eq [IntPtr]::Zero) { return $null }
        return [pscustomobject]@{
            Handle = $handle
        }
    } catch {
        return $null
    }
}

function Restore-Focus {
    param(
        [Parameter()][object]$Snapshot
    )

    if (-not $Snapshot) { return }

    try {
        Initialize-FocusInterop
        $targetHandle = [IntPtr]$Snapshot.Handle
        if ($targetHandle -eq [IntPtr]::Zero -or -not [CodexNativeFocus]::IsWindow($targetHandle)) {
            return
        }

        $currentHandle = [CodexNativeFocus]::GetForegroundWindow()
        if ($currentHandle -eq $targetHandle) { return }

        $targetPid = [uint32]0
        $targetThreadId = [CodexNativeFocus]::GetWindowThreadProcessId($targetHandle, [ref]$targetPid)
        $currentPid = [uint32]0
        $currentThreadId = if ($currentHandle -ne [IntPtr]::Zero) {
            [CodexNativeFocus]::GetWindowThreadProcessId($currentHandle, [ref]$currentPid)
        } else {
            [uint32]0
        }
        $thisThreadId = [CodexNativeFocus]::GetCurrentThreadId()
        $attachedToTarget = $false
        $attachedToCurrent = $false

        try {
            if ($targetThreadId -ne 0 -and $targetThreadId -ne $thisThreadId) {
                $attachedToTarget = [CodexNativeFocus]::AttachThreadInput($thisThreadId, $targetThreadId, $true)
            }
            if ($currentThreadId -ne 0 -and $currentThreadId -ne $thisThreadId -and $currentThreadId -ne $targetThreadId) {
                $attachedToCurrent = [CodexNativeFocus]::AttachThreadInput($thisThreadId, $currentThreadId, $true)
            }

            if ([CodexNativeFocus]::IsIconic($targetHandle)) {
                [CodexNativeFocus]::ShowWindowAsync($targetHandle, 9) | Out-Null
            }

            [CodexNativeFocus]::BringWindowToTop($targetHandle) | Out-Null
            [CodexNativeFocus]::SetForegroundWindow($targetHandle) | Out-Null
        } finally {
            if ($attachedToCurrent) {
                [CodexNativeFocus]::AttachThreadInput($thisThreadId, $currentThreadId, $false) | Out-Null
            }
            if ($attachedToTarget) {
                [CodexNativeFocus]::AttachThreadInput($thisThreadId, $targetThreadId, $false) | Out-Null
            }
        }
    } catch {}
}

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
$focusSnapshot = Get-FocusSnapshot

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
    Restore-Focus -Snapshot $focusSnapshot
    if (Test-Path -LiteralPath $lockPath) {
        Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
    }
}
