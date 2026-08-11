#!/usr/bin/env bash
# =============================================================================
# new-home.sh — build a new Ziggy home end to end, from the operator's Mac.
#
# WHAT THIS REPLACES
#   Building a home used to be a manual sequence with three hand-carried
#   secrets: a GitHub PAT pasted onto a command line, a secrets file scp'd to
#   the hub and then (hopefully) shredded, and a Cloudflare tunnel started by
#   hand afterwards. Each was a place to typo, to forget, or to leave a
#   credential behind on a box that ships to a customer.
#
#   This script owns all of it. You supply the hub's address and the home's
#   name; it does access, code, imaging, tunnel, pinning and verification.
#
# HOW SECRETS ARE HANDLED
#   * The GitHub token is minted from YOUR existing `gh` login at run time and
#     streamed to the hub over SSH stdin. It is never an argv element (so never
#     in `ps` or shell history) and never written to the hub's disk. The
#     bootstrap strips it back out of the git remote when it finishes.
#   * The imaging secrets are written ONLY to /dev/shm — a tmpfs, i.e. RAM.
#     They never touch the SSD, they are shredded the moment imaging ends, and
#     a power cut erases them regardless. An EXIT trap shreds them even if you
#     Ctrl-C mid-run.
#   * You are prompted for exactly one password: the hub's, once, to install
#     your SSH key. Everything after that is non-interactive.
#
# USAGE
#   ./scripts/new-home.sh --host ziggy@192.168.1.50 \
#                         --name "Tslil's Home" \
#                         --owner tslil@example.com \
#                         --zigbee --pair-seconds 180
#
#   ./scripts/new-home.sh --host ... --name ... --owner ... --dry-run
#   ./scripts/new-home.sh --host ... --resume        # continue a failed run
#
# OPTIONS
#   --host <[user@]ip>     the hub (default user: ziggy)
#   --name <"Home Name">   the home's display name
#   --owner <email>        the customer's email
#   --zigbee               image with the Zigbee stack on (default: off)
#   --pair-seconds <n>     hold permit-join open this long to pair kit devices
#   --matter               enable Matter/Thread (kit must ship a 2nd dongle)
#   --coordinator-ip <ip>  network SLZB-07 instead of USB
#   --coordinator-type     smlight | sonoff_e — sealed into the kit manifest
#   --coordinator-device   /dev/serial/by-id/… (auto-detected if omitted)
#   --secrets <path>       secrets file (default: newest ~/.ziggy/*secrets*.txt)
#   --keep-sudo            leave passwordless sudo in place after the run
#   --resume               resume imaging where it stopped
#   --dry-run              validate everything, change nothing
#
# EXIT: 0 the home is kit-ready; non-zero otherwise (nothing half-shipped).
# =============================================================================
set -uo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST=""
HOME_NAME=""
OWNER_EMAIL=""
SECRETS_FILE=""
ENABLE_ZIGBEE=0
PAIR_SECONDS=0
ENABLE_MATTER=0
COORDINATOR_IP=""
# Empty = infer from the dongle we find on the hub. Whatever ends up here is
# SEALED INTO THE KIT MANIFEST, so getting it wrong is not cosmetic.
COORDINATOR_TYPE=""
COORDINATOR_DEVICE=""
KEEP_SUDO=0
RESUME=0
DRY_RUN=0

# tmpfs — RAM only. Never the SSD.
REMOTE_ENV="/dev/shm/ziggy-imaging.env"
REMOTE_UNIT="ziggy-imaging"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)           HOST="${2:?}"; shift 2 ;;
    --name)           HOME_NAME="${2:?}"; shift 2 ;;
    --owner)          OWNER_EMAIL="${2:?}"; shift 2 ;;
    --secrets)        SECRETS_FILE="${2:?}"; shift 2 ;;
    --zigbee)         ENABLE_ZIGBEE=1; shift ;;
    --pair-seconds)   PAIR_SECONDS="${2:?}"; shift 2 ;;
    --matter)         ENABLE_MATTER=1; shift ;;
    --coordinator-ip) COORDINATOR_IP="${2:?}"; shift 2 ;;
    --coordinator-type)   COORDINATOR_TYPE="${2:?}"; shift 2 ;;
    --coordinator-device) COORDINATOR_DEVICE="${2:?}"; shift 2 ;;
    --keep-sudo)      KEEP_SUDO=1; shift ;;
    --resume)         RESUME=1; shift ;;
    --dry-run)        DRY_RUN=1; shift ;;
    -h|--help)        grep -E '^#( |$)' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

