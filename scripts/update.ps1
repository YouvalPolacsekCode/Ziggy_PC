# Ziggy Windows mini-PC update script.
# Pure ASCII to avoid Git-for-Windows encoding mangling.
#
# Designed for BOTH manual invocation and unattended use (scheduled task):
#   - Silent on no-op so polling every 5 min doesn't spam logs.
#   - Detects "git is in sync but container is behind" via /api/version
#     and rebuilds anyway (catches the case where someone manually
#     pulled but never rebuilt).
#   - On `docker compose --build` failure, the OLD container keeps
#     running (Docker only recreates if the image rebuild succeeded).
#   - All meaningful events go to user_files\update.log; the deploy
#     SHA breadcrumbs go to user_files\deploy_log for rollback.

# Continue rather than Stop: native commands (git, docker compose) write
# progress to stderr, which 2>&1 wraps as ErrorRecord objects. With EAP=Stop
# those terminate the script. We check $LASTEXITCODE explicitly after every
# native command, so we don't lose any error detection.
$ErrorActionPreference = "Continue"

$RepoDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $RepoDir

$DeployLog        = Join-Path $RepoDir "user_files\deploy_log"
$UpdateLog        = Join-Path $RepoDir "user_files\update.log"
$DeployLogsDir    = Join-Path $RepoDir "user_files\deploy-logs"
New-Item -ItemType Directory -Path (Split-Path $DeployLog) -Force | Out-Null
New-Item -ItemType Directory -Path $DeployLogsDir         -Force | Out-Null

$Ts = Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ"

function Write-Log {
    param([string]$msg)
    $line = "[$Ts] $msg"
    Write-Host $line
    Add-Content -Path $UpdateLog -Value $line
}

# Refuse to deploy on top of a dirty working tree -- but only flag
# MODIFIED tracked files. Untracked junk (e.g., stray files from
# PowerShell sc/del/copy command aliases) shouldn't block deploys since
# git pull won't touch them.
$dirty = git status --porcelain --untracked-files=no
if ($dirty) {
    Write-Log "ABORT: working tree not clean. Commit/stash/revert first."
    exit 1
}

$fetchOut = & git fetch --prune origin 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Log "ABORT: git fetch failed"
    exit 1
}

$GitSha    = (git rev-parse HEAD).Trim()
$RemoteSha = (git rev-parse origin/main).Trim()

# Ask the running container what SHA it's serving. If unreachable, we
# rebuild to recover (container may be crashed).
$ContainerSha = "unknown"
try {
    $resp = Invoke-RestMethod -Uri "http://localhost:8001/api/version" -TimeoutSec 3 -ErrorAction Stop
    $ContainerSha = $resp.git_sha
} catch {
    # Container down or pre-/api/version build. Force rebuild.
}

# Steady state: everything matches. Silent exit.
if ($GitSha -eq $RemoteSha -and $ContainerSha -eq $RemoteSha) {
    exit 0
}

Write-Log "Update needed: git=$GitSha remote=$RemoteSha container=$ContainerSha"

# Per-deploy verbose log lives in user_files\deploy-logs\<ts>-<sha>.log;
# update.log only sees short status lines. Keeps update.log readable as a
# timeline of "what happened when" while the noisy build output is
# parked next door for when you actually need to debug a build.
$DeployVerbose = Join-Path $DeployLogsDir ($Ts.Replace(":", "-") + "-build.log")

# Pull if remote is ahead. Capture both streams so PowerShell doesn't
# treat native command stderr lines as terminating errors.
if ($GitSha -ne $RemoteSha) {
    Write-Log "Pulling $GitSha -> $RemoteSha"
    $pullOut = & git pull --ff-only origin main 2>&1
    $pullOut | ForEach-Object { Add-Content -Path $DeployVerbose -Value $_.ToString() }
    $pullOut | ForEach-Object { Write-Host $_.ToString() }
    if ($LASTEXITCODE -ne 0) {
        Write-Log "ABORT: git pull --ff-only failed (non-fast-forward?). See $DeployVerbose"
        exit 1
    }
    $GitSha = (git rev-parse HEAD).Trim()
}

Write-Log "Rebuilding container at $GitSha (build log: $DeployVerbose)"
$env:GIT_SHA = $GitSha
$buildOut = & docker compose up -d --build --no-deps ziggy 2>&1
$buildExit = $LASTEXITCODE
$buildOut | ForEach-Object { Add-Content -Path $DeployVerbose -Value $_.ToString() }
$buildOut | ForEach-Object { Write-Host $_.ToString() }
if ($buildExit -ne 0) {
    Write-Log "FAILED: docker compose --build returned $buildExit. Previous container still running. See $DeployVerbose"
    exit 1
}

# Verify the new container reports the new SHA (with retry loop for slow starts).
Start-Sleep -Seconds 3
$verifyOk = $false
for ($i = 0; $i -lt 15; $i++) {
    try {
        $resp = Invoke-RestMethod -Uri "http://localhost:8001/api/version" -TimeoutSec 3 -ErrorAction Stop
        if ($resp.git_sha -eq $GitSha) {
            $verifyOk = $true
            break
        }
    } catch {}
    Start-Sleep -Seconds 2
}

Add-Content -Path $DeployLog -Value "---"
Add-Content -Path $DeployLog -Value ("ts:        " + $Ts)
Add-Content -Path $DeployLog -Value ("old:       " + $ContainerSha)
Add-Content -Path $DeployLog -Value ("new:       " + $GitSha)
Add-Content -Path $DeployLog -Value ("verified:  " + $verifyOk)

if ($verifyOk) {
    Write-Log "Deploy complete: $ContainerSha -> $GitSha"
} else {
    Write-Log "WARNING: deploy applied but /api/version did not confirm within 33s. Check 'docker compose logs ziggy'."
}
