param(
    [string]$ExplorerPath = "C:\Users\Qub",
    [string]$Qv2rayPath = "C:\Program Files\qv2ray\qv2ray.exe",
    [string]$Qv2rayConfigDir = "",
    [bool]$EnableQv2rayUsAutoSelect = $true,
    [string]$GlobalMgmtDir = "",
    [string]$CmdStartupCommand = "codex --dangerously-bypass-approvals-and-sandbox",
    [string]$CmdWorkingDirectory = "",
    [bool]$AutoResumeCodexInTerminal = $true,
    [int]$CodexResumeDelayMs = 1400,
    [bool]$UseCodexPromptArgument = $true,
    [int]$CodexPostStartDelayMs = 3200,
    [string]$CodexPostStartText = "test",
    [string]$CodexSubmitKeys = "^j",
    [int]$CodexPostStartDotRetries = 2,
    [int]$CodexPostStartDotRetryDelayMs = 900,
    [bool]$EnableAlternateLeftGroups = $true,
    [string]$VsCodePath = "",
    [string]$WeChatPath = "",
    [string]$ChromePath = "",
    [int]$AlternateGroupPauseMs = 700,
    [int]$InitialDelayMs = 2500,
    [int]$LaunchDelayMs = 1200,
    [int]$WindowTimeoutSeconds = 30
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class NativeWindowTools {
    [DllImport("user32.dll")]
    public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool BringWindowToTop(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }
}
"@

$SW_RESTORE = 9
$SWP_NOZORDER = 0x0004
$SWP_NOACTIVATE = 0x0010
$KEYEVENTF_KEYUP = 0x0002
$VK_LWIN = 0x5B
$VK_LEFT = 0x25
$VK_RIGHT = 0x27
$VK_UP = 0x26
$VK_DOWN = 0x28
$VK_D = 0x44

function Wait-ProcessMainWindow {
    param(
        [Parameter(Mandatory = $true)][System.Diagnostics.Process]$Process,
        [Parameter(Mandatory = $true)][int]$TimeoutSeconds
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $Process.Refresh()
            if ($Process.HasExited) {
                throw "Process '$($Process.ProcessName)' exited before a main window became available."
            }
            if ($Process.MainWindowHandle -and $Process.MainWindowHandle -ne [IntPtr]::Zero) {
                return $Process.MainWindowHandle
            }
        } catch {
            Start-Sleep -Milliseconds 250
            continue
        }

        Start-Sleep -Milliseconds 250
    }

    throw "Timed out waiting for process '$($Process.ProcessName)' to expose a main window."
}

function Get-MainWindowHandleByProcessName {
    param(
        [Parameter(Mandatory = $true)][string]$ProcessName
    )

    $candidates = @(Get-Process -Name $ProcessName -ErrorAction SilentlyContinue)
    foreach ($candidate in $candidates) {
        try {
            $candidate.Refresh()
            if ($candidate.HasExited) { continue }
            if ($candidate.MainWindowHandle -and $candidate.MainWindowHandle -ne [IntPtr]::Zero) {
                return [IntPtr]$candidate.MainWindowHandle
            }
        } catch {
            continue
        }
    }

    return [IntPtr]::Zero
}

function Get-MainWindowHandlesByProcessName {
    param(
        [Parameter(Mandatory = $true)][string]$ProcessName
    )

    $handles = @()
    $candidates = @(Get-Process -Name $ProcessName -ErrorAction SilentlyContinue)
    foreach ($candidate in $candidates) {
        try {
            $candidate.Refresh()
            if ($candidate.HasExited) { continue }
            if ($candidate.MainWindowHandle -and $candidate.MainWindowHandle -ne [IntPtr]::Zero) {
                $handles += [IntPtr]$candidate.MainWindowHandle
            }
        } catch {
            continue
        }
    }

    return $handles
}

function Ensure-Qv2rayWindowHandle {
    param(
        [Parameter(Mandatory = $true)][string]$Qv2rayExePath,
        [Parameter(Mandatory = $true)][int]$TimeoutSeconds
    )

    $procName = [IO.Path]::GetFileNameWithoutExtension($Qv2rayExePath)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $attempt = 0
    $lastLaunch = [datetime]::MinValue

    while ((Get-Date) -lt $deadline) {
        $handle = Get-MainWindowHandleByProcessName -ProcessName $procName
        if ($handle -ne [IntPtr]::Zero) {
            return $handle
        }

        $now = Get-Date
        $shouldLaunch = ($attempt -eq 0) -or (($now - $lastLaunch).TotalSeconds -ge 4)
        if ($shouldLaunch) {
            Start-Process -FilePath $Qv2rayExePath | Out-Null
            $attempt += 1
            $lastLaunch = $now
        }

        Start-Sleep -Milliseconds 300
    }

    throw "Timed out waiting for qv2ray window from executable '$Qv2rayExePath'."
}

