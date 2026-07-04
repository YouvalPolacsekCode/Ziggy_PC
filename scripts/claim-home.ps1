#Requires -Version 5.1
<#
.SYNOPSIS
    Claim a mini PC for a Ziggy customer home (Phase 2 of Oracle→mini-PC transition).

.DESCRIPTION
    Bench-provisioning script: run this ONCE per mini PC before shipping to the customer.

    Flow:
      1. Authenticate to the relay as relay_admin
      2. POST /api/provision/hub  →  receive HOME_ID, RELAY_SECRET, TUNNEL_URL, TUNNEL_TOKEN
      3. Write those into this mini PC's .env
      4. Install cloudflared as a Windows service pointing at the returned tunnel
      5. Restart the Ziggy container so it picks up the new relay identity

    Idempotency:
      - If the mini PC's .env already contains HOME_ID=home-*, aborts unless -Force is given.
      - -DryRun prints all planned actions without touching the filesystem or cloudflared.

.PARAMETER RelayUrl
    Public relay base URL. Defaults to https://ziggy-relay.fly.dev.

.PARAMETER AdminEmail
    Relay admin login. Prompted if omitted.

.PARAMETER AdminPassword
    Relay admin password as SecureString. Prompted if omitted.

.PARAMETER HomeName
    Customer-facing home name (e.g. "Sarah's House"). Prompted if omitted.

.PARAMETER OwnerEmail
    Customer owner email — used later for the ready-notification. Optional.

.PARAMETER Force
    Overwrite an existing claim on this mini PC without prompting.

.PARAMETER DryRun
    Print what would happen; do not modify .env, cloudflared, or Docker state.

.EXAMPLE
    .\scripts\claim-home.ps1 -HomeName "Sarah's House" -OwnerEmail sarah@example.com

.EXAMPLE
    .\scripts\claim-home.ps1 -DryRun -HomeName "Test Home"
#>
[CmdletBinding()]
param(
    [string]$RelayUrl = "https://ziggy-relay.fly.dev",
    [string]$AdminEmail,
    [SecureString]$AdminPassword,
    [string]$HomeName,
    [string]$OwnerEmail = "",
    [switch]$Force,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# ---------------------------------------------------------------------------
# Locate repo root + working files
# ---------------------------------------------------------------------------

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = Split-Path -Parent $ScriptDir
$EnvFile   = Join-Path $RepoRoot ".env"
$UserFiles = Join-Path $RepoRoot "user_files"
$LogFile   = Join-Path $UserFiles "claim.log"
$TokenFile = Join-Path $UserFiles "cf_tunnel_token.txt"

if (-not (Test-Path $UserFiles)) {
    New-Item -ItemType Directory -Path $UserFiles -Force | Out-Null
}

function Write-Log {
    param([string]$Level, [string]$Message)
    $ts = (Get-Date).ToUniversalTime().ToString("o")
    $line = "$ts [$Level] $Message"
    Write-Host $line
    if (-not $DryRun) {
        Add-Content -Path $LogFile -Value $line -Encoding UTF8
    }
}

# ---------------------------------------------------------------------------
# .env helpers — parse/rewrite key=value while preserving unrelated lines
# ---------------------------------------------------------------------------

function Read-EnvFile {
    param([string]$Path)
    $map = [ordered]@{}
    if (Test-Path $Path) {
        foreach ($line in Get-Content $Path) {
            if ($line -match '^\s*([A-Z_][A-Z0-9_]*)=(.*)$') {
                $map[$Matches[1]] = $Matches[2]
            }
        }
    }
    return $map
}

function Write-EnvFile {
    param([string]$Path, [hashtable]$Set)
    $existing = [ordered]@{}
    $preamble = @()
    $inHeader = $true
    if (Test-Path $Path) {
        foreach ($line in Get-Content $Path) {
            if ($line -match '^\s*([A-Z_][A-Z0-9_]*)=(.*)$') {
                $existing[$Matches[1]] = $Matches[2]
                $inHeader = $false
            } elseif ($inHeader) {
                $preamble += $line
            }
        }
    }
    foreach ($k in $Set.Keys) { $existing[$k] = $Set[$k] }

    $out = @()
    $out += $preamble
    foreach ($k in $existing.Keys) { $out += "$k=$($existing[$k])" }
    Set-Content -Path $Path -Value $out -Encoding UTF8

    # Restrict ACL — the tunnel URL + relay secret in here are sensitive.
    try {
        $acl = Get-Acl $Path
        $acl.SetAccessRuleProtection($true, $false)
        $adminRule = New-Object System.Security.AccessControl.FileSystemAccessRule(
            "BUILTIN\Administrators", "FullControl", "Allow")
        $systemRule = New-Object System.Security.AccessControl.FileSystemAccessRule(
            "NT AUTHORITY\SYSTEM", "FullControl", "Allow")
        $acl.SetAccessRule($adminRule)
        $acl.SetAccessRule($systemRule)
        Set-Acl -Path $Path -AclObject $acl
    } catch {
        Write-Log "WARN" "Could not tighten ACL on $Path: $_"
    }
}

# ---------------------------------------------------------------------------
# Cloudflared discovery + install
# ---------------------------------------------------------------------------

function Get-Cloudflared {
    $candidates = @(
        "C:\Program Files (x86)\cloudflared\cloudflared.exe",
        "C:\Program Files\cloudflared\cloudflared.exe",
        "$env:LOCALAPPDATA\cloudflared\cloudflared.exe"
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) { return $c }
    }
    $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    return $null
}

