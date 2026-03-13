param(
    [string]$ExplorerPath = "C:\Users\Qub",
    [string]$Qv2rayPath = "C:\Program Files\qv2ray\qv2ray.exe",
    [string]$Qv2rayConfigDir = "",
    [bool]$EnableQv2rayUsAutoSelect = $true,
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

$qv2raySelection = $null
if ($EnableQv2rayUsAutoSelect) {
    $qv2raySelection = Select-Qv2rayLowestLatencyUsConnection -ConfigDir $resolvedQv2rayConfigDir
}

if ($InitialDelayMs -gt 0) {
    Start-Sleep -Milliseconds $InitialDelayMs
}

$workingArea = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$leftWidth = [int][Math]::Floor($workingArea.Width / 2)
$rightWidth = $workingArea.Width - $leftWidth
$upperHeight = [int][Math]::Floor($workingArea.Height / 2)
$lowerHeight = $workingArea.Height - $upperHeight

$explorerStartedAt = Get-Date
$qv2rayProcess = Start-Process -FilePath $Qv2rayPath -PassThru
Start-Sleep -Milliseconds 400
Start-Process -FilePath "explorer.exe" -ArgumentList "`"$ExplorerPath`"" | Out-Null
Start-Sleep -Milliseconds 400
$cmdProcess = Start-Process -FilePath "cmd.exe" -PassThru

Start-Sleep -Milliseconds $LaunchDelayMs

$qv2rayHandle = Wait-ProcessMainWindow -Process $qv2rayProcess -TimeoutSeconds $WindowTimeoutSeconds
$explorerHandle = Wait-ExplorerWindowHandle -TargetPath $ExplorerPath -StartedAfter $explorerStartedAt -TimeoutSeconds $WindowTimeoutSeconds
$cmdHandle = Wait-ProcessMainWindow -Process $cmdProcess -TimeoutSeconds $WindowTimeoutSeconds

$snapQv2rayOk = Invoke-SnapStep -Handle $qv2rayHandle -Directions @("Left") -ExpectedX $workingArea.Left -ExpectedY $workingArea.Top -ExpectedWidth $leftWidth -ExpectedHeight $workingArea.Height
$snapExplorerOk = Invoke-SnapStep -Handle $explorerHandle -Directions @("Right", "Up") -ExpectedX ($workingArea.Left + $leftWidth) -ExpectedY $workingArea.Top -ExpectedWidth $rightWidth -ExpectedHeight $upperHeight
$snapCmdOk = Invoke-SnapStep -Handle $cmdHandle -Directions @("Right", "Down") -ExpectedX ($workingArea.Left + $leftWidth) -ExpectedY ($workingArea.Top + $upperHeight) -ExpectedWidth $rightWidth -ExpectedHeight $lowerHeight

if (-not $snapQv2rayOk) {
    Set-WindowBounds -Handle $qv2rayHandle -X $workingArea.Left -Y $workingArea.Top -Width $leftWidth -Height $workingArea.Height
}
if (-not $snapExplorerOk) {
    Set-WindowBounds -Handle $explorerHandle -X ($workingArea.Left + $leftWidth) -Y $workingArea.Top -Width $rightWidth -Height $upperHeight
}
if (-not $snapCmdOk) {
    Set-WindowBounds -Handle $cmdHandle -X ($workingArea.Left + $leftWidth) -Y ($workingArea.Top + $upperHeight) -Width $rightWidth -Height $lowerHeight
}

[pscustomobject]@{
    ok = $true
    explorer_path = [IO.Path]::GetFullPath($ExplorerPath)
    qv2ray_path = [IO.Path]::GetFullPath($Qv2rayPath)
    initial_delay_ms = $InitialDelayMs
    qv2ray_us_autoselect = [ordered]@{
        enabled = [bool]$EnableQv2rayUsAutoSelect
        config_dir = $resolvedQv2rayConfigDir
        selection = $qv2raySelection
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
