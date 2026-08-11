"""Tests for the automated new-home provisioning path.

Covers the three things that used to be manual when building a home, and the
one safety property that makes automating them acceptable:

  * scripts/linux/ziggy-tunnel.sh      — the Cloudflare connector
  * scripts/linux/ziggy-network-pin.sh — the address pin + its auto-revert
  * scripts/factory/ziggy-image-device.sh — that both are real, wired steps
  * scripts/new-home.sh                — that it refuses to run half-configured

The shell scripts are exercised for real, against fake system binaries placed
first on PATH. That is deliberate: the value of the pin logic is entirely in
what it does when the network does NOT come back, and a test that stubs out the
shell proves nothing about that.
"""

from __future__ import annotations

import os
import re
import stat
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
IMAGING = REPO / "scripts" / "factory" / "ziggy-image-device.sh"
TUNNEL = REPO / "scripts" / "linux" / "ziggy-tunnel.sh"
NETPIN = REPO / "scripts" / "linux" / "ziggy-network-pin.sh"
NEW_HOME = REPO / "scripts" / "new-home.sh"
GUARD_UNIT = REPO / "scripts" / "linux" / "ziggy-network-guard.service"
INSTALL_UNITS = REPO / "scripts" / "linux" / "install-systemd-units.sh"

VALID_TOKEN = "e" * 180  # connector tokens are long base64


# ─────────────────────────────────────────────────────────────────────────────
# fake-binary harness
# ─────────────────────────────────────────────────────────────────────────────
def _write_exec(path: Path, body: str) -> None:
    path.write_text("#!/usr/bin/env bash\n" + body)
    path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


@pytest.fixture()
def fakebin(tmp_path: Path):
    """A directory of fake system binaries, prepended to PATH.

    Returns (bindir, logfile). Every fake appends its argv to the logfile, so
    tests can assert on ORDER as well as on occurrence — which is how the
    "auto-revert is armed before anything is changed" property is checked.
    """
    bindir = tmp_path / "fakebin"
    bindir.mkdir()
    log = tmp_path / "calls.log"
    log.write_text("")

    def fake(name: str, body: str = "exit 0") -> None:
        _write_exec(
            bindir / name,
            f'printf "%s %s\\n" "{name}" "$*" >> "{log}"\n{body}\n',
        )

    # Networking facts the pin script reads.
    fake(
        "ip",
        """
if [[ "$*" == *"route show default"* ]]; then
  echo '[{"dst":"default","gateway":"192.168.1.1","dev":"eth0"}]'
elif [[ "$*" == *"addr show"* ]]; then
  echo '[{"ifname":"eth0","addr_info":[{"family":"inet","local":"192.168.1.42","prefixlen":24}]}]'
fi
exit 0
""",
    )
    fake("resolvectl", 'echo "Link 2 (eth0): 192.168.1.1"; exit 0')
    fake("netplan", 'exit ${FAKE_NETPLAN_RC:-0}')
    fake("ping", 'exit ${FAKE_PING_RC:-0}')
    fake("getent", 'exit ${FAKE_GETENT_RC:-0}')
    # arping -D exits 0 when the address is FREE, non-zero when someone replies.
    fake("arping", 'exit ${FAKE_ARPING_RC:-0}')
    fake("systemd-run", "exit ${FAKE_SYSTEMDRUN_RC:-0}")
    fake("systemctl", 'exit ${FAKE_SYSTEMCTL_RC:-0}')
    fake("hostnamectl", "exit 0")
    fake("avahi-daemon", "exit 0")
    fake("apt-get", "exit 0")
    fake("dpkg", 'echo amd64; exit 0')
    fake("cloudflared", 'echo "cloudflared version 2026.1.0"; exit 0')
    fake("journalctl", 'echo "INF Registered tunnel connection connIndex=0"; exit 0')
    fake("curl", 'echo -n "${FAKE_CURL_CODE:-200}"; exit 0')
    # BSD `date` has no -Is; give the scripts the GNU behaviour they expect.
    _write_exec(
        bindir / "date",
        'if [[ "$1" == "-Is" ]]; then echo "2026-08-11T12:00:00+00:00"; '
        'else /bin/date "$@"; fi\n',
    )

    env = dict(os.environ)
    env["PATH"] = f"{bindir}:{env['PATH']}"
    return bindir, log, env


