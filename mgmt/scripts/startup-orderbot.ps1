$ErrorActionPreference = 'Stop'

$userRoot = if ($env:USERPROFILE) { $env:USERPROFILE } else { [Environment]::GetFolderPath('UserProfile') }
$stateDir = Join-Path $userRoot 'mgmt\state'
$logPath = Join-Path $stateDir 'startup-orderbot.log'

if (-not (Test-Path $stateDir)) {
  New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
}

function Write-Log {
  param([string]$Message)
  $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  Add-Content -Path $logPath -Value "[$ts] $Message"
}

Write-Log 'Startup orchestrator begin.'

$maxWaitSeconds = 300
$intervalSeconds = 5
$networkOk = $false
for ($elapsed = 0; $elapsed -lt $maxWaitSeconds; $elapsed += $intervalSeconds) {
  try {
    $adapterUp = Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' }
    $pingOk = Test-Connection -ComputerName '1.1.1.1' -Count 1 -Quiet -ErrorAction SilentlyContinue
    if ($adapterUp -and $pingOk) {
      $networkOk = $true
      break
    }
  } catch {}
  Start-Sleep -Seconds $intervalSeconds
}

if ($networkOk) {
  Write-Log 'Network connectivity confirmed.'
} else {
  Write-Log 'Network not confirmed within timeout; continuing startup sequence.'
}

$xingExe = 'C:\Program Files\NovaLink\current\Client\CorpLink.exe'
if (Test-Path $xingExe) {
  $xingRunning = Get-Process -Name 'CorpLink' -ErrorAction SilentlyContinue
  if (-not $xingRunning) {
    Start-Process -FilePath $xingExe | Out-Null
    Write-Log 'Launched 星连 (CorpLink.exe).'
  } else {
    Write-Log '星连 already running; skip launch.'
  }
} else {
  Write-Log "星连 executable missing: $xingExe"
}

Start-Sleep -Seconds 8

$orderBotDir = 'C:\orderBot'
$orderBotPkg = Join-Path $orderBotDir 'package.json'
if (Test-Path $orderBotPkg) {
  $alreadyRunning = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*C:\orderBot*' }

  if (-not $alreadyRunning) {
    $args = '/c cd /d "C:\orderBot" && npm run start'
    Start-Process -FilePath 'cmd.exe' -ArgumentList $args -WindowStyle Minimized | Out-Null
    Write-Log 'Launched orderBot start script.'
  } else {
    Write-Log 'orderBot appears to already be running; skip launch.'
  }
} else {
  Write-Log "orderBot package missing: $orderBotPkg"
}

Start-Sleep -Seconds 5

$mailWatcherDir = 'C:\Users\rhyse\OneDrive\Desktop\vsScripts\mailWatcher'
$mailWatcherPkg = Join-Path $mailWatcherDir 'package.json'
if (Test-Path $mailWatcherPkg) {
  $mailWatcherRunning = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*\mailWatcher*' }

  if (-not $mailWatcherRunning) {
    $mailArgs = '/c cd /d "C:\Users\rhyse\OneDrive\Desktop\vsScripts\mailWatcher" && npm run start'
    Start-Process -FilePath 'cmd.exe' -ArgumentList $mailArgs -WindowStyle Minimized | Out-Null
    Write-Log 'Launched mailWatcher start script.'
  } else {
    Write-Log 'mailWatcher appears to already be running; skip launch.'
  }
} else {
  Write-Log "mailWatcher package missing: $mailWatcherPkg"
}

Write-Log 'Startup orchestrator end.'
