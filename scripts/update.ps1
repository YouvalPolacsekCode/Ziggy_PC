# Ziggy Windows mini-PC update script. Pure ASCII to avoid Git-for-Windows
# encoding mangling.
#
# Two-track release model (canary vs production), with auto-rollback and
# opt-in GPG-signed-tag enforcement.
#
# Selection (set in this home's .env, picked up by docker compose env):
#   ZIGGY_COHORT=canary       -> follows origin/main (default).
#                                Every push to main auto-deploys here.
#   ZIGGY_COHORT=production   -> follows the most recently created tag
#                                matching 'release-*'. To ship, the operator
#                                tags + pushes: `git tag release-2026.06.06
#                                && git push origin release-2026.06.06`.
#                                Bare pushes to main DO NOT deploy here.
#
# Opt-in integrity (for production homes whose threat model warrants it):
#   ZIGGY_REQUIRE_SIGNED_TAGS=true -> before checkout, runs `git verify-tag`.
#                                If the tag isn't signed by a trusted key,
#                                the update is aborted and the home stays
#                                on its previous tag. Default off.
#
# Auto-rollback:
#   After `docker compose --build`, the script polls /api/version. If the
#   new SHA doesn't show within ~60s, the script reverts to the last
#   verified SHA from user_files\deploy_log and rebuilds from there. The
#   rollback is itself recorded in deploy_log with kind: rollback so a
#   future run can tell rolled-back deploys apart from successful ones.
#
# Designed for BOTH manual invocation and unattended use (scheduled task):
#   - Silent on no-op so polling every 5 min doesn't spam logs.
#   - Detects "git is in sync but container is behind" via /api/version
#     and rebuilds anyway.
#   - Short status -> user_files\update.log. Noisy build output ->
#     user_files\deploy-logs\<ts>-build.log (one file per deploy).
#   - All meaningful events go to user_files\update.log; the SHA
#     breadcrumbs go to user_files\deploy_log for rollback.

# Continue rather than Stop: native commands (git, docker compose) write
# progress to stderr, which 2>&1 wraps as ErrorRecord objects. With EAP=Stop
# those terminate the script. We check $LASTEXITCODE explicitly after every
# native command, so we don't lose any error detection.
#
# Schema version: bump this string when changing the script in a way that
# requires the next polling cycle to re-rebuild even if main hasn't moved.
# The value itself isn't read at runtime — it just makes this file's content
# differ from a previous deploy so the next git pull notices a real change.
# v2 (2026-06-22): switch to docker compose build --no-cache --pull
$_SchemaVersion = "v2"
$ErrorActionPreference = "Continue"

$RepoDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $RepoDir

$DeployLog        = Join-Path $RepoDir "user_files\deploy_log"
$UpdateLog        = Join-Path $RepoDir "user_files\update.log"
$DeployLogsDir    = Join-Path $RepoDir "user_files\deploy-logs"
# Heartbeat: rewritten on every poll start regardless of whether anything
# updates. /api/admin/deploy/health surfaces this so we can tell from outside
# whether the scheduled task is firing at all. Without it, a silent
# no-op-on-every-cycle bug (dirty tree, network, etc.) looks identical to
# "task never runs". With it, mtime on heartbeat answers that in one curl.
$HeartbeatFile    = Join-Path $RepoDir "user_files\update.heartbeat"
New-Item -ItemType Directory -Path (Split-Path $DeployLog) -Force | Out-Null
New-Item -ItemType Directory -Path $DeployLogsDir         -Force | Out-Null

$Ts = Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ"

function Write-Log {
    param([string]$msg)
    $line = "[$Ts] $msg"
    Write-Host $line
    Add-Content -Path $UpdateLog -Value $line
}

