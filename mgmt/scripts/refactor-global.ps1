param(
    [switch]$Apply,
    [string]$PlanPath = "",
    [string]$GlobalMgmtDir = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$GLOBAL_MGMT_DIR = if ([string]::IsNullOrWhiteSpace($GlobalMgmtDir)) {
    Split-Path -Parent $PSScriptRoot
} else {
    [IO.Path]::GetFullPath($GlobalMgmtDir)
}
$USER_ROOT = Split-Path -Parent $GLOBAL_MGMT_DIR
$indexPath = Join-Path $GLOBAL_MGMT_DIR 'projects-index.json'
$reportPath = Join-Path $GLOBAL_MGMT_DIR 'refactor-global-report.json'
$nowIso = (Get-Date).ToString('o')

if (!(Test-Path -LiteralPath $indexPath)) {
    throw "Missing registry: $indexPath"
}

$index = Get-Content -LiteralPath $indexPath -Raw | ConvertFrom-Json
$active = @($index.projects | Where-Object { $_.status -eq 'active' })

$assessment = @()
foreach ($p in $active) {
    $mapPath = if (Test-Path (Join-Path $p.projectRoot 'mgmt\projMap\map.json')) { Join-Path $p.projectRoot 'mgmt\projMap\map.json' } else { $p.mapPath }
    if (!(Test-Path -LiteralPath $mapPath)) {
        $assessment += [ordered]@{ sourceProject = $p.id; recommendation = 'insufficient-data'; reason = 'Map file missing; cannot assess extraction suitability.' }
        continue
    }
    try {
        $map = Get-Content -LiteralPath $mapPath -Raw | ConvertFrom-Json
        $moduleNodes = @($map.nodes | Where-Object { $_.type -eq 'module' })
        if ($moduleNodes.Count -ge 2) {
            $assessment += [ordered]@{ sourceProject = $p.id; recommendation = 'consider-extraction'; reason = 'Multiple module nodes suggest reusable boundary candidates.'; candidateSharedProjectId = "$($p.id)-shared" }
        } else {
            $assessment += [ordered]@{ sourceProject = $p.id; recommendation = 'no-extraction'; reason = 'Insufficient modular surface for balanced extraction.' }
        }
    } catch {
        $assessment += [ordered]@{ sourceProject = $p.id; recommendation = 'parse-error'; reason = $_.Exception.Message }
    }
}

$plannedExtractions = @()
if (-not [string]::IsNullOrWhiteSpace($PlanPath) -and (Test-Path -LiteralPath $PlanPath)) {
    $plan = Get-Content -LiteralPath $PlanPath -Raw | ConvertFrom-Json
    $plannedExtractions = @($plan.extractions)
}

$changes = @()
if ($Apply -and $plannedExtractions.Count -gt 0) {
    foreach ($x in $plannedExtractions) {
        $targetRoot = [string]$x.targetProjectRoot
        $targetId = [string]$x.targetProjectId
        $sourceId = [string]$x.sourceProjectId
        if ([string]::IsNullOrWhiteSpace($targetRoot) -or [string]::IsNullOrWhiteSpace($targetId)) { continue }

        & (Join-Path $GLOBAL_MGMT_DIR 'scripts\init-project.ps1') -ProjectRoot $targetRoot -ProjectId $targetId -Name $targetId -ProjectType 'shared-component' -Exports @($x.exports) -Consumers @($x.consumers) -GlobalMgmtDir $GLOBAL_MGMT_DIR | Out-Null
        & (Join-Path $GLOBAL_MGMT_DIR 'scripts\registry-upsert.ps1') -ProjectRoot $targetRoot -ProjectId $targetId -Name $targetId -Status active -ProjectType 'shared-component' -ExtractionMode 'extracted' -SourceProjects @($sourceId) -ExtractedAt $nowIso -Exports @($x.exports) -Consumers @($x.consumers) -GlobalMgmtDir $GLOBAL_MGMT_DIR | Out-Null

        $sourceProject = $active | Where-Object { $_.id -eq $sourceId } | Select-Object -First 1
        $migrated = @()
        if ($null -ne $sourceProject) {
            foreach ($rel in @($x.modulePaths)) {
                $relPath = [string]$rel
                if ([string]::IsNullOrWhiteSpace($relPath)) { continue }
                $srcPath = Join-Path ([string]$sourceProject.projectRoot) $relPath
                if (!(Test-Path -LiteralPath $srcPath)) { continue }

                $leaf = Split-Path -Leaf $srcPath
                $dstRoot = Join-Path $targetRoot 'src\backend\shared'
                New-Item -ItemType Directory -Path $dstRoot -Force | Out-Null
                $dstPath = Join-Path $dstRoot $leaf

                Copy-Item -LiteralPath $srcPath -Destination $dstPath -Recurse -Force
                $migrated += [ordered]@{ from = $srcPath; to = $dstPath }
            }
        }

        $changes += [ordered]@{ createdProject = $targetId; projectRoot = $targetRoot; sourceProject = $sourceId; migrated = $migrated }
    }

    & (Join-Path $GLOBAL_MGMT_DIR 'scripts\map-sync.ps1') -GlobalMgmtDir $GLOBAL_MGMT_DIR | Out-Null
}

$report = [ordered]@{
    command = '::refactor'
    scope = $USER_ROOT
    apply = [bool]$Apply
    started_at = $nowIso
    finished_at = (Get-Date).ToString('o')
    active_projects = @($active).Count
    assessment = $assessment
    planned_extractions = $plannedExtractions
    changes = $changes
}
$report | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $reportPath -Encoding UTF8

Write-Output ("Refactor report: {0}" -f $reportPath)
