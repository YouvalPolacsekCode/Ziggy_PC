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