# Write heartbeat immediately, before any check that could exit. Format is
# `<utc-ts> <status>` so the health endpoint can show "last seen + last
# outcome" in one read.
function Write-Heartbeat {
    param([string]$status)
    $line = "$Ts $status"
    try { Set-Content -Path $HeartbeatFile -Value $line -Encoding ASCII } catch {}
}
Write-Heartbeat "starting"

# ---------------------------------------------------------------------------
# Cohort selection
# ---------------------------------------------------------------------------
$Cohort = if ($env:ZIGGY_COHORT) { $env:ZIGGY_COHORT.Trim().ToLower() } else { "canary" }
if ($Cohort -ne "canary" -and $Cohort -ne "production") {
    Write-Log ("ABORT: unknown ZIGGY_COHORT='" + $Cohort + "' (expected 'canary' or 'production')")
    exit 1
}

# ---------------------------------------------------------------------------
# Last-good SHA from deploy_log (read once up front for rollback).
# ---------------------------------------------------------------------------
function Get-LastVerifiedSha {
    if (-not (Test-Path $DeployLog)) { return $null }
    $lines = Get-Content $DeployLog
    $foundVerified = $false
    $foundNonRollback = $true
    for ($i = $lines.Count - 1; $i -ge 0; $i--) {
        $line = $lines[$i].Trim()
        if ($line -eq "---") {
            $foundVerified = $false
            $foundNonRollback = $true
            continue
        }
        if ($line -match "^kind:\s*rollback") { $foundNonRollback = $false; continue }
        if ($line -match "^verified:\s*(\w+)") {
            if ($Matches[1] -eq "True" -or $Matches[1] -eq "true") { $foundVerified = $true }
            continue
        }
        if ($foundVerified -and $foundNonRollback -and $line -match "^new:\s*([0-9a-f]{7,40})") {
            return $Matches[1]
        }
    }
    return $null
}

# ---------------------------------------------------------------------------
# Dirty-check (modified tracked files only -- untracked is fine).
# Previously this aborted hard. That converted any stray edit into a silent
# polling death — every cycle aborts, nothing in the log louder than a
# single line, no telemetry. The mini-PC SHOULD never have local edits,
# but if it does, we'd rather stash them with a timestamp and keep
# polling than freeze the whole deploy pipeline forever.
# ---------------------------------------------------------------------------
$dirty = git status --porcelain --untracked-files=no
if ($dirty) {
    $stashMsg = "auto-stash-$Ts"
    Write-Log "Working tree dirty -- auto-stashing as '$stashMsg' and continuing"
    $dirty | ForEach-Object { Add-Content -Path $UpdateLog -Value ("  " + $_.ToString()) }
    $stashOut = & git stash push -m $stashMsg 2>&1
    if ($LASTEXITCODE -ne 0) {
        $stashOut | ForEach-Object { Add-Content -Path $UpdateLog -Value ("  " + $_.ToString()) }
        Write-Heartbeat "abort-stash-failed"
        Write-Log "ABORT: git stash push failed. Manual cleanup required."
        exit 1
    }
}

# ---------------------------------------------------------------------------
# Fetch + resolve target ref based on cohort
# ---------------------------------------------------------------------------
$fetchOut = & git fetch --prune --tags origin 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Log "ABORT: git fetch failed"
    exit 1
}

$GitSha = (git rev-parse HEAD).Trim()

if ($Cohort -eq "production") {
    # Latest tag matching release-* by creation date.
    $TargetTag = (& git for-each-ref --sort=-creatordate --format='%(refname:short)' 'refs/tags/release-*' 2>$null | Select-Object -First 1)
    if ($TargetTag) { $TargetTag = $TargetTag.Trim() }
    if (-not $TargetTag) {
        # No release tag exists yet. Production homes wait silently.
        exit 0
    }
    $RemoteSha = (git rev-parse "refs/tags/$TargetTag").Trim()
    $TargetDesc = "tag $TargetTag"
} else {
    $RemoteSha = (git rev-parse origin/main).Trim()
    $TargetDesc = "origin/main"
}

