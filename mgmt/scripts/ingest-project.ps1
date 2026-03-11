param(
    [Parameter(Mandatory = $true)][string]$SourceProjectPath,
    [string]$TargetProjectRoot = "",
    [string]$ProjectId = "",
    [string]$Name = "",
    [string]$GlobalMgmtDir = "",
    [switch]$DryRun,
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$GLOBAL_MGMT_DIR = if ([string]::IsNullOrWhiteSpace($GlobalMgmtDir)) {
    Split-Path -Parent $PSScriptRoot
} else {
    [IO.Path]::GetFullPath($GlobalMgmtDir)
}
$USER_ROOT = Split-Path -Parent $GLOBAL_MGMT_DIR
$INDEX_PATH = Join-Path $GLOBAL_MGMT_DIR "projects-index.json"
$nowIso = (Get-Date).ToString("o")

$sourceRoot = [IO.Path]::GetFullPath($SourceProjectPath)
if (!(Test-Path -LiteralPath $sourceRoot -PathType Container)) {
    throw "Source project directory not found: $sourceRoot"
}

if ([string]::IsNullOrWhiteSpace($ProjectId)) {
    $ProjectId = Split-Path -Leaf $sourceRoot
}
if ([string]::IsNullOrWhiteSpace($Name)) {
    $Name = $ProjectId
}
if ([string]::IsNullOrWhiteSpace($TargetProjectRoot)) {
    $TargetProjectRoot = Join-Path $USER_ROOT $ProjectId
}
$targetRoot = [IO.Path]::GetFullPath($TargetProjectRoot)

if ((Test-Path -LiteralPath $INDEX_PATH)) {
    $index = Get-Content -LiteralPath $INDEX_PATH -Raw | ConvertFrom-Json
    $trackedRoots = @($index.projects | ForEach-Object { [string]$_.projectRoot })
    if (@($trackedRoots | Where-Object { $_ -eq $sourceRoot }).Count -gt 0) {
        throw "Source path is already tracked: $sourceRoot"
    }
    $existingId = @($index.projects | Where-Object { [string]$_.id -eq $ProjectId } | Select-Object -First 1)
    if ($existingId.Count -gt 0 -and -not $Force) {
        throw "Project id already exists in registry: $ProjectId. Use -Force to re-ingest into existing id."
    }
}

$skipDirNames = @(
    ".git", ".hg", ".svn", "node_modules", ".venv", "venv", "dist", "build",
    "target", "bin", "obj", ".idea", ".vscode", ".next", ".nuxt", ".cache"
)
$skipDirPattern = [regex]::new("(\\|/)(?:$([string]::Join("|", ($skipDirNames | ForEach-Object { [regex]::Escape($_) }))))(\\|/|$)", [Text.RegularExpressions.RegexOptions]::IgnoreCase)

function Get-BucketFromPath {
    param(
        [Parameter(Mandatory = $true)][string]$RelativePath
    )
    $lower = $RelativePath.Replace("\", "/").ToLowerInvariant()
    $ext = [IO.Path]::GetExtension($RelativePath).ToLowerInvariant()

    if ($lower -match '(^|/)(frontend|client|web|ui|views?)(/|$)') { return "frontend" }
    if ($lower -match '(^|/)(public|assets|static)(/|$)') { return "public" }
    if ($lower -match '(^|/)(backend|server|api|services?)(/|$)') { return "backend" }

    if ($ext -in @(".html",".htm",".css",".scss",".sass",".less",".jsx",".tsx",".vue",".svelte",".svg")) { return "frontend" }
    if ($ext -in @(".png",".jpg",".jpeg",".gif",".webp",".ico",".bmp",".mp3",".wav",".ogg",".mp4",".webm",".pdf",".txt")) { return "public" }
    if ($ext -in @(".js",".mjs",".cjs",".ts",".py",".java",".cs",".go",".rs",".rb",".php",".cpp",".c",".h",".hpp",".sql",".sh",".ps1",".json",".yaml",".yml",".toml",".ini",".md")) { return "backend" }
    return "backend"
}

$allFiles = Get-ChildItem -LiteralPath $sourceRoot -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object {
        $full = $_.FullName
        -not $skipDirPattern.IsMatch($full)
    }

$extCounts = @{}
$bucketCounts = @{ backend = 0; frontend = 0; public = 0 }
$planned = @()
$sourceLeaf = Split-Path -Leaf $sourceRoot

foreach ($f in $allFiles) {
    $relative = $f.FullName.Substring($sourceRoot.Length).TrimStart('\','/')
    $bucket = Get-BucketFromPath -RelativePath $relative
    $ext = [IO.Path]::GetExtension($relative).ToLowerInvariant()
    if ([string]::IsNullOrWhiteSpace($ext)) { $ext = "<none>" }
    if (-not $extCounts.ContainsKey($ext)) { $extCounts[$ext] = 0 }
    $extCounts[$ext]++
    $bucketCounts[$bucket]++

    $destRel = Join-Path "src\$bucket\ingest\$sourceLeaf" $relative
    $destAbs = Join-Path $targetRoot $destRel
    $planned += [pscustomobject]@{
        source = $f.FullName
        relative = $relative
        bucket = $bucket
        destination = $destAbs
    }
}

$topExtensions = @($extCounts.GetEnumerator() | Sort-Object -Property Value -Descending | Select-Object -First 15 | ForEach-Object {
    [pscustomobject]@{ extension = $_.Key; count = $_.Value }
})

$analysis = [ordered]@{
    source_root = $sourceRoot
    source_file_count = @($allFiles).Count
    target_root = $targetRoot
    project_id = $ProjectId
    name = $Name
    bucket_counts = $bucketCounts
    top_extensions = $topExtensions
}

if ($DryRun) {
    [pscustomobject]@{
        ok = $true
        dry_run = $true
        analyzed_at = $nowIso
        analysis = $analysis
    } | ConvertTo-Json -Depth 10
    exit 0
}

& (Join-Path $GLOBAL_MGMT_DIR "scripts\init-project.ps1") -ProjectRoot $targetRoot -ProjectId $ProjectId -Name $Name -GlobalMgmtDir $GLOBAL_MGMT_DIR | Out-Null

$copied = 0
foreach ($item in $planned) {
    $destDir = Split-Path -Parent $item.destination
    New-Item -ItemType Directory -Path $destDir -Force | Out-Null
    Copy-Item -LiteralPath $item.source -Destination $item.destination -Force
    $copied++
}

$reportPath = Join-Path $targetRoot "mgmt\projMap\state\ingest-report.json"
$report = [ordered]@{
    id = "project-ingest-report"
    generated_at = (Get-Date).ToString("o")
    dry_run = $false
    analysis = $analysis
    copied_files = $copied
}
$report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $reportPath -Encoding UTF8

[pscustomobject]@{
    ok = $true
    dry_run = $false
    source_root = $sourceRoot
    target_root = $targetRoot
    project_id = $ProjectId
    copied_files = $copied
    report_path = $reportPath
} | ConvertTo-Json -Depth 10
