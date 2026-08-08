"""Wall-tablet capability policy — what a shared wall screen is allowed to do.

ADDITIVE: a sidecar keyed by the `tablet_id` the existing pairing flow already
issues. `dashboard_tablets.json` is never read for writing and its schema is
never modified, so a tablet paired for /hub keeps working there untouched.

Why a policy at all: a wall tablet is shared, always-on, and physically
reachable by everyone in the home including children and visitors. It cannot
carry a person's full permissions. So the tablet gets its own, narrower set,
and the sensitive parts of it sit behind a PIN.

Two layers:
    capabilities   what this tablet may do at all (a false here is invisible
                   in the UI *and* refused at the API)
    pin_required   capabilities that additionally need a PIN, which grants a
                   short-lived elevation rather than unlocking forever

Elevation is in-memory and dies with the process. That is deliberate: a hub
restart should re-lock the front door control, not leave it open because
someone typed a PIN yesterday.
"""
from __future__ import annotations

import asyncio
import contextvars
import hashlib
import hmac
import json
import secrets
import time
from pathlib import Path
from typing import Optional

from core.logger_module import log_error

# The wall tablet whose credential authenticated the request currently being
# served, or None. Set by the capability middleware, read by the action
# dispatcher so natural-language commands are gated by the same policy as
# button taps. A ContextVar (not a global) so concurrent requests on the same
# event loop can never see each other's identity.
current_tablet: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "ziggy_wall_tablet", default=None,
)

_FILE = Path(__file__).parent.parent / "user_files" / "wall_tablet_policy.json"
_LOCK = asyncio.Lock()

# Every capability the wall understands. A module or control declares one of
# these; anything not listed is unrestricted.
CAPABILITIES = (
    "lights", "climate", "media", "scenes", "lists",
    "cameras", "locks", "automations", "devices", "settings",
    # A wall panel is FURNITURE, not a person: it is bolted to a wall and never
    # leaves. Anything it contributes to presence is noise — and worse than
    # noise in practice, since a second person pinned to the same LAN host made
    # every arrival and departure fire twice. Denied by default and not offered
    # as something an admin can switch on, because there is no version of this
    # that is correct.
    "presence",
)

# What an unconfigured tablet gets. Chosen so a wall panel is immediately
# useful (lights, AC, music, lists, scenes) but cannot open a door, watch a
# camera, pair hardware, or change hub settings until an admin says so.
DEFAULT_CAPABILITIES = {
    "lights": True, "climate": True, "media": True, "scenes": True, "lists": True,
    "cameras": False, "locks": False, "automations": True, "devices": False, "settings": False,
    "presence": False,
}
DEFAULT_PIN_REQUIRED = ["locks", "cameras", "devices", "settings"]

# How long a correct PIN keeps a capability unlocked.
ELEVATION_TTL_S = 5 * 60

# Brute-force guard. A 4-digit PIN is 10k combinations; without a limit that
# falls in seconds over HTTP.
_PIN_ATTEMPT_MAX = 5
_PIN_ATTEMPT_WINDOW_S = 120

# tablet_id -> { capability: expires_at }
_elevations: dict[str, dict[str, float]] = {}
# tablet_id -> [attempt timestamps]
_pin_attempts: dict[str, list[float]] = {}


def _now() -> float:
    return time.time()


# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------

