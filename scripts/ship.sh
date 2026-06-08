#!/usr/bin/env bash
# Ziggy release tagger. Stamps a release-YYYY.MM.DD[-N] tag at HEAD,
# pushes it to origin. Production homes (ZIGGY_COHORT=production)
# pull this tag on their next 5-min auto-update tick.
#
# Usage:
#   ./scripts/ship.sh                  # tag = release-YYYY.MM.DD, auto-bumps suffix if today already shipped
#   ./scripts/ship.sh -m "message"     # custom tag annotation (default: short SHA + subject)
#   ./scripts/ship.sh -s               # GPG-signed tag (-s on git tag)
#   ./scripts/ship.sh --dry-run        # show what would happen, do not tag/push
#
# Refuses to ship if:
#   - working tree is dirty (commit or stash first)
#   - HEAD is behind origin/main (push canary changes first)
#   - HEAD is not on main (release tags ship a specific commit; only main flows
#     through canary first, so refuse to tag off a feature branch)

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

DRY_RUN=0
SIGN=0
MESSAGE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)  DRY_RUN=1; shift ;;
    -s)         SIGN=1; shift ;;
    -m)         MESSAGE="$2"; shift 2 ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//' | head -16
      exit 0
      ;;
    *)  echo "Unknown arg: $1"; exit 2 ;;
  esac
done

# --- Sanity checks --------------------------------------------------------

if ! git diff --quiet --ignore-submodules HEAD 2>/dev/null; then
  echo "ERROR: working tree has uncommitted changes. Commit or stash first." >&2
  git status --short
  exit 1
fi

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$CURRENT_BRANCH" != "main" ]; then
  echo "ERROR: ship.sh tags from main only (currently on '$CURRENT_BRANCH')." >&2
  echo "Releases must flow through canary first. Merge to main, then re-run." >&2
  exit 1
fi

echo "Fetching origin..."
git fetch --quiet origin main
LOCAL_SHA="$(git rev-parse HEAD)"
REMOTE_SHA="$(git rev-parse origin/main)"
if [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
  echo "ERROR: local main is not in sync with origin/main." >&2
  echo "  Local : $LOCAL_SHA" >&2
  echo "  Remote: $REMOTE_SHA" >&2
  echo "Push or pull first so the release tag sits on a commit canary has seen." >&2
  exit 1
fi

# --- Pick a tag name ------------------------------------------------------

TODAY="$(date -u +%Y.%m.%d)"
BASE_TAG="release-$TODAY"

# If today's base tag already exists, append -2, -3, ... up to -9.
TAG="$BASE_TAG"
git fetch --quiet --tags origin
if git rev-parse --quiet --verify "refs/tags/$TAG" >/dev/null; then
  for i in 2 3 4 5 6 7 8 9; do
    CANDIDATE="$BASE_TAG-$i"
    if ! git rev-parse --quiet --verify "refs/tags/$CANDIDATE" >/dev/null; then
      TAG="$CANDIDATE"
      break
    fi
  done
fi

# --- Build annotation -----------------------------------------------------

SHORT_SHA="$(git rev-parse --short HEAD)"
SUBJECT="$(git log -1 --format=%s)"
if [ -z "$MESSAGE" ]; then
  MESSAGE="release $TAG -- $SHORT_SHA $SUBJECT"
fi

# Find the previous release-* tag to show the diff
PREV_TAG="$(git tag --list 'release-*' --sort=-creatordate | head -1 || true)"

# --- Show what we are about to do -----------------------------------------

echo
echo "=== Release plan ==="
echo "Tag:        $TAG"
echo "Commit:     $SHORT_SHA"
echo "Subject:    $SUBJECT"
echo "Message:    $MESSAGE"
echo "Signed:     $( [ $SIGN -eq 1 ] && echo yes || echo no )"
if [ -n "$PREV_TAG" ]; then
  COUNT="$(git rev-list "$PREV_TAG..HEAD" --count)"
  echo
  echo "Commits since $PREV_TAG: $COUNT"
  git log --oneline "$PREV_TAG..HEAD" | head -20
  if [ "$COUNT" -gt 20 ]; then
    echo "...and $((COUNT - 20)) more."
  fi
else
  echo
  echo "(no previous release-* tag found; first release)"
fi
echo

if [ $DRY_RUN -eq 1 ]; then
  echo "DRY RUN: would tag and push. Stopping here."
  exit 0
fi

# --- Tag + push -----------------------------------------------------------

if [ $SIGN -eq 1 ]; then
  git tag -s -a "$TAG" -m "$MESSAGE"
else
  git tag -a "$TAG" -m "$MESSAGE"
fi

echo "Tagged $TAG locally. Pushing..."
git push origin "$TAG"

echo
echo "Shipped $TAG -> $SHORT_SHA."
echo "Production homes (ZIGGY_COHORT=production) will pull it within ~5 min."
echo
echo "To verify a home picked it up:"
echo "  ./scripts/fleet-status.sh"
echo
echo "To revert (does not roll back homes already on this tag):"
echo "  git tag -d $TAG"
echo "  git push --delete origin $TAG"
echo "  (To roll back homes, cut a NEW release tag at an earlier good SHA.)"
