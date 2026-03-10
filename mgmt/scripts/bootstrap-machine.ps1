param(
    [string]$GlobalMgmtDir = "",
    [string]$UserRoot = "",
    [string]$OldUserRoot = "",
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$GLOBAL_MGMT_DIR = if ([string]::IsNullOrWhiteSpace($GlobalMgmtDir)) {
    Split-Path -Parent $PSScriptRoot
} else {
    [IO.Path]::GetFullPath($GlobalMgmtDir)
}

$USER_ROOT = if ([string]::IsNullOrWhiteSpace($UserRoot)) {
    if ($env:USERPROFILE) { $env:USERPROFILE } else { [Environment]::GetFolderPath('UserProfile') }
} else {
    [IO.Path]::GetFullPath($UserRoot)
}

$INDEX_PATH = Join-Path $GLOBAL_MGMT_DIR "projects-index.json"
$META_PATH = Join-Path $GLOBAL_MGMT_DIR "meta-map.json"
$nowIso = (Get-Date).ToString("o")

if (!(Test-Path -LiteralPath $INDEX_PATH)) {
    $seed = [ordered]@{ id = "projects-index"; root = $USER_ROOT; updated = $nowIso; projects = @() }
    if (-not $DryRun) { $seed | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $INDEX_PATH -Encoding UTF8 }
}

$index = Get-Content -LiteralPath $INDEX_PATH -Raw | ConvertFrom-Json
$oldRootResolved = if ([string]::IsNullOrWhiteSpace($OldUserRoot)) { [string]$index.root } else { [IO.Path]::GetFullPath($OldUserRoot) }
$projects = @($index.projects)

$updatedProjects = @()
foreach ($p in $projects) {
    $projectRoot = [string]$p.projectRoot
    $mapPath = [string]$p.mapPath
    if (-not [string]::IsNullOrWhiteSpace($oldRootResolved) -and $projectRoot.StartsWith($oldRootResolved, [System.StringComparison]::OrdinalIgnoreCase)) {
        $projectRoot = $projectRoot.Replace($oldRootResolved, $USER_ROOT)
    }
    if (-not [string]::IsNullOrWhiteSpace($oldRootResolved) -and $mapPath.StartsWith($oldRootResolved, [System.StringComparison]::OrdinalIgnoreCase)) {
        $mapPath = $mapPath.Replace($oldRootResolved, $USER_ROOT)
    }

    $canonical = Join-Path $projectRoot "mgmt\projMap\map.json"
    if (Test-Path -LiteralPath $canonical) { $mapPath = $canonical }

    $updatedProjects += [pscustomobject]@{
        id = [string]$p.id
        name = [string]$p.name
        projectRoot = $projectRoot
        mapPath = $mapPath
        status = if ([string]::IsNullOrWhiteSpace([string]$p.status)) { "active" } else { [string]$p.status }
        updated = if ([string]::IsNullOrWhiteSpace([string]$p.updated)) { $nowIso } else { [string]$p.updated }
        projectType = if ($p.PSObject.Properties.Name -contains "projectType" -and ![string]::IsNullOrWhiteSpace([string]$p.projectType)) { [string]$p.projectType } else { "application" }
        extraction = if ($p.PSObject.Properties.Name -contains "extraction" -and $null -ne $p.extraction) {
            [pscustomobject]@{
                mode = if ([string]::IsNullOrWhiteSpace([string]$p.extraction.mode)) { "native" } else { [string]$p.extraction.mode }
                sourceProjects = @($p.extraction.sourceProjects)
                extractedAt = $p.extraction.extractedAt
            }
        } else {
            [pscustomobject]@{ mode = "native"; sourceProjects = @(); extractedAt = $null }
        }
        sharing = if ($p.PSObject.Properties.Name -contains "sharing" -and $null -ne $p.sharing) {
            [pscustomobject]@{
                exports = @($p.sharing.exports)
                consumers = @($p.sharing.consumers)
            }
        } else {
            [pscustomobject]@{ exports = @(); consumers = @() }
        }
    }
}

$indexOut = [ordered]@{
    id = "projects-index"
    root = $USER_ROOT
    updated = $nowIso
    projects = $updatedProjects
}

if (-not $DryRun) {
    $indexOut | ConvertTo-Json -Depth 50 | Set-Content -LiteralPath $INDEX_PATH -Encoding UTF8
}

# Ensure meta-map exists before sync for first-run experience.
if (!(Test-Path -LiteralPath $META_PATH) -and -not $DryRun) {
    $metaSeed = [ordered]@{
        id = "meta-map"
        type = "meta"
        name = "Workspace Project Map Index"
        summary = "Aggregated index of project maps"
        root = $USER_ROOT
        updated = $nowIso
        stats = [ordered]@{ total_projects = 0; active_projects = 0; sources_total = 0; sources_ok = 0; sources_missing = 0; sources_parse_error = 0; cross_edges = 0 }
        sources = @()
        nodes = @()
        edges = @()
        children = @()
    }
    $metaSeed | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $META_PATH -Encoding UTF8
}

if (-not $DryRun) {
    & (Join-Path $GLOBAL_MGMT_DIR "scripts\map-sync.ps1") -GlobalMgmtDir $GLOBAL_MGMT_DIR | Out-Null
    $vizScript = Join-Path $GLOBAL_MGMT_DIR "visualization\generate-graph-data.ps1"
    if (Test-Path -LiteralPath $vizScript) {
        & $vizScript -GlobalMgmtDir $GLOBAL_MGMT_DIR | Out-Null
    }
}

[pscustomobject]@{
    ok = $true
    dry_run = [bool]$DryRun
    global_mgmt_dir = $GLOBAL_MGMT_DIR
    user_root = $USER_ROOT
    old_user_root = $oldRootResolved
    projects = @($updatedProjects).Count
    index_path = $INDEX_PATH
    meta_path = $META_PATH
} | ConvertTo-Json -Depth 6