# ---------------------------------------------------------------------------
# Query the running container for its SHA. Primary source is `docker inspect`
# of the ZIGGY_GIT_SHA env var the container was built with (set on line ~198
# via $env:GIT_SHA -> compose -> Dockerfile). This is authoritative and does
# not depend on the backend process being responsive -- the previous version
# polled /api/version with `localhost`:8001 and a 3s timeout, which silently
# rolled to "unknown" whenever (a) the Windows IPv6->IPv4 fallback on
# `localhost` added ~2s, or (b) the HA-subscriber blocked the event loop just
# long enough to miss the window. That caused perpetual rebuilds every 5 min.
# HTTP probe is kept as a fallback in case the docker CLI is unavailable.
# ---------------------------------------------------------------------------
function Get-ContainerSha {
    try {
        $envOut = & docker inspect ziggy-ziggy-1 --format '{{range .Config.Env}}{{println .}}{{end}}' 2>$null
        if ($LASTEXITCODE -eq 0 -and $envOut) {
            foreach ($line in ($envOut -split "`n")) {
                if ($line -match '^ZIGGY_GIT_SHA=([0-9a-f]{7,40})') { return $Matches[1] }
            }
        }
    } catch {}

    for ($i = 0; $i -lt 3; $i++) {
        try {
            $resp = Invoke-RestMethod -Uri "http://127.0.0.1:8001/api/version" -TimeoutSec 5 -ErrorAction Stop
            if ($resp.git_sha) { return $resp.git_sha }
        } catch {}
        Start-Sleep -Seconds 2
    }
    return "unknown"
}

$ContainerSha = Get-ContainerSha

# Steady state: nothing to do. Heartbeat records the no-op so external
# observers (the deploy/health endpoint) can confirm the loop is alive
# without us spamming update.log on every 5-minute tick.
if ($GitSha -eq $RemoteSha -and $ContainerSha -eq $RemoteSha) {
    Write-Heartbeat "idle git=$GitSha"
    exit 0
}

Write-Log ("Update needed [cohort=$Cohort target=$TargetDesc]: git=$GitSha remote=$RemoteSha container=$ContainerSha")

# ---------------------------------------------------------------------------
# Optional: GPG-verify the target tag before touching anything.
# ---------------------------------------------------------------------------
if ($Cohort -eq "production" -and ($env:ZIGGY_REQUIRE_SIGNED_TAGS -eq "true")) {
    $verifyOut = & git verify-tag $TargetTag 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Log ("ABORT: git verify-tag $TargetTag failed -- tag is unsigned or signed by an untrusted key. Staying on $GitSha.")
        $verifyOut | ForEach-Object { Add-Content -Path $UpdateLog -Value ("  " + $_.ToString()) }
        exit 1
    }
    Write-Log ("Tag $TargetTag verified against trusted key.")
}

# Per-deploy verbose log for the noisy stuff.
$DeployVerbose = Join-Path $DeployLogsDir ($Ts.Replace(":", "-") + "-build.log")

