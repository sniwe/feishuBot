param(
    [string]$ExplorerPath = "C:\Users\Qub",
    [string]$Qv2rayPath = "C:\Program Files\qv2ray\qv2ray.exe",
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
}
"@

$SW_RESTORE = 9
$SWP_NOZORDER = 0x0004
$SWP_NOACTIVATE = 0x0010

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

if (!(Test-Path -LiteralPath $ExplorerPath -PathType Container)) {
    throw "Explorer path does not exist: $ExplorerPath"
}

if (!(Test-Path -LiteralPath $Qv2rayPath -PathType Leaf)) {
    throw "Qv2ray executable was not found: $Qv2rayPath"
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

Set-WindowBounds -Handle $qv2rayHandle -X $workingArea.Left -Y $workingArea.Top -Width $leftWidth -Height $workingArea.Height
Set-WindowBounds -Handle $explorerHandle -X ($workingArea.Left + $leftWidth) -Y $workingArea.Top -Width $rightWidth -Height $upperHeight
Set-WindowBounds -Handle $cmdHandle -X ($workingArea.Left + $leftWidth) -Y ($workingArea.Top + $upperHeight) -Width $rightWidth -Height $lowerHeight

[pscustomobject]@{
    ok = $true
    explorer_path = [IO.Path]::GetFullPath($ExplorerPath)
    qv2ray_path = [IO.Path]::GetFullPath($Qv2rayPath)
    initial_delay_ms = $InitialDelayMs
    layout = [ordered]@{
        left = "qv2ray"
        right_top = "explorer"
        right_bottom = "cmd"
    }
} | ConvertTo-Json -Depth 6