def _run(script: Path, *args: str, env: dict, cwd: Path | None = None):
    return subprocess.run(
        ["bash", str(script), *args],
        capture_output=True,
        text=True,
        env=env,
        cwd=str(cwd or REPO),
        timeout=120,
    )


# ─────────────────────────────────────────────────────────────────────────────
# imaging: the new steps are real, ordered, and dispatchable
# ─────────────────────────────────────────────────────────────────────────────
class TestImagingSteps:
    @property
    def steps(self) -> list[str]:
        text = IMAGING.read_text()
        m = re.search(r"^STEPS=\(([^)]*)\)", text, re.M)
        assert m, "STEPS array not found in the imaging script"
        return m.group(1).split()

    def test_tunnel_and_network_pin_are_steps(self):
        assert "tunnel" in self.steps
        assert "network-pin" in self.steps

    def test_tunnel_runs_after_the_backend_is_up(self):
        """Verifying the public hostname is meaningless before :8001 listens."""
        s = self.steps
        assert s.index("tunnel") > s.index("ziggy-up")

    def test_network_pin_runs_after_update_channel_and_before_the_gate(self):
        """If applying the pin bounces the link, the hub must already be
        enrolled on the release channel so it can be fixed remotely."""
        s = self.steps
        assert s.index("network-pin") > s.index("update-channel")
        assert s.index("network-pin") < s.index("kit-ready")

    def test_every_step_has_a_dispatch_case_and_a_function(self):
        """A step in STEPS with no case falls through to `_die unknown step`,
        which would fail imaging at the worst possible moment."""
        text = IMAGING.read_text()
        for step in self.steps:
            assert re.search(rf"^\s*{re.escape(step)}\)\s", text, re.M), \
                f"step '{step}' has no dispatch case"
            fn = "step_" + step.replace("-", "_")
            assert f"{fn}()" in text, f"step '{step}' has no {fn} function"

    def test_list_reports_all_steps(self, fakebin, tmp_path):
        _, _, env = fakebin
        env["ZIGGY_ETC_DIR"] = str(tmp_path / "etc")
        r = _run(IMAGING, "--list", env=env)
        assert r.returncode == 0
        for step in self.steps:
            assert step in r.stdout