# ---------------------------------------------------------------------------
# Pull / checkout target
# ---------------------------------------------------------------------------
if ($GitSha -ne $RemoteSha) {
    if ($Cohort -eq "production") {
        Write-Log ("Checking out $TargetTag ($RemoteSha)")
        $checkoutOut = & git -c advice.detachedHead=false checkout "refs/tags/$TargetTag" 2>&1
        $checkoutOut | ForEach-Object { Add-Content -Path $DeployVerbose -Value $_.ToString() }
        $checkoutOut | ForEach-Object { Write-Host $_.ToString() }
        if ($LASTEXITCODE -ne 0) {
            Write-Log "ABORT: git checkout of tag failed. See $DeployVerbose"
            exit 1
        }
    } else {
        # `git pull --ff-only` moves HEAD but in the wild has been observed
        # to leave the working tree out of sync (stash/lock interactions on
        # Windows). /api/version then reports the new SHA but the BUILD
        # uses stale source files, producing the previous bundle and making
        # "is my push deployed?" answer wrong for any modified file.
        # `fetch + reset --hard` is unambiguous: HEAD AND working tree both
        # land on origin/main, every tracked file regenerated from the
        # commit. Untracked files are preserved by reset.
        Write-Log ("Force-syncing $GitSha -> $RemoteSha (fetch + reset --hard origin/main)")
        $resetOut = & git reset --hard origin/main 2>&1
        $resetOut | ForEach-Object { Add-Content -Path $DeployVerbose -Value $_.ToString() }
        $resetOut | ForEach-Object { Write-Host $_.ToString() }
        if ($LASTEXITCODE -ne 0) {
            Write-Log "ABORT: git reset --hard origin/main failed. See $DeployVerbose"
            exit 1
        }
    }
    $GitSha = (git rev-parse HEAD).Trim()
}

# ---------------------------------------------------------------------------
# Build + restart
# ---------------------------------------------------------------------------
Write-Log "Rebuilding container at $GitSha (build log: $DeployVerbose)"
$env:GIT_SHA = $GitSha
# --no-cache: skip BuildKit layer cache entirely. Past incidents had the
# frontend-build stage hitting cache across commits even after Dockerfile
# ARG changes (BuildKit's content-key only invalidates when the actual RUN
# command text or referenced ARG values change, and even then we saw
# silent re-use in the wild). The build cost is ~30 s extra per deploy on
# a warm machine; the cost of a stale frontend reaching users is hours of
# "my push deployed but nothing changed" debugging. Always-no-cache wins.
$buildOut = & docker compose build --no-cache --pull ziggy 2>&1
$buildExit = $LASTEXITCODE
$buildOut | ForEach-Object { Add-Content -Path $DeployVerbose -Value $_.ToString() }
if ($buildExit -ne 0) {
    Write-Log "FAILED: docker compose build --no-cache returned $buildExit. Previous container still running. See $DeployVerbose"
    exit 1
}
# Start (or restart) the freshly-built image.
$buildOut = & docker compose up -d --no-deps ziggy 2>&1
$buildExit = $LASTEXITCODE
$buildOut | ForEach-Object { Add-Content -Path $DeployVerbose -Value $_.ToString() }
$buildOut | ForEach-Object { Write-Host $_.ToString() }
if ($buildExit -ne 0) {
    Write-Log "FAILED: docker compose --build returned $buildExit. Previous container still running. See $DeployVerbose"
    exit 1
}

# ---------------------------------------------------------------------------
# Verify post-deploy. Up to ~60s.
# ---------------------------------------------------------------------------
Start-Sleep -Seconds 3
$verifyOk = $false
for ($i = 0; $i -lt 30; $i++) {
    try {
        $resp = Invoke-RestMethod -Uri "http://127.0.0.1:8001/api/version" -TimeoutSec 3 -ErrorAction Stop
        if ($resp.git_sha -eq $GitSha) {
            $verifyOk = $true
            break
        }
    } catch {}
    Start-Sleep -Seconds 2
}

# ---------------------------------------------------------------------------
# Record the deploy attempt either way (verified=true or false).
# ---------------------------------------------------------------------------
Add-Content -Path $DeployLog -Value "---"
Add-Content -Path $DeployLog -Value ("ts:        " + $Ts)
Add-Content -Path $DeployLog -Value ("cohort:    " + $Cohort)
Add-Content -Path $DeployLog -Value ("target:    " + $TargetDesc)
Add-Content -Path $DeployLog -Value ("old:       " + $ContainerSha)
Add-Content -Path $DeployLog -Value ("new:       " + $GitSha)
Add-Content -Path $DeployLog -Value ("verified:  " + $verifyOk)

