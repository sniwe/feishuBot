param(
    [Parameter(Mandatory = $true)][string]$ProjectRoot,
    [string]$ProjectId = "",
    [string]$Name = "",
    [ValidateSet('application','shared-component')][string]$ProjectType = 'application',
    [string[]]$Exports = @(),
    [string[]]$Consumers = @(),
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
$ProjectRoot = [IO.Path]::GetFullPath($ProjectRoot)
if ([string]::IsNullOrWhiteSpace($ProjectId)) { $ProjectId = Split-Path -Leaf $ProjectRoot }
if ([string]::IsNullOrWhiteSpace($Name)) { $Name = $ProjectId }

$templateRoot = Join-Path $GLOBAL_MGMT_DIR 'templates\shared-project'
if (Test-Path -LiteralPath $templateRoot) {
    New-Item -ItemType Directory -Path $ProjectRoot -Force | Out-Null
    Copy-Item -Path (Join-Path $templateRoot '*') -Destination $ProjectRoot -Recurse -Force
}

$src = Join-Path $ProjectRoot 'src'
$backend = Join-Path $src 'backend'
$frontend = Join-Path $src 'frontend'
$public = Join-Path $src 'public'
$mgmtDir = Join-Path $ProjectRoot 'mgmt'
$projMap = Join-Path $mgmtDir 'projMap'
$threads = Join-Path $projMap 'threads'
$state = Join-Path $projMap 'state'
$modules = Join-Path $projMap 'modules\thread-map-tracker'
$scripts = Join-Path $projMap 'scripts'

foreach ($d in @($backend,$frontend,$public,$threads,$state,$modules,$scripts)) {
    New-Item -ItemType Directory -Path $d -Force | Out-Null
}

$agentsPath = Join-Path $ProjectRoot 'AGENTS.md'
if (!(Test-Path -LiteralPath $agentsPath)) {
    $agentsLines = @(
        '# AGENTS.md',
        '',
        '## Scope and Path Variables',
        '',
        '- `WORKSPACE_ROOT`: active project root',
        '- `MGMT_DIR`: `${WORKSPACE_ROOT}\mgmt`',
        '- `PROJMAP_DIR`: `${MGMT_DIR}\projMap`',
        '- `SRC_DIR`: `${WORKSPACE_ROOT}\src`',
        '- `BACKEND_DIR`: `${SRC_DIR}\backend`',
        '- `FRONTEND_DIR`: `${SRC_DIR}\frontend`',
        '- `PUBLIC_DIR`: `${SRC_DIR}\public`',
        '',
        '## Project Governance',
        '',
        '- Keep management assets under `${PROJMAP_DIR}`.',
        '- Keep project code/assets under `${SRC_DIR}` subdirectories.',
        '- Create and auto-maintain `${WORKSPACE_ROOT}\.gitignore` for generated/unwieldy/private artifacts.',
        '- Use Context Object Pattern for authored functions.',
        '- Update `${PROJMAP_DIR}\map.json` after code changes.',
        '',
        '## Project Refactor Bootstrap (`::refactor`)',
        '',
        '- Run project-local refactor only within `${SRC_DIR}`.',
        '- Preserve modular boundaries and Context Object Pattern.',
        '- Update `${PROJMAP_DIR}\map.json` and refresh `updated` timestamp.'
    )
    Set-Content -LiteralPath $agentsPath -Value ($agentsLines -join "`n") -Encoding UTF8
}

$gitignorePath = Join-Path $ProjectRoot '.gitignore'
$governed = @(
  '# codex-governed:start',
  'mgmt/projMap/threads/current-thread.json',
  'mgmt/projMap/state/thread-map-deltas.json',
  '.env',
  '.env.*',
  '*.local',
  'node_modules/',
  'dist/',
  'build/',
  '# codex-governed:end'
)
if (!(Test-Path -LiteralPath $gitignorePath)) {
    Set-Content -LiteralPath $gitignorePath -Value ($governed -join "`n") -Encoding UTF8
} else {
    $existing = Get-Content -LiteralPath $gitignorePath
    $start = ($existing | Select-String '^# codex-governed:start$' | Select-Object -First 1).LineNumber
    $end = ($existing | Select-String '^# codex-governed:end$' | Select-Object -First 1).LineNumber
    if ($start -and $end -and $end -ge $start) {
        $pre = if ($start -gt 1) { $existing[0..($start-2)] } else { @() }
        $post = if ($end -lt $existing.Count) { $existing[$end..($existing.Count-1)] } else { @() }
        Set-Content -LiteralPath $gitignorePath -Value (@($pre + $governed + $post) -join "`n") -Encoding UTF8
    } else {
        Add-Content -LiteralPath $gitignorePath -Value ("`n" + ($governed -join "`n"))
    }
}

$mgmtReadmePath = Join-Path $mgmtDir 'README.md'
if (!(Test-Path -LiteralPath $mgmtReadmePath)) {
    $readmeLines = @(
        '# mgmt layout',
        '',
        'All management assets are packaged under `mgmt/projMap/`.',
        '',
        '- `projMap/map.json`: canonical project map artifact.',
        '- `projMap/threads/`: thread discovery/cache for `::init`.',
        '- `projMap/state/`: generated tracker state/history (`thread-map-deltas.json`).',
        '- `projMap/modules/thread-map-tracker/`: reusable JS module for map delta tracking.',
        '- `projMap/scripts/generate-map.ps1`: map generator and tracker orchestrator.',
        '- `projMap/scripts/track-map-update.js`: runner for thread+map delta tracking.'
    )
    Set-Content -LiteralPath $mgmtReadmePath -Value ($readmeLines -join "`n") -Encoding UTF8
}

$mapPath = Join-Path $projMap 'map.json'
if (!(Test-Path -LiteralPath $mapPath)) {
    $mapSeed = [ordered]@{ id = "map:$ProjectId"; type = 'project-map'; name = $Name; summary = "$Name project map"; root = $ProjectRoot; updated = (Get-Date).ToString('o'); nodes = @(); edges = @(); children = @() }
    $mapSeed | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $mapPath -Encoding UTF8
}

$threadsReadme = Join-Path $threads 'README.md'
if (!(Test-Path -LiteralPath $threadsReadme)) {
    $resolvePath = Join-Path $ProjectRoot 'mgmt\projMap\threads\resolve-init-thread.ps1'
    $lines = @('# Thread Init Resolver','','Use this script when the incoming user command is `::init`.','','```powershell',"& $resolvePath -CommandText '::init'",'```')
    Set-Content -LiteralPath $threadsReadme -Value ($lines -join "`n") -Encoding UTF8
}

$resolveTemplate = Join-Path $templateRoot 'mgmt\projMap\threads\resolve-init-thread.ps1'
$resolveDst = Join-Path $threads 'resolve-init-thread.ps1'
if ((Test-Path -LiteralPath $resolveTemplate) -and !(Test-Path -LiteralPath $resolveDst)) {
    Copy-Item -LiteralPath $resolveTemplate -Destination $resolveDst -Force
}

$threadCache = Join-Path $threads 'current-thread.json'
if (!(Test-Path -LiteralPath $threadCache)) {
    '{"thread_id":"","turn_index":0}' | Set-Content -LiteralPath $threadCache -Encoding UTF8
}

$stateFile = Join-Path $state 'thread-map-deltas.json'
if (!(Test-Path -LiteralPath $stateFile)) {
    '{"id":"thread-map-deltas","type":"thread-map-tracker","updated":"","entries":[],"snapshots":[]}' | Set-Content -LiteralPath $stateFile -Encoding UTF8
}

$trackerSrc = Join-Path $templateRoot 'mgmt\projMap\modules\thread-map-tracker'
$trackerIndex = Join-Path $modules 'index.js'
if (!(Test-Path -LiteralPath $trackerIndex)) {
    "const { trackMapUpdate } = require('./tracker.js');`n`nmodule.exports = { trackMapUpdate };" | Set-Content -LiteralPath $trackerIndex -Encoding UTF8
}
foreach ($f in @('tracker.js','delta.js','io.js')) {
    $dst = Join-Path $modules $f
    $srcFile = Join-Path $trackerSrc $f
    if (!(Test-Path -LiteralPath $dst) -and (Test-Path -LiteralPath $srcFile)) {
        Copy-Item -LiteralPath $srcFile -Destination $dst -Force
    }
}

$trackJs = Join-Path $scripts 'track-map-update.js'
if (!(Test-Path -LiteralPath $trackJs)) {
    $trackLines = @(
        "const fs = require('node:fs/promises');",
        "const path = require('node:path');",
        "const { trackMapUpdate } = require('../modules/thread-map-tracker/index.js');",
        '',
        '(async function main() {',
        '  const cwd = process.cwd();',
        '  const projectRoot = process.argv[2] ? path.resolve(process.argv[2]) : cwd;',
        "  const mgmtDir = path.join(projectRoot, 'mgmt', 'projMap');",
        '  const result = await trackMapUpdate({',
        '    data: {',
        "      mapPath: path.join(mgmtDir, 'map.json'),",
        "      threadCachePath: path.join(mgmtDir, 'threads', 'current-thread.json'),",
        "      historyPath: path.join(mgmtDir, 'state', 'thread-map-deltas.json'),",
        '      nowIso: new Date().toISOString(),',
        '      maxSnapshots: 30',
        '    },',
        '    deps: { fs }',
        '  });',
        '  console.log(JSON.stringify(result));',
        '})().catch(function (error) {',
        '  console.error(error);',
        '  process.exit(1);',
        '});'
    )
    Set-Content -LiteralPath $trackJs -Value ($trackLines -join "`n") -Encoding UTF8
}

$genPs1 = Join-Path $scripts 'generate-map.ps1'
if (!(Test-Path -LiteralPath $genPs1)) {
    $genLines = @(
        'param([string]$ProjectRoot = "")',
        '',
        'Set-StrictMode -Version Latest',
        '$ErrorActionPreference = "Stop"',
        '',
        'if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {',
        '  $ProjectRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))',
        '}',
        '',
        '$mgmtDir = Split-Path -Parent $PSScriptRoot',
        '$mapPath = Join-Path $mgmtDir "map.json"',
        '$map = [ordered]@{',
        '  id = "map:$(Split-Path -Leaf $ProjectRoot)"',
        '  type = "project-map"',
        '  name = (Split-Path -Leaf $ProjectRoot)',
        '  summary = "Project map generated by bootstrap script"',
        '  root = $ProjectRoot',
        '  updated = (Get-Date).ToString("o")',
        '  nodes = @()',
        '  edges = @()',
        '  children = @()',
        '}',
        '$map | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $mapPath -Encoding UTF8',
        'Write-Output "Map generated: $mapPath"',
        '$trackerScript = Join-Path $PSScriptRoot "track-map-update.js"',
        'if (Test-Path -LiteralPath $trackerScript) {',
        '  $trackerResult = & node $trackerScript $ProjectRoot',
        '  Write-Output "Tracker updated: $trackerResult"',
        '}'
    )
    Set-Content -LiteralPath $genPs1 -Value ($genLines -join "`n") -Encoding UTF8
}

& (Join-Path $GLOBAL_MGMT_DIR 'scripts\registry-upsert.ps1') -ProjectRoot $ProjectRoot -ProjectId $ProjectId -Name $Name -Status active -ProjectType $ProjectType -ExtractionMode native -Exports $Exports -Consumers $Consumers -GlobalMgmtDir $GLOBAL_MGMT_DIR | Out-Null
& (Join-Path $GLOBAL_MGMT_DIR 'scripts\map-sync.ps1') -GlobalMgmtDir $GLOBAL_MGMT_DIR | Out-Null
& (Join-Path $GLOBAL_MGMT_DIR 'scripts\install-queue-maintenance-task.ps1') -GlobalMgmtDir $GLOBAL_MGMT_DIR | Out-Null

Write-Output ("Initialized project: {0}" -f $ProjectRoot)