# ─────────────────────────────────────────────────────────────────────────────
# the Cloudflare connector
# ─────────────────────────────────────────────────────────────────────────────
class TestTunnel:
    def _env(self, fakebin, tmp_path):
        _, _, env = fakebin
        env["ZIGGY_ETC_DIR"] = str(tmp_path / "etc")
        env["ZIGGY_SYSTEMD_DIR"] = str(tmp_path / "systemd")
        (tmp_path / "systemd").mkdir(exist_ok=True)
        return env

    def test_rejects_a_truncated_token(self, fakebin, tmp_path):
        env = self._env(fakebin, tmp_path)
        r = _run(TUNNEL, "--token", "abc123", env=env)
        assert r.returncode != 0
        assert "truncated" in r.stderr.lower()

    def test_refuses_without_any_token(self, fakebin, tmp_path):
        env = self._env(fakebin, tmp_path)
        env.pop("ZIGGY_TUNNEL_TOKEN", None)
        r = _run(TUNNEL, env=env)
        assert r.returncode != 0
        assert "no connector token" in r.stderr.lower()

    def test_dry_run_changes_nothing(self, fakebin, tmp_path):
        env = self._env(fakebin, tmp_path)
        r = _run(TUNNEL, "--dry-run", "--token", VALID_TOKEN, env=env)
        assert r.returncode == 0
        assert not (tmp_path / "systemd" / "ziggy-tunnel.service").exists()
        assert not (tmp_path / "etc" / "tunnel.env").exists()

    def test_installs_unit_and_stores_token(self, fakebin, tmp_path):
        env = self._env(fakebin, tmp_path)
        r = _run(TUNNEL, "--token", VALID_TOKEN, env=env)
        assert r.returncode == 0, r.stderr
        unit = tmp_path / "systemd" / "ziggy-tunnel.service"
        tokfile = tmp_path / "etc" / "tunnel.env"
        assert unit.exists()
        assert tokfile.exists()
        assert tokfile.read_text().strip() == f"TUNNEL_TOKEN={VALID_TOKEN}"

    def test_token_never_appears_in_the_unit_file(self, fakebin, tmp_path):
        """The token is a bearer credential for the home's tunnel. Anything on
        an ExecStart line is visible in `ps` to every local user."""
        env = self._env(fakebin, tmp_path)
        r = _run(TUNNEL, "--token", VALID_TOKEN, env=env)
        assert r.returncode == 0, r.stderr
        unit_text = (tmp_path / "systemd" / "ziggy-tunnel.service").read_text()
        assert VALID_TOKEN not in unit_text
        assert "EnvironmentFile=" in unit_text
        exec_line = next(l for l in unit_text.splitlines() if l.startswith("ExecStart="))
        assert "--token" not in exec_line

    def test_token_file_is_root_only(self, fakebin, tmp_path):
        env = self._env(fakebin, tmp_path)
        _run(TUNNEL, "--token", VALID_TOKEN, env=env)
        mode = (tmp_path / "etc" / "tunnel.env").stat().st_mode
        assert stat.S_IMODE(mode) == 0o600

    def test_reuses_a_stored_token_on_rerun(self, fakebin, tmp_path):
        env = self._env(fakebin, tmp_path)
        assert _run(TUNNEL, "--token", VALID_TOKEN, env=env).returncode == 0
        r = _run(TUNNEL, env=env)  # no --token this time
        assert r.returncode == 0, r.stderr
        assert "reusing" in r.stderr.lower()

    def test_fails_when_the_connector_never_registers(self, fakebin, tmp_path):
        """A wrong or revoked token must fail HERE, not silently at handover."""
        bindir, _, _ = fakebin
        env = self._env(fakebin, tmp_path)
        _write_exec(bindir / "journalctl", 'echo "ERR Unauthorized: invalid token"\nexit 0\n')
        env["ZIGGY_TUNNEL_CONNECT_TIMEOUT_S"] = "2"
        r = _run(TUNNEL, "--token", VALID_TOKEN, env=env)
        assert r.returncode != 0
        assert "never registered" in r.stderr.lower()