function Ensure-AppWindowHandle {
    param(
        [Parameter(Mandatory = $true)][string]$AppPath,
        [string]$ProcessName = "",
        [string[]]$ArgumentList = @(),
        [bool]$ForceNewWindow = $false,
        [Parameter(Mandatory = $true)][int]$TimeoutSeconds
    )

    if (!(Test-Path -LiteralPath $AppPath -PathType Leaf)) {
        throw "App executable was not found: $AppPath"
    }

    $procName = if ([string]::IsNullOrWhiteSpace($ProcessName)) {
        [IO.Path]::GetFileNameWithoutExtension($AppPath)
    } else {
        $ProcessName
    }

    $existingHandles = @()
    if ($ForceNewWindow) {
        $existingHandles = Get-MainWindowHandlesByProcessName -ProcessName $procName
    }

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $attempt = 0
    $lastLaunch = [datetime]::MinValue

    while ((Get-Date) -lt $deadline) {
        if ($ForceNewWindow) {
            $currentHandles = Get-MainWindowHandlesByProcessName -ProcessName $procName
            foreach ($handle in $currentHandles) {
                if ($existingHandles -notcontains $handle) {
                    return $handle
                }
            }
        } else {
            $handle = Get-MainWindowHandleByProcessName -ProcessName $procName
            if ($handle -ne [IntPtr]::Zero) {
                return $handle
            }
        }

        $now = Get-Date
        $shouldLaunch = ($attempt -eq 0) -or (($now - $lastLaunch).TotalSeconds -ge 4)
        if ($shouldLaunch) {
            if ($null -ne $ArgumentList -and $ArgumentList.Count -gt 0) {
                Start-Process -FilePath $AppPath -ArgumentList $ArgumentList | Out-Null
            } else {
                Start-Process -FilePath $AppPath | Out-Null
            }
            $attempt += 1
            $lastLaunch = $now
        }

        Start-Sleep -Milliseconds 300
    }

    throw "Timed out waiting for app window from executable '$AppPath'."
}