function Install-CloudflaredTunnelService {
    param([string]$Token)
    $cf = Get-Cloudflared
    if (-not $cf) {
        throw "cloudflared not found. Install from https://github.com/cloudflare/cloudflared/releases first."
    }
    # If a previous tunnel service exists, remove it before re-installing.
    $svc = Get-Service -Name "Cloudflared" -ErrorAction SilentlyContinue
    if ($svc) {
        Write-Log "INFO" "Removing existing cloudflared service to re-install with new token"
        try { & $cf service uninstall 2>&1 | Out-Null } catch { Write-Log "WARN" "uninstall returned: $_" }
        Start-Sleep -Seconds 2
    }
    Write-Log "INFO" "Installing cloudflared service with tunnel token"
    & $cf service install $Token 2>&1 | ForEach-Object { Write-Log "cloudflared" $_ }
    if ($LASTEXITCODE -ne 0) {
        throw "cloudflared service install failed (exit $LASTEXITCODE)"
    }
}

# ---------------------------------------------------------------------------
# Main flow
# ---------------------------------------------------------------------------

Write-Log "INFO" "=== claim-home.ps1 start (DryRun=$DryRun) ==="
Write-Log "INFO" "Repo root: $RepoRoot"
Write-Log "INFO" "Relay URL: $RelayUrl"

# 1. Already-claimed guard
$env = Read-EnvFile -Path $EnvFile
if ($env.Contains("HOME_ID") -and $env["HOME_ID"] -match '^home-') {
    if (-not $Force) {
        Write-Log "ERROR" "Mini PC already claimed as $($env['HOME_ID']) ($($env['HOME_NAME'])). Re-run with -Force to overwrite."
        exit 2
    } else {
        Write-Log "WARN" "Overwriting existing claim: $($env['HOME_ID'])"
    }
}

# 2. Interactive prompts for missing params
if (-not $HomeName)     { $HomeName     = Read-Host "Home name (e.g. 'Sarah's House')" }
if (-not $AdminEmail)   { $AdminEmail   = Read-Host "Relay admin email" }
if (-not $AdminPassword) {
    $AdminPassword = Read-Host "Relay admin password" -AsSecureString
}
$plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($AdminPassword)
)