# ─────────────────────────────────────────────────────────────────────────────
# the address pin — and, above all, its rollback
# ─────────────────────────────────────────────────────────────────────────────
class TestNetworkPin:
    def _env(self, fakebin, tmp_path):
        _, _, env = fakebin
        etc = tmp_path / "etc"
        netplan = tmp_path / "netplan"
        etc.mkdir(exist_ok=True)
        netplan.mkdir(exist_ok=True)
        env["ZIGGY_ETC_DIR"] = str(etc)
        env["ZIGGY_NETPLAN_DIR"] = str(netplan)
        return env

    def _pin_file(self, tmp_path) -> Path:
        return tmp_path / "netplan" / "60-ziggy-static.yaml"

    def test_pins_the_address_the_router_already_leased(self, fakebin, tmp_path):
        env = self._env(fakebin, tmp_path)
        r = _run(NETPIN, "--pin", "--no-mdns", env=env)
        assert r.returncode == 0, r.stderr
        text = self._pin_file(tmp_path).read_text()
        assert "192.168.1.42/24" in text
        assert "via: 192.168.1.1" in text
        assert "dhcp4: false" in text
        assert "eth0:" in text

    def test_arms_auto_revert_before_touching_the_config(self, fakebin, tmp_path):
        """The whole reason this is safe to run headlessly. If the pin were
        written before the timer was armed, a link that never comes back would
        need a site visit."""
        _, log, _ = fakebin
        env = self._env(fakebin, tmp_path)
        assert _run(NETPIN, "--pin", "--no-mdns", env=env).returncode == 0
        calls = log.read_text().splitlines()
        armed = next(i for i, c in enumerate(calls) if c.startswith("systemd-run"))
        applied = next(i for i, c in enumerate(calls) if c.startswith("netplan"))
        assert armed < applied, f"auto-revert armed too late:\n{calls}"

    def test_refuses_to_pin_without_a_safety_net(self, fakebin, tmp_path):
        """If the rollback timer cannot be armed we must not change anything."""
        env = self._env(fakebin, tmp_path)
        env["FAKE_SYSTEMDRUN_RC"] = "1"
        r = _run(NETPIN, "--pin", "--no-mdns", env=env)
        assert r.returncode != 0
        assert not self._pin_file(tmp_path).exists()
        assert "safety net" in r.stderr.lower()

    def test_reverts_when_connectivity_is_lost(self, fakebin, tmp_path):
        """The failure that matters: config applied, network gone."""
        env = self._env(fakebin, tmp_path)
        env["FAKE_PING_RC"] = "1"
        r = _run(NETPIN, "--pin", "--no-mdns", env=env)
        assert r.returncode != 0
        assert not self._pin_file(tmp_path).exists(), "pin was left in place after losing the network"
        assert "revert" in r.stderr.lower()

    def test_reverts_when_dns_breaks_even_if_the_gateway_answers(self, fakebin, tmp_path):
        """L3 without a resolver still breaks the relay, OTA and the LLM proxy."""
        env = self._env(fakebin, tmp_path)
        env["FAKE_GETENT_RC"] = "1"
        r = _run(NETPIN, "--pin", "--no-mdns", env=env)
        assert r.returncode != 0
        assert not self._pin_file(tmp_path).exists()

    def test_reverts_when_netplan_rejects_the_config(self, fakebin, tmp_path):
        env = self._env(fakebin, tmp_path)
        env["FAKE_NETPLAN_RC"] = "1"
        r = _run(NETPIN, "--pin", "--no-mdns", env=env)
        assert r.returncode != 0
        assert not self._pin_file(tmp_path).exists()

    def test_refuses_when_another_device_holds_the_address(self, fakebin, tmp_path):
        env = self._env(fakebin, tmp_path)
        env["FAKE_ARPING_RC"] = "1"  # a reply arrived => address in use
        r = _run(NETPIN, "--pin", "--no-mdns", env=env)
        assert r.returncode != 0
        assert not self._pin_file(tmp_path).exists()
        assert "already answering" in r.stderr.lower()

    def test_cancels_the_rollback_once_verified(self, fakebin, tmp_path):
        _, log, _ = fakebin
        env = self._env(fakebin, tmp_path)
        assert _run(NETPIN, "--pin", "--no-mdns", env=env).returncode == 0
        calls = log.read_text()
        assert "systemctl stop ziggy-netpin-rollback.timer" in calls

    def test_records_state_for_support(self, fakebin, tmp_path):
        env = self._env(fakebin, tmp_path)
        assert _run(NETPIN, "--pin", "--no-mdns", env=env).returncode == 0
        state = (tmp_path / "etc" / "network-pin.state").read_text()
        assert "state=pinned" in state
        assert "192.168.1.42/24" in state

    # ── the boot guard ──────────────────────────────────────────────────────
    def test_check_is_a_noop_when_not_pinned(self, fakebin, tmp_path):
        env = self._env(fakebin, tmp_path)
        r = _run(NETPIN, "--check", env=env)
        assert r.returncode == 0

    def test_check_keeps_a_healthy_pin(self, fakebin, tmp_path):
        env = self._env(fakebin, tmp_path)
        assert _run(NETPIN, "--pin", "--no-mdns", env=env).returncode == 0
        r = _run(NETPIN, "--check", env=env)
        assert r.returncode == 0
        assert self._pin_file(tmp_path).exists()

    def test_check_reverts_when_the_router_was_replaced(self, fakebin, tmp_path):
        """New router, new subnet: the pinned address cannot reach the gateway.
        Booting unreachable is the worst outcome, so fall back to DHCP."""
        env = self._env(fakebin, tmp_path)
        assert _run(NETPIN, "--pin", "--no-mdns", env=env).returncode == 0
        env["FAKE_PING_RC"] = "1"
        r = _run(NETPIN, "--check", env=env)
        assert r.returncode == 0
        assert not self._pin_file(tmp_path).exists()

    def test_check_reverts_when_our_address_was_taken(self, fakebin, tmp_path):
        """Hub powered off, router leased our address to a new device."""
        env = self._env(fakebin, tmp_path)
        assert _run(NETPIN, "--pin", "--no-mdns", env=env).returncode == 0
        env["FAKE_ARPING_RC"] = "1"
        r = _run(NETPIN, "--check", env=env)
        assert r.returncode == 0
        assert not self._pin_file(tmp_path).exists()

    def test_revert_is_idempotent(self, fakebin, tmp_path):
        env = self._env(fakebin, tmp_path)
        assert _run(NETPIN, "--revert", env=env).returncode == 0
        assert _run(NETPIN, "--revert", env=env).returncode == 0

    def test_dry_run_changes_nothing(self, fakebin, tmp_path):
        env = self._env(fakebin, tmp_path)
        r = _run(NETPIN, "--dry-run", env=env)
        assert r.returncode == 0
        assert not self._pin_file(tmp_path).exists()


