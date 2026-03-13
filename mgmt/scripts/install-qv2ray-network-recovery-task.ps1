param(
    [string]$GlobalMgmtDir = "",
    [string]$TaskName = "Qv2rayNetworkRecovery",
    [string]$Qv2rayPath = "C:\Program Files\qv2ray\qv2ray.exe",
    [int]$MaxDurationMinutes = 30,
    [int]$PollIntervalSeconds = 90
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$GLOBAL_MGMT_DIR = if ([string]::IsNullOrWhiteSpace($GlobalMgmtDir)) {
    Split-Path -Parent $PSScriptRoot
} else {
    [IO.Path]::GetFullPath($GlobalMgmtDir)
}

$recoveryScript = Join-Path $GLOBAL_MGMT_DIR "scripts\ensure-qv2ray-connected.ps1"
if (!(Test-Path -LiteralPath $recoveryScript -PathType Leaf)) {
    throw "Missing recovery script: $recoveryScript"
}

$taskAuthor = if ($env:USERDOMAIN) { "$env:USERDOMAIN\$env:USERNAME" } else { $env:USERNAME }
$taskUserSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$startBoundary = (Get-Date).ToString("s")
$taskArgs = "-NoLogo -NonInteractive -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""$recoveryScript"" -GlobalMgmtDir ""$GLOBAL_MGMT_DIR"" -Qv2rayPath ""$Qv2rayPath"" -MaxDurationMinutes $MaxDurationMinutes -PollIntervalSeconds $PollIntervalSeconds"
$taskXmlPath = Join-Path $env:TEMP ("{0}.xml" -f [guid]::NewGuid().ToString("N"))

$repeatDuration = "PT{0}M" -f ([Math]::Max(5, $MaxDurationMinutes))
$taskXml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Date>$startBoundary</Date>
    <Author>$taskAuthor</Author>
    <URI>\$TaskName</URI>
  </RegistrationInfo>
  <Principals>
    <Principal id="Author">
      <UserId>$taskUserSid</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT1H</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <Repetition>
        <Interval>PT2M</Interval>
        <Duration>$repeatDuration</Duration>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
    </LogonTrigger>
  </Triggers>
  <Actions Context="Author">
    <Exec>
      <Command>powershell.exe</Command>
      <Arguments>$taskArgs</Arguments>
      <WorkingDirectory>$GLOBAL_MGMT_DIR</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@

try {
    Set-Content -LiteralPath $taskXmlPath -Value $taskXml -Encoding Unicode
    & schtasks.exe /Delete /TN $TaskName /F 2>$null | Out-Null
    & schtasks.exe /Create /TN $TaskName /XML $taskXmlPath /F | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to create scheduled task '$TaskName' (exit code $LASTEXITCODE)."
    }
}
finally {
    Remove-Item -LiteralPath $taskXmlPath -Force -ErrorAction SilentlyContinue
}

[pscustomobject]@{
    ok = $true
    task_name = $TaskName
    script = $recoveryScript
    qv2ray_path = [IO.Path]::GetFullPath($Qv2rayPath)
    max_duration_minutes = [Math]::Max(5, $MaxDurationMinutes)
    poll_interval_seconds = $PollIntervalSeconds
} | ConvertTo-Json -Depth 5
