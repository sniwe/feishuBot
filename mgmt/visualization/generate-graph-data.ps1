param(
    [string]$UserRoot = "",
    [string]$GlobalMgmtDir = "",
    [string]$OutFile = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

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

$INDEX_PATH = Join-Path $GLOBAL_MGMT_DIR "projects-index.json"
$META_PATH = Join-Path $GLOBAL_MGMT_DIR "meta-map.json"
$OUT_PATH = if ([string]::IsNullOrWhiteSpace($OutFile)) {
    Join-Path $GLOBAL_MGMT_DIR "visualization\graph-data.json"
} else { $OutFile }
$JS_OUT_PATH = [IO.Path]::ChangeExtension($OUT_PATH, ".js")

if (!(Test-Path -LiteralPath $INDEX_PATH)) {
    throw "Missing projects index: $INDEX_PATH"
}

$index = Get-Content -LiteralPath $INDEX_PATH -Raw | ConvertFrom-Json
$active = @($index.projects | Where-Object { $_.status -eq "active" })

$projectGroups = @()
$allNodes = @()
$allEdges = @()

foreach ($p in $active) {
    $projectId = [string]$p.id
    $projectName = [string]$p.name
    $projectRoot = [string]$p.projectRoot
    $canonical = Join-Path $projectRoot "mgmt\projMap\map.json"
    $legacy = Join-Path $projectRoot "mgmt\map.json"
    $mapPath = if (Test-Path -LiteralPath $canonical) { $canonical } elseif (Test-Path -LiteralPath $legacy) { $legacy } else { [string]$p.mapPath }

    if (!(Test-Path -LiteralPath $mapPath)) { continue }

    $map = Get-Content -LiteralPath $mapPath -Raw | ConvertFrom-Json
    $mapNodes = @($map.nodes)
    $mapEdges = @($map.edges)

    $globalProjectNodeId = "project:$projectId"
    $allNodes += [ordered]@{ id = $globalProjectNodeId; projectId = $projectId; type = "project"; label = $projectName; summary = [string]$map.summary }

    $localIds = @{}
    foreach ($n in $mapNodes) {
        $nid = [string]$n.id
        $localIds[$nid] = $true
        $globalId = "$projectId::$nid"
        $label = if ([string]::IsNullOrWhiteSpace([string]$n.name)) { $nid } else { [string]$n.name }
        $allNodes += [ordered]@{ id = $globalId; projectId = $projectId; type = [string]$n.type; label = $label; summary = [string]$n.summary }
        $allEdges += [ordered]@{ id = "edge:contains:${projectId}:${nid}"; kind = "control"; from = $globalProjectNodeId; to = $globalId; note = "contains"; intraProject = $true }
    }

    foreach ($e in $mapEdges) {
        $fromLocal = [string]$e.from
        $toLocal = [string]$e.to
        $fromId = if ($localIds.ContainsKey($fromLocal)) { "$projectId::$fromLocal" } else { $globalProjectNodeId }
        $toId = if ($localIds.ContainsKey($toLocal)) { "$projectId::$toLocal" } else { $globalProjectNodeId }
        $note = if ($e.PSObject.Properties.Name -contains "note") { [string]$e.note } else { "" }
        $via = if ($e.PSObject.Properties.Name -contains "via") { [string]$e.via } else { "" }
        $allEdges += [ordered]@{ id = [string]$e.id; kind = [string]$e.kind; from = $fromId; to = $toId; note = $note; via = $via; intraProject = $true }
    }

    $projectGroups += [ordered]@{ id = $projectId; name = $projectName; projectRoot = $projectRoot; mapPath = $mapPath }
}

if (Test-Path -LiteralPath $META_PATH) {
    try {
        $meta = Get-Content -LiteralPath $META_PATH -Raw | ConvertFrom-Json
        foreach ($e in @($meta.edges)) {
            $from = [string]$e.from
            $to = [string]$e.to
            if ($from -like "project:*" -and $to -like "project:*" -and [string]$e.kind -ne "indexes") {
                $allEdges += [ordered]@{ id = "meta:$([string]$e.id)"; kind = [string]$e.kind; from = $from; to = $to; note = if ([string]::IsNullOrWhiteSpace([string]$e.note)) { "meta-link" } else { [string]$e.note }; via = if ($e.PSObject.Properties.Name -contains "via") { [string]$e.via } else { "" }; intraProject = $false }
            }
        }
    } catch {}
}

$output = [ordered]@{
    id = "workspace-graph"
    generatedAt = (Get-Date).ToString("o")
    source = [ordered]@{ projectsIndex = $INDEX_PATH; metaMap = $META_PATH; projectCount = @($projectGroups).Count }
    projects = $projectGroups
    nodes = $allNodes
    edges = $allEdges
}

New-Item -ItemType Directory -Path (Split-Path -Parent $OUT_PATH) -Force | Out-Null
$jsonText = $output | ConvertTo-Json -Depth 30
$jsonText | Set-Content -LiteralPath $OUT_PATH -Encoding UTF8
"window.__GRAPH_DATA__ = $jsonText;" | Set-Content -LiteralPath $JS_OUT_PATH -Encoding UTF8

Write-Output "Graph data generated: $OUT_PATH"
Write-Output "Graph data generated: $JS_OUT_PATH"
