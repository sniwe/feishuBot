param(
    [string]$UserRoot = "",
    [string]$GlobalMgmtDir = "",
    [switch]$AllowFallbackScan
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$GLOBAL_MGMT_DIR = if ([string]::IsNullOrWhiteSpace($GlobalMgmtDir)) {
    Split-Path -Parent $PSScriptRoot
} else {
    [IO.Path]::GetFullPath($GlobalMgmtDir)
}
$USER_ROOT = if ([string]::IsNullOrWhiteSpace($UserRoot)) {
    Split-Path -Parent $GLOBAL_MGMT_DIR
} else {
    [IO.Path]::GetFullPath($UserRoot)
}

$indexPath = Join-Path $GLOBAL_MGMT_DIR 'projects-index.json'
$metaPath = Join-Path $GLOBAL_MGMT_DIR 'meta-map.json'
$nowIso = (Get-Date).ToString('o')

if (!(Test-Path -LiteralPath $indexPath)) {
    $seed = [ordered]@{ id = 'projects-index'; root = $USER_ROOT; updated = $nowIso; projects = @() }
    $seed | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $indexPath -Encoding UTF8
}

$index = Get-Content -LiteralPath $indexPath -Raw | ConvertFrom-Json
$projects = @($index.projects)
$normalized = @()

foreach ($p in $projects) {
    $normalized += [pscustomobject]@{
        id = [string]$p.id
        name = [string]$p.name
        projectRoot = [string]$p.projectRoot
        mapPath = [string]$p.mapPath
        status = if ([string]::IsNullOrWhiteSpace([string]$p.status)) { 'active' } else { [string]$p.status }
        updated = if ([string]::IsNullOrWhiteSpace([string]$p.updated)) { $nowIso } else { [string]$p.updated }
        projectType = if ($p.PSObject.Properties.Name -contains 'projectType' -and ![string]::IsNullOrWhiteSpace([string]$p.projectType)) { [string]$p.projectType } else { 'application' }
        extraction = if ($p.PSObject.Properties.Name -contains 'extraction' -and $null -ne $p.extraction) {
            [pscustomobject]@{ mode = if ([string]::IsNullOrWhiteSpace([string]$p.extraction.mode)) { 'native' } else { [string]$p.extraction.mode }; sourceProjects = @($p.extraction.sourceProjects); extractedAt = $p.extraction.extractedAt }
        } else {
            [pscustomobject]@{ mode = 'native'; sourceProjects = @(); extractedAt = $null }
        }
        sharing = if ($p.PSObject.Properties.Name -contains 'sharing' -and $null -ne $p.sharing) {
            [pscustomobject]@{ exports = @($p.sharing.exports); consumers = @($p.sharing.consumers) }
        } else {
            [pscustomobject]@{ exports = @(); consumers = @() }
        }
    }
}

if ($AllowFallbackScan -and $normalized.Count -eq 0) {
    $foundMaps = Get-ChildItem -Path $USER_ROOT -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match '\\mgmt\\projMap\\map\.json$' -or $_.FullName -match '\\mgmt\\map\.json$' }
    foreach ($m in $foundMaps) {
        $projectRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $m.FullName))
        if ((Split-Path -Parent $projectRoot) -ne $USER_ROOT) { continue }
        $pid = Split-Path -Leaf $projectRoot
        if (@($normalized | Where-Object { $_.id -eq $pid }).Count -gt 0) { continue }
        $normalized += [pscustomobject]@{
            id = $pid; name = $pid; projectRoot = $projectRoot; mapPath = $m.FullName; status = 'active'; updated = $nowIso;
            projectType = 'application'; extraction = [pscustomobject]@{ mode = 'native'; sourceProjects = @(); extractedAt = $null };
            sharing = [pscustomobject]@{ exports = @(); consumers = @() }
        }
    }
}

$indexOut = [ordered]@{ id = 'projects-index'; root = $USER_ROOT; updated = $nowIso; projects = $normalized }
$indexOut | ConvertTo-Json -Depth 40 | Set-Content -LiteralPath $indexPath -Encoding UTF8

