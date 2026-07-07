#Requires -Version 5.1
<#
.SYNOPSIS
    Diagnose and recover a stuck Ziggy mini-PC OTA loop.

.DESCRIPTION
    When /health reports ota.status=silent (>2h since last verified deploy)
    something has broken the ZiggyAutoUpdate task's ability to progress
    origin/main -> running container.

    This script prints EVERYTHING you need to see the problem in one screen:
      * Repo HEAD vs origin/main + how many commits behind
      * ZiggyAutoUpdate task state (last result, next run, missed runs)
      * update.heartbeat mtime + status
      * update_task.json (Task Scheduler snapshot from update.ps1)
      * Last 30 lines of update.log + last 3 deploy_log blocks
      * git stash list (accidental stash storm is a common cause)
      * Disk free on the repo drive + Docker service state

    With -Fix it also attempts safe recoveries:
      * Enable-ScheduledTask if the task is disabled
      * Prune git stashes older than 7 days
      * Kick one manual update.ps1 run and stream its output

    Run from anywhere; auto-locates the repo root as the parent of scripts\.

.PARAMETER Fix
    Attempt safe automatic recoveries. Without this flag the script is read-only.

.PARAMETER Verbose
    (Built-in PowerShell switch) — extra step-by-step output.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\ota-recover.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\ota-recover.ps1 -Fix
#>
[CmdletBinding()]
param(
    [switch]$Fix
)

$ErrorActionPreference = "Continue"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = Split-Path -Parent $ScriptDir
Set-Location $RepoRoot

$UserFiles = Join-Path $RepoRoot "user_files"
$UpdateLog     = Join-Path $UserFiles "update.log"
$DeployLog     = Join-Path $UserFiles "deploy_log"
$Heartbeat     = Join-Path $UserFiles "update.heartbeat"
$TaskHeartbeat = Join-Path $UserFiles "update_task.json"
$TaskName      = "ZiggyAutoUpdate"

function Section([string]$title) {
    Write-Host ""
    Write-Host "==== $title ====" -ForegroundColor Cyan
}
function Warn([string]$msg)  { Write-Host "WARN: $msg" -ForegroundColor Yellow }
function Fatal([string]$msg) { Write-Host "FATAL: $msg" -ForegroundColor Red; exit 1 }
function Good([string]$msg)  { Write-Host "OK: $msg" -ForegroundColor Green }

$now = Get-Date
Write-Host ""
Write-Host "Ziggy OTA recovery ($($now.ToUniversalTime().ToString('o')))" -ForegroundColor White
Write-Host "Repo: $RepoRoot"
Write-Host "Mode: $(if ($Fix) { 'FIX (safe recoveries enabled)' } else { 'READ-ONLY (rerun with -Fix to attempt recoveries)' })"

# ---------------------------------------------------------------------------
# 1. Repo state
# ---------------------------------------------------------------------------
Section "Repo state"
$head = (& git rev-parse HEAD 2>$null).Trim()
Write-Host "HEAD: $head"
& git log --oneline -3 2>$null | ForEach-Object { Write-Host "  $_" }

Write-Host ""
Write-Host "Fetching origin (read-only)..."
$fetchOut = & git fetch --prune origin 2>&1
if ($LASTEXITCODE -ne 0) {
    Warn "git fetch failed. Network or auth broken."
    $fetchOut | ForEach-Object { Write-Host "  $_" }
} else {
    Good "git fetch succeeded"
}

$mainSha = (& git rev-parse origin/main 2>$null).Trim()
Write-Host "origin/main: $mainSha"
$behind = (& git rev-list --count "HEAD..origin/main" 2>$null).Trim()
$ahead  = (& git rev-list --count "origin/main..HEAD" 2>$null).Trim()
Write-Host "HEAD is $behind commit(s) behind, $ahead commit(s) ahead"

Write-Host ""
Write-Host "Working tree status:"
& git status --porcelain --untracked-files=no 2>&1 | ForEach-Object { Write-Host "  $_" }
$dirty = (& git status --porcelain --untracked-files=no).Trim()
if ($dirty) { Warn "tracked files modified — update.ps1 will auto-stash on next run" }

Write-Host ""
Write-Host "Stash list (newest first):"
$stashes = & git stash list 2>&1
if ($stashes) { $stashes | ForEach-Object { Write-Host "  $_" } } else { Write-Host "  (none)" }
$stashCount = if ($stashes) { ($stashes | Measure-Object).Count } else { 0 }
if ($stashCount -gt 20) { Warn "$stashCount stashes accumulated — a bug may be auto-stashing every 2 min" }

# ---------------------------------------------------------------------------
# 2. Scheduled task state
# ---------------------------------------------------------------------------
Section "ZiggyAutoUpdate scheduled task"
try {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
    $info = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction Stop
    Write-Host "State                : $($task.State)"
    Write-Host "Principal            : $($task.Principal.UserId)"
    Write-Host "LastRunTime          : $(if ($info.LastRunTime) { $info.LastRunTime.ToUniversalTime().ToString('o') } else { '(never)' })"
    Write-Host "LastTaskResult       : $($info.LastTaskResult) ($('0x{0:X}' -f [uint32]$info.LastTaskResult))"
    Write-Host "NextRunTime          : $(if ($info.NextRunTime) { $info.NextRunTime.ToUniversalTime().ToString('o') } else { '(none)' })"
    Write-Host "NumberOfMissedRuns   : $($info.NumberOfMissedRuns)"
    if ($task.State -eq "Disabled") {
        Warn "task is DISABLED — this is almost certainly the reason OTA is stuck"
        if ($Fix) {
            try {
                Enable-ScheduledTask -TaskName $TaskName -ErrorAction Stop | Out-Null
                Good "task re-enabled"
            } catch {
                Warn "Enable-ScheduledTask failed: $_ (need admin PowerShell?)"
            }
        }
    }
    if ($info.LastRunTime) {
        $ageMin = [int]((Get-Date) - $info.LastRunTime).TotalMinutes
        Write-Host "Last run was $ageMin minute(s) ago (task fires every 2 min)"
        if ($ageMin -gt 15) {
            Warn "last run was $ageMin min ago — task engine is not launching the script"
        }
    }
} catch {
    Warn "Task '$TaskName' not registered on this machine: $_"
    Write-Host "  -> re-run scripts\install-auto-update.ps1 as Admin to register it"
}

