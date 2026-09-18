"""FP300 profile: the radar's absence timer is raised once, when the device is
awake, and the owner's later choices are respected."""
import importlib

import pytest

IEEE = "0x54ef4410015c03e9"
PRES = f"binary_sensor.{IEEE}_presence"
PIR = f"binary_sensor.{IEEE}_pir_detection"
TIMER = f"number.{IEEE}_absence_delay_timer"


@pytest.fixture
def sp(tmp_path, monkeypatch):
    laa = importlib.import_module("services.local_automation_actions")
    monkeypatch.setattr(laa, "STATE_FILE", str(tmp_path / "state.json"))
    mod = importlib.import_module("services.sensor_profiles")
    mod._settled.clear()
    monkeypatch.setattr(mod, "_cfg", lambda: {"enabled": True, "fp300_absence_delay_s": 120})
    return mod


def _cache(timer="10", with_pir=True):
    c = {PRES: {"state": "on"}, TIMER: {"state": timer}}
    if with_pir:
        c[PIR] = {"state": "on"}
    return c


def test_recognises_fp300_report_entities(sp):
    assert sp.fp300_ieee(PRES) == IEEE
    assert sp.fp300_ieee(PIR) == IEEE
    assert sp.fp300_ieee("binary_sensor.0x00158d008c7d0d8e_occupancy") is None
    assert sp.fp300_ieee("light.0xa4c138fe4ba31d47") is None


def test_writes_profile_when_device_speaks_with_low_timer(sp):
    sent = []
    out = sp.on_device_report(PRES, _cache("10"), now=1000.0,
                              set_value=lambda eid, v: sent.append((eid, v)) or True)
    assert out == "sent"
    assert sent == [(TIMER, 120)]


def test_not_an_fp300_without_pir_sibling(sp):
    sent = []
    out = sp.on_device_report(PRES, _cache("10", with_pir=False), now=1000.0,
                              set_value=lambda eid, v: sent.append(1) or True)
    assert out == "ignored" and sent == []


def test_settles_once_timer_reads_target_and_never_touches_again(sp):
    sent = []
    sp.on_device_report(PRES, _cache("10"), now=1000.0,
                        set_value=lambda eid, v: sent.append(v) or True)
    # Device confirmed the write; next report sees 120.
    assert sp.on_device_report(PIR, _cache("120"), now=1100.0,
                               set_value=lambda eid, v: sent.append(v) or True) == "done"
    # Owner later lowers it on purpose: Ziggy stays out of it.
    assert sp.on_device_report(PRES, _cache("30"), now=5000.0,
                               set_value=lambda eid, v: sent.append(v) or True) == "already"
    assert sent == [120]


def test_already_sane_device_is_marked_done_without_a_write(sp):
    sent = []
    assert sp.on_device_report(PRES, _cache("180"), now=1000.0,
                               set_value=lambda eid, v: sent.append(v) or True) == "done"
    assert sent == []


def test_retry_is_rate_limited_and_bounded(sp):
    sent = []
    sv = lambda eid, v: sent.append(v) or True
    assert sp.on_device_report(PRES, _cache("10"), now=1000.0, set_value=sv) == "sent"
    assert sp.on_device_report(PIR, _cache("10"), now=1010.0, set_value=sv) == "skipped"
    t = 1000.0
    for _ in range(4):
        t += 61
        assert sp.on_device_report(PRES, _cache("10"), now=t, set_value=sv) == "sent"
    assert sp.on_device_report(PRES, _cache("10"), now=t + 61, set_value=sv) == "exhausted"
    assert len(sent) == 5


def test_disabled_by_settings(sp, monkeypatch):
    monkeypatch.setattr(sp, "_cfg", lambda: {"enabled": False})
    sent = []
    assert sp.on_device_report(PRES, _cache("10"), now=1000.0,
                               set_value=lambda eid, v: sent.append(v) or True) == "disabled"
    assert sent == []


def test_unavailable_timer_waits(sp):
    sent = []
    assert sp.on_device_report(PRES, _cache("unavailable"), now=1000.0,
                               set_value=lambda eid, v: sent.append(v) or True) == "ignored"
    assert sent == []


def test_subscriber_hook_is_wired():
    """The prod path is ha_subscriber under uvicorn; the profile must hang off it."""
    src = open("services/ha_subscriber.py", encoding="utf-8").read()
    assert "sensor_profiles" in src and "on_device_report_async" in src
