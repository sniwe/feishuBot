param(
    [string]$GlobalMgmtDir = "",
    [string]$Qv2rayPath = "C:\Program Files\qv2ray\qv2ray.exe",
    [string]$Qv2rayConfigDir = "",
    [int]$MaxDurationMinutes = 30,
    [int]$PollIntervalSeconds = 90
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$GLOBAL_MGMT_DIR = if ([string]::IsNullOrWhiteSpace($GlobalMgmtDir)) {
    Split-Path -Parent $PSScriptRoot
} else {
    [IO.Path]::GetFullPath($GlobalMgmtDir)
}
$stateDir = Join-Path $GLOBAL_MGMT_DIR "state"
New-Item -ItemType Directory -Path $stateDir -Force | Out-Null

$resolvedQv2rayConfigDir = if ([string]::IsNullOrWhiteSpace($Qv2rayConfigDir)) {
    Join-Path $env:LOCALAPPDATA "qv2ray"
} else {
    [IO.Path]::GetFullPath($Qv2rayConfigDir)
}

$runStatePath = Join-Path $stateDir "qv2ray-recovery-last-run.json"
$lockPath = Join-Path $stateDir "qv2ray-recovery.lock"
$selectionCachePath = Join-Path $stateDir "qv2ray-us-last-good.json"

function Save-RunState {
    param(
        [Parameter(Mandatory = $true)][hashtable]$State
    )

    $State | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $runStatePath -Encoding UTF8
}

function Test-InternetAvailable {
    $dnsOk = $false
    try {
        $addrs = [System.Net.Dns]::GetHostAddresses("one.one.one.one")
        $dnsOk = $addrs.Count -gt 0
    } catch {
        $dnsOk = $false
    }

    if (-not $dnsOk) {
        return $false
    }

    $tcpOk = $false
    $client = $null
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $ar = $client.BeginConnect("1.1.1.1", 443, $null, $null)
        $tcpOk = $ar.AsyncWaitHandle.WaitOne(1500) -and $client.Connected
        if ($client.Connected) {
            $client.EndConnect($ar)
        }
    } catch {
        $tcpOk = $false
    } finally {
        if ($null -ne $client) {
            $client.Dispose()
        }
    }

    return $tcpOk
}

function Set-Qv2rayConnectionPreference {
    param(
        [Parameter(Mandatory = $true)][string]$ConfigDir,
        [Parameter(Mandatory = $true)][string]$ConnectionId,
        [Parameter(Mandatory = $true)][string]$GroupId
    )

    $configPath = Join-Path $ConfigDir "Qv2ray.conf"
    if (!(Test-Path -LiteralPath $configPath -PathType Leaf)) {
        throw "Missing qv2ray config file: $configPath"
    }

    $cfg = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    $target = [pscustomobject]@{
        connectionId = $ConnectionId
        groupId = $GroupId
    }
    $cfg.lastConnectedId = $target
    $cfg.autoStartId = $target
    $cfg.autoStartBehavior = 2
    $cfg | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $configPath -Encoding UTF8
}

function Select-Qv2rayLowestLatencyUsConnection {
    param(
        [Parameter(Mandatory = $true)][string]$ConfigDir
    )

    $connectionsPath = Join-Path $ConfigDir "connections.json"
    $groupsPath = Join-Path $ConfigDir "groups.json"
    foreach ($path in @($connectionsPath, $groupsPath)) {
        if (!(Test-Path -LiteralPath $path -PathType Leaf)) {
            throw "Missing qv2ray metadata file: $path"
        }
    }

    $connectionsJson = Get-Content -LiteralPath $connectionsPath -Raw | ConvertFrom-Json
    $groupsJson = Get-Content -LiteralPath $groupsPath -Raw | ConvertFrom-Json

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
        if ($grp.Value.connections -contains $selected.id) {
            $selectedGroupId = [string]$grp.Name
            break
        }
    }

    return [pscustomobject]@{
        connection_id = $selected.id
        group_id = $selectedGroupId
        display_name = $selected.name
        latency_ms = $selected.latency
    }
}

function Save-SelectionCache {
    param(
        [Parameter(Mandatory = $true)][object]$Selection
    )

    $payload = [pscustomobject]@{
        updated = (Get-Date).ToString("o")
        connection_id = [string]$Selection.connection_id
        group_id = [string]$Selection.group_id
        display_name = [string]$Selection.display_name
        latency_ms = [int]$Selection.latency_ms
    }
    $payload | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $selectionCachePath -Encoding UTF8
}

function Try-StartQv2ray {
    param(
        [Parameter(Mandatory = $true)][string]$ExePath
    )

    if (!(Test-Path -LiteralPath $ExePath -PathType Leaf)) {
        throw "Qv2ray executable was not found: $ExePath"
    }

    Start-Process -FilePath $ExePath | Out-Null
}

$lockStream = $null
try {
    try {
        $lockStream = [System.IO.File]::Open($lockPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
    } catch {
        Save-RunState -State @{
            ok = $true
            skipped = "locked"
            timestamp = (Get-Date).ToString("o")
            lock_path = $lockPath
        }
        [pscustomobject]@{
            ok = $true
            skipped = "locked"
            lock_path = $lockPath
        } | ConvertTo-Json -Depth 5
        exit 0
    }

    $startedAt = Get-Date
    $deadline = $startedAt.AddMinutes([Math]::Max(1, $MaxDurationMinutes))
    $attempts = 0
    $networkChecks = 0
    $result = $null

    while ((Get-Date) -lt $deadline) {
        $attempts += 1
        $networkChecks += 1

        if (-not (Test-InternetAvailable)) {
            Start-Sleep -Seconds ([Math]::Max(10, $PollIntervalSeconds))
            continue
        }

        $selection = Select-Qv2rayLowestLatencyUsConnection -ConfigDir $resolvedQv2rayConfigDir
        Set-Qv2rayConnectionPreference -ConfigDir $resolvedQv2rayConfigDir -ConnectionId $selection.connection_id -GroupId $selection.group_id
        Save-SelectionCache -Selection $selection
        Try-StartQv2ray -ExePath $Qv2rayPath

        $result = [pscustomobject]@{
            ok = $true
            connected_target = $selection
            attempts = $attempts
            network_checks = $networkChecks
            started_at = $startedAt.ToString("o")
            finished_at = (Get-Date).ToString("o")
        }
        break
    }

    if ($null -eq $result) {
        $result = [pscustomobject]@{
            ok = $false
            reason = "timeout_waiting_for_network_or_selection"
            attempts = $attempts
            network_checks = $networkChecks
            started_at = $startedAt.ToString("o")
            finished_at = (Get-Date).ToString("o")
        }
    }

    Save-RunState -State @{
        ok = [bool]$result.ok
        result = $result
        config_dir = $resolvedQv2rayConfigDir
        qv2ray_path = $Qv2rayPath
    }
    $result | ConvertTo-Json -Depth 10
}
finally {
    if ($null -ne $lockStream) {
        $lockStream.Dispose()
    }
    Remove-Item -LiteralPath $lockPath -ErrorAction SilentlyContinue
}
