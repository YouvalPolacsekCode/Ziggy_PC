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
        "$t = Get-ScheduledTask -TaskName ZiggyAutoUpdate; "
        "Write-Output ($t.Principal.UserId + '|' + $t.Principal.LogonType)"
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
    rc, out, _ = _ps(
        "$t = Get-ScheduledTask -TaskName ZiggyAutoUpdate; "
        "$i = Get-ScheduledTaskInfo -TaskName ZiggyAutoUpdate; "
        "Write-Output ($t.State + '|' + $i.LastTaskResult + '|' + $i.NextRunTime)"
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


# ── Main ───────────────────────────────────────────────────────────────────


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=("quick", "probe", "lock"), default="quick")
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

    r.print_summary()
    return 0 if not r.failed else 1


if __name__ == "__main__":
    sys.exit(main())