if ($verifyOk) {
    Write-Heartbeat "deployed $GitSha"
    Write-Log "Deploy complete: $ContainerSha -> $GitSha"
    exit 0
}

# ---------------------------------------------------------------------------
# AUTO-ROLLBACK
# ---------------------------------------------------------------------------
Write-Log "WARNING: post-deploy /api/version did not return $GitSha within 60s. Rolling back."

$LastGoodSha = Get-LastVerifiedSha
if (-not $LastGoodSha -or $LastGoodSha -eq $GitSha) {
    Write-Log "ROLLBACK SKIPPED: no prior verified SHA in deploy_log. Check 'docker compose logs ziggy'."
    exit 1
}

Write-Log "ROLLBACK: $GitSha -> $LastGoodSha (last verified deploy)"
$rbTs = Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ"
$RollbackVerbose = Join-Path $DeployLogsDir ($rbTs.Replace(":", "-") + "-rollback.log")

$rbCheckoutOut = & git -c advice.detachedHead=false checkout $LastGoodSha 2>&1
$rbCheckoutOut | ForEach-Object { Add-Content -Path $RollbackVerbose -Value $_.ToString() }
if ($LASTEXITCODE -ne 0) {
    Write-Log "ROLLBACK FAILED: git checkout $LastGoodSha did not succeed. See $RollbackVerbose"
    exit 1
}

$env:GIT_SHA = $LastGoodSha
# Same --no-cache rationale as the forward-deploy build above: never let
# a layer cache resurrect a known-bad bundle during a rollback.
$rbBuildOut = & docker compose build --no-cache --pull ziggy 2>&1
$rbBuildExit = $LASTEXITCODE
$rbBuildOut | ForEach-Object { Add-Content -Path $RollbackVerbose -Value $_.ToString() }
if ($rbBuildExit -ne 0) {
    Write-Log "ROLLBACK FAILED: build --no-cache at $LastGoodSha returned $rbBuildExit. See $RollbackVerbose"
    exit 1
}
$rbBuildOut = & docker compose up -d --no-deps ziggy 2>&1
$rbBuildExit = $LASTEXITCODE
$rbBuildOut | ForEach-Object { Add-Content -Path $RollbackVerbose -Value $_.ToString() }
if ($rbBuildExit -ne 0) {
    Write-Log "ROLLBACK FAILED: rebuild at $LastGoodSha returned $rbBuildExit. See $RollbackVerbose"
    exit 1
}

# Verify the rollback container is healthy.
Start-Sleep -Seconds 3
$rbVerifyOk = $false
for ($i = 0; $i -lt 30; $i++) {
    try {
        $resp = Invoke-RestMethod -Uri "http://127.0.0.1:8001/api/version" -TimeoutSec 3 -ErrorAction Stop
        if ($resp.git_sha -eq $LastGoodSha) {
            $rbVerifyOk = $true
            break
        }
    } catch {}
    Start-Sleep -Seconds 2
}

Add-Content -Path $DeployLog -Value "---"
Add-Content -Path $DeployLog -Value ("ts:        " + $rbTs)
Add-Content -Path $DeployLog -Value ("cohort:    " + $Cohort)
Add-Content -Path $DeployLog -Value ("kind:      rollback")
Add-Content -Path $DeployLog -Value ("old:       " + $GitSha)
Add-Content -Path $DeployLog -Value ("new:       " + $LastGoodSha)
Add-Content -Path $DeployLog -Value ("verified:  " + $rbVerifyOk)

if ($rbVerifyOk) {
    Write-Heartbeat "rolledback to=$LastGoodSha bad=$GitSha"
    Write-Log "ROLLBACK complete: now running $LastGoodSha. INVESTIGATE the bad deploy at $GitSha."
    exit 1
} else {
    Write-Heartbeat "rollback-verify-failed last=$LastGoodSha"
    Write-Log "ROLLBACK applied but $LastGoodSha also failed /api/version verify. Manual intervention required."
    exit 1
}
