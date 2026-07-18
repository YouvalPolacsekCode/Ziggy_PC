"""Command path records intent into the command ledger (self-heal correlation)."""
import types

import services.home_automation as ha
import services.command_ledger as cl


class _Resp:
    def __init__(self, status=200, body=None):
        self.status_code = status
        self._body = body or {}
        self.text = "ok"

    def json(self):
        return self._body


def setup_function():
    cl._last.clear()


def _fake_session(resp):
    return types.SimpleNamespace(post=lambda *a, **k: resp,
                                 get=lambda *a, **k: resp)


def test_call_service_turn_on_records_on(monkeypatch):
    monkeypatch.setattr(ha, "_session", _fake_session(_Resp(200)))
    ha.call_service("light", "turn_on", {"entity_id": "light.kitchen"})
    rec = cl.get_last("light.kitchen")
    assert rec and rec["state"] == "on" and rec["origin"] == "ziggy"


def test_call_service_turn_off_records_off(monkeypatch):
    monkeypatch.setattr(ha, "_session", _fake_session(_Resp(200)))
    ha.call_service("switch", "turn_off", {"entity_id": "switch.fan"})
    rec = cl.get_last("switch.fan")
    assert rec and rec["state"] == "off"


def test_origin_self_heal_propagates(monkeypatch):
    monkeypatch.setattr(ha, "_session", _fake_session(_Resp(200)))
    ha.call_service("light", "turn_on", {"entity_id": "light.kitchen"}, origin="self_heal")
    assert cl.get_last("light.kitchen")["origin"] == "self_heal"


def test_toggle_infers_from_cache(monkeypatch):
    monkeypatch.setattr(ha, "_session", _fake_session(_Resp(200)))
    monkeypatch.setattr(ha, "_state_from_cache", lambda eid: {"state": "off"})
    ha.call_service("light", "toggle", {"entity_id": "light.kitchen"})
    assert cl.get_last("light.kitchen")["state"] == "on"


def test_toggle_light_helper_records(monkeypatch):
    monkeypatch.setattr(ha, "_session", _fake_session(_Resp(200)))
    ha.toggle_light("light.kitchen", turn_on=False)
    assert cl.get_last("light.kitchen")["state"] == "off"


def test_non_controllable_domain_not_recorded(monkeypatch):
    monkeypatch.setattr(ha, "_session", _fake_session(_Resp(200)))
    ha.call_service("sensor", "turn_on", {"entity_id": "sensor.temp"})
    assert cl.get_last("sensor.temp") is None
