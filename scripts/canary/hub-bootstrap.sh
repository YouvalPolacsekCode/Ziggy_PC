#!/usr/bin/env bash
# scripts/canary/hub-bootstrap.sh
# Run this ON THE MINI PC (fresh Ubuntu Server 24.04), over SSH or on its console.
# It installs Docker + git and puts the Ziggy code at /opt/ziggy on the beta branch.
#
# You need a GitHub token (runbook Part A step 1) because the repo is private.
# Run it like this (paste your token in place of the word after GH_TOKEN=):
#   GH_TOKEN=github_pat_xxxxx bash hub-bootstrap.sh
set -euo pipefail

REPO_OWNER="YouvalPolacsekCode"
REPO_NAME="Ziggy_PC"
REPO_DIR="/opt/ziggy"

# What code does a NEW home get?
#
# This used to pin a long-lived feature branch (feat/beta-image-readiness).
# Branches drift: by 2026-08-10 it sat far behind the released fleet, so a hub
# imaged that day would have been born with every bug the fleet had already
# fixed — no reconcile self-heal (its first power cut would falsely mark every
# device "removed"), no health telemetry (invisible to the fleet), and an
# updater that would delete its owner's automations on the first update it ever
# received.
#
# A new home should start where the fleet already is: the newest release tag,
# the same thing every existing hub is pulling. Override for a deliberate test:
#   ZIGGY_IMAGE_REF=feat/some-branch  sudo -E bash hub-bootstrap.sh
ZIGGY_IMAGE_REF="${ZIGGY_IMAGE_REF:-}"

[ "$(id -u)" = "0" ] || { echo "ERROR: run with sudo:  sudo GH_TOKEN=... bash hub-bootstrap.sh"; exit 1; }
: "${GH_TOKEN:?ERROR: set GH_TOKEN=<your github token>. Example: sudo GH_TOKEN=github_pat_xxx bash hub-bootstrap.sh}"

echo "== 1/4 apt update + base packages =="
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y git curl ca-certificates jq

echo "== 2/4 install Docker Engine =="
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker
# let the login user run docker without sudo (takes effect next login)
if [ -n "${SUDO_USER:-}" ]; then usermod -aG docker "$SUDO_USER" || true; fi

echo "== 3/4 clone/refresh the Ziggy repo at $REPO_DIR =="
AUTH_URL="https://${GH_TOKEN}@github.com/${REPO_OWNER}/${REPO_NAME}.git"
if [ -d "$REPO_DIR/.git" ]; then
  git -C "$REPO_DIR" remote set-url origin "$AUTH_URL"
else
  git clone --no-checkout "$AUTH_URL" "$REPO_DIR"
fi
git -C "$REPO_DIR" fetch --prune --tags origin

# Resolve the target ref: explicit override, else the newest release tag, else
# main. Newest by creatordate — the same ordering ziggy-update.sh uses to pick a
# production hub's target, so imaging and OTA can never disagree about "latest".
TARGET_REF="$ZIGGY_IMAGE_REF"
if [ -z "$TARGET_REF" ]; then
  TARGET_REF="$(git -C "$REPO_DIR" for-each-ref --sort=-creatordate \
                  --format='%(refname:short)' --count=1 'refs/tags/release-*' || true)"
fi
[ -n "$TARGET_REF" ] || TARGET_REF="origin/main"

echo "   imaging at: $TARGET_REF"
git -C "$REPO_DIR" -c advice.detachedHead=false checkout --force "$TARGET_REF"

# Strip the token back out of the stored remote so it isn't left on disk.
git -C "$REPO_DIR" remote set-url origin "https://github.com/${REPO_OWNER}/${REPO_NAME}.git"

# Home Assistant `!include`s automations/scripts/scenes and refuses to start
# without them. They are the HOME'S OWN state, not code, so they are gitignored
# and a fresh clone has none — seed empty ones exactly once. (They used to be
# tracked and shipped as `[]`, which meant every release checkout overwrote a
# live home's real automations; on 2026-08-14 that cost a home five and a half
# hours with no automations at all.) The updater does the same on every run, so
# this only matters for the window before the first update.
for _f in automations scripts scenes; do
  if [ ! -f "$REPO_DIR/docker/ha-config/$_f.yaml" ]; then
    mkdir -p "$REPO_DIR/docker/ha-config"
    printf '[]\n' > "$REPO_DIR/docker/ha-config/$_f.yaml"
    echo "   seeded docker/ha-config/$_f.yaml"
  fi
done

echo "== 4/4 mark factory scripts executable =="
chmod +x "$REPO_DIR"/scripts/factory/*.sh "$REPO_DIR"/scripts/*.sh "$REPO_DIR"/scripts/linux/*.sh 2>/dev/null || true

echo
echo "DONE. Ziggy is at $REPO_DIR on $TARGET_REF ($(git -C "$REPO_DIR" describe --tags --always))."
echo
echo "NEXT: this hub is NOT yet on the update channel. To keep it current:"
echo "  printf 'ZIGGY_COHORT=production\\nZIGGY_REPO_DIR=%s\\n' \"$REPO_DIR\" | sudo tee /etc/ziggy/ziggy.env"
echo "  sudo $REPO_DIR/scripts/linux/install-systemd-units.sh"
echo "NEXT: run the imaging command (runbook Part F)."
