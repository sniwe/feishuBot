param(
    [string]$ProjectRoot = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    $ProjectRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
}

$mgmtDir = Split-Path -Parent $PSScriptRoot
$mapPath = Join-Path $mgmtDir "map.json"
$updated = (Get-Date).ToString("o")

$map = [ordered]@{
    id = "map:toDo-test"
    type = "project-map"
    name = "toDo-test"
    summary = "Minimal browser to-do app with localStorage persistence"
    root = $ProjectRoot
    updated = $updated
    nodes = @(
        [ordered]@{
            id = "control:ui"
            type = "control"
            name = "index.html"
            summary = "To-do page shell"
            features = @(
                [ordered]@{ summary = "Render UI"; flow = @("e1") }
            )
            edges = @("e1")
            critical = $true
            files = @("index.html", "style.css")
            children = @()
        },
        [ordered]@{
            id = "module:app"
            type = "module"
            name = "app.js"
            summary = "Handles add, toggle, delete and persistence"
            features = @(
                [ordered]@{ summary = "Manage tasks"; flow = @("e2", "e3", "e4") }
            )
            edges = @("e2", "e3", "e4")
            critical = $true
            files = @("app.js")
            children = @()
        },
        [ordered]@{
            id = "io:storage"
            type = "io"
            name = "localStorage"
            summary = "Persistent storage for tasks"
            features = @()
            edges = @()
            critical = $false
            files = @()
            children = @()
        }
    )
    edges = @(
        [ordered]@{ id = "e1"; kind = "control"; from = "control:ui"; to = "module:app"; note = "UI loads app logic" },
        [ordered]@{ id = "e2"; kind = "io"; from = "module:app"; to = "io:storage"; via = "loadItems" },
        [ordered]@{ id = "e3"; kind = "io"; from = "module:app"; to = "io:storage"; via = "saveItems" },
        [ordered]@{ id = "e4"; kind = "control"; from = "module:app"; to = "module:app"; note = "add/toggle/delete transitions" }
    )
    children = @()
}

$map | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $mapPath -Encoding UTF8
Write-Output "Map generated: $mapPath"

$trackerScript = Join-Path $PSScriptRoot "track-map-update.js"
if (Test-Path -LiteralPath $trackerScript) {
    $trackerResult = & node $trackerScript $ProjectRoot
    Write-Output "Tracker updated: $trackerResult"
}
