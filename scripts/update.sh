#!/usr/bin/env bash
# Ziggy mini-PC update script — pulls from origin/main and rebuilds.
#
# Records every deploy in user_files/deploy_log so rollback is one
# command:  git checkout <sha-from-log> && docker compose up -d --build
#
# Run this on the MINI PC, not on the Mac. Safe to re-run.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

LOG_FILE="$REPO_DIR/user_files/deploy_log"
mkdir -p "$(dirname "$LOG_FILE")"

OLD_SHA="$(git rev-parse HEAD)"
OLD_BRANCH="$(git rev-parse --abbrev-ref HEAD)"

echo "=== Ziggy update — $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "Repo:       $REPO_DIR"
echo "Branch:     $OLD_BRANCH"
echo "Old SHA:    $OLD_SHA"

# Bail loudly if the working tree is dirty — never silently overwrite
# in-flight edits on the mini PC.
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo
  echo "ERROR: working tree is not clean. Commit, stash, or revert first."
  echo
  git status --short
  exit 1
fi

echo
echo "Fetching origin..."
git fetch --prune origin

NEW_SHA="$(git rev-parse origin/main)"

if [ "$OLD_SHA" = "$NEW_SHA" ]; then
  echo "Already at origin/main ($NEW_SHA) — nothing to do."
  exit 0
fi

echo
echo "Incoming commits:"
git log --oneline "${OLD_SHA}..${NEW_SHA}"
echo

# --ff-only refuses non-fast-forward pulls. If main has been rewritten
# upstream, this fails loudly and we DO NOT silently destroy local state.
git pull --ff-only origin main

NEW_SHA="$(git rev-parse HEAD)"
echo "New SHA:    $NEW_SHA"

echo
echo "Rebuilding containers..."
docker compose up -d --build

# Record this deploy so rollback is trivial.
{
  echo "---"
  echo "ts:     $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "old:    $OLD_SHA"
  echo "new:    $NEW_SHA"
  echo "branch: $OLD_BRANCH"
} >> "$LOG_FILE"

echo
echo "Deploy logged to $LOG_FILE"
echo
echo "Recent Ziggy logs:"
docker compose logs --tail=20 ziggy || true

echo
echo "Done. To roll back:"
echo "  git checkout $OLD_SHA && docker compose up -d --build"
