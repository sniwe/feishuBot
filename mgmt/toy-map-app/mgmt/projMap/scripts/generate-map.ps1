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

$edges = @(
    [ordered]@{
        id = "e1"
        kind = "control"
        from = "control:app"
        to = "module:src-index"
        note = "entrypoint invokes orchestration module"
    },
    [ordered]@{
        id = "e2"
        kind = "depends"
        from = "module:src-index"
        to = "module:math-add"
        note = "runToyApp computes sum"
    },
    [ordered]@{
        id = "e3"
        kind = "depends"
        from = "module:src-index"
        to = "module:greeting-build"
        note = "runToyApp builds greeting"
    },
    [ordered]@{
        id = "e4"
        kind = "context"
        from = "control:app"
        to = "module:src-index"
        via = "ctx.data + ctx.deps"
    },
    [ordered]@{
        id = "e5"
        kind = "io"
        from = "control:app"
        to = "io:console"
        via = "ctx.deps.log"
    }
)

$map = [ordered]@{
    id = "map:toy-map-app"
    type = "project-map"
    name = "Toy Map App"
    summary = "Minimal toy app to validate map generation flow"
    root = $ProjectRoot
    updated = $updated
    nodes = @(
        [ordered]@{
            id = "control:app"
            type = "control"
            name = "app.js"
            summary = "Builds ctx and runs toy flow"
            features = @(
                [ordered]@{
                    summary = "Execute app and print result"
                    flow = @("e1", "e5")
                }
            )
            edges = @("e1", "e4", "e5")
            critical = $true
            files = @("app.js")
            children = @()
        },
        [ordered]@{
            id = "module:src-index"
            type = "module"
            name = "src/index.js"
            summary = "Orchestrates math and greeting modules"
            features = @(
                [ordered]@{
                    summary = "Compose sum and greeting"
                    flow = @("e2", "e3")
                }
            )
            edges = @("e2", "e3")
            critical = $true
            files = @("src/index.js")
            children = @()
        },
        [ordered]@{
            id = "module:math-add"
            type = "module"
            name = "src/modules/math/add.js"
            summary = "Returns sum from ctx.data"
            features = @(
                [ordered]@{
                    summary = "Add two numbers"
                    flow = @()
                }
            )
            edges = @()
            critical = $false
            files = @("src/modules/math/add.js", "src/modules/math/index.js")
            children = @()
        },
        [ordered]@{
            id = "module:greeting-build"
            type = "module"
            name = "src/modules/greeting/buildGreeting.js"
            summary = "Builds greeting message using deps.nowIso optionally"
            features = @(
                [ordered]@{
                    summary = "Format greeting message"
                    flow = @()
                }
            )
            edges = @()
            critical = $false
            files = @("src/modules/greeting/buildGreeting.js", "src/modules/greeting/index.js")
            children = @()
        },
        [ordered]@{
            id = "io:console"
            type = "io"
            name = "console"
            summary = "Stdout logging sink"
            features = @()
            edges = @()
            critical = $false
            files = @()
            children = @()
        }
    )
    edges = $edges
    children = @()
}

$map | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $mapPath -Encoding UTF8
Write-Output "Map generated: $mapPath"

$trackerScript = Join-Path $PSScriptRoot "track-map-update.js"
if (Test-Path -LiteralPath $trackerScript) {
    $trackerResult = & node $trackerScript $ProjectRoot
    Write-Output "Tracker updated: $trackerResult"
}