def _load() -> dict:
    if not _FILE.exists():
        return {}
    try:
        data = json.loads(_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception as e:
        log_error(f"[wall_policy] Read failed, starting empty: {e}")
        return {}


def _save(data: dict) -> None:
    try:
        _FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp = _FILE.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
        tmp.replace(_FILE)
    except Exception as e:
        log_error(f"[wall_policy] Write failed: {e}")


# ---------------------------------------------------------------------------
# PIN hashing
# ---------------------------------------------------------------------------
# PBKDF2 rather than a bare digest: a 4-6 digit PIN has almost no entropy, so
# the only meaningful defence if the file leaks is making each guess expensive.

def _hash_pin(pin: str, salt: Optional[str] = None) -> str:
    salt = salt or secrets.token_hex(8)
    dk = hashlib.pbkdf2_hmac("sha256", pin.encode(), salt.encode(), 120_000)
    return f"pbkdf2${salt}${dk.hex()}"


def _verify_pin(pin: str, stored: str) -> bool:
    try:
        algo, salt, digest = stored.split("$", 2)
        if algo != "pbkdf2":
            return False
        dk = hashlib.pbkdf2_hmac("sha256", pin.encode(), salt.encode(), 120_000)
        return hmac.compare_digest(dk.hex(), digest)
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Tablet credentials
# ---------------------------------------------------------------------------
# A wall tablet authenticates AS a tablet, with its own token. This is the
# whole security model: restrictions keyed on a self-declared header are
# worthless, because anyone wanting more privilege simply omits the header.
# Binding identity to the credential means dropping it leaves you with no
# access at all rather than more.

def issue_token(tablet_id: str) -> str:
    """Mint a tablet credential. Returned in plaintext ONCE, stored hashed."""
    token = "zwt_" + secrets.token_urlsafe(32)
    data = _load()
    rec = data.get(tablet_id) or {}
    rec["token_hash"] = hashlib.sha256(token.encode()).hexdigest()
    data[tablet_id] = rec
    _save(data)
    return token


def resolve_token(token: Optional[str]) -> Optional[str]:
    """tablet_id for a presented credential, or None.

    SHA-256 rather than PBKDF2: unlike a 4-digit PIN this is 256 bits of
    entropy, so there is nothing to brute-force and the check sits on the hot
    path of every request. Compared in constant time regardless.
    """
    if not token or not token.startswith("zwt_"):
        return None
    digest = hashlib.sha256(token.encode()).hexdigest()
    for tablet_id, rec in _load().items():
        stored = (rec or {}).get("token_hash")
        if stored and hmac.compare_digest(stored, digest):
            return tablet_id
    return None


def default_policy() -> dict:
    return {
        "capabilities": dict(DEFAULT_CAPABILITIES),
        "pin_required": list(DEFAULT_PIN_REQUIRED),
        "has_pin": False,
    }


def unrestricted_policy() -> dict:
    """Everything allowed, nothing gated.

    What an UNPAIRED visitor to /wall gets. Such a session is not a wall panel
    — it is a signed-in person looking at the wall view in their browser, and
    they already hold their own account's permissions. Restricting them would
    be both pointless (no header is sent, so the server cannot enforce it
    anyway) and confusing: the Devices button would vanish with no explanation.

    The restrictions exist for a PAIRED tablet, because that is the one that
    hangs on a wall where anyone in the house can reach it.
    """
    return {
        "capabilities": {c: True for c in CAPABILITIES},
        "pin_required": [],
        "has_pin": False,
    }


async def get_policy(tablet_id: Optional[str]) -> dict:
    """Policy for a tablet. Never raises, never returns the PIN hash."""
    if not tablet_id:
        return unrestricted_policy()
    data = await asyncio.to_thread(_load)
    rec = data.get(tablet_id)
    if not rec:
        return default_policy()
    caps = dict(DEFAULT_CAPABILITIES)
    caps.update({k: bool(v) for k, v in (rec.get("capabilities") or {}).items() if k in CAPABILITIES})
    return {
        "capabilities": caps,
        "pin_required": [c for c in (rec.get("pin_required") or []) if c in CAPABILITIES],
        "has_pin": bool(rec.get("pin_hash")),
    }


async def set_policy(tablet_id: str, policy: dict) -> dict:
    """Admin write. Leaves any existing PIN hash alone — the PIN has its own
    endpoint so a policy edit can never silently clear it."""
    if not tablet_id:
        raise ValueError("tablet_id is required.")
    async with _LOCK:
        data = await asyncio.to_thread(_load)
        rec = data.get(tablet_id) or {}
        caps_in = (policy or {}).get("capabilities") or {}
        rec["capabilities"] = {
            k: bool(caps_in.get(k, DEFAULT_CAPABILITIES[k])) for k in CAPABILITIES
        }
        # Not negotiable — see the CAPABILITIES note. A wall panel that reports
        # presence corrupts every automation that asks "is anyone home?".
        rec["capabilities"]["presence"] = False
        req_in = (policy or {}).get("pin_required")
        if req_in is not None:
            rec["pin_required"] = [c for c in req_in if c in CAPABILITIES]
        data[tablet_id] = rec
        await asyncio.to_thread(_save, data)
    return await get_policy(tablet_id)


async def set_pin(tablet_id: str, pin: Optional[str]) -> bool:
    """Set or clear the PIN. Passing None/empty clears it, which also drops
    every pin_required gate to 'allowed' — otherwise clearing the PIN would
    lock the tablet out of its own capabilities with no way back."""
    if not tablet_id:
        raise ValueError("tablet_id is required.")
    if pin is not None and pin != "":
        if not pin.isdigit() or not (4 <= len(pin) <= 8):
            raise ValueError("PIN must be 4-8 digits.")
    async with _LOCK:
        data = await asyncio.to_thread(_load)
        rec = data.get(tablet_id) or {}
        if pin:
            rec["pin_hash"] = _hash_pin(pin)
        else:
            rec.pop("pin_hash", None)
            rec["pin_required"] = []
        data[tablet_id] = rec
        await asyncio.to_thread(_save, data)
    _elevations.pop(tablet_id, None)
    return True


def _rate_ok(tablet_id: str) -> bool:
    window = _now() - _PIN_ATTEMPT_WINDOW_S
    _pin_attempts[tablet_id] = [t for t in _pin_attempts.get(tablet_id, []) if t >= window]
    if len(_pin_attempts[tablet_id]) >= _PIN_ATTEMPT_MAX:
        return False
    _pin_attempts[tablet_id].append(_now())
    return True


async def verify_pin(tablet_id: str, capability: str, pin: str) -> dict:
    """Check a PIN and, on success, elevate that one capability for a while.

    Returns { ok, ttl_s } or raises PermissionError when rate-limited.
    """
    if not tablet_id:
        raise ValueError("tablet_id is required.")
    if not _rate_ok(tablet_id):
        raise PermissionError("Too many attempts. Wait a couple of minutes.")

    data = await asyncio.to_thread(_load)
    rec = data.get(tablet_id) or {}
    stored = rec.get("pin_hash")
    if not stored:
        return {"ok": False, "reason": "no_pin"}

    if not _verify_pin(pin or "", stored):
        return {"ok": False, "reason": "wrong"}

    # Correct PIN clears the attempt counter so a fat-fingered family member
    # isn't locked out right after succeeding.
    _pin_attempts.pop(tablet_id, None)
    _elevations.setdefault(tablet_id, {})[capability] = _now() + ELEVATION_TTL_S
    return {"ok": True, "ttl_s": ELEVATION_TTL_S}


def is_elevated(tablet_id: str, capability: str) -> bool:
    exp = (_elevations.get(tablet_id) or {}).get(capability)
    return bool(exp and exp > _now())


def drop_elevation(tablet_id: str) -> None:
    """Called when the tablet goes idle — walking away re-locks the door."""
    _elevations.pop(tablet_id, None)


async def delete_policy(tablet_id: str) -> bool:
    """Forget a tablet's policy entirely. Called on un-pair.

    Without this, un-pairing left the capability set AND the PIN hash on disk
    for a tablet id that no longer exists — so a reissued id would silently
    inherit a stranger's permissions and PIN.
    """
    if not tablet_id:
        return False
    drop_elevation(tablet_id)
    _pin_attempts.pop(tablet_id, None)
    async with _LOCK:
        data = await asyncio.to_thread(_load)
        if tablet_id not in data:
            return False
        del data[tablet_id]
        await asyncio.to_thread(_save, data)
        return True


# ---------------------------------------------------------------------------
# Intent-level enforcement
# ---------------------------------------------------------------------------
# Gating HTTP paths is an allowlist-by-omission over a large API surface, and
# it missed the most important door of all: Ziggy is a natural-language product,
# so "unlock the front door" typed into the assistant reached the lock without
# ever touching a lock-shaped URL. Every path — chat, voice, /api/intent,
# /api/intent/direct — funnels through core.action_parser.handle_intent, so
# that is where the check belongs.

# Home Assistant domain → capability. The single most important table here:
# Ziggy's generic `control_device` intent carries its target domain in params,
# which is how "unlock the front door" reaches a lock without any lock-shaped
# intent name existing.
_DOMAIN_CAPABILITY = {
    "lock":         "locks",
    "camera":       "cameras",
    "climate":      "climate",
    "water_heater": "climate",
    "media_player": "media",
    "light":        "lights",
    "switch":       "lights",
    "fan":          "lights",
    "cover":        "lights",
}

# Ziggy's actual intent vocabulary (core.action_parser._ALL_HANDLERS), mapped
# explicitly. Guessing from name fragments missed `control_device` entirely —
# the one that matters most.
_INTENT_CAPABILITY = {
    "toggle_light": "lights", "toggle_all_lights_in_room": "lights",
    "turn_off_all_lights": "lights", "set_light_brightness": "lights",
    "adjust_light_brightness": "lights", "set_light_color": "lights",
    "control_ac": "climate", "set_ac_temperature": "climate",
    "ir_set_ac_temperature": "climate",
    "control_tv": "media", "set_tv_source": "media",
    "media_cast_camera_live": "cameras", "visual_cast_camera": "cameras",
    "create_automation": "automations", "update_automation": "automations",
    "delete_automation": "automations", "toggle_automation": "automations",
    "assign_automation_to_room": "automations",
    "apply_automation_bundle": "automations", "design_automation_set": "automations",
    "accept_suggestion": "automations",
}

# Fallback for names not in the table above, so a newly added intent inherits a
# sensible gate rather than silently becoming unrestricted.
_INTENT_FRAGMENTS: tuple[tuple[str, str], ...] = (
    ("unlock", "locks"), ("lock", "locks"), ("door", "locks"),
    ("camera", "cameras"),
    ("light", "lights"), ("lamp", "lights"), ("brightness", "lights"),
    ("climate", "climate"), ("temperature", "climate"),
    ("heater", "climate"), ("boiler", "climate"), ("_ac", "climate"),
    ("media", "media"), ("tv", "media"), ("music", "media"), ("volume", "media"),
    ("scene", "scenes"), ("routine", "scenes"), ("mode", "scenes"),
    ("automation", "automations"),
    ("pair", "devices"),
    ("setting", "settings"), ("system", "settings"),
    ("task", "lists"), ("shopping", "lists"),
)

# Dispatcher intents whose NAME says nothing about what they touch — they are
# classified purely by their params. Without this, `control_device` matched the
# "device" fragment and was classified as hardware management, which outranks
# `locks` and therefore MASKED the lock domain sitting in its params. The name
# is always a weaker signal than an explicit target.
_GENERIC_INTENTS = frozenset({
    "control_device", "list_active_devices", "get_device_state",
})

_STRENGTH = ("settings", "devices", "locks", "cameras", "automations",
             "climate", "media", "scenes", "lists", "lights")


def _strongest(caps) -> Optional[str]:
    for c in _STRENGTH:
        if c in caps:
            return c
    return None


def capability_for_intent(intent: Optional[str], params: Optional[dict] = None) -> Optional[str]:
    """Capability a parsed intent falls under, or None when it gates nothing.

    Every signal can only RAISE the requirement, never lower it, so no single
    field decides on its own. The target wins over the intent's name: "turn off
    the front door" parses as a generic device command, and it is the lock that
    makes it dangerous.
    """
    caps = set()
    params = params or {}

    # 1. The declared domain. This is the one that closes the natural-language
    #    hole: `control_device` + params.domain == "lock".
    dom = params.get("domain")
    if isinstance(dom, str) and dom in _DOMAIN_CAPABILITY:
        caps.add(_DOMAIN_CAPABILITY[dom])

    # 2. Any entity id reachable in the params, at any depth or in a list.
    def walk(node, depth=0):
        if depth > 5:
            return
        if isinstance(node, str):
            if "." in node and " " not in node:
                d = node.split(".", 1)[0]
                if d in _DOMAIN_CAPABILITY:
                    caps.add(_DOMAIN_CAPABILITY[d])
        elif isinstance(node, list):
            for v in node[:64]:
                walk(v, depth + 1)
        elif isinstance(node, dict):
            for k, v in list(node.items())[:64]:
                if k in ("entity_id", "entity", "entities", "device", "devices",
                         "target", "targets", "data"):
                    walk(v, depth + 1)

    walk(params)

    # 3. The intent's own name — skipped for generic dispatchers, whose name
    #    describes the mechanism rather than the target.
    name = (intent or "").lower()
    if name not in _GENERIC_INTENTS:
        if name in _INTENT_CAPABILITY:
            caps.add(_INTENT_CAPABILITY[name])
        else:
            for frag, cap in _INTENT_FRAGMENTS:
                if frag in name:
                    caps.add(cap)
                    break

    return _strongest(caps)


async def check_intent(intent: Optional[str], params: Optional[dict] = None) -> tuple[bool, str]:
    """Allow/deny a parsed intent for whichever tablet is in context.

    Returns (True, "ok") when no wall tablet is in context at all — every
    phone, browser and background job takes that path and is unaffected.
    """
    tablet_id = current_tablet.get()
    if not tablet_id:
        return True, "ok"
    return await check(tablet_id, capability_for_intent(intent, params))


async def check(tablet_id: str, capability: Optional[str]) -> tuple[bool, str]:
    """Authoritative allow/deny for (tablet, capability).

    Returns (allowed, reason). Reason is 'ok', 'denied', or 'pin_required'.
    """
    if not capability:
        return True, "ok"
    policy = await get_policy(tablet_id)
    if policy["capabilities"].get(capability) is False:
        return False, "denied"
    if capability in policy["pin_required"] and not is_elevated(tablet_id, capability):
        return False, "pin_required"
    return True, "ok"
