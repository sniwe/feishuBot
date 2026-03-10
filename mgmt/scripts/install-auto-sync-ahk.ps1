param(
    [string]$GlobalMgmtDir = "",
    [switch]$StartNow
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$GLOBAL_MGMT_DIR = if ([string]::IsNullOrWhiteSpace($GlobalMgmtDir)) {
    Split-Path -Parent $PSScriptRoot
} else {
    [IO.Path]::GetFullPath($GlobalMgmtDir)
}

$ahkScript = Join-Path $GLOBAL_MGMT_DIR "automation\repo-auto-sync.ahk"
if (!(Test-Path -LiteralPath $ahkScript)) {
    throw "Missing AHK script: $ahkScript"
}

function Find-AhkExe {
    $candidates = @(
        "$env:ProgramFiles\AutoHotkey\v2\AutoHotkey64.exe",
        "$env:ProgramFiles\AutoHotkey\AutoHotkey64.exe",
        "$env:ProgramFiles\AutoHotkey\v2\AutoHotkey.exe",
        "$env:ProgramFiles\AutoHotkey\AutoHotkey.exe",
        "$env:LOCALAPPDATA\Programs\AutoHotkey\v2\AutoHotkey64.exe",
        "$env:LOCALAPPDATA\Programs\AutoHotkey\AutoHotkey64.exe"
    )
    foreach ($p in $candidates) {
        if (Test-Path -LiteralPath $p) { return $p }
    }
    $cmd = Get-Command AutoHotkey64.exe, AutoHotkey.exe, autohotkey -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($cmd) { return $cmd.Source }
    return $null
}

$ahkExe = Find-AhkExe
if (-not $ahkExe) {
    throw "AutoHotkey not found. Install AutoHotkey v2 first."
}

$startupDir = [Environment]::GetFolderPath("Startup")
$startupLnk = Join-Path $startupDir "Repo Auto Sync.lnk"

$wsh = New-Object -ComObject WScript.Shell
$sc = $wsh.CreateShortcut($startupLnk)
$sc.TargetPath = $ahkExe
$sc.Arguments = "`"$ahkScript`""
$sc.WorkingDirectory = Split-Path -Parent $ahkScript
$sc.IconLocation = "$env:SystemRoot\System32\imageres.dll,3"
$sc.Save()

if ($StartNow) {
    Get-CimInstance Win32_Process | Where-Object {
        $_.Name -match "AutoHotkey(64)?\.exe" -and $_.CommandLine -like "*$ahkScript*"
    } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
    Start-Process -FilePath $ahkExe -ArgumentList "`"$ahkScript`""
}

[pscustomobject]@{
    ok = $true
    mode = "ahk_startup"
    startupShortcut = $startupLnk
    ahkExe = $ahkExe
    script = $ahkScript
    startedNow = [bool]$StartNow
} | ConvertTo-Json -Depth 5
