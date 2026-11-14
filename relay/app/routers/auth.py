from __future__ import annotations

import ipaddress
import os
import time
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from pydantic import BaseModel

from ..auth import (
    hash_password, hash_password_bcrypt, verify_password,
    new_salt, new_token, new_id,
    issue_jwt, current_user, require_role,
)
from ..database import get_db

router = APIRouter(prefix="/auth")

RELAY_ADMIN_EMAIL    = os.getenv("RELAY_ADMIN_EMAIL", "admin@relay.local")
RELAY_ADMIN_PASSWORD = os.getenv("RELAY_ADMIN_PASSWORD", "changeme")


def _legacy_register_provision_enabled() -> bool:
    """Escape hatch for the pre-Stream-3 behaviour where accepting a home
    invite minted a brand-new home_id AND provisioned a second Cloudflare
    tunnel. That double-provision footgun is OFF by default: home invites are
    expected to carry a pre-provisioned home_id. Set
    RELAY_LEGACY_REGISTER_PROVISION=1 only for legacy flows with no
    bench-provision step."""
    return os.getenv("RELAY_LEGACY_REGISTER_PROVISION", "").strip().lower() in ("1", "true", "yes")

# ---------------------------------------------------------------------------
# Bootstrap — create the relay-level super admin on first run
# ---------------------------------------------------------------------------

async def ensure_relay_admin():
    async with get_db() as db:
        row = await db.execute_fetchall(
            "SELECT id FROM users WHERE role='relay_admin' LIMIT 1"
        )
        if row:
            return
        # Bcrypt embeds its own salt; we still set the salt column for table
        # compatibility but it's unused for bcrypt rows.
        await db.execute(
            """INSERT OR IGNORE INTO users
               (id, email, password_hash, salt, role, home_id, hash_algo, created_at)
               VALUES (?,?,?,?,?,NULL,?,?)""",
            (new_id(), RELAY_ADMIN_EMAIL,
             hash_password_bcrypt(RELAY_ADMIN_PASSWORD),
             "", "relay_admin", "bcrypt",
             datetime.now(timezone.utc).isoformat()),
        )
        await db.commit()


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

class LoginBody(BaseModel):
    email: str
    password: str


class RegisterBody(BaseModel):
    email: str
    password: str
    invite_token: str


# Failed-login throttle. bcrypt-12 alone still allows ~4 guesses/s per
# connection against a public endpoint. Two in-process limiters (single Fly
# machine; state resets on restart, which is acceptable):
#
#   * per client network (IPv4 address / IPv6 /64): LOGIN_MAX_FAILURES per
#     window -> hard 429.
#   * per target email: after LOGIN_EMAIL_FREE_FAILURES failures in the window,
#     an exponential cooldown (capped at LOGIN_EMAIL_MAX_COOLDOWN_S) between
#     further attempts, so guesses spread over many IPs are still limited per
#     account. It is a slowdown, never a lockout, and a network that has
#     already logged in to that account successfully is exempt, so an attacker
#     cannot keep the real owner out.
#
# Every attempt is RESERVED (counted as a failure) synchronously, before the
# first await, and released only on success. Parallel requests therefore
# cannot all pass the check before any of them is counted.
LOGIN_WINDOW_S = 15 * 60
LOGIN_MAX_FAILURES = 10
LOGIN_EMAIL_FREE_FAILURES = 5
LOGIN_EMAIL_MAX_COOLDOWN_S = 60
_LOGIN_BUCKETS_MAX = 10_000
_LOGIN_KNOWN_GOOD_PER_EMAIL = 8
_login_failures: dict[str, list[float]] = {}        # network key -> attempt times
_login_email_failures: dict[str, list[float]] = {}  # email -> attempt times
_login_known_good: dict[str, list[str]] = {}        # email -> networks that logged in


def _login_ip(request: Request) -> str:
    """Client network key: IPv4 address, or the /64 for IPv6 (one subscriber
    controls a whole /64, so per-address keying is trivially bypassed)."""
    # Fly sets Fly-Client-IP itself; X-Forwarded-For's first hop is client-controlled.
    raw = (request.headers.get("fly-client-ip")
           or (request.client.host if request.client else "")
           or "").strip()
    try:
        addr = ipaddress.ip_address(raw)
    except ValueError:
        return "unknown"
    if addr.version == 6:
        if addr.ipv4_mapped:
            return str(addr.ipv4_mapped)
        return str(ipaddress.ip_network((int(addr) >> 64 << 64, 64)))
    return str(addr)


def _login_email_key(email: str) -> str:
    return (email or "").strip().lower()[:254]