# ─────────────────────────────────────────────────────────────────────────────
# the boot guard unit is actually installed
# ─────────────────────────────────────────────────────────────────────────────
class TestGuardUnitWiring:
    def test_guard_unit_exists_and_calls_check(self):
        text = GUARD_UNIT.read_text()
        assert "ziggy-network-pin.sh --check" in text
        assert "Before=ziggy.service" in text, \
            "the guard must fix the network before the stack starts on it"

    def test_installer_installs_and_enables_the_guard(self):
        text = INSTALL_UNITS.read_text()
        units = re.search(r"^UNITS=\((.*?)\)", text, re.M | re.S).group(1)
        services = re.search(r"^SERVICES=\((.*?)\)", text, re.M).group(1)
        assert "ziggy-network-guard.service" in units
        assert "ziggy-network-guard.service" in services

    def test_guard_never_fails_the_boot(self):
        """A guard that hard-fails would leave the hub in a degraded boot for a
        problem it is supposed to be papering over."""
        text = GUARD_UNIT.read_text()
        assert "SuccessExitStatus=0 1" in text
        assert "TimeoutStartSec=" in text


# ─────────────────────────────────────────────────────────────────────────────
# the ship gate refuses a home that cannot be reached or updated
# ─────────────────────────────────────────────────────────────────────────────
KIT_READY = REPO / "scripts" / "factory" / "kit-ready-check.sh"

SYSTEMCTL_FAKE = """
sub=""; unit=""
for a in "$@"; do
  case "$a" in
    is-active|is-enabled) sub="$a" ;;
    ziggy-tunnel.service) unit="tunnel" ;;
    ziggy-update.timer)   unit="timer" ;;
  esac
done
if [[ "$unit" == "tunnel" && "$sub" == "is-active" ]];  then exit ${FAKE_TUNNEL_ACTIVE:-0}; fi
if [[ "$unit" == "tunnel" && "$sub" == "is-enabled" ]]; then exit ${FAKE_TUNNEL_ENABLED:-0}; fi
if [[ "$unit" == "timer"  && "$sub" == "is-enabled" ]]; then exit ${FAKE_TIMER_ENABLED:-0}; fi
exit 0
"""


