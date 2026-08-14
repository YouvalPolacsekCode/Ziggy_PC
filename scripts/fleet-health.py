#!/usr/bin/env python3
"""Ziggy fleet health — check every home, and optionally repair the safe things.

This is the operator loop. It works from anywhere with internet (the relay admin
API is public-facing), so it runs equally well from a laptop, a cron job, or a
scheduled agent. That matters: remediation used to require an SSH session from
one specific Mac holding a cloudflared cert, which is why a customer home sat
broken for 19 hours.

    ./scripts/fleet-health.py                 # human-readable status table
    ./scripts/fleet-health.py --json          # machine-readable, for agents
    ./scripts/fleet-health.py --fix           # also run safe repairs
    ./scripts/fleet-health.py --fix --dry-run # show what --fix would do

Exit codes (so cron / CI / an agent can gate on them):
    0  every home healthy
    1  at least one home degraded
    2  at least one home down, or the relay itself is unreachable

Credentials, in order: RELAY_ADMIN_EMAIL/RELAY_ADMIN_PASSWORD env, then the
first ~/.ziggy/*secrets.txt that carries them. Never pass a password on argv.
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import sys
import urllib.error
import urllib.request

DEFAULT_RELAY = os.environ.get("ZIGGY_RELAY_URL", "https://ziggy-relay.fly.dev")
TIMEOUT_S = 45

# Only verbs the hub exposes as idempotent and non-destructive
# (backend/routers/ops_router.py). Anything that can lose state is absent on
# purpose — an automated remediator must not be able to delete a device.
SAFE_VERBS = {
    "reconcile":  "/api/ops/reconcile",
    "recover-ha": "/api/ops/recover-ha",
}

LEVEL_ORDER = {"down": 0, "degraded": 1, "unknown": 2, "ok": 3}
COLORS = {"down": "\033[31m", "degraded": "\033[33m", "unknown": "\033[90m", "ok": "\033[32m"}
RESET = "\033[0m"


def _color(level: str, text: str, enabled: bool) -> str:
    if not enabled:
        return text
    return f"{COLORS.get(level, '')}{text}{RESET}"


def load_credentials() -> tuple[str, str]:
    email = os.environ.get("RELAY_ADMIN_EMAIL", "").strip()
    password = os.environ.get("RELAY_ADMIN_PASSWORD", "").strip()
    if email and password:
        return email, password

    home = os.path.expanduser("~/.ziggy")
    for path in sorted(glob.glob(os.path.join(home, "*secrets*.txt"))):
        found: dict[str, str] = {}
        try:
            with open(path, "r", encoding="utf-8") as fh:
                for line in fh:
                    if "=" in line and not line.strip().startswith("#"):
                        k, _, v = line.partition("=")
                        found[k.strip()] = v.strip()
        except OSError:
            continue
        if found.get("RELAY_ADMIN_EMAIL") and found.get("RELAY_ADMIN_PASSWORD"):
            return found["RELAY_ADMIN_EMAIL"], found["RELAY_ADMIN_PASSWORD"]

    sys.exit(
        "No relay admin credentials. Set RELAY_ADMIN_EMAIL / RELAY_ADMIN_PASSWORD, "
        "or keep them in ~/.ziggy/<name>-secrets.txt"
    )


def request(method: str, url: str, token: str | None = None, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
        raw = resp.read().decode("utf-8")
    return json.loads(raw) if raw else {}


def login(relay: str) -> str:
    email, password = load_credentials()
    try:
        out = request("POST", f"{relay}/api/auth/login", body={"email": email, "password": password})
    except urllib.error.URLError as e:
        sys.exit(f"Cannot reach the relay at {relay}: {e}")
    token = out.get("token")
    if not token:
        sys.exit("Relay login failed — check the admin credentials.")
    return token


def fetch_health(relay: str, token: str) -> dict:
    try:
        return request("GET", f"{relay}/api/admin/fleet/health", token=token)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            sys.exit(
                "The relay has no /api/admin/fleet/health endpoint — it is running a build "
                "older than the fleet-health work. Deploy the relay (cd relay && flyctl deploy)."
            )
        sys.exit(f"Fleet health request failed: {e}")


def repair(relay: str, token: str, home: dict, *, dry_run: bool, color: bool) -> list[str]:
    """Run the safe verbs this home's issues map to. Returns log lines."""
    lines: list[str] = []
    for verb in home.get("actionable") or []:
        path = SAFE_VERBS.get(verb)
        if not path:
            lines.append(f"    ~ skipping unknown verb '{verb}' (not in the safe set)")
            continue
        target = f"{relay}/api/proxy/{home['home_id']}{path}"
        if dry_run:
            lines.append(f"    · would run {verb}")
            continue
        try:
            out = request("POST", target, token=token, body={})
            msg = out.get("message") or out.get("status") or "done"
            lines.append(f"    ✓ {verb}: {msg}")
        except Exception as e:
            lines.append(f"    ✗ {verb} failed: {e}")
    return lines


