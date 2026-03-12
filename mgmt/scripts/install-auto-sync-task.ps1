param(
    [string]$GlobalMgmtDir = "",
    [string]$TaskName = "CodexRepoAutoSync"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$GLOBAL_MGMT_DIR = if ([string]::IsNullOrWhiteSpace($GlobalMgmtDir)) {
    Split-Path -Parent $PSScriptRoot
} else {
    [IO.Path]::GetFullPath($GlobalMgmtDir)
}

$tickScript = Join-Path $GLOBAL_MGMT_DIR "scripts\auto-sync-tick.ps1"
if (!(Test-Path -LiteralPath $tickScript)) {
    throw "Missing tick script: $tickScript"
}

$taskAuthor = if ($env:USERDOMAIN) { "$env:USERDOMAIN\$env:USERNAME" } else { $env:USERNAME }
$taskUserSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$startBoundary = (Get-Date).ToString("s")
$taskArgs = "-NoLogo -NonInteractive -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""$tickScript"""
$taskXmlPath = Join-Path $env:TEMP ("{0}.xml" -f [guid]::NewGuid().ToString("N"))
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
    <DisallowStartIfOnBatteries>true</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>true</StopIfGoingOnBatteries>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <Duration>PT10M</Duration>
      <WaitTimeout>PT1H</WaitTimeout>
      <StopOnIdleEnd>true</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>true</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT1H</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Triggers>
    <TimeTrigger>
      <StartBoundary>$startBoundary</StartBoundary>
      <Enabled>true</Enabled>
      <Repetition>
        <Interval>PT5M</Interval>
      </Repetition>
    </TimeTrigger>
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

    cmd /c "schtasks /Delete /TN ""$TaskName"" /F >nul 2>&1" | Out-Null
    cmd /c "schtasks /Create /TN ""$TaskName"" /XML ""$taskXmlPath"" /F" | Out-Null
    cmd /c "schtasks /Run /TN ""$TaskName""" | Out-Null
}
finally {
    Remove-Item -LiteralPath $taskXmlPath -Force -ErrorAction SilentlyContinue
}

[pscustomobject]@{
    ok = $true
    mode = "task_scheduler"
    taskName = $TaskName
    script = $tickScript
} | ConvertTo-Json -Depth 5
