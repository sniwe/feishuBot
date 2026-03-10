param(
  [string]$SessionsRoot = (Join-Path $env:USERPROFILE '.codex\sessions'),
  [string]$OutputPath = (Join-Path $PSScriptRoot 'current-thread.json')
)

$today = Get-Date
$dayPath = Join-Path $SessionsRoot ($today.ToString('yyyy\\MM\\dd'))
if (-not (Test-Path $dayPath)) {
  throw "Session day directory not found: $dayPath"
}

$rollouts = Get-ChildItem -Path $dayPath -Filter 'rollout-*.jsonl' -File | Sort-Object LastWriteTime -Descending
if (-not $rollouts) {
  throw "No rollout files found under: $dayPath"
}

$selected = $null
$threadId = $null

foreach ($file in $rollouts) {
  $lines = Get-Content -Path $file.FullName
  foreach ($line in $lines) {
    if (-not $line) { continue }
    try {
      $obj = $line | ConvertFrom-Json
      if ($obj.type -eq 'session_meta' -and $obj.payload.id) {
        $selected = $file
        $threadId = $obj.payload.id
        break
      }
    } catch {
      continue
    }
  }
  if ($threadId) { break }
}

if (-not $threadId) {
  throw "Unable to resolve thread id from rollout files in: $dayPath"
}

$cache = [ordered]@{
  thread_id = $threadId
  turn_index = 0
  updated = (Get-Date).ToString('o')
  source = [ordered]@{
    file = $selected.FullName
    lastWriteTime = $selected.LastWriteTime.ToString('o')
  }
}

$cache | ConvertTo-Json -Depth 10 | Set-Content -Path $OutputPath -Encoding UTF8
Write-Output $OutputPath
