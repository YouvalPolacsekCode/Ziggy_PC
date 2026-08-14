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
# Mirror the real repo after the 2026-08-14 fix: the home's own automations,
# scripts and scenes are CUSTOMER STATE and are gitignored, so a release
# checkout cannot overwrite them and the tree never goes dirty because of them.
# They used to be tracked and shipped as empty `[]` placeholders, which is how a
# checkout wiped a live home and a restore then propagated the emptiness.
printf 'automations.yaml\nscripts.yaml\nscenes.yaml\n' > docker/ha-config/.gitignore
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

# --- Scenario 3: the file is UNTRACKED, so a checkout cannot touch it --------
# The real fix for 2026-08-14. automations/scripts/scenes are customer state
# and are now gitignored, so the release checkout never overwrites them and
# nothing has to restore them. Prove the tree stays CLEAN too — the permanent
# dirtiness caused by restoring these files is what drove the auto-stash loop
# (2331 stashes at one every two minutes) that swept the FCM push credential
# out of config/ on 2026-08-10.
cd "$HUB"
git -C "$HUB" ls-files --error-unmatch docker/ha-config/automations.yaml >/dev/null 2>&1 \
  && fail "automations.yaml is still TRACKED — a checkout will keep clobbering it"
pass "the home's automations.yaml is not tracked by git"

git -C "$HUB" check-ignore -q docker/ha-config/automations.yaml \
  || fail "automations.yaml is untracked but NOT ignored — 'git stash -u' will still sweep it"
pass "automations.yaml is ignored, so 'git stash -u' leaves it alone"

dirty="$(git -C "$HUB" status --porcelain -- docker/ha-config/ | wc -l | tr -d ' ')"
[ "$dirty" = "0" ] \
  || fail "ha-config leaves the tree dirty ($dirty entries) — the stash loop will continue"
pass "a home with its own automations leaves the tree clean"

# --- Scenario 4: HA's include files are seeded when absent -------------------
# HA `!include`s automations/scripts/scenes and refuses to start without them.
# They are no longer in the repo, so a fresh clone has none.
HUB3="$WORK/hub3"
git clone -q "$UP" "$HUB3"
cd "$HUB3"
git config user.email t@t; git config user.name t
git checkout -q -b local "$OLD_COMMIT"
rm -f docker/ha-config/automations.yaml docker/ha-config/scripts.yaml docker/ha-config/scenes.yaml

set +e
PATH="$BIN:$PATH" ZIGGY_ENV_FILE=/nonexistent ZIGGY_COHORT=production \
ZIGGY_REPO_DIR="$HUB3" ZIGGY_INFRA_CHANNEL=off \
  bash "$HUB3/scripts/linux/ziggy-update.sh" > "$WORK/update3.log" 2>&1
set -e

for f in automations scripts scenes; do
  [ -f "$HUB3/docker/ha-config/$f.yaml" ] \
    || fail "$f.yaml was not seeded — Home Assistant would refuse to start"
done
pass "missing HA include files are seeded so Home Assistant can start"

# --- Scenario 5: a shrinking backup is refused -------------------------------
# The backup is taken at the START of a run. If anything emptied a protected
# file just before that, restoring it would re-apply the emptiness on every
# later cycle — which is precisely what kept the Canary at zero automations and
# clobbered three manual restores within ten seconds each.
HUB4="$WORK/hub4"
git clone -q "$UP" "$HUB4"
cd "$HUB4"
git config user.email t@t; git config user.name t
git checkout -q -b local "$OLD_COMMIT"
printf 'homeassistant:\n  name: A real config with content\n' > docker/ha-config/configuration.yaml
mkdir -p "$HUB4/user_files/ha-config-backups/EMPTY/docker/ha-config"
printf '' > "$HUB4/user_files/ha-config-backups/EMPTY/docker/ha-config/configuration.yaml"

set +e
PATH="$BIN:$PATH" ZIGGY_ENV_FILE=/nonexistent ZIGGY_COHORT=production \
ZIGGY_REPO_DIR="$HUB4" ZIGGY_INFRA_CHANNEL=off \
ZIGGY_FORCE_BACKUP_DIR="$HUB4/user_files/ha-config-backups/EMPTY" \
  bash "$HUB4/scripts/linux/ziggy-update.sh" > "$WORK/update4.log" 2>&1
set -e

[ -s "$HUB4/docker/ha-config/configuration.yaml" ] \
  || fail "a live configuration.yaml was replaced by an EMPTY backup"
pass "an empty backup is refused rather than restored over a good file"

# --- Scenario 6: THE MIGRATION -----------------------------------------------
# The dangerous one. A live hub is running an older build where automations.yaml
# is TRACKED, holding the customer's real automations as a local modification.
# It now updates to a release where that file is gitignored. `git checkout`
# removes a file that left the tree, so without care the upgrade itself would
# wipe every home on the fleet — the exact disaster this whole change exists to
# prevent, caused by the fix for it.
UPM="$WORK/upstream-mig"
mkdir -p "$UPM/docker/ha-config" "$UPM/scripts/linux"
cd "$UPM"
git init -q -b main
git config user.email t@t; git config user.name t
printf 'user_files/*\n!user_files/.gitkeep\n' > .gitignore
mkdir -p user_files && touch user_files/.gitkeep
# OLD world: the file is tracked and shipped empty.
printf '%s\n' "$SHIPPED_AUTOMATIONS" > docker/ha-config/automations.yaml
echo "v0" > marker.txt
cp "$REPO_ROOT/scripts/linux/ziggy-update.sh" scripts/linux/
git add -A && git commit -qm "old build: automations.yaml tracked"
OLD_MIG="$(git rev-parse HEAD)"

# NEW world: the file is removed from the index and ignored.
git rm -q --cached docker/ha-config/automations.yaml
printf 'automations.yaml\nscripts.yaml\nscenes.yaml\n' > docker/ha-config/.gitignore
echo "v1" > marker.txt
git add -A && git commit -qm "new build: automations.yaml is customer state"
git tag -a release-2099.02.02 -m "migration release"

HUB5="$WORK/hub5"
git clone -q "$UPM" "$HUB5"
cd "$HUB5"
git config user.email t@t; git config user.name t
git checkout -q -b local "$OLD_MIG"
printf '%s\n' "$CUSTOMER_AUTOMATIONS" > docker/ha-config/automations.yaml

git -C "$UPM" rev-parse "refs/tags/release-2099.02.02^{commit}" | tr -d '\n' > /tmp/.ziggy-test-sha
set +e
PATH="$BIN:$PATH" ZIGGY_ENV_FILE=/nonexistent ZIGGY_COHORT=production \
ZIGGY_REPO_DIR="$HUB5" ZIGGY_INFRA_CHANNEL=off \
  bash "$HUB5/scripts/linux/ziggy-update.sh" > "$WORK/update5.log" 2>&1
set -e

got5="$(cat "$HUB5/docker/ha-config/automations.yaml" 2>/dev/null || echo MISSING)"
[ "$got5" = "$CUSTOMER_AUTOMATIONS" ] \
  || { sed 's/^/    /' "$WORK/update5.log"; fail "MIGRATION WIPED the home's automations. File now:
$got5"; }
pass "upgrading from tracked to ignored keeps the customer's automations"

echo
echo "PASS — the updater ships the release without destroying the home."