def render(report: dict, *, color: bool) -> None:
    summary = report.get("summary") or {}
    counts = summary.get("counts") or {}
    print()
    print(f"  Ziggy fleet — {summary.get('total', 0)} home(s)")
    print(
        "  "
        + _color("ok", f"{counts.get('ok', 0)} healthy", color) + " · "
        + _color("degraded", f"{counts.get('degraded', 0)} degraded", color) + " · "
        + _color("down", f"{counts.get('down', 0)} down", color) + " · "
        + _color("unknown", f"{counts.get('unknown', 0)} unknown", color)
    )
    print()
    for home in report.get("homes") or []:
        level = home.get("level", "unknown")
        name = home.get("name") or home.get("home_id")
        badge = _color(level, f"[{level.upper():^8}]", color)
        print(f"  {badge} {name}")
        # Automation counts always print, healthy or not. A home whose
        # automations silently went to zero looked perfectly fine on this
        # screen for five and a half hours on 2026-08-14 — "no issues" is not
        # the same as "and here is what it has".
        v = home.get("vitals") or {}
        z, h = v.get("automations_ha_backed"), v.get("automations_ha")
        if z is not None or h is not None:
            note = "" if z == h else "   <-- MISMATCH"
            print(f"        automations: ziggy={z} ha={h}{note}")
        for issue in home.get("issues") or []:
            print(f"        - {issue.get('message')}")
        if home.get("actionable"):
            print(f"        → repairable with: {', '.join(home['actionable'])}")
    print()


def worst_level(report: dict) -> str:
    levels = [h.get("level", "unknown") for h in report.get("homes") or []]
    if not levels:
        return "unknown"
    return sorted(levels, key=lambda l: LEVEL_ORDER.get(l, 9))[0]


def main() -> int:
    ap = argparse.ArgumentParser(description="Ziggy fleet health check")
    ap.add_argument("--relay", default=DEFAULT_RELAY)
    ap.add_argument("--json", action="store_true", help="raw JSON (for agents/pipelines)")
    ap.add_argument("--fix", action="store_true", help="run safe repairs on unhealthy homes")
    ap.add_argument("--dry-run", action="store_true", help="with --fix, only show what would run")
    ap.add_argument("--no-color", action="store_true")
    args = ap.parse_args()

    relay = args.relay.rstrip("/")
    color = sys.stdout.isatty() and not args.no_color

    token = login(relay)
    report = fetch_health(relay, token)

    repairs: dict[str, list[str]] = {}
    if args.fix:
        for home in report.get("homes") or []:
            if home.get("level") in ("degraded", "down") and home.get("actionable"):
                lines = repair(relay, token, home, dry_run=args.dry_run, color=color)
                if lines:
                    repairs[home["home_id"]] = lines
        if repairs and not args.dry_run:
            # Re-read so the reported state reflects the repairs, not the
            # pre-repair snapshot. An operator should never be shown a problem
            # this run already fixed.
            report = fetch_health(relay, token)

    if args.json:
        print(json.dumps({"report": report, "repairs": repairs}, indent=2))
    else:
        render(report, color=color)
        if repairs:
            print("  Repairs:")
            for home_id, lines in repairs.items():
                print(f"    {home_id}")
                for line in lines:
                    print(line)
            print()

    worst = worst_level(report)
    return {"down": 2, "degraded": 1}.get(worst, 0)


if __name__ == "__main__":
    sys.exit(main())
