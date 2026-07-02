#!/usr/bin/env python3
"""OTA health test — verifies the mini PC's auto-update pipeline is alive.

Three test modes:

  --mode quick   Fast static checks (task principal, task state, deploy_log
                 age via the /health endpoint). No pushes, no waits. ~10s.

  --mode probe   Quick checks PLUS an end-to-end probe: append a probe file
                 to the repo, commit, push, poll canary's /api/version for
                 the new SHA, verify it lands within 5 min. ~2-5 min.

  --mode lock    Quick checks PLUS the specific scenario that broke OTA in
                 production: lock the mini PC's console session, wait 3 min,
                 verify the scheduled task fires successfully anyway (proves
                 the SYSTEM principal fix survives screen lock). ~4 min.

  --mode signed-out   DESTRUCTIVE. Forces the interactive console user to sign
                 out, waits 3 min, verifies the SYSTEM task still fires (result
                 0, LastRunTime after sign-out). Non-damaging but disruptive;
                 re-login is manual. Needs --confirm-destructive.

  --mode docker-down  DESTRUCTIVE. Stops the Docker engine, confirms /health
                 goes dark, then ALWAYS restarts it (finally block) and confirms
                 recovery. Needs --confirm-destructive.

Destructive modes refuse to run without --confirm-destructive.

Requires:
  - SSH access to the mini PC (uses whatever key ssh_config points at)
  - ZIGGY_TOKEN env var (super_admin session token) for the /health poll in
    probe/lock modes — /health itself is public but the probe checks
    /api/version which needs no auth, and the smart-sensor cross-check
    optionally does.
  - GitHub push access if --mode probe

Usage:
  python3 scripts/test_ota_health.py --mode quick
  python3 scripts/test_ota_health.py --mode probe
  python3 scripts/test_ota_health.py --mode lock
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone


SSH_HOST = "youval polacsek@10.100.102.23"
CANARY_URL = "https://app.ziggy-home.com"
UA_HEADER = "Mozilla/5.0 (compatible; ZiggyOTATest/1.0)"


class Result:
    def __init__(self):
        self.checks = []
        self.failed = False

    def check(self, name: str, passed: bool, detail: str = "") -> None:
        icon = "✅" if passed else "❌"
        self.checks.append((icon, name, detail))
        if not passed:
            self.failed = True

    def print_summary(self):
        print()
        for icon, name, detail in self.checks:
            line = f"  {icon} {name}"
            if detail:
                line += f"  — {detail}"
            print(line)
        print()
        print(f"  {'ALL GREEN' if not self.failed else 'FAILURES ABOVE'}")


def _ssh(cmd: str, timeout: float = 30.0) -> tuple[int, str, str]:
    """Run a command over SSH; return (rc, stdout, stderr)."""
    full = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", SSH_HOST, cmd]
    try:
        p = subprocess.run(full, capture_output=True, text=True, timeout=timeout)
        return p.returncode, p.stdout, p.stderr
    except subprocess.TimeoutExpired:
        return -1, "", "timeout"


def _ps(script: str, timeout: float = 30.0) -> tuple[int, str, str]:
    """Run a PowerShell snippet on the mini PC. Wraps in -EncodedCommand
    to survive quoting between bash → ssh → cmd → powershell."""
    import base64
    encoded = base64.b64encode(script.encode("utf-16-le")).decode()
    return _ssh(f"powershell -NoProfile -EncodedCommand {encoded}", timeout=timeout)


def _http_get_json(url: str, timeout: float = 15.0) -> dict:
    """GET a URL returning JSON. Uses a browser UA to get past Cloudflare 1010."""
    req = urllib.request.Request(url, headers={"User-Agent": UA_HEADER,
                                                "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        try:
            return {"_http_error": e.code, "_body": e.read().decode()[:300]}
        except Exception:
            return {"_http_error": e.code}


# ── Checks ─────────────────────────────────────────────────────────────────


def check_task_principal(r: Result) -> None:
    """Task must run as NT AUTHORITY\\SYSTEM (ServiceAccount) — survives lock."""
    rc, out, err = _ps(
        '$t = Get-ScheduledTask -TaskName ZiggyAutoUpdate; '
        'Write-Output "$($t.Principal.UserId)|$($t.Principal.LogonType)"'
    )
    if rc != 0 or not out.strip():
        r.check("Task principal check", False, f"ssh rc={rc} err={err[:80]!r}")
        return
    line = out.strip().splitlines()[-1]
    if "|" not in line:
        r.check("Task principal check", False, f"unexpected output {line!r}")
        return
    user, logon = line.split("|", 1)
    passed = user == "SYSTEM" and logon == "ServiceAccount"
    r.check("Task principal is SYSTEM/ServiceAccount", passed, f"got user={user!r} logon={logon!r}")


def check_task_state(r: Result) -> None:
    """Task must be Ready + last result 0 OR 267009 (RUNNING)."""
    # Use PowerShell string interpolation (`$($x)`) — the earlier `+` chain
    # tripped up EncodedCommand serialisation on integer→string conversions.
    rc, out, _ = _ps(
        '$t = Get-ScheduledTask -TaskName ZiggyAutoUpdate; '
        '$i = Get-ScheduledTaskInfo -TaskName ZiggyAutoUpdate; '
        'Write-Output "$($t.State)|$($i.LastTaskResult)|$($i.NextRunTime)"'
    )
    if rc != 0 or not out.strip():
        r.check("Task state check", False, f"ssh rc={rc}")
        return
    line = out.strip().splitlines()[-1]
    parts = line.split("|")
    if len(parts) < 3:
        r.check("Task state check", False, f"unexpected output {line!r}")
        return
    state, last_result, next_run = parts[0], parts[1], parts[2]
    # LastTaskResult 0 = success, 267009 = currently running, 267011 = never run
    passed = state == "Ready" and last_result in ("0", "267009", "267011")
    r.check("Task state Ready + last result healthy", passed,
            f"state={state} last={last_result} next={next_run!r}")


def check_health_ota_signal(r: Result) -> dict:
    """The new /health.ota signal must exist and not be 'silent'."""
    data = _http_get_json(f"{CANARY_URL}/health?t={int(time.time())}")
    ota = (data or {}).get("ota") or {}
    if not ota:
        r.check("/health.ota signal present", False, f"missing from {list(data.keys())}")
        return {}
    status = ota.get("status")
    seconds = ota.get("seconds_since")
    passed = status in ("ok", "stale")   # "stale" is a warn, not a fail; "silent" fails
    r.check("OTA age from /health", passed,
            f"status={status} seconds_since={seconds}")
    return ota


def check_deploy_log_recent(r: Result, max_age_s: int = 3600) -> None:
    """Deploy log must have an entry newer than max_age_s. Reads from the
    mini PC filesystem directly — cross-check against the /health signal."""
    rc, out, _ = _ps(
        "Get-Content C:\\ziggy\\user_files\\deploy_log -Tail 6 | Select-String -Pattern '^ts:' | Select-Object -Last 1"
    )
    if rc != 0 or not out.strip():
        r.check("deploy_log has recent entry", False, "empty output")
        return
    # Line looks like: "ts:        2026-07-01T14:35:50Z"
    line = out.strip().splitlines()[-1]
    ts = ""
    for tok in line.split():
        if "T" in tok and "Z" in tok:
            ts = tok
            break
    if not ts:
        r.check("deploy_log has recent entry", False, f"couldn't parse {line!r}")
        return
    try:
        dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        age = (datetime.now(timezone.utc) - dt).total_seconds()
    except Exception:
        r.check("deploy_log has recent entry", False, f"bad timestamp {ts!r}")
        return
    passed = age <= max_age_s
    r.check(f"deploy_log entry within {max_age_s // 60} min",
            passed, f"last={ts} age={int(age)}s")


# ── E2E probe ──────────────────────────────────────────────────────────────


def probe_e2e(r: Result, timeout_s: int = 360) -> None:
    """Push a trivial change and wait for canary to serve the new SHA."""
    repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    probe_file = os.path.join(repo, "user_files", "ota_probe.txt")
    stamp = datetime.now(timezone.utc).isoformat()
    try:
        with open(probe_file, "w") as f:
            f.write(f"OTA probe {stamp}\n")
        subprocess.run(["git", "-C", repo, "add", probe_file], check=True)
        subprocess.run(["git", "-C", repo, "commit", "-m",
                        f"test(ota): probe {stamp}"], check=True)
        push = subprocess.run(["git", "-C", repo, "push", "origin", "main"],
                              capture_output=True, text=True, check=True)
    except subprocess.CalledProcessError as e:
        r.check("E2E: push probe", False, f"git failed: {e.stderr[:120] if e.stderr else e}")
        return

    target = subprocess.run(
        ["git", "-C", repo, "rev-parse", "--short", "HEAD"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()

    print(f"  Pushed {target}; polling canary /api/version (up to {timeout_s}s) …")
    deadline = time.time() + timeout_s
    live = ""
    while time.time() < deadline:
        try:
            data = _http_get_json(f"{CANARY_URL}/api/version?t={int(time.time())}")
            live = (data.get("git_sha") or "")[:7]
            if live == target:
                elapsed = int(timeout_s - (deadline - time.time()))
                r.check("E2E: canary picked up probe", True, f"landed in {elapsed}s")
                return
        except Exception:
            pass
        time.sleep(15)
    r.check("E2E: canary picked up probe", False,
            f"timed out after {timeout_s}s; live={live!r} target={target!r}")


# ── Screen-lock scenario ───────────────────────────────────────────────────


def scenario_lock(r: Result, wait_s: int = 180) -> None:
    """Lock the console session, wait ~3 min (task fires once at least),
    verify the last run result is still 0."""
    print(f"  Locking console session; waiting {wait_s}s for scheduled task to fire …")
    _ps("rundll32.exe user32.dll,LockWorkStation")
    # Note when we locked so we can prove the run happened AFTER the lock
    lock_ts = datetime.now(timezone.utc)
    time.sleep(wait_s)
    # After the wait, LastRunTime should be AFTER lock_ts AND LastTaskResult=0
    rc, out, _ = _ps(
        "$i = Get-ScheduledTaskInfo -TaskName ZiggyAutoUpdate; "
        "Write-Output ($i.LastRunTime.ToUniversalTime().ToString('o') + '|' + $i.LastTaskResult)"
    )
    line = (out or "").strip().splitlines()[-1] if out else ""
    if "|" not in line:
        r.check("Locked-session task run", False, f"unexpected output {line!r}")
        return
    last_ts, last_result = line.split("|", 1)
    try:
        last_dt = datetime.fromisoformat(last_ts.replace("Z", "+00:00"))
    except Exception:
        r.check("Locked-session task run", False, f"bad timestamp {last_ts!r}")
        return
    ran_after_lock = last_dt >= lock_ts
    result_ok = last_result.strip() == "0"
    passed = ran_after_lock and result_ok
    r.check("Task fires successfully with console locked",
            passed,
            f"ran_after_lock={ran_after_lock} last_result={last_result}")


# ── Adverse scenarios (DESTRUCTIVE — gated behind --confirm-destructive) ─────
#
# These deliberately break the mini PC to prove the OTA pipeline survives the
# failure mode, then restore it. They are HIGHER RISK than quick/probe/lock:
#   - signed-out: forces the interactive user off the console
#   - docker-down: stops the Docker engine (Ziggy goes dark until restored)
# Both refuse to run without --confirm-destructive so a stray invocation can't
# knock over the user's real home. docker-down guarantees restart via finally.


def _require_confirm(r: Result, args, mode: str) -> bool:
    """Gate destructive modes. Returns True if allowed to proceed."""
    if getattr(args, "confirm_destructive", False):
        return True
    r.check(f"{mode}: refused (safety)", False,
            "destructive mode needs --confirm-destructive; not run")
    print(f"  ⚠️  --mode {mode} is destructive (it breaks the live home to test "
          f"recovery).\n     Re-run with --confirm-destructive to actually execute it.")
    return False


def _wait_health_reachable(timeout_s: int, want_reachable: bool) -> tuple[bool, str]:
    """Poll /health until reachability matches want_reachable (or timeout).
    Returns (matched, last_detail)."""
    deadline = time.time() + timeout_s
    last = ""
    while time.time() < deadline:
        try:
            data = _http_get_json(f"{CANARY_URL}/health?t={int(time.time())}", timeout=8.0)
            reachable = bool(data) and "_http_error" not in data and data.get("status") is not None
            last = f"status={data.get('status')}" if reachable else f"unreachable ({list(data.keys())})"
            if reachable == want_reachable:
                return True, last
        except Exception as e:
            last = f"exc={e}"
            if not want_reachable:
                return True, last
        time.sleep(10)
    return False, last


def _detect_docker_service() -> str | None:
    """Find the Docker engine service name on the mini PC (Docker Desktop uses
    com.docker.service; a plain dockerd install uses 'docker')."""
    rc, out, _ = _ps(
        "$s = Get-Service -Name 'com.docker.service','docker' -ErrorAction SilentlyContinue | "
        "Where-Object { $_.Status -eq 'Running' } | Select-Object -First 1; "
        "if ($s) { Write-Output $s.Name }"
    )
    name = (out or "").strip().splitlines()[-1].strip() if out.strip() else ""
    return name or None


def scenario_docker_down(r: Result, args, down_s: int = 60, restore_timeout_s: int = 300) -> None:
    """Stop the Docker engine, confirm /health goes dark, then ALWAYS restart it
    and confirm recovery. Reversible: the restart runs in a finally block so an
    exception or Ctrl-C can't leave the home offline."""
    if not _require_confirm(r, args, "docker-down"):
        return
    svc = _detect_docker_service()
    if not svc:
        r.check("docker-down: locate Docker service", False,
                "no running com.docker.service/docker found — aborting (nothing stopped)")
        return
    print(f"  Docker service = {svc!r}. Stopping it for ~{down_s}s …")
    stopped = False
    try:
        rc, out, err = _ps(f"Stop-Service -Name '{svc}' -Force; Write-Output 'stopped'", timeout=90)
        stopped = rc == 0 and "stopped" in (out or "")
        if not stopped:
            r.check("docker-down: stop engine", False, f"rc={rc} err={err[:80]!r}")
            return
        # Health should become unreachable / not-ok while the container is down.
        matched, detail = _wait_health_reachable(down_s, want_reachable=False)
        r.check("docker-down: /health reflects outage", matched, detail)
    finally:
        if stopped:
            print("  Restarting Docker engine (guaranteed restore) …")
            _ps(f"Start-Service -Name '{svc}'", timeout=120)
            recovered, detail = _wait_health_reachable(restore_timeout_s, want_reachable=True)
            r.check("docker-down: home recovered after restart", recovered, detail)


