# Normalize the mini PC's system clock via Windows Time (NTP).
#
# Why: the home mini PC has drifted ~2h ahead of real time. That skews
# user_files\deploy_log timestamps and makes /health.ota report negative
# seconds_since (now < deploy time). Cosmetic, but it makes the OTA health
# signal hard to read. A one-time resync + hardening keeps it in sync.
#
# What it does (idempotent — safe to re-run):
#   1. Ensures the W32Time service is enabled + running.
#   2. Points it at reliable NTP servers (Israel pool first, then Windows).
#   3. Forces an immediate resync and prints before/after time.
#   4. Sets W32Time to start automatically (survives reboot).
#
# Run in an ELEVATED PowerShell on the mini PC:
#   powershell -ExecutionPolicy Bypass -File scripts\fix-clock-skew.ps1
#
# VirtualBox note: if HA runs in a VirtualBox VM whose "Host time sync" keeps
# dragging the guest clock, that's a SEPARATE guest-side issue — this script
# only fixes the Windows HOST clock. See the -ShowVBoxHint switch output.
param([switch]$ShowVBoxHint)

$ErrorActionPreference = "Stop"

$isAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "ERROR: this needs Administrator PowerShell (w32tm config + service control)."
    Write-Host "Right-click PowerShell, 'Run as Administrator', then re-run."
    exit 1
}

Write-Host "Clock before resync: $(Get-Date -Format o)"

# 1. Service must be enabled + running before w32tm can configure it.
Set-Service -Name W32Time -StartupType Automatic
Start-Service -Name W32Time -ErrorAction SilentlyContinue

# 2. Reliable NTP peers — il.pool.ntp.org for Israel-local accuracy, then
#    time.windows.com as a widely-reachable fallback. 0x9 = client + fallback.
$peers = "il.pool.ntp.org,0x9 time.windows.com,0x9 pool.ntp.org,0x9"
w32tm /config /manualpeerlist:"$peers" /syncfromflags:manual /reliable:no /update | Out-Null

# 3. Re-read config and force an immediate resync.
Restart-Service -Name W32Time
Start-Sleep -Seconds 2
w32tm /resync /force

Write-Host "Clock after resync:  $(Get-Date -Format o)"
Write-Host ""
Write-Host "Sync status:"
w32tm /query /status

if ($ShowVBoxHint) {
    Write-Host ""
    Write-Host "VirtualBox guest-clock hint:"
    Write-Host "  If HA's VM keeps drifting, disable host->guest time sync on the guest:"
    Write-Host '  & "$Env:ProgramFiles\Oracle\VirtualBox\VBoxManage.exe" setextradata <VMName> "VBoxInternal/Devices/VMMDev/0/Config/GetHostTimeDisabled" 1'
}
