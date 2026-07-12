from __future__ import annotations

"""
Prod boot-time config guard.

Refuses to start the relay in a production environment while security-critical
secrets are still at their dev/`changeme` defaults. A random-per-boot JWT
secret silently invalidates every issued token on each restart; a `changeme`
admin password is an open door. Both are fine in dev — the guard is a no-op
unless we detect prod.

Prod is detected by either:
  * ZIGGY_ENV=prod        (explicit)
  * FLY_APP_NAME set      (running on Fly.io)

Secrets checked:
  * RELAY_JWT_SECRET      — must be set, not a placeholder, >= 16 chars.
  * RELAY_ADMIN_PASSWORD  — must be set and not a placeholder.
"""

import os
from typing import Mapping, Optional

# Values we treat as "still a dev default" and refuse in prod.
DEV_PLACEHOLDERS = {
    "", "changeme", "change-me", "change_me", "changethis", "change-this",
    "dev", "devsecret", "dev-secret", "secret", "please-change",
    "placeholder", "test", "example",
}

MIN_JWT_SECRET_LEN = 16


def is_prod(env: Optional[Mapping[str, str]] = None) -> bool:
    env = os.environ if env is None else env
    if (env.get("ZIGGY_ENV", "") or "").strip().lower() == "prod":
        return True
    if (env.get("FLY_APP_NAME", "") or "").strip():
        return True
    return False


def check_prod_secrets(env: Optional[Mapping[str, str]] = None) -> list[str]:
    """Return a list of human-readable problems. Empty list == OK.

    Always evaluates (independent of environment) so it is unit-testable; the
    prod gate lives in assert_prod_secrets().
    """
    env = os.environ if env is None else env
    problems: list[str] = []

    jwt = (env.get("RELAY_JWT_SECRET", "") or "").strip()
    if jwt.lower() in DEV_PLACEHOLDERS:
        problems.append(
            "RELAY_JWT_SECRET is unset or a dev placeholder — set a strong random "
            "value (e.g. `openssl rand -hex 32`) as a Fly secret."
        )
    elif len(jwt) < MIN_JWT_SECRET_LEN:
        problems.append(
            f"RELAY_JWT_SECRET is too short ({len(jwt)} chars); need >= {MIN_JWT_SECRET_LEN}."
        )

    pw = (env.get("RELAY_ADMIN_PASSWORD", "") or "").strip()
    if pw.lower() in DEV_PLACEHOLDERS:
        problems.append(
            "RELAY_ADMIN_PASSWORD is unset or a dev placeholder (`changeme`) — "
            "set a real password as a Fly secret."
        )

    return problems


def assert_prod_secrets(env: Optional[Mapping[str, str]] = None) -> None:
    """Raise RuntimeError if running in prod with dev-default secrets.

    No-op in dev. Called from the relay lifespan so the process refuses to
    finish booting rather than serving with insecure defaults.
    """
    env = os.environ if env is None else env
    if not is_prod(env):
        return
    problems = check_prod_secrets(env)
    if problems:
        raise RuntimeError(
            "Refusing to boot ziggy-relay in prod with insecure config:\n  - "
            + "\n  - ".join(problems)
        )
