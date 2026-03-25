param(
  [string]$StatusPath = (Join-Path $PSScriptRoot "..\..\..\mgmt\projMap\state\codex-status.json"),
  [int]$IntervalMs = 5000
)

while ($true) {
  $busy = $false

  if (Test-Path -LiteralPath $StatusPath) {
    try {
      $status = Get-Content -LiteralPath $StatusPath -Raw | ConvertFrom-Json
      $busy = [bool]$status.busy
      if ($busy -and $null -ne $status.processId) {
        $processId = [int]$status.processId
        $busy = [bool](Get-Process -Id $processId -ErrorAction SilentlyContinue)
      }
    } catch {
      $busy = $false
    }
  }

  if ($busy) {
    [Console]::WriteLine("x")
  } else {
    [Console]::WriteLine("o")
  }

  Start-Sleep -Milliseconds $IntervalMs
}