def scenario_signed_out(r: Result, args, wait_s: int = 180) -> None:
    """Force the interactive console user to sign out, then verify the SYSTEM
    scheduled task still fires (LastRunTime advances past sign-out, result 0).

    This is the exact regression the SYSTEM-principal fix guards against. It's
    non-damaging (the machine keeps running headless; the user simply logs back
    in later) but disruptive, so it's confirmation-gated. Re-login is manual —
    the script can't and won't cache the user's password."""
    if not _require_confirm(r, args, "signed-out"):
        return
    # Enumerate active interactive sessions so we log off a real one.
    rc, out, _ = _ps(
        "query session 2>$null | Select-String -Pattern 'Active' | ForEach-Object { $_.ToString() }"
    )
    if rc != 0 or not (out or "").strip():
        r.check("signed-out: find active session", False, "no active console session found")
        return
    print("  Active sessions:\n    " + "\n    ".join(out.strip().splitlines()))
    signout_ts = datetime.now(timezone.utc)
    # `logoff` the active session id (2nd token of the `query session` Active row).
    _ps(
        "$row = (query session | Select-String 'Active' | Select-Object -First 1).ToString(); "
        "$id = ($row -split '\\s+' | Where-Object { $_ -match '^[0-9]+$' } | Select-Object -First 1); "
        "if ($id) { logoff $id }"
    )
    print(f"  Signed out; waiting {wait_s}s for the SYSTEM task to fire while logged off …")
    time.sleep(wait_s)
    rc, out, _ = _ps(
        "$i = Get-ScheduledTaskInfo -TaskName ZiggyAutoUpdate; "
        "Write-Output ($i.LastRunTime.ToUniversalTime().ToString('o') + '|' + $i.LastTaskResult)"
    )
    line = (out or "").strip().splitlines()[-1] if out else ""
    if "|" not in line:
        r.check("signed-out: task run", False, f"unexpected output {line!r}")
        return
    last_ts, last_result = line.split("|", 1)
    try:
        last_dt = datetime.fromisoformat(last_ts.replace("Z", "+00:00"))
    except Exception:
        r.check("signed-out: task run", False, f"bad timestamp {last_ts!r}")
        return
    ran_after = last_dt >= signout_ts
    result_ok = last_result.strip() == "0"
    r.check("Task fires successfully while signed out", ran_after and result_ok,
            f"ran_after_signout={ran_after} last_result={last_result.strip()}")
    print("  ℹ️  The console is now signed out — log back in on the mini PC when convenient.")


# ── Main ───────────────────────────────────────────────────────────────────


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode",
                    choices=("quick", "probe", "lock", "signed-out", "docker-down"),
                    default="quick")
    ap.add_argument("--confirm-destructive", action="store_true",
                    help="required to actually run signed-out / docker-down modes")
    args = ap.parse_args()

    r = Result()
    print(f"[test_ota_health] mode={args.mode} target={CANARY_URL}")

    check_task_principal(r)
    check_task_state(r)
    check_deploy_log_recent(r)
    ota = check_health_ota_signal(r)

    if args.mode == "probe":
        probe_e2e(r)
        # After probe, re-check /health.ota — should show the fresh deploy
        after = check_health_ota_signal(r)
        if after.get("seconds_since") is not None:
            r.check("Post-probe /health.ota is fresh",
                    after["seconds_since"] < 600,
                    f"seconds_since={after['seconds_since']}")
    elif args.mode == "lock":
        scenario_lock(r)
    elif args.mode == "signed-out":
        scenario_signed_out(r, args)
    elif args.mode == "docker-down":
        scenario_docker_down(r, args)

    r.print_summary()
    return 0 if not r.failed else 1


if __name__ == "__main__":
    sys.exit(main())
