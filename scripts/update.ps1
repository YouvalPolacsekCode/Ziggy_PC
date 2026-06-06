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

$ErrorActionPreference = "Stop"

$RepoDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $RepoDir

$DeployLog = Join-Path $RepoDir "user_files\deploy_log"
$UpdateLog = Join-Path $RepoDir "user_files\update.log"
New-Item -ItemType Directory -Path (Split-Path $DeployLog) -Force | Out-Null

$Ts = Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ"

function Write-Log {
    param([string]$msg)
    $line = "[$Ts] $msg"
    Write-Host $line
    Add-Content -Path $UpdateLog -Value $line
}

# Refuse to deploy on top of a dirty working tree.
$dirty = git status --porcelain
if ($dirty) {
    Write-Log "ABORT: working tree not clean. Commit/stash/revert first."
    exit 1
}

git fetch --prune origin 2>&1 | Out-Null
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

# Pull if remote is ahead.
if ($GitSha -ne $RemoteSha) {
    git pull --ff-only origin main 2>&1 | Tee-Object -FilePath $UpdateLog -Append
    if ($LASTEXITCODE -ne 0) {
        Write-Log "ABORT: git pull --ff-only failed (non-fast-forward?)"
        exit 1
    }
    $GitSha = (git rev-parse HEAD).Trim()
}

Write-Log "Rebuilding container at $GitSha"
$env:GIT_SHA = $GitSha
docker compose up -d --build --no-deps ziggy 2>&1 | Tee-Object -FilePath $UpdateLog -Append
if ($LASTEXITCODE -ne 0) {
    Write-Log "FAILED: docker compose --build returned $LASTEXITCODE. Previous container left running."
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
