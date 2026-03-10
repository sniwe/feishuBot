param(
  [string]$MapPath = (Join-Path $PSScriptRoot '..\map.json'),
  [string]$StatePath = (Join-Path $PSScriptRoot '..\state\thread-map-deltas.json')
)

if (-not (Test-Path $MapPath)) {
  throw "Map not found: $MapPath"
}

if (-not (Test-Path $StatePath)) {
  "[]" | Set-Content -Path $StatePath -Encoding UTF8
}

node (Join-Path $PSScriptRoot 'track-map-update.js') --map "$MapPath" --state "$StatePath"
