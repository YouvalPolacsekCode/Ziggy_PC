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
BRANCH="feat/beta-image-readiness"
REPO_DIR="/opt/ziggy"

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

echo "== 3/4 clone/refresh the Ziggy repo at $REPO_DIR ($BRANCH) =="
if [ -d "$REPO_DIR/.git" ]; then
  git -C "$REPO_DIR" remote set-url origin "https://${GH_TOKEN}@github.com/${REPO_OWNER}/${REPO_NAME}.git"
  git -C "$REPO_DIR" fetch origin "$BRANCH"
  git -C "$REPO_DIR" checkout "$BRANCH"
  git -C "$REPO_DIR" reset --hard "origin/$BRANCH"
else
  git clone --branch "$BRANCH" "https://${GH_TOKEN}@github.com/${REPO_OWNER}/${REPO_NAME}.git" "$REPO_DIR"
fi
# Strip the token back out of the stored remote so it isn't left on disk.
git -C "$REPO_DIR" remote set-url origin "https://github.com/${REPO_OWNER}/${REPO_NAME}.git"

echo "== 4/4 mark factory scripts executable =="
chmod +x "$REPO_DIR"/scripts/factory/*.sh "$REPO_DIR"/scripts/*.sh "$REPO_DIR"/scripts/linux/*.sh 2>/dev/null || true

echo
echo "DONE. Ziggy is at $REPO_DIR on $BRANCH."
echo "NEXT: run the imaging command (runbook Part F)."
