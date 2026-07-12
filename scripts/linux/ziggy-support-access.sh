#!/usr/bin/env bash
# =============================================================================
# ziggy-support-access.sh — on-demand founder SSH support login (Ubuntu hub).
#
# Enables a locked-down `ziggy-support` login ONLY for the duration of a
# support session, then revokes it. The login is reachable exclusively through
# the per-home Cloudflare Access SSH ingress that the relay provisions
# (ssh-<home_id>.<domain> → ssh://localhost:22); there is NO inbound port and
# NO standing remote access when a session is not active.
#
# Security model:
#   * The `ziggy-support` account exists but is LOCKED and holds NO authorized
#     key when no session is active — logging in is impossible.
#   * --enable installs the founder public key (from --pubkey / env, never
#     hard-coded) into ziggy-support's authorized_keys with restrictive
#     forced-options, unlocks the account, and schedules an auto-revoke timer.
#     --enable FAILS HARD (non-zero, nothing armed) if it cannot schedule that
#     auto-revoke — the account is never left unlocked without a self-heal timer.
#   * --disable removes the key, locks the account, and cancels the timer.
#   * A per-user sshd drop-in restricts ONLY ziggy-support (no forwarding, no
#     X11, key-only). It never relaxes anything for other users, so normal
#     security is unchanged whether or not a session is active.
#   * NO supplementary groups by default. ziggy-support is a plain, unprivileged
#     login. Extra groups are opt-in via ZIGGY_SUPPORT_GROUPS (comma-separated).
#     WARNING: adding `docker` grants host-root-equivalent access (the docker
#     socket == root); only set it when that is genuinely required.
#
# Idempotent. --dry-run prints the full plan and mutates nothing.
#
#   sudo ZIGGY_SUPPORT_PUBKEY="ssh-ed25519 AAAA... founder" \
#        ./ziggy-support-access.sh --enable --ttl 60
#   sudo ./ziggy-support-access.sh --enable --pubkey /root/founder.pub --dry-run
#   sudo ./ziggy-support-access.sh --disable
#   sudo ./ziggy-support-access.sh --status
# =============================================================================
set -uo pipefail

# --- Defaults / config -------------------------------------------------------
SUPPORT_USER="${ZIGGY_SUPPORT_USER:-ziggy-support}"
# Supplementary groups are OPT-IN. Default is none: ziggy-support is a plain,
# unprivileged login. `docker` == host root (docker socket), so it is NOT added
# unless the operator explicitly sets ZIGGY_SUPPORT_GROUPS (e.g. "docker").
SUPPORT_GROUPS="${ZIGGY_SUPPORT_GROUPS:-}"
SSHD_DROPIN="/etc/ssh/sshd_config.d/60-ziggy-support.conf"
DEFAULT_TTL_MIN="${ZIGGY_SUPPORT_TTL_MIN:-60}"     # auto-revoke after N minutes

ACTION=""
DRY_RUN=false
PUBKEY=""
PUBKEY_FILE=""
TTL_MIN="$DEFAULT_TTL_MIN"

usage() { grep -E '^#( |$)' "$0" | sed 's/^# \{0,1\}//' | head -40; }

while [ $# -gt 0 ]; do
  case "$1" in
    --enable)     ACTION="enable" ;;
    --disable)    ACTION="disable" ;;
    --status)     ACTION="status" ;;
    --dry-run)    DRY_RUN=true ;;
    --pubkey)     PUBKEY_FILE="${2:?--pubkey needs a file path}"; shift ;;
    --pubkey=*)   PUBKEY_FILE="${1#--pubkey=}" ;;
    --ttl)        TTL_MIN="${2:?--ttl needs minutes}"; shift ;;
    --ttl=*)      TTL_MIN="${1#--ttl=}" ;;
    -h|--help)    usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage; exit 2 ;;
  esac
  shift
done

if [ -z "$ACTION" ]; then
  echo "Specify one of --enable / --disable / --status (see --help)." >&2
  exit 2
fi

SUPPORT_HOME="/home/${SUPPORT_USER}"
AUTH_KEYS="${SUPPORT_HOME}/.ssh/authorized_keys"
TIMER_UNIT="ziggy-support-revoke.timer"

say()  { if $DRY_RUN; then echo "[dry-run] $*"; else echo "$*"; fi; }
run()  { if $DRY_RUN; then echo "[dry-run] + $*"; else "$@"; fi; }

# Root is required for real mutation (enable/disable); --status is read-only
# and a --dry-run can be previewed by anyone.
if [ "$ACTION" != "status" ] && ! $DRY_RUN && [ "$(id -u)" != "0" ]; then
  echo "Must run as root (sudo) for --${ACTION}. Use --dry-run to preview." >&2
  exit 1
