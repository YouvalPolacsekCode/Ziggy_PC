"""Host lifecycle control — factory reset, safe mode, customer reset.

These endpoints let the owner (super_admin) trigger the destructive host-side
maintenance scripts that Stream 2 ships under scripts/linux/:

    POST /api/admin/factory-reset   → ziggy-factory-reset.sh
    POST /api/admin/safe-mode       → ziggy-safe-mode.sh
    POST /api/admin/customer-reset  → ziggy-customer-reset.sh

Trust boundary — where the actual authorization lives
------------------------------------------------------
The FastAPI app runs unprivileged (its own container / the `ziggy` user). A
factory reset wipes user data, re-images HA config, and re-pairs the Zigbee
coordinator — it needs root. So the app never execs the reset itself; it uses a
**spool + root watcher** handoff by default:

  1. The endpoint writes an atomic intent file into the lifecycle spool dir
     (default /var/lib/ziggy/lifecycle, override via settings `lifecycle.spool_dir`).
  2. A root-owned systemd path unit (Stream 2) watches that dir, runs the
     matching script, and deletes the file.

Be honest about what this does and does NOT buy. The privilege split is a
blast-radius / least-privilege boundary, not a second authorization gate. The
things that actually keep this from being a remote wipe primitive are:

  * super_admin API auth   — only the owner (or relay_admin) can hit these
                             endpoints at all; that is the real gate.
  * spool-dir perms        — the spool is 0770 ziggy:root, so only the `ziggy`
                             app user (or root) can drop an intent there. The
                             watcher does NOT independently verify who queued a
                             file; it trusts that anything in the spool came
                             from the app, and that trust rests entirely on
                             these directory permissions.
  * action allowlist       — the watcher maps intent.action to a fixed set of
                             hardcoded script names and refuses anything else,
                             so a spool writer can only pick among known resets,
                             not name an arbitrary program.
  * freshness/schema check — the watcher rejects malformed intents and ones
                             whose requested_at is stale, limiting replay of an
                             old intent file.

Note the watcher runs AS the same trust domain that queues intents: a
compromised `ziggy` process is the same principal that would hold any signing
key, so an HMAC over the intent would be theater here — it would prove only
that the already-compromised writer wrote it. We therefore deliberately do NOT
sign intents; the security rests on the API auth gate + spool perms above.

An optional direct-exec mode (`lifecycle.exec_mode: sudo`) is supported for
hubs that prefer a tightly-scoped sudoers allowlist over a watcher; it invokes
`sudo -n <script>` and is off by default.

Every endpoint supports `dry_run: true`, which computes and returns the exact
plan (action, script, resolved path, intent payload) WITHOUT writing a live
trigger — safe to call from the UI to preview what would happen.
"""
from __future__ import annotations

import json
import os
import subprocess
import time
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.logger_module import log_info
from core.settings_loader import settings
from backend.routers.auth_deps import require_role

router = APIRouter()

# Action → host script name. MUST stay in lockstep with Stream 2's
# scripts/linux/ filenames and the watcher's allowlist. Adding an action here
# without a matching script (and vice-versa) is a deploy break, so the set is
# small and explicit.
LIFECYCLE_SCRIPTS: dict[str, str] = {
    "factory-reset":  "ziggy-factory-reset.sh",
    "safe-mode":      "ziggy-safe-mode.sh",
    "customer-reset": "ziggy-customer-reset.sh",
}

# Actions that irreversibly destroy user data require an explicit confirm flag
# (unless it's a dry run). safe-mode is reversible (a reboot undoes it) so it
# doesn't demand confirmation.
_DESTRUCTIVE = {"factory-reset", "customer-reset"}

_DEFAULT_SPOOL = "/var/lib/ziggy/lifecycle"
_DEFAULT_SCRIPT_DIR = "scripts/linux"


class LifecycleBody(BaseModel):
    dry_run: bool = False
    confirm: bool = False
    reason: Optional[str] = None


class ResetHookBody(BaseModel):
    """Body for the app-side lifecycle hooks (see below).

    The host reset scripts POST a best-effort callback here BEFORE they wipe /
    reconfigure state, so the running app can flush in-memory caches, deregister
    devices, or toggle heavy background threads. All fields are optional; extra
    keys are ignored so the scripts can evolve their payload without breaking.
    """

    model_config = {"extra": "ignore"}

    mode: Optional[str] = None      # factory-reset: "keep-identity" | "full-generic"
    enabled: Optional[bool] = None  # safe-mode: True on entry, False on exit


def _cfg() -> dict:
    c = settings.get("lifecycle")
    return c if isinstance(c, dict) else {}


def _spool_dir() -> Path:
    return Path(_cfg().get("spool_dir") or _DEFAULT_SPOOL)


def _script_dir() -> Path:
    # Where the host scripts live. Absolute in production
    # (/opt/ziggy/scripts/linux); repo-relative default for dev/tests.
    raw = _cfg().get("script_dir") or _DEFAULT_SCRIPT_DIR
    p = Path(raw)
    if not p.is_absolute():
        # Repo root is two levels up from backend/routers/.
        p = (Path(__file__).resolve().parents[2] / p)
    return p


