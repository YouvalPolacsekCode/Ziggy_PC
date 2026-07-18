"""Tests for services.command_ledger."""
import time

import services.command_ledger as cl


def setup_function():
    cl._last.clear()


def test_record_and_get_last():
    cl.record("light.kitchen", "on", origin="ziggy")
    rec = cl.get_last("light.kitchen")
    assert rec is not None
    assert rec["state"] == "on"
    assert rec["origin"] == "ziggy"
    assert isinstance(rec["ts"], float)
    assert "_exp" not in rec  # internal key stripped


def test_origin_propagates():
    cl.record("light.kitchen", "on", origin="self_heal")
    assert cl.get_last("light.kitchen")["origin"] == "self_heal"


def test_none_intended_not_recorded():
    cl.record("light.kitchen", None)
    assert cl.get_last("light.kitchen") is None


def test_unknown_entity_returns_none():
    assert cl.get_last("light.nope") is None


def test_expiry():
    cl.record("light.kitchen", "on", ttl=0.05)
    assert cl.get_last("light.kitchen") is not None
    time.sleep(0.08)
    assert cl.get_last("light.kitchen") is None


def test_clear():
    cl.record("light.kitchen", "on")
    cl.clear("light.kitchen")
    assert cl.get_last("light.kitchen") is None