function Wait-ExplorerWindowHandle {
    param(
        [Parameter(Mandatory = $true)][string]$TargetPath,
        [Parameter(Mandatory = $true)][datetime]$StartedAfter,
        [Parameter(Mandatory = $true)][int]$TimeoutSeconds
    )

    $resolvedTarget = [IO.Path]::GetFullPath($TargetPath).TrimEnd('\')
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

    while ((Get-Date) -lt $deadline) {
        $shell = $null
        try {
            $shell = New-Object -ComObject Shell.Application
            foreach ($window in @($shell.Windows())) {
                try {
                    if ($null -eq $window) { continue }

                    $windowPath = $null
                    if ($window.Document -and $window.Document.Folder -and $window.Document.Folder.Self) {
                        $windowPath = [string]$window.Document.Folder.Self.Path
                    }

                    if ([string]::IsNullOrWhiteSpace($windowPath)) { continue }
                    if ([IO.Path]::GetFullPath($windowPath).TrimEnd('\') -ne $resolvedTarget) { continue }

                    $hwnd = [IntPtr]([int64]$window.HWND)
                    if ($hwnd -eq [IntPtr]::Zero) { continue }

                    return $hwnd
                } catch {
                    continue
                }
            }
        } finally {
            if ($shell) {
                [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shell)
            }
        }

        Start-Sleep -Milliseconds 300
    }

    throw "Timed out waiting for File Explorer window at '$resolvedTarget'."
}

function Set-WindowBounds {
    param(
        [Parameter(Mandatory = $true)][IntPtr]$Handle,
        [Parameter(Mandatory = $true)][int]$X,
        [Parameter(Mandatory = $true)][int]$Y,
        [Parameter(Mandatory = $true)][int]$Width,
        [Parameter(Mandatory = $true)][int]$Height
    )

    [void][NativeWindowTools]::ShowWindowAsync($Handle, $SW_RESTORE)
    $ok = [NativeWindowTools]::SetWindowPos($Handle, [IntPtr]::Zero, $X, $Y, $Width, $Height, $SWP_NOZORDER -bor $SWP_NOACTIVATE)
    if (-not $ok) {
        throw "Failed to position window handle '$Handle'."
    }
}

function Get-WindowRect {
    param(
        [Parameter(Mandatory = $true)][IntPtr]$Handle
    )

    $rect = New-Object NativeWindowTools+RECT
    $ok = [NativeWindowTools]::GetWindowRect($Handle, [ref]$rect)
    if (-not $ok) {
        throw "Failed to read window bounds for handle '$Handle'."
    }

    [pscustomobject]@{
        left = $rect.Left
        top = $rect.Top
        width = $rect.Right - $rect.Left
        height = $rect.Bottom - $rect.Top
    }
}

function Set-WindowForeground {
    param(
        [Parameter(Mandatory = $true)][IntPtr]$Handle
    )

    [void][NativeWindowTools]::ShowWindowAsync($Handle, $SW_RESTORE)
    [void][NativeWindowTools]::BringWindowToTop($Handle)
    [void][NativeWindowTools]::SetForegroundWindow($Handle)
    Start-Sleep -Milliseconds 200
}

function Send-WinArrow {
    param(
        [Parameter(Mandatory = $true)][ValidateSet("Left", "Right", "Up", "Down")][string]$Direction
    )

    $arrowVk = switch ($Direction) {
        "Left" { $VK_LEFT }
        "Right" { $VK_RIGHT }
        "Up" { $VK_UP }
        "Down" { $VK_DOWN }
    }

    [NativeWindowTools]::keybd_event([byte]$VK_LWIN, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 40
    [NativeWindowTools]::keybd_event([byte]$arrowVk, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 40
    [NativeWindowTools]::keybd_event([byte]$arrowVk, 0, $KEYEVENTF_KEYUP, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 40
    [NativeWindowTools]::keybd_event([byte]$VK_LWIN, 0, $KEYEVENTF_KEYUP, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 280
}

function Send-WinDesktopShow {
    [NativeWindowTools]::keybd_event([byte]$VK_LWIN, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 40
    [NativeWindowTools]::keybd_event([byte]$VK_D, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 40
    [NativeWindowTools]::keybd_event([byte]$VK_D, 0, $KEYEVENTF_KEYUP, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 40
    [NativeWindowTools]::keybd_event([byte]$VK_LWIN, 0, $KEYEVENTF_KEYUP, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 350
}

function Send-KeysToWindow {
    param(
        [Parameter(Mandatory = $true)][IntPtr]$Handle,
        [Parameter(Mandatory = $true)][string]$Keys,
        [int]$PreDelayMs = 120
    )

    Set-WindowForeground -Handle $Handle
    if ($PreDelayMs -gt 0) {
        Start-Sleep -Milliseconds $PreDelayMs
    }
    [System.Windows.Forms.SendKeys]::SendWait($Keys)
    Start-Sleep -Milliseconds 120
}

function Test-WindowNearBounds {
    param(
        [Parameter(Mandatory = $true)][IntPtr]$Handle,
        [Parameter(Mandatory = $true)][int]$X,
        [Parameter(Mandatory = $true)][int]$Y,
        [Parameter(Mandatory = $true)][int]$Width,
        [Parameter(Mandatory = $true)][int]$Height,
        [int]$TolerancePx = 40
    )

    $rect = Get-WindowRect -Handle $Handle
    return (
        [Math]::Abs($rect.left - $X) -le $TolerancePx -and
        [Math]::Abs($rect.top - $Y) -le $TolerancePx -and
        [Math]::Abs($rect.width - $Width) -le $TolerancePx -and
        [Math]::Abs($rect.height - $Height) -le $TolerancePx
    )
}

function Invoke-SnapStep {
    param(
        [Parameter(Mandatory = $true)][IntPtr]$Handle,
        [Parameter(Mandatory = $true)][string[]]$Directions,
        [Parameter(Mandatory = $true)][int]$ExpectedX,
        [Parameter(Mandatory = $true)][int]$ExpectedY,
        [Parameter(Mandatory = $true)][int]$ExpectedWidth,
        [Parameter(Mandatory = $true)][int]$ExpectedHeight
    )

    Set-WindowForeground -Handle $Handle
    foreach ($dir in $Directions) {
        Send-WinArrow -Direction $dir
    }

    return (Test-WindowNearBounds -Handle $Handle -X $ExpectedX -Y $ExpectedY -Width $ExpectedWidth -Height $ExpectedHeight)
}

function Select-Qv2rayLowestLatencyUsConnection {
    param(
        [Parameter(Mandatory = $true)][string]$ConfigDir
    )

    $connectionsPath = Join-Path $ConfigDir "connections.json"
    $groupsPath = Join-Path $ConfigDir "groups.json"
    $mainConfigPath = Join-Path $ConfigDir "Qv2ray.conf"

    foreach ($path in @($connectionsPath, $groupsPath, $mainConfigPath)) {
        if (!(Test-Path -LiteralPath $path -PathType Leaf)) {
            throw "Missing qv2ray config file: $path"
        }
    }

    $connectionsJson = Get-Content -LiteralPath $connectionsPath -Raw | ConvertFrom-Json
    $groupsJson = Get-Content -LiteralPath $groupsPath -Raw | ConvertFrom-Json
    $mainConfig = Get-Content -LiteralPath $mainConfigPath -Raw | ConvertFrom-Json

    $usCandidates = @()
    foreach ($prop in $connectionsJson.PSObject.Properties) {
        $id = [string]$prop.Name
        $meta = $prop.Value
        if ($null -eq $meta) { continue }

        $name = [string]$meta.displayName
        if ([string]::IsNullOrWhiteSpace($name)) { continue }
        if ($name -notmatch "(^|[\s_\(])US([-\s_\)]|$)") { continue }

        $latency = [int]::MaxValue
        try { $latency = [int]$meta.latency } catch { continue }
        if ($latency -le 0) { continue }

        $lastConnected = 0
        try { $lastConnected = [int64]$meta.lastConnected } catch { $lastConnected = 0 }

        $usCandidates += [pscustomobject]@{
            id = $id
            name = $name
            latency = $latency
            lastConnected = $lastConnected
        }
    }

    if ($usCandidates.Count -eq 0) {
        throw "No US connections with valid latency were found in $connectionsPath."
    }

    $selected = $usCandidates | Sort-Object latency, @{ Expression = { -1 * $_.lastConnected } } | Select-Object -First 1

    $selectedGroupId = "000000000000"
    foreach ($grp in $groupsJson.PSObject.Properties) {
        $groupId = [string]$grp.Name
        $groupValue = $grp.Value
        if ($null -eq $groupValue) { continue }
        if ($groupValue.connections -contains $selected.id) {
            $selectedGroupId = $groupId
            break
        }
    }

    $target = [pscustomobject]@{
        connectionId = $selected.id
        groupId = $selectedGroupId
    }

    if ($null -eq $mainConfig.lastConnectedId) {
        $mainConfig | Add-Member -MemberType NoteProperty -Name lastConnectedId -Value $target
    } else {
        $mainConfig.lastConnectedId = $target
    }

    if ($null -eq $mainConfig.autoStartId) {
        $mainConfig | Add-Member -MemberType NoteProperty -Name autoStartId -Value $target
    } else {
        $mainConfig.autoStartId = $target
    }

    # 2 is the commonly used qv2ray config value for auto-connect startup behavior.
    $mainConfig.autoStartBehavior = 2

    $mainConfig | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $mainConfigPath -Encoding UTF8

    return [pscustomobject]@{
        ok = $true
        connection_id = $selected.id
        display_name = $selected.name
        latency_ms = $selected.latency
        group_id = $selectedGroupId
        config_path = $mainConfigPath
    }
}

function Set-Qv2rayConnectionPreference {
    param(
        [Parameter(Mandatory = $true)][string]$ConfigDir,
        [Parameter(Mandatory = $true)][string]$ConnectionId,
        [Parameter(Mandatory = $true)][string]$GroupId
    )

    $mainConfigPath = Join-Path $ConfigDir "Qv2ray.conf"
    if (!(Test-Path -LiteralPath $mainConfigPath -PathType Leaf)) {
        throw "Missing qv2ray config file: $mainConfigPath"
    }

    $mainConfig = Get-Content -LiteralPath $mainConfigPath -Raw | ConvertFrom-Json
    $target = [pscustomobject]@{
        connectionId = $ConnectionId
        groupId = $GroupId
    }

    if ($null -eq $mainConfig.lastConnectedId) {
        $mainConfig | Add-Member -MemberType NoteProperty -Name lastConnectedId -Value $target
    } else {
        $mainConfig.lastConnectedId = $target
    }

    if ($null -eq $mainConfig.autoStartId) {
        $mainConfig | Add-Member -MemberType NoteProperty -Name autoStartId -Value $target
    } else {
        $mainConfig.autoStartId = $target
    }

    $mainConfig.autoStartBehavior = 2
    $mainConfig | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $mainConfigPath -Encoding UTF8
}

function Get-Qv2raySelectionCache {
    param(
        [Parameter(Mandatory = $true)][string]$CachePath
    )

    if (!(Test-Path -LiteralPath $CachePath -PathType Leaf)) {
        return $null
    }

    try {
        $cached = Get-Content -LiteralPath $CachePath -Raw | ConvertFrom-Json
        if ($null -eq $cached.connection_id -or $null -eq $cached.group_id) {
            return $null
        }
        return $cached
    } catch {
        return $null
    }
}

function Save-Qv2raySelectionCache {
    param(
        [Parameter(Mandatory = $true)][string]$CachePath,
        [Parameter(Mandatory = $true)][object]$Selection
    )

    $payload = [pscustomobject]@{
        updated = (Get-Date).ToString("o")
        connection_id = [string]$Selection.connection_id
        group_id = [string]$Selection.group_id
        display_name = [string]$Selection.display_name
        latency_ms = [int]$Selection.latency_ms
    }
    $payload | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $CachePath -Encoding UTF8
}

function Resolve-FirstPathCandidate {
    param(
        [string[]]$Candidates
    )

    foreach ($candidate in $Candidates) {
        if ([string]::IsNullOrWhiteSpace($candidate)) { continue }
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return $candidate
        }
    }

    return ($Candidates | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -First 1)
}

function Join-PathIfPresent {
    param(
        [string]$BasePath,
        [Parameter(Mandatory = $true)][string]$ChildPath
    )

    if ([string]::IsNullOrWhiteSpace($BasePath)) {
        return $null
    }

    return (Join-Path $BasePath $ChildPath)
}

if (!(Test-Path -LiteralPath $ExplorerPath -PathType Container)) {
    throw "Explorer path does not exist: $ExplorerPath"
}

if (!(Test-Path -LiteralPath $Qv2rayPath -PathType Leaf)) {
    throw "Qv2ray executable was not found: $Qv2rayPath"
}

$resolvedQv2rayConfigDir = if ([string]::IsNullOrWhiteSpace($Qv2rayConfigDir)) {
    Join-Path $env:LOCALAPPDATA "qv2ray"
} else {
    [IO.Path]::GetFullPath($Qv2rayConfigDir)
}

$resolvedGlobalMgmtDir = if ([string]::IsNullOrWhiteSpace($GlobalMgmtDir)) {
    Split-Path -Parent $PSScriptRoot
} else {
    [IO.Path]::GetFullPath($GlobalMgmtDir)
}
$resolvedCmdWorkingDirectory = if ([string]::IsNullOrWhiteSpace($CmdWorkingDirectory)) {
    if ([string]::IsNullOrWhiteSpace($env:USERPROFILE)) { "C:\Users\Qub" } else { $env:USERPROFILE }
} else {
    [IO.Path]::GetFullPath($CmdWorkingDirectory)
}
if (!(Test-Path -LiteralPath $resolvedCmdWorkingDirectory -PathType Container)) {
    $resolvedCmdWorkingDirectory = if ([string]::IsNullOrWhiteSpace($env:USERPROFILE)) { "C:\Users\Qub" } else { $env:USERPROFILE }
}
$stateDir = Join-Path $resolvedGlobalMgmtDir "state"
New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
$selectionCachePath = Join-Path $stateDir "qv2ray-us-last-good.json"

$qv2raySelection = $null
$qv2raySelectionWarning = $null
if ($EnableQv2rayUsAutoSelect) {
    try {
        $qv2raySelection = Select-Qv2rayLowestLatencyUsConnection -ConfigDir $resolvedQv2rayConfigDir
        Save-Qv2raySelectionCache -CachePath $selectionCachePath -Selection $qv2raySelection
    } catch {
        $qv2raySelectionWarning = $_.Exception.Message
        $cachedSelection = Get-Qv2raySelectionCache -CachePath $selectionCachePath
        if ($null -ne $cachedSelection) {
            try {
                Set-Qv2rayConnectionPreference -ConfigDir $resolvedQv2rayConfigDir -ConnectionId $cachedSelection.connection_id -GroupId $cachedSelection.group_id
                $qv2raySelection = [pscustomobject]@{
                    ok = $true
                    connection_id = $cachedSelection.connection_id
                    display_name = [string]$cachedSelection.display_name
                    latency_ms = [int]$cachedSelection.latency_ms
                    group_id = $cachedSelection.group_id
                    config_path = (Join-Path $resolvedQv2rayConfigDir "Qv2ray.conf")
                    source = "cache_fallback"
                }
            } catch {
                $qv2raySelectionWarning = "{0}; cache fallback failed: {1}" -f $qv2raySelectionWarning, $_.Exception.Message
            }
        }
    }
}

if ($InitialDelayMs -gt 0) {
    Start-Sleep -Milliseconds $InitialDelayMs
}

$resolvedVsCodePath = if ([string]::IsNullOrWhiteSpace($VsCodePath)) {
    Resolve-FirstPathCandidate -Candidates @(
        (Join-PathIfPresent -BasePath $env:LOCALAPPDATA -ChildPath "Programs\Microsoft VS Code\Code.exe"),
        (Join-PathIfPresent -BasePath $env:ProgramFiles -ChildPath "Microsoft VS Code\Code.exe"),
        (Join-PathIfPresent -BasePath ${env:ProgramFiles(x86)} -ChildPath "Microsoft VS Code\Code.exe")
    )
} else {
    [IO.Path]::GetFullPath($VsCodePath)
}
$resolvedWeChatPath = if ([string]::IsNullOrWhiteSpace($WeChatPath)) {
    Resolve-FirstPathCandidate -Candidates @(
        (Join-PathIfPresent -BasePath ${env:ProgramFiles(x86)} -ChildPath "Tencent\WeChat\WeChat.exe"),
        (Join-PathIfPresent -BasePath $env:ProgramFiles -ChildPath "Tencent\WeChat\WeChat.exe"),
        (Join-PathIfPresent -BasePath ${env:ProgramFiles(x86)} -ChildPath "Tencent\Weixin\Weixin.exe"),
        (Join-PathIfPresent -BasePath $env:ProgramFiles -ChildPath "Tencent\Weixin\Weixin.exe"),
        (Join-PathIfPresent -BasePath $env:LOCALAPPDATA -ChildPath "Tencent\WeChat\WeChat.exe")
    )
} else {
    [IO.Path]::GetFullPath($WeChatPath)
}
$resolvedChromePath = if ([string]::IsNullOrWhiteSpace($ChromePath)) {
    Resolve-FirstPathCandidate -Candidates @(
        (Join-PathIfPresent -BasePath $env:ProgramFiles -ChildPath "Google\Chrome\Application\chrome.exe"),
        (Join-PathIfPresent -BasePath ${env:ProgramFiles(x86)} -ChildPath "Google\Chrome\Application\chrome.exe")
    )
} else {
    [IO.Path]::GetFullPath($ChromePath)
}

$workingArea = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$leftWidth = [int][Math]::Floor($workingArea.Width / 2)
$rightWidth = $workingArea.Width - $leftWidth
$upperHeight = [int][Math]::Floor($workingArea.Height / 2)
$lowerHeight = $workingArea.Height - $upperHeight

$qv2rayHandle = [IntPtr]::Zero
$qv2rayLaunchWarning = $null
$codexPostStartDotSent = $false
$codexPostStartDotWarning = $null
$codexPromptArgumentUsed = $false
$snapQv2rayOk = $false
$snapExplorerOk = $false
$snapCmdOk = $false

$alternateGroupResults = @()
if ($EnableAlternateLeftGroups) {
    $weChatProcessName = if ([string]::IsNullOrWhiteSpace($resolvedWeChatPath)) {
        "WeChat"
    } else {
        [IO.Path]::GetFileNameWithoutExtension($resolvedWeChatPath)
    }

    $alternateSpecs = @(
        [pscustomobject]@{
            id = "vscode"
            process_name = "Code"
            app_path = $resolvedVsCodePath
            args = @("--new-window")
            force_new_window = $true
        },
        [pscustomobject]@{
            id = "wechat"
            process_name = $weChatProcessName
            app_path = $resolvedWeChatPath
            args = @()
            force_new_window = $false
        },
        [pscustomobject]@{
            id = "chrome"
            process_name = "chrome"
            app_path = $resolvedChromePath
            args = @()
            force_new_window = $false
        }
    )

    foreach ($alt in $alternateSpecs) {
        Send-WinDesktopShow
        if ($AlternateGroupPauseMs -gt 0) {
            Start-Sleep -Milliseconds $AlternateGroupPauseMs
        }

        $altResult = [ordered]@{
            app = $alt.id
            app_path = $alt.app_path
            created = $false
            warning = $null
            snap_result = [ordered]@{
                left = $false
            }
        }

        if (!(Test-Path -LiteralPath $alt.app_path -PathType Leaf)) {
            $altResult.warning = "App executable was not found."
            $alternateGroupResults += [pscustomobject]$altResult
            continue
        }

        try {
            $leftHandle = Ensure-AppWindowHandle -AppPath $alt.app_path -ProcessName $alt.process_name -ArgumentList $alt.args -ForceNewWindow $alt.force_new_window -TimeoutSeconds $WindowTimeoutSeconds

            $altSnapLeft = Invoke-SnapStep -Handle $leftHandle -Directions @("Left") -ExpectedX $workingArea.Left -ExpectedY $workingArea.Top -ExpectedWidth $leftWidth -ExpectedHeight $workingArea.Height

            if (-not $altSnapLeft) {
                Set-WindowBounds -Handle $leftHandle -X $workingArea.Left -Y $workingArea.Top -Width $leftWidth -Height $workingArea.Height
            }

            if ($alt.id -eq "wechat") {
                Send-KeysToWindow -Handle $leftHandle -Keys "{ENTER}" -PreDelayMs 120
            } elseif ($alt.id -eq "chrome") {
                Send-KeysToWindow -Handle $leftHandle -Keys "{ESC}" -PreDelayMs 120
            }

            $altResult.created = $true
            $altResult.snap_result.left = $altSnapLeft
        } catch {
            $altResult.warning = $_.Exception.Message
        }

        $alternateGroupResults += [pscustomobject]$altResult
    }

    # After the final alternate-group key action (chrome ESC), return to desktop
    # before launching and arranging the primary qv2ray/explorer/cmd group.
    Send-WinDesktopShow
    if ($AlternateGroupPauseMs -gt 0) {
        Start-Sleep -Milliseconds $AlternateGroupPauseMs
    }
}

$explorerStartedAt = Get-Date
try {
    $qv2rayHandle = Ensure-Qv2rayWindowHandle -Qv2rayExePath $Qv2rayPath -TimeoutSeconds $WindowTimeoutSeconds
} catch {
    $qv2rayLaunchWarning = $_.Exception.Message
}
Start-Sleep -Milliseconds 400
Start-Process -FilePath "explorer.exe" -ArgumentList "`"$ExplorerPath`"" | Out-Null
Start-Sleep -Milliseconds 400
$isCodexStartupCommand = $CmdStartupCommand -match '(^|\s)codex(\s|$)'
$effectiveCmdStartupCommand = $CmdStartupCommand
if ($UseCodexPromptArgument -and $isCodexStartupCommand -and -not [string]::IsNullOrWhiteSpace($CodexPostStartText)) {
    $effectiveCmdStartupCommand = "$CmdStartupCommand `"$CodexPostStartText`""
    $codexPromptArgumentUsed = $true
}

$cmdArgs = @("/k")
if (-not [string]::IsNullOrWhiteSpace($effectiveCmdStartupCommand)) {
    $cmdArgs += $effectiveCmdStartupCommand
}
$cmdProcess = Start-Process -FilePath "cmd.exe" -ArgumentList $cmdArgs -WorkingDirectory $resolvedCmdWorkingDirectory -PassThru

Start-Sleep -Milliseconds $LaunchDelayMs

$explorerHandle = Wait-ExplorerWindowHandle -TargetPath $ExplorerPath -StartedAfter $explorerStartedAt -TimeoutSeconds $WindowTimeoutSeconds
$cmdHandle = Wait-ProcessMainWindow -Process $cmdProcess -TimeoutSeconds $WindowTimeoutSeconds

if ($qv2rayHandle -ne [IntPtr]::Zero) {
    $snapQv2rayOk = Invoke-SnapStep -Handle $qv2rayHandle -Directions @("Left") -ExpectedX $workingArea.Left -ExpectedY $workingArea.Top -ExpectedWidth $leftWidth -ExpectedHeight $workingArea.Height
}
$snapExplorerOk = Invoke-SnapStep -Handle $explorerHandle -Directions @("Right", "Up") -ExpectedX ($workingArea.Left + $leftWidth) -ExpectedY $workingArea.Top -ExpectedWidth $rightWidth -ExpectedHeight $upperHeight
$snapCmdOk = Invoke-SnapStep -Handle $cmdHandle -Directions @("Right", "Down") -ExpectedX ($workingArea.Left + $leftWidth) -ExpectedY ($workingArea.Top + $upperHeight) -ExpectedWidth $rightWidth -ExpectedHeight $lowerHeight

if ($qv2rayHandle -ne [IntPtr]::Zero -and -not $snapQv2rayOk) {
    Set-WindowBounds -Handle $qv2rayHandle -X $workingArea.Left -Y $workingArea.Top -Width $leftWidth -Height $workingArea.Height
}
if (-not $snapExplorerOk) {
    Set-WindowBounds -Handle $explorerHandle -X ($workingArea.Left + $leftWidth) -Y $workingArea.Top -Width $rightWidth -Height $upperHeight
}
if (-not $snapCmdOk) {
    Set-WindowBounds -Handle $cmdHandle -X ($workingArea.Left + $leftWidth) -Y ($workingArea.Top + $upperHeight) -Width $rightWidth -Height $lowerHeight
}

if ($isCodexStartupCommand -and -not $codexPromptArgumentUsed) {
    try {
        if ($CodexPostStartDelayMs -gt 0) {
            Start-Sleep -Milliseconds $CodexPostStartDelayMs
        }

        $attempts = [Math]::Max(1, $CodexPostStartDotRetries)
        for ($attempt = 1; $attempt -le $attempts; $attempt++) {
            Send-KeysToWindow -Handle $cmdHandle -Keys $CodexPostStartText -PreDelayMs 120
            Start-Sleep -Milliseconds 80
            Send-KeysToWindow -Handle $cmdHandle -Keys $CodexSubmitKeys -PreDelayMs 40
            $codexPostStartDotSent = $true

            if ($attempt -lt $attempts -and $CodexPostStartDotRetryDelayMs -gt 0) {
                Start-Sleep -Milliseconds $CodexPostStartDotRetryDelayMs
            }
        }
    } catch {
        $codexPostStartDotWarning = $_.Exception.Message
    }
}

[pscustomobject]@{
    ok = $true
    explorer_path = [IO.Path]::GetFullPath($ExplorerPath)
    qv2ray_path = [IO.Path]::GetFullPath($Qv2rayPath)
    initial_delay_ms = $InitialDelayMs
    qv2ray_us_autoselect = [ordered]@{
        enabled = [bool]$EnableQv2rayUsAutoSelect
        config_dir = $resolvedQv2rayConfigDir
        cache_path = $selectionCachePath
        selection = $qv2raySelection
        warning = $qv2raySelectionWarning
    }
    qv2ray_startup = [ordered]@{
        window_found = [bool]($qv2rayHandle -ne [IntPtr]::Zero)
        warning = $qv2rayLaunchWarning
    }
    terminal_startup = [ordered]@{
        cmd_startup_command = $CmdStartupCommand
        cmd_effective_startup_command = $effectiveCmdStartupCommand
        cmd_working_directory = $resolvedCmdWorkingDirectory
        codex_prompt_argument_used = $codexPromptArgumentUsed
        codex_poststart_dot_sent = $codexPostStartDotSent
        codex_poststart_dot_warning = $codexPostStartDotWarning
        codex_poststart_delay_ms = $CodexPostStartDelayMs
        codex_poststart_dot_retries = $CodexPostStartDotRetries
        codex_poststart_text = $CodexPostStartText
        codex_submit_keys = $CodexSubmitKeys
    }
    alternate_groups = [ordered]@{
        enabled = [bool]$EnableAlternateLeftGroups
        results = $alternateGroupResults
    }
    snap_attempted = $true
    snap_result = [ordered]@{
        qv2ray = $snapQv2rayOk
        explorer = $snapExplorerOk
        cmd = $snapCmdOk
    }
    layout = [ordered]@{
        left = "qv2ray"
        right_top = "explorer"
        right_bottom = "cmd"
    }
} | ConvertTo-Json -Depth 6