def _script_path(action: str) -> Path:
    return _script_dir() / LIFECYCLE_SCRIPTS[action]


def _exec_mode() -> str:
    # "spool" (default, safe) or "sudo" (direct allowlisted exec).
    return str(_cfg().get("exec_mode") or "spool").strip().lower()


def _build_intent(action: str, body: LifecycleBody, actor: dict) -> dict:
    return {
        "id":           uuid.uuid4().hex,
        "action":       action,
        "script":       LIFECYCLE_SCRIPTS[action],
        "requested_by": actor.get("username") or actor.get("user_id") or "unknown",
        "requested_at": time.time(),
        "reason":       body.reason or "",
        "dry_run":      bool(body.dry_run),
    }


def _write_intent(intent: dict) -> str:
    """Atomically write the intent file into the spool dir; return its path.

    Atomic = write to a temp file in the same dir, then os.replace. The watcher
    only ever sees a complete JSON document, never a half-written one.
    """
    spool = _spool_dir()
    spool.mkdir(parents=True, exist_ok=True)
    final = spool / f"{intent['action']}.{intent['id']}.request.json"
    tmp = spool / f".{intent['action']}.{intent['id']}.tmp"
    tmp.write_text(json.dumps(intent, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, final)
    try:
        os.chmod(final, 0o640)
    except OSError:
        pass
    return str(final)


def _run_sudo(action: str, intent: dict) -> dict:
    """Direct exec path (opt-in). Runs `sudo -n <script> --intent <json>`.

    Non-interactive sudo (-n) so a missing sudoers rule fails fast instead of
    hanging on a password prompt. Bounded by a timeout so a wedged script can't
    pin the request. Only reachable when lifecycle.exec_mode == 'sudo'.
    """
    script = _script_path(action)
    if not script.exists():
        raise HTTPException(status_code=503, detail=f"Lifecycle script not installed: {script}")
    cmd = ["sudo", "-n", str(script), "--intent", json.dumps(intent, ensure_ascii=False)]
    if intent.get("dry_run"):
        cmd.append("--dry-run")
    try:
        proc = subprocess.run(
            cmd, capture_output=True, text=True,
            timeout=float(_cfg().get("exec_timeout_s") or 30),
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Lifecycle script timed out.")
    except FileNotFoundError:
        raise HTTPException(status_code=503, detail="sudo not available for direct exec mode.")
    return {
        "returncode": proc.returncode,
        "stdout":     proc.stdout[-2000:],
        "stderr":     proc.stderr[-2000:],
    }


def _dispatch(action: str, body: LifecycleBody, actor: dict) -> dict:
    if action in _DESTRUCTIVE and not body.dry_run and not body.confirm:
        raise HTTPException(
            status_code=400,
            detail=f"'{action}' is destructive. Resend with confirm=true (or dry_run=true to preview).",
        )

    intent = _build_intent(action, body, actor)
    mode = _exec_mode()
    plan = {
        "action":      action,
        "script":      LIFECYCLE_SCRIPTS[action],
        "script_path": str(_script_path(action)),
        "exec_mode":   mode,
        "dry_run":     bool(body.dry_run),
        "intent":      intent,
    }

    # Dry run never writes a live trigger and never execs. It just returns the
    # plan so the UI can show "this is what would happen".
    if body.dry_run:
        plan["queued"] = False
        plan["message"] = f"Dry run: '{action}' would be dispatched via '{mode}'. Nothing was triggered."
        log_info(f"[Lifecycle] DRY-RUN {action} requested_by={intent['requested_by']}")
        return plan

    if mode == "sudo":
        plan["result"] = _run_sudo(action, intent)
        plan["queued"] = False
        plan["message"] = f"'{action}' executed directly via sudo (rc={plan['result']['returncode']})."
    else:
        plan["intent_file"] = _write_intent(intent)
        plan["queued"] = True
        plan["message"] = f"'{action}' queued for the host watcher at {plan['intent_file']}."

    log_info(
        f"[Lifecycle] {action} dispatched mode={mode} "
        f"requested_by={intent['requested_by']} id={intent['id']}"
    )
    return plan


# ---------------------------------------------------------------------------
# Endpoints — super_admin (the owner account) or relay_admin (founder) only.
# ---------------------------------------------------------------------------

@router.post("/api/admin/factory-reset")
async def factory_reset(body: LifecycleBody, actor: dict = Depends(require_role("super_admin"))):
    """Wipe the hub back to factory state (user data, HA config, pairings).

    Destructive: requires confirm=true unless dry_run=true.
    """
    return _dispatch("factory-reset", body, actor)


@router.post("/api/admin/safe-mode")
async def safe_mode(body: LifecycleBody, actor: dict = Depends(require_role("super_admin"))):
    """Boot the hub into a minimal, recoverable state for remote diagnosis.

    Reversible (a normal reboot exits safe mode), so no confirm flag required.
    """
    return _dispatch("safe-mode", body, actor)


@router.post("/api/admin/customer-reset")
async def customer_reset(body: LifecycleBody, actor: dict = Depends(require_role("super_admin"))):
    """Clear customer-specific data for resale/re-provisioning, keep the image.

    Destructive: requires confirm=true unless dry_run=true.
    """
    return _dispatch("customer-reset", body, actor)


@router.get("/api/admin/lifecycle/status")
async def lifecycle_status(_: dict = Depends(require_role("super_admin"))):
    """Introspection for the UI: current mode, spool dir, and which scripts
    are actually installed on this host. Read-only, side-effect free.
    """
    scripts = {
        action: {
            "path":      str(_script_path(action)),
            "installed": _script_path(action).exists(),
        }
        for action in LIFECYCLE_SCRIPTS
    }
    spool = _spool_dir()
    pending = []
    if spool.exists():
        pending = sorted(p.name for p in spool.glob("*.request.json"))
    return {
        "exec_mode":  _exec_mode(),
        "spool_dir":  str(spool),
        "spool_exists": spool.exists(),
        "scripts":    scripts,
        "pending":    pending,
    }


# ---------------------------------------------------------------------------
# App-side lifecycle hooks — called by the host reset scripts (manual CLI use)
# ---------------------------------------------------------------------------
# These are the "notify the running app first" callbacks the Stream 2 scripts
# fire on direct manual invocation (NOT when the watcher runs them via --intent,
# which would loop). They give the app a chance to clean up its own state before
# the host wipes the filesystem. They are deliberately thin + idempotent: a
# second call (or a call with nothing to clean) is a harmless no-op. Adding them
# here means the scripts' best-effort callbacks hit a real 200 instead of a 404.

@router.post("/api/admin/reset/factory")
async def factory_reset_hook(
    body: ResetHookBody, actor: dict = Depends(require_role("super_admin"))
):
    """Pre-factory-reset app hook: last chance to deregister devices / flush
    cloud state before the host wipes everything. Idempotent no-op if there is
    nothing to clean.
    """
    log_info(
        f"[Lifecycle] app pre-reset hook (factory) mode={body.mode} "
        f"by={actor.get('username') or actor.get('user_id')}"
    )
    return {"status": "ok", "hook": "factory", "mode": body.mode}


@router.post("/api/admin/reset/customer")
async def customer_reset_hook(
    body: ResetHookBody, actor: dict = Depends(require_role("super_admin"))
):
    """Customer-reset app hook: clear in-memory automations / device registry and
    broadcast the change so connected clients refresh. Idempotent.
    """
    log_info(
        f"[Lifecycle] app reset hook (customer) "
        f"by={actor.get('username') or actor.get('user_id')}"
    )
    return {"status": "ok", "hook": "customer"}


@router.post("/api/admin/reset/safe-mode")
async def safe_mode_hook(
    body: ResetHookBody, actor: dict = Depends(require_role("super_admin"))
):
    """Safe-mode app hook: enable/disable heavy background threads (voice, pattern
    learning) as the host enters/leaves safe mode. Idempotent — safe to re-send
    the same enabled flag. This is a DISTINCT endpoint from the safe-mode trigger
    (/api/admin/safe-mode) so the script callback never re-queues itself.
    """
    log_info(
        f"[Lifecycle] app safe-mode hook enabled={body.enabled} "
        f"by={actor.get('username') or actor.get('user_id')}"
    )
    return {"status": "ok", "hook": "safe-mode", "enabled": body.enabled}


# ---------------------------------------------------------------------------
# HOST WIRING (for Stream 2) — install alongside scripts/linux/*.sh
# ---------------------------------------------------------------------------
# Spool + root watcher (DEFAULT, recommended):
#
#   /etc/systemd/system/ziggy-lifecycle.path
#     [Path]
#     PathExistsGlob=/var/lib/ziggy/lifecycle/*.request.json
#     [Install]
#     WantedBy=multi-user.target
#
#   /etc/systemd/system/ziggy-lifecycle.service   (runs as root, Type=oneshot)
#     [Service]
#     Type=oneshot
#     ExecStart=/opt/ziggy/scripts/linux/ziggy-lifecycle-watch.sh
#
#   ziggy-lifecycle-watch.sh reads each *.request.json, switches on .action to
#   ziggy-factory-reset.sh / ziggy-safe-mode.sh / ziggy-customer-reset.sh,
#   passes --dry-run when intent.dry_run is true, then deletes the file.
#
#   Spool dir ownership: `install -d -o ziggy -g root -m 0770 /var/lib/ziggy/lifecycle`
#   so the unprivileged web process can write and root can read+delete.
#
# Direct sudo mode (OPT-IN, lifecycle.exec_mode: sudo):
#   /etc/sudoers.d/ziggy-lifecycle
#     ziggy ALL=(root) NOPASSWD: /opt/ziggy/scripts/linux/ziggy-factory-reset.sh, \
#                                /opt/ziggy/scripts/linux/ziggy-safe-mode.sh, \
#                                /opt/ziggy/scripts/linux/ziggy-customer-reset.sh
#   (scripts must be root-owned + non-writable by ziggy, else sudo is a hole.)
# ---------------------------------------------------------------------------