fi

# --- Key-only, forwarding-disabled sshd policy for ziggy-support -------------
# Restricts ONLY this user; other users are unaffected. Written once and left
# in place — harmless when the account is locked / has no key.
ensure_sshd_dropin() {
  local want
  want=$(cat <<EOF
# Managed by ziggy-support-access.sh — locked-down founder support login.
Match User ${SUPPORT_USER}
    PubkeyAuthentication yes
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    AllowTcpForwarding no
    AllowAgentForwarding no
    X11Forwarding no
    PermitTunnel no
    PermitTTY yes
EOF
)
  if [ -f "$SSHD_DROPIN" ] && [ "$(cat "$SSHD_DROPIN" 2>/dev/null)" = "$want" ]; then
    say "sshd drop-in already current: $SSHD_DROPIN"
    return 0
  fi
  say "write sshd drop-in: $SSHD_DROPIN"
  if ! $DRY_RUN; then
    mkdir -p "$(dirname "$SSHD_DROPIN")"
    printf '%s\n' "$want" > "$SSHD_DROPIN"
    chmod 0644 "$SSHD_DROPIN"
    if sshd -t 2>/dev/null; then
      systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
    else
      echo "WARNING: sshd -t failed; leaving service unreloaded." >&2
    fi
  fi
}

ensure_user() {
  if id "$SUPPORT_USER" >/dev/null 2>&1; then
    say "user ${SUPPORT_USER} exists"
  else
    say "create locked system user ${SUPPORT_USER} (home ${SUPPORT_HOME})"
    run useradd --create-home --shell /bin/bash "$SUPPORT_USER"
    run passwd -l "$SUPPORT_USER"   # no password login, ever
  fi
  # Supplementary groups (e.g. docker) so the founder can inspect the stack.
  local g
  for g in ${SUPPORT_GROUPS//,/ }; do
    if getent group "$g" >/dev/null 2>&1; then
      say "add ${SUPPORT_USER} to group ${g}"
      run usermod -aG "$g" "$SUPPORT_USER"
    fi
  done
}

read_pubkey() {
  if [ -n "$PUBKEY_FILE" ]; then
    [ -r "$PUBKEY_FILE" ] || { echo "Cannot read pubkey file: $PUBKEY_FILE" >&2; exit 1; }
    PUBKEY="$(cat "$PUBKEY_FILE")"
  elif [ -n "${ZIGGY_SUPPORT_PUBKEY:-}" ]; then
    PUBKEY="$ZIGGY_SUPPORT_PUBKEY"
  fi
  PUBKEY="$(printf '%s' "$PUBKEY" | tr -d '\r' | sed '/^$/d' | head -1)"
  case "$PUBKEY" in
    ssh-ed25519\ *|ssh-rsa\ *|ecdsa-*\ *|sk-*\ *) : ;;
    *) echo "No valid founder public key (via --pubkey FILE or ZIGGY_SUPPORT_PUBKEY env)." >&2
       exit 1 ;;
  esac
}

have_scheduler() {
  # True iff we have a mechanism to schedule the TTL auto-revoke.
  command -v systemd-run >/dev/null 2>&1 || command -v at >/dev/null 2>&1
}

require_scheduler() {
  # Fail-closed preflight: NEVER arm the account if we cannot guarantee an
  # auto-revoke. A forgotten session that never self-heals would leave the
  # founder key live indefinitely. Enforced even under --dry-run so the preview
  # honestly reflects that --enable would refuse on this host.
  if have_scheduler; then return 0; fi
  echo "ERROR: no auto-revoke scheduler available (need systemd-run or 'at')." >&2
  echo "Refusing to arm ${SUPPORT_USER}: an unrevocable support login is unsafe." >&2
  echo "Install 'at' (or run on a systemd host), then retry --enable." >&2
  exit 1
}

schedule_auto_revoke() {
  # Transient systemd timer that re-invokes this script's --disable after TTL,
  # so a forgotten session self-heals. Falls back to `at` if systemd-run absent.
  # Returns non-zero if scheduling fails so the caller can roll back (fail hard);
  # the account must never stay armed without a working auto-revoke.
  local self; self="$(readlink -f "$0")"
  say "schedule auto-revoke in ${TTL_MIN} min (unit ${TIMER_UNIT})"
  if $DRY_RUN; then return 0; fi
  if command -v systemd-run >/dev/null 2>&1; then
    systemctl stop "$TIMER_UNIT" 2>/dev/null || true
    if systemd-run --unit="${TIMER_UNIT%.timer}" --on-active="${TTL_MIN}min" \
        --timer-property=AccuracySec=30s \
        "$self" --disable >/dev/null 2>&1; then
      return 0
    fi
    echo "ERROR: failed to schedule systemd auto-revoke." >&2
    return 1
  elif command -v at >/dev/null 2>&1; then
    if echo "$self --disable" | at now + "${TTL_MIN}" minutes 2>/dev/null; then
      return 0
    fi
    echo "ERROR: failed to schedule 'at' auto-revoke." >&2
    return 1
  fi
  echo "ERROR: no systemd-run/at available; cannot guarantee auto-revoke." >&2
  return 1
}