def _live(table: dict[str, list[float]], key: str, now: float) -> list[float]:
    bucket = [t for t in table.get(key, []) if now - t < LOGIN_WINDOW_S]
    if bucket:
        table[key] = bucket
    else:
        table.pop(key, None)
    return bucket


def _login_blocked(ip: str, now: float) -> bool:
    return len(_live(_login_failures, ip, now)) >= LOGIN_MAX_FAILURES


def _login_email_retry_after(email: str, ip: str, now: float) -> float:
    """Seconds this email must still wait (0 = go ahead)."""
    if ip in _login_known_good.get(email, ()):
        return 0.0
    bucket = _live(_login_email_failures, email, now)
    over = len(bucket) - LOGIN_EMAIL_FREE_FAILURES
    if over < 0:
        return 0.0
    cooldown = min(2.0 ** min(over, 16), LOGIN_EMAIL_MAX_COOLDOWN_S)
    return max(0.0, bucket[-1] + cooldown - now)


def _make_room(table: dict[str, list[float]], now: float, protect_at: int) -> None:
    """Keep `table` bounded without ever freeing a throttled key: drop expired
    buckets first, then the oldest buckets still under `protect_at`. Buckets at
    or over the threshold are never evicted (they expire on their own), so the
    table may temporarily exceed the cap rather than un-block an attacker."""
    if len(table) < _LOGIN_BUCKETS_MAX:
        return
    for k in list(table):
        _live(table, k, now)
    excess = len(table) - _LOGIN_BUCKETS_MAX + 1
    if excess <= 0:
        return
    for k in [k for k, b in table.items() if len(b) < protect_at][:excess]:
        del table[k]


def _login_reserve(ip: str, email: str, now: float) -> None:
    for table, key, protect_at in (
        (_login_failures, ip, LOGIN_MAX_FAILURES),
        (_login_email_failures, email, LOGIN_EMAIL_FREE_FAILURES),
    ):
        if key not in table:
            _make_room(table, now, protect_at)
        table.setdefault(key, []).append(now)


def _login_release(ip: str, email: str, now: float) -> None:
    """Successful login: give this attempt's reservation back."""
    for table, key in ((_login_failures, ip), (_login_email_failures, email)):
        bucket = table.get(key)
        if bucket and now in bucket:
            bucket.remove(now)
            if not bucket:
                del table[key]
    good = _login_known_good.get(email)
    if good is None:
        if len(_login_known_good) >= _LOGIN_BUCKETS_MAX:
            _login_known_good.pop(next(iter(_login_known_good)), None)
        good = _login_known_good[email] = []
    if ip not in good:
        good.append(ip)
        del good[:-_LOGIN_KNOWN_GOOD_PER_EMAIL]


@router.post("/login")
async def login(body: LoginBody, request: Request):
    ip = _login_ip(request)
    email = _login_email_key(body.email)
    now = time.time()
    # --- no await between these checks and the reservation ---
    if _login_blocked(ip, now):
        raise HTTPException(429, "Too many failed login attempts. Try again later.")
    wait = _login_email_retry_after(email, ip, now)
    if wait > 0:
        raise HTTPException(
            429, "Too many failed login attempts for this account. Try again shortly.",
            headers={"Retry-After": str(int(wait) + 1)},
        )
    _login_reserve(ip, email, now)

    async with get_db() as db:
        rows = await db.execute_fetchall("SELECT * FROM users WHERE email=?", (email,))
        if not rows:
            raise HTTPException(401, "Invalid email or password.")
        u = dict(rows[0])
        # Fallback default for rows that predate the hash_algo migration.
        algo = u.get("hash_algo") or "hmac_sha256"

        if not verify_password(body.password, u["password_hash"], u.get("salt", ""), algo):
            raise HTTPException(401, "Invalid email or password.")
        _login_release(ip, email, now)

        # Transparent rehash: a successful login on a legacy HMAC row
        # immediately rotates the stored hash to bcrypt and clears the now-
        # unused salt. Wrapped in a single transaction so a crash mid-flight
        # leaves the row internally consistent.
        if algo != "bcrypt":
            await db.execute(
                """UPDATE users
                   SET password_hash = ?, salt = '', hash_algo = 'bcrypt'
                   WHERE id = ?""",
                (hash_password_bcrypt(body.password), u["id"]),
            )
            await db.commit()

        token = issue_jwt(u["id"], u["email"], u["role"], u["home_id"])
        return {"token": token, "role": u["role"], "home_id": u["home_id"], "email": u["email"]}


