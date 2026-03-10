param(
    [Parameter(Mandatory = $true)][string]$ProjectRoot,
    [string]$ProjectId = "",
    [string]$Name = "",
    [string]$GlobalMgmtDir = "",
    [ValidateSet('active','archived','paused')][string]$Status = 'active',
    [ValidateSet('application','shared-component')][string]$ProjectType = 'application',
    [ValidateSet('native','extracted')][string]$ExtractionMode = 'native',
    [string[]]$SourceProjects = @(),
    [string]$ExtractedAt = $null,
    [string[]]$Exports = @(),
    [string[]]$Consumers = @()
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$GLOBAL_MGMT_DIR = if ([string]::IsNullOrWhiteSpace($GlobalMgmtDir)) {
    Split-Path -Parent $PSScriptRoot
} else {
    [IO.Path]::GetFullPath($GlobalMgmtDir)
}
$USER_ROOT = Split-Path -Parent $GLOBAL_MGMT_DIR
$IndexPath = Join-Path $GLOBAL_MGMT_DIR 'projects-index.json'

$ProjectRoot = [IO.Path]::GetFullPath($ProjectRoot)
if ([string]::IsNullOrWhiteSpace($ProjectId)) { $ProjectId = Split-Path -Leaf $ProjectRoot }
if ([string]::IsNullOrWhiteSpace($Name)) { $Name = $ProjectId }
$mapPath = Join-Path $ProjectRoot 'mgmt\projMap\map.json'
$nowIso = (Get-Date).ToString('o')

if (!(Test-Path -LiteralPath $IndexPath)) {
    $seed = [ordered]@{ id = 'projects-index'; root = $USER_ROOT; updated = $nowIso; projects = @() }
    $seed | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $IndexPath -Encoding UTF8
}

$index = Get-Content -LiteralPath $IndexPath -Raw | ConvertFrom-Json
$projects = @($index.projects)
$existing = $projects | Where-Object { $_.id -eq $ProjectId } | Select-Object -First 1

$entry = [ordered]@{
    id = $ProjectId
    name = $Name
    projectRoot = $ProjectRoot
    mapPath = $mapPath
    status = $Status
    updated = $nowIso
    projectType = $ProjectType
    extraction = [ordered]@{
        mode = $ExtractionMode
        sourceProjects = @($SourceProjects)
        extractedAt = if ([string]::IsNullOrWhiteSpace($ExtractedAt)) { $null } else { $ExtractedAt }
    }
    sharing = [ordered]@{
        exports = @($Exports)
        consumers = @($Consumers)
    }
}

if ($null -eq $existing) {
    $projects += [pscustomobject]$entry
} else {
    $projects = @($projects | Where-Object { $_.id -ne $ProjectId })
    $projects += [pscustomobject]$entry
}

$indexOut = [ordered]@{ id = 'projects-index'; root = $index.root; updated = $nowIso; projects = $projects }
$indexOut | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $IndexPath -Encoding UTF8

Write-Output ("Upserted: {0}" -f $ProjectId)
