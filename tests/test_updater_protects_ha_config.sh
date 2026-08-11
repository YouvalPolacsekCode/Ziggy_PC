#!/usr/bin/env bash
# =============================================================================
# The OTA updater must never destroy a customer's Home Assistant automations.
#
# docker/ha-config is bind-mounted as Home Assistant's /config, and
# automations.yaml inside it is a TRACKED file. So a customer's real automations
# live inside the versioned tree, and a naive "stash local changes, checkout the
# release tag" would delete them on the first update the box ever received.
#
# This builds a throwaway repo shaped like a hub — a release tag whose
# automations.yaml holds the shipped default, and a working tree holding the
# customer's own — then runs the real update path and asserts the customer's
# file survived.
#
#     ./tests/test_updater_protects_ha_config.sh
# =============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

CUSTOMER_AUTOMATIONS='- id: davids_good_night
  alias: Good night
  trigger: [{platform: state, entity_id: input_boolean.sleep}]
  action: [{service: light.turn_off, target: {entity_id: all}}]'
SHIPPED_AUTOMATIONS='# shipped default - intentionally empty'

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "ok — $*"; }

# --- Build a fake hub repo: upstream with a release tag, plus a clone --------
UP="$WORK/upstream"
mkdir -p "$UP/docker/ha-config" "$UP/scripts/linux"
cd "$UP"
git init -q -b main
git config user.email t@t; git config user.name t
# Mirror the real repo: user_files/ is runtime state and is gitignored, so the
# auto-stash can't sweep away the hub's own data.
printf 'user_files/*\n!user_files/.gitkeep\n' > .gitignore
mkdir -p user_files && touch user_files/.gitkeep
printf '%s\n' "$SHIPPED_AUTOMATIONS" > docker/ha-config/automations.yaml
echo "v0" > marker.txt
cp "$REPO_ROOT/scripts/linux/ziggy-update.sh" scripts/linux/
git add -A && git commit -qm "the build the hub is currently running"
OLD_COMMIT="$(git rev-parse HEAD)"

# The release the hub is supposed to move TO. Annotated, like ship.sh makes.
echo "v1" > marker.txt
git commit -qam "release content"
git tag -a release-2099.01.01 -m "test release"

HUB="$WORK/hub"
git clone -q "$UP" "$HUB"
cd "$HUB"
git config user.email t@t; git config user.name t
# The hub sits on the older build, with the customer's own automations in HA's
# /config and a hand-pushed code edit — exactly the shape found in the field.
git checkout -q -b local "$OLD_COMMIT"
printf '%s\n' "$CUSTOMER_AUTOMATIONS" > docker/ha-config/automations.yaml
echo "hand-pushed change" >> marker.txt

# --- Stub out everything that would touch the real world ---------------------
BIN="$WORK/bin"; mkdir -p "$BIN"
cat > "$BIN/docker" <<'EOF'
#!/usr/bin/env bash
# compose build/up/pull succeed silently; `inspect` reports the target SHA so
# the updater's verification passes without a container.
if [ "${1:-}" = "inspect" ]; then echo "ZIGGY_GIT_SHA=$(cat /tmp/.ziggy-test-sha 2>/dev/null || echo unknown)"; fi
exit 0
EOF
cat > "$BIN/curl" <<'EOF'
#!/usr/bin/env bash
echo "{\"git_sha\":\"$(cat /tmp/.ziggy-test-sha 2>/dev/null || echo unknown)\"}"
EOF
cat > "$BIN/systemctl" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$BIN"/*
git -C "$UP" rev-parse "refs/tags/release-2099.01.01^{commit}" | tr -d '\n' > /tmp/.ziggy-test-sha

# --- Run the real updater ----------------------------------------------------
set +e
PATH="$BIN:$PATH" \
ZIGGY_ENV_FILE=/nonexistent \
ZIGGY_COHORT=production \
ZIGGY_REPO_DIR="$HUB" \
ZIGGY_INFRA_CHANNEL=off \
  bash "$HUB/scripts/linux/ziggy-update.sh" > "$WORK/update.log" 2>&1
rc=$?
set -e

# --- Assertions --------------------------------------------------------------
echo "--- updater output ---"; sed 's/^/    /' "$WORK/update.log"; echo "---"

want_sha="$(git -C "$UP" rev-parse 'refs/tags/release-2099.01.01^{commit}')"
got_sha="$(git -C "$HUB" rev-parse HEAD)"
[ "$want_sha" = "$got_sha" ] \
  || fail "hub did not land on the release tag (HEAD=$got_sha rc=$rc)"
pass "hub checked out the release tag"

got="$(cat "$HUB/docker/ha-config/automations.yaml")"
[ "$got" = "$CUSTOMER_AUTOMATIONS" ] \
  || fail "customer automations were LOST. File now contains:
$got"
pass "customer's automations survived the update"

ls -d "$HUB/user_files/ha-config-backups/"*/ >/dev/null 2>&1 \
  || fail "no backup of the live HA config was written"
pass "a timestamped backup of the live HA config exists"

grep -q "v1" "$HUB/marker.txt" \
  || fail "release content was not applied (marker.txt should come from the tag)"
grep -q "hand-pushed change" "$HUB/marker.txt" \
  && fail "hand-pushed code change survived — only ha-config should be protected"
pass "ordinary hand-pushed code was replaced by the release, as intended"

# --- Scenario 2: the update ABORTS midway -----------------------------------
# The dangerous window is between the auto-stash (which reverts the customer's
# automations to the shipped copy) and the post-checkout restore. If the script
# dies in there — dead network, failed fetch, systemd SIGTERM — the house would
# be left running the release's automations instead of its owner's. An EXIT trap
# is what closes it, so prove the trap actually fires.
HUB2="$WORK/hub2"
git clone -q "$UP" "$HUB2"
cd "$HUB2"
git config user.email t@t; git config user.name t
git checkout -q -b local "$OLD_COMMIT"
printf '%s\n' "$CUSTOMER_AUTOMATIONS" > docker/ha-config/automations.yaml

# Break `git fetch` by pointing origin at nothing. Everything before the fetch
# still runs — including the auto-stash that clears the customer's file.
git remote set-url origin "$WORK/does-not-exist"

set +e
PATH="$BIN:$PATH" \
ZIGGY_ENV_FILE=/nonexistent \
ZIGGY_COHORT=production \
ZIGGY_REPO_DIR="$HUB2" \
ZIGGY_INFRA_CHANNEL=off \
  bash "$HUB2/scripts/linux/ziggy-update.sh" > "$WORK/update2.log" 2>&1
rc2=$?
set -e

grep -q "ABORT" "$WORK/update2.log" || fail "scenario 2 did not actually abort (rc=$rc2)"
pass "update aborted as intended (fetch failure)"

got2="$(cat "$HUB2/docker/ha-config/automations.yaml")"
[ "$got2" = "$CUSTOMER_AUTOMATIONS" ] \
  || fail "automations LOST when the update aborted mid-flight. File now:
$got2"
pass "customer's automations survived an aborted update"

echo
echo "PASS — the updater ships the release without destroying the home."
