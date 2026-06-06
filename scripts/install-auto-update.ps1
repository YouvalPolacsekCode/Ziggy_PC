# Install a Windows Scheduled Task that runs scripts\update.ps1 every 5
# minutes. Idempotent: re-running replaces the existing task.
#
# REQUIRES Administrator PowerShell (because we use -LogonType S4U so the
# task runs even when no user is logged in).
#
# After install:
#   - Task name:    ZiggyAutoUpdate
#   - Action:       powershell -File scripts\update.ps1
#   - Trigger:      every 5 minutes, indefinitely
#   - Output log:   user_files\update.log
#   - Deploy log:   user_files\deploy_log (one entry per successful deploy)
#
# To uninstall:
#   Unregister-ScheduledTask -TaskName ZiggyAutoUpdate -Confirm:$false

$ErrorActionPreference = "Stop"

# Confirm running as admin
$isAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "ERROR: this script must run from an Administrator PowerShell."
    Write-Host "Right-click PowerShell, 'Run as Administrator', then re-run."
    exit 1
}

$TaskName     = "ZiggyAutoUpdate"
$RepoDir      = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$UpdateScript = Join-Path $RepoDir "scripts\update.ps1"

if (-not (Test-Path $UpdateScript)) {
    Write-Host "ERROR: $UpdateScript not found."
    exit 1
}

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$UpdateScript`""

# Trigger: fire once now, then repeat every 5 min for the next year.
# (Windows recreates the trigger when the task fires near the end of the duration.)
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) `
    -RepetitionInterval (New-TimeSpan -Minutes 5) `
    -RepetitionDuration (New-TimeSpan -Days 365)

# S4U = run with the user's credentials, even when they're not logged in.
$principal = New-ScheduledTaskPrincipal `
    -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType S4U `
    -RunLevel Highest

# Safety: don't pile up if a run is slow; cap each run at 10 min.
$settings = New-ScheduledTaskSettingsSet `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
    -StartWhenAvailable

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description "Polls origin/main every 5 min and runs scripts\update.ps1" | Out-Null

Write-Host "Installed scheduled task '$TaskName'."
Write-Host "  Runs:    $UpdateScript"
Write-Host "  Output:  $RepoDir\user_files\update.log"
Write-Host "  Deploys: $RepoDir\user_files\deploy_log"
Write-Host ""
Write-Host "Verify in Task Scheduler GUI (taskschd.msc) or:"
Write-Host "  Get-ScheduledTask -TaskName '$TaskName' | Get-ScheduledTaskInfo"