cancel_auto_revoke() {
  say "cancel any pending auto-revoke timer"
  if $DRY_RUN; then return 0; fi
  systemctl stop "$TIMER_UNIT" 2>/dev/null || true
  systemctl reset-failed "${TIMER_UNIT%.timer}.service" 2>/dev/null || true
}

do_enable() {
  # Fail-closed preflight BEFORE arming anything: if we can't schedule the TTL
  # auto-revoke, refuse outright so no account is ever armed unrevocably.
  require_scheduler
  read_pubkey
  ensure_sshd_dropin
  ensure_user
  say "install founder key into ${AUTH_KEYS} (restrict,pty — no forwarding)"
  if ! $DRY_RUN; then
    install -d -m 0700 -o "$SUPPORT_USER" -g "$SUPPORT_USER" "$(dirname "$AUTH_KEYS")"
    # restrict = disable all forwarding/agent/x11/tunnel; pty re-enabled so the
    # founder still gets an interactive shell to debug the stack.
    printf 'restrict,pty %s\n' "$PUBKEY" > "$AUTH_KEYS"
    chmod 0600 "$AUTH_KEYS"
    chown "$SUPPORT_USER":"$SUPPORT_USER" "$AUTH_KEYS"
  fi
  say "unlock ${SUPPORT_USER} account for the session"
  run usermod --expiredate '' "$SUPPORT_USER"
  run chage -E -1 "$SUPPORT_USER"
  # Arm auto-revoke. If it fails (despite the preflight — e.g. a transient
  # systemd error), FAIL HARD: roll back to a locked, keyless account so no
  # unrevocable support login is ever left behind.
  if ! schedule_auto_revoke; then
    echo "ERROR: auto-revoke scheduling failed — rolling back to locked state." >&2
    do_disable
    exit 1
  fi
  echo
  say "ENABLED: founder may now 'cloudflared access ssh --user ${SUPPORT_USER}' for up to ${TTL_MIN} min."
}

do_disable() {
  cancel_auto_revoke
  if id "$SUPPORT_USER" >/dev/null 2>&1; then
    say "remove founder key (truncate ${AUTH_KEYS})"
    if ! $DRY_RUN && [ -e "$AUTH_KEYS" ]; then : > "$AUTH_KEYS"; fi
    say "lock + expire ${SUPPORT_USER} account"
    run usermod --expiredate 1 "$SUPPORT_USER"   # expired → login refused
    run passwd -l "$SUPPORT_USER"
    # Kill any live session so revoke is immediate, not next-login.
    say "terminate any live ${SUPPORT_USER} sessions"
    run pkill -KILL -u "$SUPPORT_USER" || true
  else
    say "user ${SUPPORT_USER} absent — nothing to revoke"
  fi
  echo
  say "DISABLED: no founder key present; ${SUPPORT_USER} locked. Normal security restored."
}

do_status() {
  echo "ziggy-support access status"
  echo "  user:        ${SUPPORT_USER}"
  if id "$SUPPORT_USER" >/dev/null 2>&1; then
    echo "  account:     present"
    if [ -s "$AUTH_KEYS" ]; then
      echo "  key:         PRESENT (session may be ACTIVE)"
    else
      echo "  key:         none (inactive)"
    fi
    passwd -S "$SUPPORT_USER" 2>/dev/null | awk '{print "  passwd:     ", $2}'
  else
    echo "  account:     absent (never provisioned)"
  fi
  echo "  sshd drop-in: $( [ -f "$SSHD_DROPIN" ] && echo present || echo absent )"
  if command -v systemctl >/dev/null 2>&1; then
    systemctl is-active "$TIMER_UNIT" >/dev/null 2>&1 \
      && echo "  auto-revoke: scheduled ($TIMER_UNIT)" \
      || echo "  auto-revoke: none pending"
  fi
}

case "$ACTION" in
  enable)  do_enable ;;
  disable) do_disable ;;
  status)  do_status ;;
esac
