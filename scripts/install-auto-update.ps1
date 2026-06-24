# Install a Windows Scheduled Task that runs scripts\update.ps1 every 2
# minutes. Idempotent: re-running replaces the existing task.
#
# Default: Interactive logon (no admin required, runs while signed in — the
# always-on home mini PC case). Pass -RequireS4U to use the legacy logon mode
# that survives sign-out at the cost of needing Admin PowerShell to install.
#
# After install:
#   - Task name:    ZiggyAutoUpdate
#   - Action:       powershell -File scripts\update.ps1
#   - Trigger:      every 2 minutes, indefinitely
#   - Output log:   user_files\update.log
#   - Deploy log:   user_files\deploy_log (one entry per successful deploy)
#
# To uninstall:
#   Unregister-ScheduledTask -TaskName ZiggyAutoUpdate -Confirm:$false
param([switch]$RequireS4U)

$ErrorActionPreference = "Stop"

$isAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
if ($RequireS4U -and -not $isAdmin) {
    Write-Host "ERROR: -RequireS4U needs Administrator PowerShell."
    Write-Host "Right-click PowerShell, 'Run as Administrator', then re-run."
    exit 1
}
if (-not $RequireS4U -and -not $isAdmin) {
    Write-Host "Installing with Interactive logon (task fires only while signed in)."
    Write-Host "Pass -RequireS4U from an Admin PowerShell to survive sign-out."
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

# Trigger: fire once now, then repeat every 2 min for the next year.
# Tightened from 5 min after observed lag — with --no-cache rebuilds
# eating ~6 min and `-MultipleInstances IgnoreNew` skipping overlapping
# triggers, the effective cadence stretched to ~10 min between deploys.
# A 2-min interval keeps idle polling cheap (most cycles are no-ops in
# steady state) and means a fresh push picks up within 2 min of build
# completion instead of 5.
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) `
    -RepetitionInterval (New-TimeSpan -Minutes 2) `
    -RepetitionDuration (New-TimeSpan -Days 365)

# Default: Interactive logon (runs while user is signed in — the always-on
# home-mini-PC case). S4U would let it run when nobody is signed in but
# requires admin elevation to register, so it's opt-in.
$logonType = if ($RequireS4U) { "S4U" } else { "Interactive" }
$principal = New-ScheduledTaskPrincipal `
    -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType $logonType `
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