@router.post("/register")
async def register(body: RegisterBody, bg: BackgroundTasks):
    """Accept an invite and create an account."""
    async with get_db() as db:
        inv_rows = await db.execute_fetchall(
            "SELECT * FROM invites WHERE token=?", (body.invite_token,)
        )
        if not inv_rows:
            raise HTTPException(404, "Invite not found.")
        inv = dict(inv_rows[0])
        if inv["accepted"]:
            raise HTTPException(410, "Invite already used.")
        now = datetime.now(timezone.utc)
        if now > datetime.fromisoformat(inv["expires_at"]):
            raise HTTPException(410, "Invite expired.")

        # Defense in depth: never redeem an invite granting a non-home role
        # (e.g. relay_admin). Covers rows minted before invite-role validation
        # existed in create_invite.
        if inv["role"] not in ("guest", "user", "admin", "super_admin"):
            raise HTTPException(403, "Invite grants an invalid role.")
        if inv["type"] not in ("user", "home"):
            raise HTTPException(403, "Invalid invite type.")

        email = body.email.strip().lower()
        existing = await db.execute_fetchall(
            "SELECT id FROM users WHERE email=?", (email,)
        )
        if existing:
            raise HTTPException(409, "Email already registered.")
        if len(body.password) < 6:
            raise HTTPException(400, "Password must be at least 6 characters.")

        uid  = new_id()

        # Home invites: bind the accepting user to the home the invite was
        # issued against. Identity reconciliation (Stream 3) — the home is
        # PRE-PROVISIONED (via /provision/hub) and the invite carries its
        # home_id, so acceptance must NOT mint a second home_id or a second
        # Cloudflare tunnel. The legacy self-provision path is gated OFF by
        # default (see _legacy_register_provision_enabled).
        home_id = inv["home_id"]
        did_legacy_provision = False
        if inv["type"] == "home":
            if home_id:
                # Pre-provisioned home — verify it still exists and adopt the
                # accepter as owner if none is recorded yet.
                hrows = await db.execute_fetchall(
                    "SELECT id, owner_email FROM homes WHERE id=?", (home_id,)
                )
                if not hrows:
                    raise HTTPException(409, "Invited home is no longer provisioned. Contact support.")
                if not dict(hrows[0]).get("owner_email"):
                    await db.execute(
                        "UPDATE homes SET owner_email=? WHERE id=?", (email, home_id)
                    )
            elif _legacy_register_provision_enabled():
                # Legacy escape hatch: create a placeholder home + provision a
                # tunnel in the background. OFF unless explicitly enabled.
                home_id = f"home-{new_id()}"
                home_name = (inv.get("home_name") or "My Home").strip() or "My Home"
                await db.execute(
                    """INSERT INTO homes
                       (id, name, type, tunnel_url, status, relay_secret, created_at, owner_email)
                       VALUES (?,?,?,NULL,'provisioning','pending',?,?)""",
                    (home_id, home_name, "hub", now.isoformat(), email),
                )
                did_legacy_provision = True
            else:
                raise HTTPException(
                    409,
                    "This home has not been provisioned yet. Ask the operator to "
                    "run hub provisioning before accepting this invite.",
                )

        token = issue_jwt(uid, email, inv["role"], home_id)

        await db.execute(
            """INSERT INTO users (id, email, password_hash, salt, role, home_id, hash_algo, created_at)
               VALUES (?,?,?,?,?,?,?,?)""",
            (uid, email, hash_password_bcrypt(body.password),
             "", inv["role"], home_id, "bcrypt", now.isoformat()),
        )
        await db.execute(
            "UPDATE invites SET accepted=1, accepted_at=?, accepted_by=? WHERE token=?",
            (now.isoformat(), email, body.invite_token),
        )
        await db.commit()

        # Only the legacy escape-hatch path provisions a tunnel here. The
        # default Stream-3 path binds to a home that was already provisioned
        # via /provision/hub, so no background tunnel creation happens (that
        # was the double-provision footgun).
        if did_legacy_provision:
            from ..routers.provision import _provision_hub_background
            home_name_for_prov = (inv.get("home_name") or "My Home").strip() or "My Home"
            bg.add_task(_provision_hub_background, home_id, home_name_for_prov)

        return {
            "token":       token,
            "role":        inv["role"],
            "home_id":     home_id,
            "email":       email,
            "invite_type": inv["type"],
        }


@router.get("/me")
async def me(request: Request):
    user = current_user(request)
    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT id, email, role, home_id, created_at FROM users WHERE id=?",
            (user["sub"],)
        )
        if not rows:
            raise HTTPException(404, "User not found.")
        return dict(rows[0])


@router.get("/status")
async def status():
    return {"ok": True, "service": "ziggy-relay"}