class TestKitReadyGate:
    def _env(self, fakebin, tmp_path, cohort: str | None = "production"):
        bindir, _, env = fakebin
        _write_exec(bindir / "systemctl", SYSTEMCTL_FAKE)
        etc = tmp_path / "etc"
        etc.mkdir(exist_ok=True)
        if cohort is not None:
            (etc / "ziggy.env").write_text(f"ZIGGY_COHORT={cohort}\n")
        env["ZIGGY_ETC_DIR"] = str(etc)
        env["ZIGGY_REPO_DIR"] = str(tmp_path / "repo")
        (tmp_path / "repo").mkdir(exist_ok=True)
        return env

    def _run_gate(self, env):
        # The gate never exits 0 in a sandbox (no HA, no seal); we assert on the
        # individual result lines it prints, which is what it is designed to
        # surface. --skip-* keeps the mutating/dockered checks out of the way.
        return _run(KIT_READY, "--skip-mqtt", "--skip-backup", "--skip-blank", env=env)

    def test_passes_when_tunnel_and_channel_are_healthy(self, fakebin, tmp_path):
        env = self._env(fakebin, tmp_path)
        out = self._run_gate(env).stdout
        assert "PASS  Cloudflare connector running and enabled at boot" in out
        assert "PASS  update channel enrolled (cohort=production" in out

    def test_fails_when_the_connector_is_not_running(self, fakebin, tmp_path):
        """The exact gap that made 'imaged' and 'reachable' diverge."""
        env = self._env(fakebin, tmp_path)
        env["FAKE_TUNNEL_ACTIVE"] = "3"
        out = self._run_gate(env).stdout
        assert "FAIL" in out and "would ship unreachable" in out

    def test_fails_when_the_connector_is_not_enabled_at_boot(self, fakebin, tmp_path):
        """Running now but not enabled means remote access dies at the first
        power cut — in a customer's home, unattended."""
        env = self._env(fakebin, tmp_path)
        env["FAKE_TUNNEL_ENABLED"] = "1"
        out = self._run_gate(env).stdout
        assert "FAIL" in out and "NOT enabled at boot" in out

    def test_fails_when_the_update_timer_is_not_enabled(self, fakebin, tmp_path):
        env = self._env(fakebin, tmp_path)
        env["FAKE_TIMER_ENABLED"] = "1"
        out = self._run_gate(env).stdout
        assert "FAIL" in out and "could never receive a fix" in out

    def test_fails_when_no_cohort_is_configured(self, fakebin, tmp_path):
        env = self._env(fakebin, tmp_path, cohort=None)
        out = self._run_gate(env).stdout
        assert "FAIL" in out and "no ZIGGY_COHORT" in out

    def test_flags_a_customer_home_left_on_canary(self, fakebin, tmp_path):
        """canary follows origin/main — untagged code — and belongs only on a
        founder bench unit. Say so at the gate, not in the field."""
        env = self._env(fakebin, tmp_path, cohort="canary")
        out = self._run_gate(env).stdout
        assert "cohort=canary" in out and "bench/founder unit" in out

    def test_tunnel_check_is_skippable_for_a_lan_only_bench_unit(self, fakebin, tmp_path):
        env = self._env(fakebin, tmp_path)
        env["FAKE_TUNNEL_ACTIVE"] = "3"
        r = _run(KIT_READY, "--skip-mqtt", "--skip-backup", "--skip-blank",
                 "--skip-tunnel", env=env)
        assert "would ship unreachable" not in r.stdout