# ---------------------------------------------------------------------------
# 3. Heartbeat / task-heartbeat files
# ---------------------------------------------------------------------------
Section "Heartbeat files"
if (Test-Path $Heartbeat) {
    $hb = Get-Item $Heartbeat
    $ageSec = [int]((Get-Date) - $hb.LastWriteTime).TotalSeconds
    Write-Host "update.heartbeat mtime: $($hb.LastWriteTimeUtc.ToString('o'))  (age: $ageSec s)"
    Write-Host "update.heartbeat contents: $((Get-Content $Heartbeat -Raw).Trim())"
    if ($ageSec -gt 900) {
        Warn "heartbeat is stale (>15 min) — update.ps1 has not started a cycle recently"
    } else {
        Good "heartbeat is fresh"
    }
} else {
    Warn "update.heartbeat does not exist — update.ps1 has NEVER run cleanly on this machine"
}

if (Test-Path $TaskHeartbeat) {
    Write-Host ""
    Write-Host "update_task.json contents:"
    Get-Content $TaskHeartbeat -Raw | Write-Host
} else {
    Warn "update_task.json missing"
}

# ---------------------------------------------------------------------------
# 4. Logs
# ---------------------------------------------------------------------------
Section "update.log — last 30 lines"
if (Test-Path $UpdateLog) {
    Get-Content $UpdateLog -Tail 30
} else {
    Warn "update.log does not exist"
}

Section "deploy_log — last 3 blocks"
if (Test-Path $DeployLog) {
    $rawLog = Get-Content $DeployLog -Raw
    $blocks = $rawLog -split "\n---\n"
    $lastN = $blocks | Where-Object { $_.Trim() } | Select-Object -Last 3
    $lastN | ForEach-Object {
        Write-Host "----"
        Write-Host $_.Trim()
    }
} else {
    Warn "deploy_log does not exist"
}

# ---------------------------------------------------------------------------
# 5. Docker + disk
# ---------------------------------------------------------------------------
Section "Docker state"
$dockerService = Get-Service -Name "com.docker.service" -ErrorAction SilentlyContinue
if (-not $dockerService) { $dockerService = Get-Service -Name "*docker*" -ErrorAction SilentlyContinue | Select-Object -First 1 }
if ($dockerService) {
    Write-Host "Service: $($dockerService.Name) Status=$($dockerService.Status)"
    if ($dockerService.Status -ne "Running") { Warn "Docker service not running" }
} else {
    Warn "no Docker service found by name; falling back to `docker info`"
}
$dockerInfo = & docker info --format "{{.ServerVersion}} on {{.OperatingSystem}}" 2>&1
if ($LASTEXITCODE -eq 0) { Good "docker daemon reachable: $dockerInfo" }
else { Warn "docker info failed: $dockerInfo" }

Write-Host ""
Write-Host "docker compose ps (ziggy service):"
& docker compose ps 2>&1 | Select-Object -First 20 | ForEach-Object { Write-Host "  $_" }

Section "Disk free"
$drive = Split-Path -Qualifier $RepoRoot
$vol = Get-Volume -DriveLetter $drive.TrimEnd(":") -ErrorAction SilentlyContinue
if ($vol) {
    $freeGB = [math]::Round($vol.SizeRemaining / 1GB, 1)
    $totalGB = [math]::Round($vol.Size / 1GB, 1)
    Write-Host "$drive : $freeGB GB free of $totalGB GB"
    if ($freeGB -lt 5) { Warn "less than 5 GB free — build may be failing on ENOSPC" }
}

# ---------------------------------------------------------------------------
# 6. -Fix: run one manual cycle of update.ps1 and stream its output
# ---------------------------------------------------------------------------
if ($Fix) {
    Section "FIX: kick one manual update.ps1 cycle"
    Write-Host "Running scripts\update.ps1 with full output..."
    Write-Host ""
    & (Join-Path $ScriptDir "update.ps1")
    $rc = $LASTEXITCODE
    Write-Host ""
    Write-Host "update.ps1 exit code: $rc"

    Section "Post-run repo state"
    $newHead = (& git rev-parse HEAD 2>$null).Trim()
    Write-Host "HEAD is now: $newHead"
    if ($newHead -ne $head) {
        Good "HEAD moved from $head to $newHead"
    } else {
        Warn "HEAD did not move. Check the update.log above for why."
    }

    Section "Post-run container SHA"
    Start-Sleep -Seconds 5
    try {
        $ver = (Invoke-RestMethod -Uri "http://localhost:8001/api/version" -TimeoutSec 10)
        Write-Host "container /api/version: $($ver.git_sha)"
        if ($ver.git_sha -eq $newHead) {
            Good "container matches HEAD — OTA loop recovered"
        } else {
            Warn "container SHA does not match HEAD — verification loop still failing"
        }
    } catch {
        Warn "could not reach http://localhost:8001/api/version : $_"
    }
}

Section "Done"
if (-not $Fix) {
    Write-Host "Rerun with -Fix to attempt recoveries (Admin PowerShell required for task re-enable)."
} else {
    Write-Host "If the container SHA still didn't advance, paste the whole output above back to Claude."
}
