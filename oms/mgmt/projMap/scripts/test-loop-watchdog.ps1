param(
    [int]$TickMs = 60000,
    [int]$MaxRunMs = 220000
)

$ErrorActionPreference = 'Stop'

$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$logPath = Join-Path $workspaceRoot 'mgmt\projMap\state\loop-watchdog.log'
$errLogPath = Join-Path $workspaceRoot 'mgmt\projMap\state\loop-watchdog.err.log'

if (Test-Path $logPath) {
    Remove-Item $logPath -Force
}
if (Test-Path $errLogPath) {
    Remove-Item $errLogPath -Force
}

$env:OMS_FAST_FLOW_TICK_MS = [string]$TickMs
$proc = Start-Process -FilePath 'npm.cmd' `
    -ArgumentList @('run', 'action:fast-flow-last2h:loop') `
    -WorkingDirectory $workspaceRoot `
    -PassThru `
    -RedirectStandardOutput $logPath `
    -RedirectStandardError $errLogPath

$activeTick = $null
$activeStarted = $null
$lastLength = 0
$stalled = $false
$stallReason = ''
$startedAt = Get-Date

while (-not $proc.HasExited) {
    Start-Sleep -Milliseconds 1000

    if (((Get-Date) - $startedAt).TotalMilliseconds -gt $MaxRunMs) {
        $stalled = $true
        $stallReason = 'global_timeout'
        break
    }

    if (Test-Path $logPath) {
        $raw = Get-Content -Path $logPath -Raw
        if ($raw.Length -gt $lastLength) {
            $newChunk = $raw.Substring($lastLength)
            $lastLength = $raw.Length
            $lines = $newChunk -split "`r?`n"
            foreach ($line in $lines) {
                if ($line -match '\[loop-fast-flow\] tick=(\d+) started_at=') {
                    $activeTick = [int]$Matches[1]
                    $activeStarted = Get-Date
                }
                if ($line -match '\[loop-fast-flow\] tick=(\d+) exit_code=') {
                    if ($activeTick -eq [int]$Matches[1]) {
                        $activeTick = $null
                        $activeStarted = $null
                    }
                }
            }
        }
    }

    if ($activeTick -ne $null -and $activeStarted -ne $null) {
        $elapsedTickMs = ((Get-Date) - $activeStarted).TotalMilliseconds
        if ($elapsedTickMs -gt $TickMs) {
            $stalled = $true
            $stallReason = "tick_${activeTick}_exceeded_${TickMs}ms"
            break
        }
    }
}

if ($stalled -and -not $proc.HasExited) {
    Stop-Process -Id $proc.Id -Force
}

Start-Sleep -Milliseconds 500

$tail = if (Test-Path $logPath) {
    Get-Content -Path $logPath -Tail 180
} else {
    @('<no log>')
}
$errTail = if (Test-Path $errLogPath) {
    Get-Content -Path $errLogPath -Tail 80
} else {
    @('<no err log>')
}

[pscustomobject]@{
    ok = (-not $stalled)
    stalled = $stalled
    stallReason = $stallReason
    processExited = $proc.HasExited
    exitCode = if ($proc.HasExited) { $proc.ExitCode } else { $null }
    tickMs = $TickMs
    maxRunMs = $MaxRunMs
    logPath = $logPath
    errLogPath = $errLogPath
    tail = $tail
    errTail = $errTail
} | ConvertTo-Json -Depth 8
