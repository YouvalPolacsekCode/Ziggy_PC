"""Phase-2: the agent's remediations are gated by the PDP autonomy ladder.

Safe reads/fixes → 'act'/'confirm' (autonomous). Risky (shell/config/restart/
repair) → 'ask' (needs an explicit human yes). host/CRITICAL → denied to the
agent entirely. Acting on behalf of a person can never exceed that person.

The gate is enforced BELOW the LLM — a hijacked prompt cannot talk past it.
"""
import pytest

from services.permissions.service import PermissionService
from services.permissions.store import PolicyStore
from services.permissions import runtime
from services.permissions.reconcile import HOME_ID
from core.agent import authz


@pytest.fixture
def svc(tmp_path):
    s = PermissionService(store=PolicyStore(str(tmp_path / "perm.db")))
    s.add_space(HOME_ID, "home", actor="test")
    authz.seed_agent_principal(s)
    runtime.set_service(s)
    yield s
    runtime.set_service(None)


def test_read_health_is_autonomous(svc):
    v = authz.gate("system.read_health")
    assert v.may_act is True and v.mode == "act"


def test_refresh_device_is_autonomous(svc):
    # auto-safe fix (do it and tell them) — diagnostics tag keeps it 'act'.
    v = authz.gate("system.refresh_device")
    assert v.may_act is True and v.mode == "act"


def test_reload_connectivity_is_confirm_with_undo_and_notify(svc):
    v = authz.gate("system.reload_coordinator")
    assert v.may_act is True and v.mode == "confirm"
    kinds = " ".join(o.to_json().get("kind", "") for o in v.obligations).lower()
    assert "undo" in kinds and "notify" in kinds


def test_shell_diagnostic_needs_human_yes(svc):
    v = authz.gate("system.exec_diagnostic")
    assert v.may_act is False and v.mode == "ask"
    ok = authz.gate("system.exec_diagnostic", explicit_confirm=True)
    assert ok.may_act is True and ok.mode == "ask"


def test_restart_service_is_ask(svc):
    v = authz.gate("system.restart_service")
    assert v.may_act is False and v.mode == "ask"


def test_edit_config_is_ask(svc):
    v = authz.gate("system.edit_config")
    assert v.may_act is False and v.mode == "ask"


def test_repair_device_is_ask(svc):
    v = authz.gate("system.repair_device")
    assert v.may_act is False and v.mode == "ask"


def test_host_privileged_denied_even_with_confirm(svc):
    v = authz.gate("system.exec_privileged")
    assert v.may_act is False and v.mode == "deny"
    still = authz.gate("system.exec_privileged", explicit_confirm=True)
    assert still.may_act is False, "host/CRITICAL is outside the agent envelope"


def test_delegation_cannot_exceed_the_person(svc):
    # person:nobody has no grants → agent acting for them is denied.
    v = authz.gate("system.read_health", on_behalf_of="person:nobody")
    assert v.may_act is False


# ── check(): the fail-open wrapper the tools actually call ───────────────────
#
# The tools must never REGRESS an action that auto-runs today. A home whose PDP
# was never bootstrapped (agent principal unseeded / no home space) has no
# policy to enforce — so the gate steps out of the way instead of blocking.


def test_check_allows_a_seeded_safe_action(svc):
    may_act, mode = authz.check("system.refresh_device")
    assert may_act is True and mode == "act"


def test_check_fails_open_when_the_agent_principal_is_unseeded(tmp_path):
    bare = PermissionService(store=PolicyStore(str(tmp_path / "bare.db")))
    bare.add_space(HOME_ID, "home", actor="test")   # home exists, agent never seeded
    runtime.set_service(bare)
    try:
        may_act, mode = authz.check("system.reload_coordinator")
        assert may_act is True, "an unbootstrapped PDP must not block today's auto-fix"
        assert mode == "open"
    finally:
        runtime.set_service(None)


def test_check_fails_open_when_the_home_space_is_missing(tmp_path):
    bare = PermissionService(store=PolicyStore(str(tmp_path / "nohome.db")))
    authz.seed_agent_principal(bare)                # agent seeded, but no space:home
    runtime.set_service(bare)
    try:
        may_act, mode = authz.check("system.refresh_device")
        assert may_act is True and mode == "open"
    finally:
        runtime.set_service(None)


def test_check_fails_open_when_the_pdp_blows_up(svc, monkeypatch):
    def boom():
        raise RuntimeError("policy store unavailable")
    monkeypatch.setattr("services.permissions.runtime.get_service", boom)
    may_act, mode = authz.check("system.refresh_device")
    assert may_act is True and mode == "open"


def test_check_blocks_when_autonomy_is_dialled_down(svc):
    # Operator drops the agent to 'ask' for safe fixes → it must stop acting alone.
    svc.add_principal(authz.AGENT_REF,
                      attrs={"autonomy": {"diagnostics": "ask"}, "default_autonomy": "ask"},
                      actor="test")
    may_act, mode = authz.check("system.refresh_device")
    assert may_act is False and mode == "ask"


def test_check_clamps_to_a_limited_person(svc):
    # A person the PDP KNOWS but who may not do this → the agent can't do it for them.
    svc.add_principal("person:kid", attrs={}, actor="test")
    may_act, mode = authz.check("system.refresh_device", on_behalf_of="person:kid")
    assert may_act is False and mode == "deny"


def test_check_ignores_an_unknown_person(svc):
    # An actor the PDP has no record of carries no restriction to intersect with —
    # clamping there would break the fixer for every un-mirrored user.
    may_act, mode = authz.check("system.refresh_device", on_behalf_of="person:ghost")
    assert may_act is True and mode == "act"