# ─────────────────────────────────────────────────────────────────────────────
# the orchestrator refuses to run half-configured
# ─────────────────────────────────────────────────────────────────────────────
class TestNewHomeOrchestrator:
    def _base_env(self, fakebin, tmp_path, secrets: str | None):
        bindir, _, env = fakebin
        _write_exec(bindir / "ssh", "exit 0")
        _write_exec(bindir / "gh", 'echo "gho_faketoken"; exit 0')
        env["HOME"] = str(tmp_path)
        (tmp_path / ".ziggy").mkdir(exist_ok=True)
        if secrets is not None:
            (tmp_path / ".ziggy" / "test-secrets.txt").write_text(secrets)
        return env

    FULL_SECRETS = (
        "RELAY_ADMIN_EMAIL=a@b.c\nRELAY_ADMIN_PASSWORD=x\n"
        "MASTER_KEY_B64=abc\nB2_KEY_ID=k\nB2_APP_KEY=s\n"
    )

    def test_requires_a_host(self, fakebin, tmp_path):
        env = self._base_env(fakebin, tmp_path, self.FULL_SECRETS)
        r = _run(NEW_HOME, "--name", "X", env=env)
        assert r.returncode != 0
        assert "--host is required" in r.stderr

    def test_names_the_missing_secret(self, fakebin, tmp_path):
        """Discovering a missing B2 key at seal time wastes a whole run."""
        partial = "RELAY_ADMIN_EMAIL=a@b.c\nRELAY_ADMIN_PASSWORD=x\nMASTER_KEY_B64=abc\n"
        env = self._base_env(fakebin, tmp_path, partial)
        r = _run(NEW_HOME, "--host", "ziggy@10.0.0.5", "--name", "X",
                 "--owner", "o@e.com", "--dry-run", env=env)
        assert r.returncode != 0
        assert "B2_KEY_ID" in r.stderr and "B2_APP_KEY" in r.stderr

    def test_fails_without_any_secrets_file(self, fakebin, tmp_path):
        env = self._base_env(fakebin, tmp_path, None)
        r = _run(NEW_HOME, "--host", "ziggy@10.0.0.5", "--name", "X",
                 "--owner", "o@e.com", "--dry-run", env=env)
        assert r.returncode != 0
        assert "secrets file" in r.stderr.lower()

    def test_dry_run_reports_the_release_it_would_image(self, fakebin, tmp_path):
        env = self._base_env(fakebin, tmp_path, self.FULL_SECRETS)
        r = _run(NEW_HOME, "--host", "ziggy@10.0.0.5", "--name", "X",
                 "--owner", "o@e.com", "--dry-run", env=env)
        assert r.returncode == 0, r.stderr
        assert re.search(r"release-\d{4}\.\d{2}\.\d{2}", r.stderr), \
            "the operator must be told which release the home will land on"

    def test_never_passes_the_github_token_as_an_argument(self):
        """argv is world-readable via `ps`, and lands in shell history."""
        text = NEW_HOME.read_text()
        assert "export GH_TOKEN=%q" in text, "token must be streamed over stdin"
        assert not re.search(r"GH_TOKEN=\$\{?GH_TOKEN_VALUE\}? ", text)
        assert not re.search(r"ssh .*GH_TOKEN=", text)

    def test_rejects_an_invalid_coordinator_type(self, fakebin, tmp_path):
        """coordinator_type is sealed into kit_manifest.yaml. The seal step
        rejects a bad value too, but that is eight steps into a run."""
        env = self._base_env(fakebin, tmp_path, self.FULL_SECRETS)
        r = _run(NEW_HOME, "--host", "ziggy@10.0.0.5", "--name", "X",
                 "--owner", "o@e.com", "--coordinator-type", "sonof", "--dry-run", env=env)
        assert r.returncode != 0
        assert "smlight" in r.stderr and "sonoff_e" in r.stderr

    @pytest.mark.parametrize("ctype", ["smlight", "sonoff_e"])
    def test_accepts_the_two_real_coordinator_types(self, fakebin, tmp_path, ctype):
        env = self._base_env(fakebin, tmp_path, self.FULL_SECRETS)
        r = _run(NEW_HOME, "--host", "ziggy@10.0.0.5", "--name", "X",
                 "--owner", "o@e.com", "--coordinator-type", ctype, "--dry-run", env=env)
        assert r.returncode == 0, r.stderr

    def test_passes_coordinator_through_to_imaging(self):
        """Left unset, imaging defaults to smlight AND to a hardcoded Sonoff
        by-id path — so a mismatched kit seals a manifest describing hardware
        it does not have."""
        text = NEW_HOME.read_text()
        assert "COORDINATOR_TYPE=%s" in text
        assert "ZIGBEE_COORDINATOR_DEVICE=%s" in text

    def test_runs_under_bash_3_2(self, fakebin, tmp_path):
        """macOS still ships bash 3.2 and this script runs on the operator's
        Mac — mapfile/declare -A/${x,,} would fail only in the field."""
        env = self._base_env(fakebin, tmp_path, self.FULL_SECRETS)
        r = subprocess.run(
            ["/bin/bash", str(NEW_HOME), "--host", "ziggy@10.0.0.5", "--name", "X",
             "--owner", "o@e.com", "--dry-run"],
            capture_output=True, text=True, env=env, cwd=str(REPO), timeout=120,
        )
        assert r.returncode == 0, r.stderr
        assert "mapfile" not in r.stderr and "syntax error" not in r.stderr

    def test_secrets_go_to_tmpfs_and_are_shredded(self):
        text = NEW_HOME.read_text()
        assert "/dev/shm/" in text, "imaging secrets must live in RAM, not on the SSD"
        assert "shred -u" in text
        assert "trap _cleanup EXIT INT TERM" in text, \
            "secrets must be shredded even when the operator interrupts the run"