# 3. Login to relay
Write-Log "INFO" "Logging in as $AdminEmail"
$loginBody = @{ email = $AdminEmail; password = $plainPassword } | ConvertTo-Json
try {
    $loginResp = Invoke-RestMethod -Method POST -Uri "$RelayUrl/api/auth/login" `
        -Body $loginBody -ContentType "application/json" -ErrorAction Stop
} catch {
    Write-Log "ERROR" "Login failed: $_"
    exit 3
}
$jwt = $loginResp.token
if (-not $jwt) {
    Write-Log "ERROR" "Login succeeded but no token returned. Response: $($loginResp | ConvertTo-Json -Compress)"
    exit 3
}
Write-Log "INFO" "Login OK (JWT prefix $($jwt.Substring(0, [Math]::Min(12, $jwt.Length)))...)"

# 4. POST /api/provision/hub
$provBody = @{ home_name = $HomeName; owner_email = $OwnerEmail } | ConvertTo-Json
Write-Log "INFO" "POST /api/provision/hub  home_name='$HomeName'"
try {
    $bundle = Invoke-RestMethod -Method POST -Uri "$RelayUrl/api/provision/hub" `
        -Headers @{ Authorization = "Bearer $jwt" } `
        -Body $provBody -ContentType "application/json" -ErrorAction Stop
} catch {
    Write-Log "ERROR" "Provisioning failed: $_"
    exit 4
}
Write-Log "INFO" "Provisioned home_id=$($bundle.home_id) tunnel_id=$($bundle.tunnel_id)"

# 5. DryRun exit point — everything above is read-only
if ($DryRun) {
    Write-Log "INFO" "=== DRY RUN — no changes written ==="
    Write-Host ""
    Write-Host "Would write to .env:"
    Write-Host "  HOME_ID=$($bundle.home_id)"
    Write-Host "  HOME_NAME=$HomeName"
    Write-Host "  HOME_TYPE=hub"
    Write-Host "  CLOUD_MODE=false"
    Write-Host "  RELAY_URL=$($bundle.relay_url)"
    Write-Host "  RELAY_SECRET=<redacted, len=$($bundle.relay_secret.Length)>"
    Write-Host "  TUNNEL_URL=$($bundle.tunnel_url)"
    Write-Host ""
    Write-Host "Would install cloudflared service with the returned tunnel token."
    Write-Host "Would restart Ziggy: docker compose restart ziggy"
    exit 0
}

# 6. Write .env
Write-Log "INFO" "Writing bundle to $EnvFile"
Write-EnvFile -Path $EnvFile -Set @{
    HOME_ID      = $bundle.home_id
    HOME_NAME    = $HomeName
    HOME_TYPE    = "hub"
    CLOUD_MODE   = "false"
    RELAY_URL    = $bundle.relay_url
    RELAY_SECRET = $bundle.relay_secret
    TUNNEL_URL   = $bundle.tunnel_url
}

# 7. Persist tunnel token to a locked-down file (for re-installing the service later)
Write-Log "INFO" "Writing tunnel token to $TokenFile (Admin/SYSTEM only)"
Set-Content -Path $TokenFile -Value $bundle.tunnel_token -Encoding UTF8
try {
    $acl = Get-Acl $TokenFile
    $acl.SetAccessRuleProtection($true, $false)
    $acl.SetAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
        "BUILTIN\Administrators", "FullControl", "Allow")))
    $acl.SetAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
        "NT AUTHORITY\SYSTEM", "FullControl", "Allow")))
    Set-Acl -Path $TokenFile -AclObject $acl
} catch {
    Write-Log "WARN" "Could not tighten ACL on $TokenFile: $_"
}

# 8. Install cloudflared service
try {
    Install-CloudflaredTunnelService -Token $bundle.tunnel_token
} catch {
    Write-Log "ERROR" "cloudflared install failed: $_"
    Write-Log "ERROR" ".env is written but tunnel is NOT running. Retry with -Force after fixing cloudflared."
    exit 5
}

# 9. Restart Ziggy so it re-reads .env and re-registers with the relay
Write-Log "INFO" "Restarting Ziggy container"
Push-Location $RepoRoot
try {
    docker compose restart ziggy 2>&1 | ForEach-Object { Write-Log "docker" $_ }
    if ($LASTEXITCODE -ne 0) {
        Write-Log "WARN" "docker compose restart returned $LASTEXITCODE. The next scheduled update.ps1 run will pick up the new .env."
    }
} finally {
    Pop-Location
}

# 10. Success
Write-Log "INFO" "=== claim-home.ps1 complete ==="
Write-Host ""
Write-Host "Claimed as: $($bundle.home_id) ('$HomeName')"
Write-Host "Public URL: $($bundle.tunnel_url)"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Ship this mini PC to $OwnerEmail."
Write-Host "  2. Customer plugs in power + Ethernet."
Write-Host "  3. Ziggy auto-registers with relay on first boot."
Write-Host "  4. Home status flips to 'active' in the relay dashboard."
