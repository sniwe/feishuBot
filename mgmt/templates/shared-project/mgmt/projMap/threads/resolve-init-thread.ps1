param(
    [string]$CommandText = "::init",
    [string]$SessionsRootPath = "$env:USERPROFILE\.codex\sessions",
    [string]$CachePath = "$PSScriptRoot\current-thread.json",
    [int]$MaxFilesToCheck = 25
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-SessionMeta {
    param([Parameter(Mandatory = $true)][string]$JsonlPath)

    $firstLines = Get-Content -LiteralPath $JsonlPath -TotalCount 40
    foreach ($line in $firstLines) {
        $obj = $null
        try { $obj = $line | ConvertFrom-Json } catch { $obj = $null }
        if ($null -eq $obj) { continue }
        if ([string]$obj.type -ne "session_meta") { continue }

        $id = [string]$obj.payload.id
        if ([string]::IsNullOrWhiteSpace($id)) { continue }

        return [pscustomobject]@{
            thread_id = $id
            session_meta_ts = [string]$obj.payload.timestamp
        }
    }

    return $null
}

function Resolve-ThreadFromInit {
    param(
        [Parameter(Mandatory = $true)][string]$SessionsRoot,
        [Parameter(Mandatory = $true)][int]$MaxFiles
    )

    $now = Get-Date
    $year = $now.ToString("yyyy")
    $month = $now.ToString("MM")
    $day = $now.ToString("dd")
    $dayDir = Join-Path (Join-Path (Join-Path $SessionsRoot $year) $month) $day

    if (-not (Test-Path -LiteralPath $dayDir)) {
        return [pscustomobject]@{
            ok = $false
            reason = "day_dir_missing"
            checked_at_local = $now.ToString("o")
            sessions_day_dir = $dayDir
            checked_files = @()
        }
    }

    $files = @(Get-ChildItem -LiteralPath $dayDir -File -Filter "rollout-*.jsonl" |
        Sort-Object -Property LastWriteTime -Descending |
        Select-Object -First $MaxFiles)

    if ($files.Count -eq 0) {
        return [pscustomobject]@{
            ok = $false
            reason = "no_rollout_files"
            checked_at_local = $now.ToString("o")
            sessions_day_dir = $dayDir
            checked_files = @()
        }
    }

    $checked = @()
    $chosen = $null

    foreach ($file in $files) {
        $meta = Get-SessionMeta -JsonlPath $file.FullName
        $checked += [pscustomobject]@{
            file = [string]$file.FullName
            last_write_time_local = $file.LastWriteTime.ToString("o")
            has_session_meta = ($null -ne $meta)
            thread_id = if ($null -eq $meta) { "" } else { [string]$meta.thread_id }
        }

        if ($null -ne $meta -and [string]::IsNullOrWhiteSpace([string]$meta.thread_id) -eq $false) {
            $chosen = [pscustomobject]@{
                ok = $true
                reason = "latest_rollout_with_session_meta"
                checked_at_local = $now.ToString("o")
                sessions_day_dir = $dayDir
                thread_id = [string]$meta.thread_id
                session_file = [string]$file.FullName
                session_last_write_local = $file.LastWriteTime.ToString("o")
                checked_files = $checked
            }
            break
        }
    }

    if ($null -ne $chosen) { return $chosen }

    return [pscustomobject]@{
        ok = $false
        reason = "no_session_meta_found"
        checked_at_local = $now.ToString("o")
        sessions_day_dir = $dayDir
        checked_files = $checked
    }
}

if (-not [string]::Equals([string]$CommandText.Trim(), "::init", [System.StringComparison]::OrdinalIgnoreCase)) {
    [pscustomobject]@{
        ok = $false
        reason = "command_not_init"
        command_text = $CommandText
    } | ConvertTo-Json -Depth 8
    exit 0
}

$result = Resolve-ThreadFromInit -SessionsRoot $SessionsRootPath -MaxFiles $MaxFilesToCheck

if ([bool]$result.ok) {
    $cacheDir = Split-Path -Parent $CachePath
    if (-not [string]::IsNullOrWhiteSpace($cacheDir) -and -not (Test-Path -LiteralPath $cacheDir)) {
        New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null
    }

    $cachePayload = [pscustomobject]@{
        thread_id = [string]$result.thread_id
        turn_index = 0
        updated_at_local = [string]$result.checked_at_local
        sessions_day_dir = [string]$result.sessions_day_dir
        session_file = [string]$result.session_file
    }

    $cachePayload | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $CachePath -Encoding UTF8
}

$result | ConvertTo-Json -Depth 8
