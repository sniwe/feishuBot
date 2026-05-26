param(
    [string]$GlobalMgmtDir = "",
    [string]$TaskName = "WorkspaceStartupLayout",
    [string]$ExplorerPath = "C:\Users\Qub",
    [string]$Qv2rayPath = "C:\Program Files\qv2ray\qv2ray.exe",
    [string]$CmdWorkingDirectory = "",
    [string]$VsCodeWorkspacePath = "",
    [int]$InitialDelayMs = 2500,
    [bool]$InstallNetworkRecovery = $true,
    [string]$RecoveryTaskName = "Qv2rayNetworkRecovery",
    [int]$RecoveryMaxDurationMinutes = 30,
    [int]$RecoveryPollIntervalSeconds = 90
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
$recoveryInstaller = Join-Path $GLOBAL_MGMT_DIR "scripts\install-qv2ray-network-recovery-task.ps1"
if ($InstallNetworkRecovery -and !(Test-Path -LiteralPath $recoveryInstaller)) {
    throw "Missing recovery task installer: $recoveryInstaller"
}

$taskAuthor = if ($env:USERDOMAIN) { "$env:USERDOMAIN\$env:USERNAME" } else { $env:USERNAME }
$taskUserSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$startBoundary = (Get-Date).ToString("s")
$resolvedCmdWorkingDirectory = if ([string]::IsNullOrWhiteSpace($CmdWorkingDirectory)) {
    if ([string]::IsNullOrWhiteSpace($env:USERPROFILE)) { "C:\Users\Qub" } else { $env:USERPROFILE }
} else {
    [IO.Path]::GetFullPath($CmdWorkingDirectory)
}
$resolvedVsCodeWorkspacePath = if ([string]::IsNullOrWhiteSpace($VsCodeWorkspacePath)) {
    $defaultWorkspacePath = "C:\chinLog"
    if (Test-Path -LiteralPath $defaultWorkspacePath -PathType Container) {
        $defaultWorkspacePath
    } else {
        $ExplorerPath
    }
} else {
    [IO.Path]::GetFullPath($VsCodeWorkspacePath)
}
$taskArgs = "-NoLogo -NonInteractive -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""$layoutScript"" -ExplorerPath ""$ExplorerPath"" -Qv2rayPath ""$Qv2rayPath"" -CmdWorkingDirectory ""$resolvedCmdWorkingDirectory"" -VsCodeWorkspacePath ""$resolvedVsCodeWorkspacePath"" -InitialDelayMs $InitialDelayMs"
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
      <RunLevel>HighestAvailable</RunLevel>
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
    & schtasks.exe /Delete /TN $TaskName /F 2>$null | Out-Null
    & schtasks.exe /Create /TN $TaskName /XML $taskXmlPath /F | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to create scheduled task '$TaskName' (exit code $LASTEXITCODE)."
    }
}
finally {
    Remove-Item -LiteralPath $taskXmlPath -Force -ErrorAction SilentlyContinue
}

$recoveryResult = $null
if ($InstallNetworkRecovery) {
    $recoveryResult = & $recoveryInstaller -GlobalMgmtDir $GLOBAL_MGMT_DIR -TaskName $RecoveryTaskName -Qv2rayPath $Qv2rayPath -MaxDurationMinutes $RecoveryMaxDurationMinutes -PollIntervalSeconds $RecoveryPollIntervalSeconds | ConvertFrom-Json
}

[pscustomobject]@{
    ok = $true
    task_name = $TaskName
    script = $layoutScript
    explorer_path = [IO.Path]::GetFullPath($ExplorerPath)
    qv2ray_path = [IO.Path]::GetFullPath($Qv2rayPath)
    cmd_working_directory = $resolvedCmdWorkingDirectory
    vscode_workspace_path = $resolvedVsCodeWorkspacePath
    initial_delay_ms = $InitialDelayMs
    network_recovery_task = $recoveryResult
} | ConvertTo-Json -Depth 5
