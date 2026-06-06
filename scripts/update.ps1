# Ziggy Windows mini-PC update script.
# Pure ASCII to avoid Git-for-Windows encoding mangling of em-dashes.
#
# Records every deploy in user_files\deploy_log so rollback is one cmd:
#   git checkout <sha-from-log>
#   $env:GIT_SHA = '<sha-from-log>'
#   docker compose up -d --build --no-deps ziggy
#
# Run on the WINDOWS mini PC (over SSH or directly), not Mac.

$ErrorActionPreference = "Stop"

$RepoDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $RepoDir

$LogFile = Join-Path $RepoDir "user_files\deploy_log"
New-Item -ItemType Directory -Path (Split-Path $LogFile) -Force | Out-Null

$OldSha    = (git rev-parse HEAD).Trim()
$OldBranch = (git rev-parse --abbrev-ref HEAD).Trim()
$Ts        = Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ"

Write-Host "=== Ziggy update at $Ts ==="
Write-Host "Repo:       $RepoDir"
Write-Host "Branch:     $OldBranch"
Write-Host "Old SHA:    $OldSha"
Write-Host ""

# Refuse to deploy on top of a dirty working tree.
$dirty = (git status --porcelain)
if ($dirty) {
    Write-Host "ERROR: working tree is not clean. Commit, stash, or revert first."
    Write-Host ""
    git status --short
    exit 1
}

Write-Host "Fetching origin..."
git fetch --prune origin
if ($LASTEXITCODE -ne 0) { throw "git fetch failed" }

$NewSha = (git rev-parse origin/main).Trim()

if ($OldSha -eq $NewSha) {
    Write-Host "Already at origin/main ($NewSha). Nothing to do."
    exit 0
}

Write-Host ""
Write-Host "Incoming commits:"
git log --oneline "$OldSha..$NewSha"
Write-Host ""

git pull --ff-only origin main
if ($LASTEXITCODE -ne 0) { throw "git pull --ff-only failed" }

$NewSha = (git rev-parse HEAD).Trim()
Write-Host "New SHA:    $NewSha"
Write-Host ""

Write-Host "Rebuilding container..."
$env:GIT_SHA = $NewSha
docker compose up -d --build --no-deps ziggy
if ($LASTEXITCODE -ne 0) { throw "docker compose up --build failed" }

Add-Content -Path $LogFile -Value "---"
Add-Content -Path $LogFile -Value ("ts:     " + $Ts)
Add-Content -Path $LogFile -Value ("old:    " + $OldSha)
Add-Content -Path $LogFile -Value ("new:    " + $NewSha)
Add-Content -Path $LogFile -Value ("branch: " + $OldBranch)

Write-Host ""
Write-Host "Deploy logged to $LogFile"
Write-Host ""
Write-Host "Recent Ziggy logs:"
docker compose logs --tail=20 ziggy

Write-Host ""
Write-Host "Done. To roll back, run:"
Write-Host ("  git checkout " + $OldSha)
Write-Host ("  " + '$env:GIT_SHA' + " = '" + $OldSha + "'")
Write-Host "  docker compose up -d --build --no-deps ziggy"
