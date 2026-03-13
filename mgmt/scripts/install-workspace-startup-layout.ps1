param(
    [string]$GlobalMgmtDir = "",
    [string]$TaskName = "WorkspaceStartupLayout",
    [string]$ExplorerPath = "C:\Users\Qub",
    [string]$Qv2rayPath = "C:\Program Files\qv2ray\qv2ray.exe",
    [int]$InitialDelayMs = 2500
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$GLOBAL_MGMT_DIR = if ([string]::IsNullOrWhiteSpace($GlobalMgmtDir)) {
    Split-Path -Parent $PSScriptRoot
} else {
    [IO.Path]::GetFullPath($GlobalMgmtDir)
}

$layoutScript = Join-Path $GLOBAL_MGMT_DIR "scripts\startup-workspace-layout.ps1"
if (!(Test-Path -LiteralPath $layoutScript)) {
    throw "Missing layout script: $layoutScript"
}

$taskAuthor = if ($env:USERDOMAIN) { "$env:USERDOMAIN\$env:USERNAME" } else { $env:USERNAME }
$taskUserSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$startBoundary = (Get-Date).ToString("s")
$taskArgs = "-NoLogo -NonInteractive -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""$layoutScript"" -ExplorerPath ""$ExplorerPath"" -Qv2rayPath ""$Qv2rayPath"" -InitialDelayMs $InitialDelayMs"
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
    <ExecutionTimeLimit>PT15M</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
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
    cmd /c "schtasks /Delete /TN ""$TaskName"" /F >nul 2>&1" | Out-Null
    cmd /c "schtasks /Create /TN ""$TaskName"" /XML ""$taskXmlPath"" /F" | Out-Null
}
finally {
    Remove-Item -LiteralPath $taskXmlPath -Force -ErrorAction SilentlyContinue
}

[pscustomobject]@{
    ok = $true
    task_name = $TaskName
    script = $layoutScript
    explorer_path = [IO.Path]::GetFullPath($ExplorerPath)
    qv2ray_path = [IO.Path]::GetFullPath($Qv2rayPath)
    initial_delay_ms = $InitialDelayMs
} | ConvertTo-Json -Depth 5
