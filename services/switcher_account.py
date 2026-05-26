"""
Switcher account credentials — validate, cache, and serve.

What this solves
----------------
HA's `switcher_kis` integration needs `username` (the user's Switcher account
email) + `token` (a ~24-char base64-ish string, example: zvVvd7JxtN7CgvkD1Psujw==)
to control specific newer device families:

  - Switcher Runner S11 / S12 (blinds)
  - Switcher Light SL01 / SL02 / SL03 (and their Mini variants)
  - Switcher Heater (the specific newer model named "Heater" by Switcher)

Other devices — Touch, V2, V4, Mini, Breeze, Power Plug — pair without any
credentials. HA's config flow only prompts when needed; we mirror that.

Acquiring the token
-------------------
Per HA's docs, the user goes to Switcher's GetKey web page, enters their
account email, and Switcher emails the token to that address. There is NO
mobile-app step and NO programmatic OTP flow — that's a hard constraint of
Switcher's account system, not a Ziggy choice.

What we CAN do programmatically is validate the pasted credentials via
`aioswitcher.device.tools.validate_token` (it hits switcher.co.il's
ValidateToken endpoint). We collect once, validate, cache, and auto-inject
into every Switcher pairing flow thereafter so the user never sees the
token field again.

Storage: user_files/switcher_account.json (plaintext — same security posture
as the rest of user_files; tokens are per-account access tokens that can be
re-requested through Switcher's GetKey page at any time).
"""
from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Optional

from core.logger_module import log_info, log_error


# Anchor to project root so cwd doesn't matter — same pattern as the
# ir_manager fix.
CREDS_FILE = Path(__file__).resolve().parent.parent / "user_files" / "switcher_account.json"


# ───────────────────────── persistence ─────────────────────────

def get_credentials() -> Optional[dict]:
    """Return cached {email, token} or None if not connected."""
    try:
        if not CREDS_FILE.exists():
            return None
        with CREDS_FILE.open("r", encoding="utf-8") as f:
            data = json.load(f)
        if not data.get("email") or not data.get("token"):
            return None
        return {"email": data["email"], "token": data["token"]}
    except Exception as e:
        log_error(f"[SwitcherAccount] read failed: {e}")
        return None


def is_connected() -> bool:
    return get_credentials() is not None


def save_credentials(email: str, token: str) -> None:
    """Persist credentials. Caller is responsible for validating first."""
    CREDS_FILE.parent.mkdir(parents=True, exist_ok=True)
    payload = {"email": email.strip(), "token": token.strip()}
    with CREDS_FILE.open("w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    log_info(f"[SwitcherAccount] credentials saved for {email}")


def clear_credentials() -> bool:
    """Remove cached credentials. Returns True iff a file was deleted."""
    if CREDS_FILE.exists():
        try:
            CREDS_FILE.unlink()
            log_info("[SwitcherAccount] credentials cleared")
            return True
        except Exception as e:
            log_error(f"[SwitcherAccount] clear failed: {e}")
    return False


# ───────────────────────── validation ─────────────────────────

async def validate(email: str, token: str) -> dict:
    """Validate credentials against Switcher's account API.

    Returns: {"ok": bool, "valid": bool, "error": str|None}

    `valid` semantics: True iff Switcher's API confirms the pair. The flow
    is: Ziggy → aioswitcher → https://switcher.co.il/ValidateToken/.
    Network failures, library issues, etc. surface as ok=False so the UI
    can distinguish "wrong creds" from "couldn't check".
    """
    email = (email or "").strip()
    token = (token or "").strip()
    if not email or not token:
        return {"ok": False, "valid": False, "error": "Email and token are required."}

    try:
        from aioswitcher.device.tools import validate_token
    except Exception as e:
        log_error(f"[SwitcherAccount] aioswitcher import failed: {e}")
        return {"ok": False, "valid": False, "error": "aioswitcher library is not installed."}

    try:
        # validate_token is async — it opens an aiohttp session and POSTs to
        # Switcher's validation endpoint. ~1–3 s on a normal connection.
        valid = await asyncio.wait_for(validate_token(email, token), timeout=15)
        return {"ok": True, "valid": bool(valid), "error": None}
    except asyncio.TimeoutError:
        return {"ok": False, "valid": False, "error": "Switcher's server didn't respond in time."}
    except Exception as e:
        log_error(f"[SwitcherAccount] validate raised: {e}")
        return {"ok": False, "valid": False, "error": str(e)}


async def validate_and_save(email: str, token: str) -> dict:
    """Validate, then persist on success. Returns the validate() shape."""
    res = await validate(email, token)
    if res.get("valid"):
        save_credentials(email, token)
    return res