$active = @($normalized | Where-Object { $_.status -eq 'active' })
$sources = @(); $nodes = @(); $edges = @(); $children = @()
$sOk = 0; $sMissing = 0; $sErr = 0

foreach ($p in $active) {
    $projectRoot = [string]$p.projectRoot
    $canonical = Join-Path $projectRoot 'mgmt\projMap\map.json'
    $legacy = Join-Path $projectRoot 'mgmt\map.json'
    $mapPath = if (Test-Path -LiteralPath $canonical) { $canonical } elseif (Test-Path -LiteralPath $legacy) { $legacy } else { [string]$p.mapPath }

    $sourceId = "source:$($p.id)"
    $nodeId = "project:$($p.id)"

    if (Test-Path -LiteralPath $mapPath) {
        try {
            $m = Get-Content -LiteralPath $mapPath -Raw | ConvertFrom-Json
            $sources += [ordered]@{ id = $sourceId; projectId = $p.id; projectRoot = $projectRoot; mapPath = $mapPath; status = 'ok'; updated = $nowIso }
            $nodes += [ordered]@{ id = $nodeId; type = 'project'; name = $p.name; projectType = $p.projectType; summary = [string]$m.summary; projectRoot = $projectRoot; mapPath = $mapPath; critical = $false }
            $edges += [ordered]@{ id = "edge:indexes:$($p.id)"; kind = 'indexes'; from = $sourceId; to = $nodeId }
            $children += $nodeId
            $sOk++
        } catch {
            $sources += [ordered]@{ id = $sourceId; projectId = $p.id; projectRoot = $projectRoot; mapPath = $mapPath; status = 'parse_error'; error = $_.Exception.Message; updated = $nowIso }
            $sErr++
        }
    } else {
        $sources += [ordered]@{ id = $sourceId; projectId = $p.id; projectRoot = $projectRoot; mapPath = $mapPath; status = 'missing'; updated = $nowIso }
        $sMissing++
    }
}

foreach ($sp in @($active | Where-Object { $_.projectType -eq 'shared-component' })) {
    $sharedNode = "project:$($sp.id)"
    foreach ($consumerId in @($sp.sharing.consumers)) {
        if ([string]::IsNullOrWhiteSpace([string]$consumerId)) { continue }
        if (@($active | Where-Object { $_.id -eq [string]$consumerId }).Count -eq 0) { continue }
        $edges += [ordered]@{ id = "edge:depends:$consumerId->$($sp.id)"; kind = 'depends'; from = "project:$consumerId"; to = $sharedNode; note = 'Derived from registry sharing.consumers' }
    }
}

$seen = @{}
$dedup = @()
foreach ($e in $edges) {
    $via = if ($e.PSObject.Properties.Name -contains 'via') { [string]$e.via } else { '' }
    $k = "{0}|{1}|{2}|{3}" -f $e.kind, $e.from, $e.to, $via
    if (-not $seen.ContainsKey($k)) { $seen[$k] = $true; $dedup += $e }
}

$meta = [ordered]@{
    id = 'meta-map'
    type = 'meta'
    name = 'Qub Workspace Project Map Index'
    summary = "Aggregated index of project maps under $USER_ROOT"
    root = $USER_ROOT
    updated = $nowIso
    stats = [ordered]@{ total_projects = @($normalized).Count; active_projects = @($active).Count; sources_total = @($sources).Count; sources_ok = $sOk; sources_missing = $sMissing; sources_parse_error = $sErr; cross_edges = @($dedup | Where-Object { $_.kind -ne 'indexes' }).Count }
    sources = $sources
    nodes = $nodes
    edges = $dedup
    children = $children
}
$meta | ConvertTo-Json -Depth 50 | Set-Content -LiteralPath $metaPath -Encoding UTF8

Write-Output ("Meta map refreshed: {0}" -f $metaPath)