_say()  { printf '\n\033[1;36m▸ %s\033[0m\n' "$*" >&2; }
_log()  { printf '  %s\n' "$*" >&2; }
_ok()   { printf '  \033[32m✓\033[0m %s\n' "$*" >&2; }
_warn() { printf '  \033[33m!\033[0m %s\n' "$*" >&2; }
_die()  { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[[ -n "$HOST" ]] || _die "--host is required (e.g. --host ziggy@192.168.1.50)"
[[ "$HOST" == *@* ]] || HOST="ziggy@$HOST"
[[ -n "$HOME_NAME" ]] || _die "--name is required"
[[ -n "$OWNER_EMAIL" || "$DRY_RUN" == "1" ]] || _die "--owner is required"

# Validate here, on the Mac. The seal step rejects a bad value too, but that is
# eight steps and several minutes into a run that then has to be resumed.
if [[ -n "$COORDINATOR_TYPE" && "$COORDINATOR_TYPE" != "smlight" && "$COORDINATOR_TYPE" != "sonoff_e" ]]; then
  _die "--coordinator-type must be 'smlight' or 'sonoff_e' (got '$COORDINATOR_TYPE')"
fi

SSH_OPTS=(-o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new)
_ssh()  { ssh "${SSH_OPTS[@]}" -o BatchMode=yes "$HOST" "$@"; }
_ssh_i() { ssh "${SSH_OPTS[@]}" "$HOST" "$@"; }   # may prompt for a password

# Shred the RAM-backed secrets on the hub no matter how this script exits.
_cleanup() {
  [[ "$DRY_RUN" == "1" ]] && return 0
  _ssh "sudo -n shred -u $REMOTE_ENV 2>/dev/null || sudo -n rm -f $REMOTE_ENV 2>/dev/null || true" >/dev/null 2>&1 || true
}
trap _cleanup EXIT INT TERM

# ═══════════════════════════════════════════════════════════════════════════
# 1. PREFLIGHT — fail on the Mac, before touching the hub
# ═══════════════════════════════════════════════════════════════════════════
_say "Preflight"

command -v ssh >/dev/null || _die "ssh not found"

# --- the GitHub token, minted from your existing gh login -------------------
GH_TOKEN_VALUE=""
if command -v gh >/dev/null 2>&1; then
  GH_TOKEN_VALUE="$(gh auth token 2>/dev/null || true)"
fi
if [[ -z "$GH_TOKEN_VALUE" ]]; then
  GH_TOKEN_VALUE="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
fi
if [[ -z "$GH_TOKEN_VALUE" ]]; then
  _die "No GitHub token. Run 'gh auth login' once on this Mac (preferred — the token is then minted per run and never stored), or export GH_TOKEN."
fi
_ok "GitHub token sourced from ${GH_TOKEN:+environment}${GH_TOKEN:-the gh CLI} (never written to the hub)"

# --- the imaging secrets ---------------------------------------------------
if [[ -z "$SECRETS_FILE" ]]; then
  # newest ~/.ziggy/*secrets*.txt — same convention scripts/fleet-health.py uses
  SECRETS_FILE="$(ls -t "$HOME"/.ziggy/*secrets*.txt 2>/dev/null | head -1 || true)"
fi
[[ -n "$SECRETS_FILE" && -f "$SECRETS_FILE" ]] \
  || _die "No secrets file. Expected ~/.ziggy/<name>-secrets.txt, or pass --secrets <path>."

REQUIRED_KEYS=(RELAY_ADMIN_EMAIL RELAY_ADMIN_PASSWORD MASTER_KEY_B64 B2_KEY_ID B2_APP_KEY)
missing=()
for k in "${REQUIRED_KEYS[@]}"; do
  grep -qE "^[[:space:]]*$k[[:space:]]*=" "$SECRETS_FILE" || missing+=("$k")
done
[[ ${#missing[@]} -eq 0 ]] || _die "secrets file $SECRETS_FILE is missing: ${missing[*]}"
_ok "secrets file validated: $SECRETS_FILE (${#REQUIRED_KEYS[@]} required keys present)"

# --- the code we are about to ship ----------------------------------------
git -C "$REPO_DIR" fetch --quiet --tags origin 2>/dev/null || _warn "could not fetch tags (offline?)"
TARGET_TAG="$(git -C "$REPO_DIR" for-each-ref --sort=-creatordate \
                --format='%(refname:short)' --count=1 'refs/tags/release-*' 2>/dev/null || true)"
[[ -n "$TARGET_TAG" ]] || _die "no release-* tag exists — cut one with ./scripts/ship.sh before building a home"
_ok "new home will be imaged at $TARGET_TAG ($(git -C "$REPO_DIR" rev-parse --short "$TARGET_TAG^{commit}" 2>/dev/null))"

_log "host        : $HOST"
_log "home name   : $HOME_NAME"
_log "owner       : ${OWNER_EMAIL:-<none>}"
_log "zigbee      : $([[ $ENABLE_ZIGBEE == 1 ]] && echo "on (pair window ${PAIR_SECONDS}s)" || echo off)"
_log "matter      : $([[ $ENABLE_MATTER == 1 ]] && echo on || echo off)"

if [[ "$DRY_RUN" == "1" ]]; then
  _say "Dry run — validating the hub is reachable, then stopping"
  if _ssh 'echo ok' >/dev/null 2>&1; then
    _ok "hub reachable over SSH with key auth"
  else
    _warn "hub not reachable with key auth yet (the real run installs your key)"
  fi
  _ok "dry run complete — nothing was changed"
  exit 0
fi

# ═══════════════════════════════════════════════════════════════════════════
# 2. ACCESS — your key + passwordless sudo. The only password prompt.
# ═══════════════════════════════════════════════════════════════════════════
_say "Access"

if ! _ssh 'echo ok' >/dev/null 2>&1; then
  _log "installing your SSH key on the hub (you will be asked for the hub's password once)…"
  if command -v ssh-copy-id >/dev/null 2>&1; then
    ssh-copy-id "${SSH_OPTS[@]}" "$HOST" >/dev/null 2>&1 || _die "ssh-copy-id failed — check the address and password"
  else
    _die "ssh-copy-id not found; install it or add your key to the hub manually"
  fi
  _ssh 'echo ok' >/dev/null 2>&1 || _die "key auth still failing after ssh-copy-id"
fi
_ok "SSH key auth working"

if ! _ssh 'sudo -n true' >/dev/null 2>&1; then
  _log "granting passwordless sudo (needed for a non-interactive imaging run)…"
  # Interactive: the operator types the hub password once, here and nowhere else.
  _ssh_i 'echo "'"${HOST%@*}"' ALL=(ALL) NOPASSWD:ALL" | sudo tee /etc/sudoers.d/ziggy-nopasswd >/dev/null && sudo chmod 440 /etc/sudoers.d/ziggy-nopasswd' \
    || _die "could not grant passwordless sudo"
  _ssh 'sudo -n true' >/dev/null 2>&1 || _die "passwordless sudo still not working"
fi
_ok "passwordless sudo available"

# Remove any secrets a previous, manual run left lying on this box.
_ssh 'for f in ~/canary-secrets.txt ~/*secrets*.txt; do [ -f "$f" ] && (shred -u "$f" 2>/dev/null || rm -f "$f"); done; true' >/dev/null 2>&1 || true
_ok "cleared any secrets left on the hub by earlier runs"

# ═══════════════════════════════════════════════════════════════════════════
# 3. CODE — bootstrap the hub at the newest release tag
# ═══════════════════════════════════════════════════════════════════════════
_say "Code"

if _ssh 'test -d /opt/ziggy/.git' >/dev/null 2>&1; then
  _ok "/opt/ziggy already present — refreshing it to the newest release tag"
fi

# The token is prepended to the script text and fed over stdin. It is never an
# argv element and never lands on the hub's filesystem.
BOOTSTRAP="$REPO_DIR/scripts/canary/hub-bootstrap.sh"
[[ -f "$BOOTSTRAP" ]] || _die "missing $BOOTSTRAP"

if ! { printf 'export GH_TOKEN=%q\n' "$GH_TOKEN_VALUE"; cat "$BOOTSTRAP"; } \
     | _ssh 'sudo -n bash -s'; then
  _die "bootstrap failed on the hub"
fi

ON_HUB_REF="$(_ssh 'cd /opt/ziggy && git describe --tags --always 2>/dev/null' 2>/dev/null | tr -d '\r')"
_ok "hub code at: $ON_HUB_REF"
if [[ "$ON_HUB_REF" != "$TARGET_TAG" ]]; then
  _warn "hub landed on '$ON_HUB_REF' but this Mac's newest tag is '$TARGET_TAG' — check that the tag is pushed to origin"
fi

# ═══════════════════════════════════════════════════════════════════════════
# 3b. COORDINATOR — identify the Zigbee dongle before anything is sealed
# ───────────────────────────────────────────────────────────────────────────
# COORDINATOR_TYPE is written into /etc/ziggy/kit_manifest.yaml at the seal
# step, and the manifest is what the kit IS. Left unset, imaging silently
# defaults to `smlight` and to a hardcoded *Sonoff* by-id device path — so a
# mismatched kit would seal a manifest that describes hardware it does not have,
# and a USB SLZB-07 would be pointed at a device node that does not exist.
# Detect it instead of defaulting to it.
# ═══════════════════════════════════════════════════════════════════════════
if [[ "$ENABLE_ZIGBEE" == "1" && -z "$COORDINATOR_IP" ]]; then
  _say "Coordinator"
  if [[ -z "$COORDINATOR_DEVICE" ]]; then
    # No mapfile: macOS still ships bash 3.2 and this runs on the operator's Mac.
    _devs=()
    while IFS= read -r _line; do
      [[ -n "$_line" ]] && _devs+=("$_line")
    done < <(_ssh 'ls -1 /dev/serial/by-id/ 2>/dev/null' 2>/dev/null | tr -d '\r')
    if [[ ${#_devs[@]} -eq 0 ]]; then
      _die "Zigbee requested but no USB serial device found on the hub. Is the coordinator plugged in? (check: ssh $HOST 'ls -l /dev/serial/by-id/')"
    fi
    # Prefer a recognisable coordinator over any other serial gadget present.
    for d in "${_devs[@]}"; do
      case "$d" in
        *SLZB-07*|*SMLIGHT*) COORDINATOR_DEVICE="/dev/serial/by-id/$d"; [[ -z "$COORDINATOR_TYPE" ]] && COORDINATOR_TYPE="smlight"; break ;;
        *Sonoff_Zigbee*|*Itead*) COORDINATOR_DEVICE="/dev/serial/by-id/$d"; [[ -z "$COORDINATOR_TYPE" ]] && COORDINATOR_TYPE="sonoff_e"; break ;;
      esac
    done
    if [[ -z "$COORDINATOR_DEVICE" ]]; then
      _warn "found serial devices but none recognisable as a Zigbee coordinator:"
      for d in "${_devs[@]}"; do _log "  $d"; done
      _die "pass --coordinator-device /dev/serial/by-id/<one of the above> and --coordinator-type smlight|sonoff_e"
    fi
  fi
  [[ -n "$COORDINATOR_TYPE" ]] || COORDINATOR_TYPE="smlight"
  _ok "coordinator: $COORDINATOR_TYPE"
  _log "device: $COORDINATOR_DEVICE"
elif [[ -n "$COORDINATOR_IP" ]]; then
  # Network SLZB-07: no local device node, z2m talks tcp://.
  [[ -n "$COORDINATOR_TYPE" ]] || COORDINATOR_TYPE="smlight"
  _log "network coordinator at $COORDINATOR_IP (type $COORDINATOR_TYPE)"
fi

# ═══════════════════════════════════════════════════════════════════════════
# 4. IMAGE — secrets into RAM, imaging as a detached systemd unit
# ═══════════════════════════════════════════════════════════════════════════
_say "Image"

# Build the env in memory here, ship it to the hub's tmpfs, never to disk.
IMAGING_ENV="$(
  cat "$SECRETS_FILE"
  printf 'HOME_NAME=%s\n' "$HOME_NAME"
  printf 'OWNER_EMAIL=%s\n' "$OWNER_EMAIL"
  printf 'ENABLE_ZIGBEE=%s\n' "$ENABLE_ZIGBEE"
  printf 'ZIGBEE_PAIR_SECONDS=%s\n' "$PAIR_SECONDS"
  printf 'ENABLE_MATTER=%s\n' "$ENABLE_MATTER"
  [[ -n "$COORDINATOR_IP" ]]     && printf 'COORDINATOR_IP=%s\n' "$COORDINATOR_IP"
  [[ -n "$COORDINATOR_TYPE" ]]   && printf 'COORDINATOR_TYPE=%s\n' "$COORDINATOR_TYPE"
  [[ -n "$COORDINATOR_DEVICE" ]] && printf 'ZIGBEE_COORDINATOR_DEVICE=%s\n' "$COORDINATOR_DEVICE"
)"

if ! printf '%s\n' "$IMAGING_ENV" \
     | _ssh "sudo -n install -m 600 /dev/null $REMOTE_ENV && sudo -n tee $REMOTE_ENV >/dev/null"; then
  _die "could not stage the imaging environment on the hub"
fi
_ok "imaging secrets staged in $REMOTE_ENV (tmpfs — RAM only, shredded when this run ends)"

RESUME_FLAG=""
[[ "$RESUME" == "1" ]] && RESUME_FLAG="--resume"

# Always dry-run first: it validates every input against the real relay
# without provisioning anything, which is far cheaper than discovering a bad
# B2 key at step 7 of a real run.
_log "validating inputs with an imaging dry run…"
if ! _ssh "sudo -n bash -c 'set -a; . $REMOTE_ENV; set +a; cd /opt/ziggy && ./scripts/factory/ziggy-image-device.sh --dry-run'" 2>&1 | sed 's/^/    /'; then
  _die "imaging dry run failed — fix the reported input and re-run"
fi
_ok "dry run clean"

# The real run goes into a detached systemd unit. Imaging reconfigures the
# network (network-pin) and restarts containers; if that briefly bounces the
# link, a foreground SSH command would die halfway through a half-imaged hub.
# As a systemd unit it survives, and we just re-attach to the journal.
_log "starting the real imaging run (detached; safe to lose the SSH link)…"
_ssh "sudo -n systemctl reset-failed $REMOTE_UNIT 2>/dev/null; true" >/dev/null 2>&1 || true
if ! _ssh "sudo -n systemd-run --unit=$REMOTE_UNIT --collect --quiet \
      /bin/bash -c 'set -a; . $REMOTE_ENV; set +a; cd /opt/ziggy && exec ./scripts/factory/ziggy-image-device.sh $RESUME_FLAG'"; then
  _die "could not start the imaging unit"
fi

_log "streaming imaging output (Ctrl-C detaches the log, the run continues)…"
_ssh "sudo -n journalctl -u $REMOTE_UNIT -f --no-pager -o cat" 2>/dev/null | sed 's/^/    /' &
TAIL_PID=$!

# Wait for the unit to finish, reconnecting if the link drops.
IMAGING_RC=""
while :; do
  state="$(_ssh "systemctl show -p SubState --value $REMOTE_UNIT 2>/dev/null" 2>/dev/null | tr -d '\r')"
  if [[ "$state" == "exited" || "$state" == "failed" || "$state" == "dead" ]]; then
    IMAGING_RC="$(_ssh "systemctl show -p ExecMainStatus --value $REMOTE_UNIT 2>/dev/null" 2>/dev/null | tr -d '\r')"
    break
  fi
  sleep 5
done
kill "$TAIL_PID" >/dev/null 2>&1 || true
wait "$TAIL_PID" 2>/dev/null || true

_cleanup
trap - EXIT INT TERM
_ok "imaging secrets shredded from the hub"

[[ "$IMAGING_RC" == "0" ]] || _die "imaging failed (exit $IMAGING_RC). Inspect: ssh $HOST 'sudo journalctl -u $REMOTE_UNIT --no-pager'. Then re-run this script with --resume."
_ok "imaging completed"

# ═══════════════════════════════════════════════════════════════════════════
# 5. VERIFY — prove the things that used to be assumed
# ═══════════════════════════════════════════════════════════════════════════
_say "Verify"

_check() {  # label, remote command
  if _ssh "$2" >/dev/null 2>&1; then _ok "$1"; return 0; else _warn "$1 — FAILED"; return 1; fi
}
FAILED=0
_check "Ziggy backend healthy"        'test "$(curl -s -o /dev/null -w %{http_code} http://localhost:8001/health)" = 200' || FAILED=1
_check "Cloudflare connector running" 'systemctl is-active --quiet ziggy-tunnel.service'  || FAILED=1
_check "OTA timer enabled"            'systemctl is-enabled --quiet ziggy-update.timer'   || FAILED=1
_check "Network guard enabled"        'systemctl is-enabled --quiet ziggy-network-guard.service' || FAILED=1
_check "Stack service enabled"        'systemctl is-enabled --quiet ziggy.service'        || FAILED=1

COHORT="$(_ssh 'sudo -n sed -n "s/^ZIGGY_COHORT=//p" /etc/ziggy/ziggy.env' 2>/dev/null | tr -d '\r')"
PINNED="$(_ssh 'test -f /etc/netplan/60-ziggy-static.yaml && echo yes || echo no' 2>/dev/null | tr -d '\r')"
MDNS="$(_ssh 'hostname' 2>/dev/null | tr -d '\r')"

_log "cohort      : ${COHORT:-<unset>}"
_log "release     : $ON_HUB_REF"
_log "address     : $(_ssh 'hostname -I 2>/dev/null | awk "{print \$1}"' 2>/dev/null | tr -d '\r') (pinned: $PINNED)"
_log "mdns        : ${MDNS}.local"

if [[ "$KEEP_SUDO" != "1" ]]; then
  _ssh 'sudo -n rm -f /etc/sudoers.d/ziggy-nopasswd' >/dev/null 2>&1 \
    && _ok "passwordless sudo revoked" \
    || _warn "could not revoke passwordless sudo — remove /etc/sudoers.d/ziggy-nopasswd by hand"
fi

echo
if [[ "$FAILED" == "0" ]]; then
  printf '\033[32m✓ %s is kit-ready on %s\033[0m\n' "$HOME_NAME" "$ON_HUB_REF" >&2
  printf '  It will follow the release channel automatically (cohort=%s).\n' "${COHORT:-production}" >&2
  printf '  Confirm it joins the fleet in ~5 min: ./scripts/fleet-health.py\n' >&2
  exit 0
else
  printf '\033[31m✗ %s imaged but some checks failed — see above. Do not ship yet.\033[0m\n' "$HOME_NAME" >&2
  exit 1
fi
