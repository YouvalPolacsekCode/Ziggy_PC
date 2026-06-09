"""
Tests for the vendor-agnostic blaster abstraction.

These tests don't require the broadlink package — they verify the registry
chooses the right adapter for a given device record and that capability
profiles match documented behavior. Adapter I/O is tested at integration
level (would need real hardware) and is out of scope here.
"""
from __future__ import annotations

import pytest

from services.ir_blaster import (
    Blaster,
    BlasterCapabilities,
    BlasterInfo,
    BroadlinkBlaster,
    AvattoHABlaster,
    get_blaster,
    describe_capabilities,
    _vendor_from_device,
)


# ---------------------------------------------------------------------------
# Vendor inference
# ---------------------------------------------------------------------------

class TestVendorInference:
    def test_explicit_vendor_wins(self):
        device = {"blaster_vendor": "avatto", "blaster_host": "10.0.0.5"}
        assert _vendor_from_device(device) == "avatto"

    def test_default_is_broadlink_for_legacy_records(self):
        # Pre-abstraction installs have no vendor field but always have a host.
        device = {"blaster_host": "10.0.0.5"}
        assert _vendor_from_device(device) == "broadlink"

    def test_uppercase_vendor_normalized(self):
        device = {"blaster_vendor": "BROADLINK"}
        assert _vendor_from_device(device) == "broadlink"

    def test_empty_vendor_falls_through_to_default(self):
        device = {"blaster_vendor": "  ", "blaster_host": "10.0.0.5"}
        assert _vendor_from_device(device) == "broadlink"


# ---------------------------------------------------------------------------
# Registry adapter selection
# ---------------------------------------------------------------------------

class TestGetBlaster:
    def test_broadlink_record_returns_broadlink_adapter(self):
        device = {
            "id": "ir_abc",
            "blaster_host": "10.0.0.5",
            "blaster_mac": "aabbccddeeff",
        }
        bl = get_blaster(device)
        assert isinstance(bl, BroadlinkBlaster)
        assert bl.info.host == "10.0.0.5"
        assert bl.info.mac == "aabbccddeeff"
        assert bl.info.vendor == "broadlink"

    def test_avatto_record_returns_avatto_adapter(self):
        device = {
            "id": "ir_xyz",
            "blaster_vendor": "avatto",
            "blaster_entity_id": "remote.living_room_blaster",
        }
        bl = get_blaster(device)
        assert isinstance(bl, AvattoHABlaster)
        assert bl.info.extras["blaster_entity_id"] == "remote.living_room_blaster"

    def test_broadlink_without_host_returns_none(self):
        device = {"id": "ir_abc", "blaster_vendor": "broadlink"}
        assert get_blaster(device) is None

    def test_avatto_without_entity_returns_none(self):
        device = {"id": "ir_abc", "blaster_vendor": "avatto"}
        assert get_blaster(device) is None

    def test_unknown_vendor_falls_back_to_broadlink_when_host_present(self):
        # Conservative fallback — never break existing installs by introducing
        # the abstraction.
        device = {
            "id": "ir_abc",
            "blaster_vendor": "mystery_brand",
            "blaster_host": "10.0.0.5",
        }
        bl = get_blaster(device)
        assert isinstance(bl, BroadlinkBlaster)


# ---------------------------------------------------------------------------
# Capability profiles — the contract the UI and listener rely on
# ---------------------------------------------------------------------------

class TestCapabilityProfiles:
    def test_broadlink_supports_full_feedback(self):
        info = BlasterInfo(id="x", vendor="broadlink", host="10.0.0.5")
        bl = BroadlinkBlaster(info)
        caps = bl.capabilities
        assert caps.can_send and caps.can_learn and caps.can_listen
        assert caps.supports_feedback is True

    def test_avatto_ha_routed_supports_send_and_learn_only(self):
        info = BlasterInfo(
            id="x", vendor="avatto",
            extras={"blaster_entity_id": "remote.x"},
        )
        bl = AvattoHABlaster(info)
        caps = bl.capabilities
        assert caps.can_send and caps.can_learn
        assert caps.can_listen is False
        assert caps.supports_feedback is False  # the demo moment isn't available

    def test_describe_capabilities_for_broadlink_device(self):
        device = {"id": "x", "blaster_host": "10.0.0.5"}
        snap = describe_capabilities(device)
        assert snap["vendor"] == "broadlink"
        assert snap["supports_feedback"] is True

    def test_describe_capabilities_for_avatto_device(self):
        device = {
            "id": "x",
            "blaster_vendor": "avatto",
            "blaster_entity_id": "remote.x",
        }
        snap = describe_capabilities(device)
        assert snap["vendor"] == "avatto"
        assert snap["supports_feedback"] is False

    def test_describe_capabilities_for_misconfigured_device(self):
        device = {"id": "x", "blaster_vendor": "broadlink"}  # no host
        snap = describe_capabilities(device)
        assert snap["can_send"] is False
        assert snap["supports_feedback"] is False


# ---------------------------------------------------------------------------
# Protocol conformance — anything satisfying the Protocol passes
# ---------------------------------------------------------------------------

class TestProtocolConformance:
    def test_broadlink_satisfies_blaster_protocol(self):
        info = BlasterInfo(id="x", vendor="broadlink", host="10.0.0.5")
        assert isinstance(BroadlinkBlaster(info), Blaster)

    def test_avatto_satisfies_blaster_protocol(self):
        info = BlasterInfo(
            id="x", vendor="avatto",
            extras={"blaster_entity_id": "remote.x"},
        )
        assert isinstance(AvattoHABlaster(info), Blaster)


# ---------------------------------------------------------------------------
# Send-side error contracts — Avatto can't do raw, must say so explicitly
# ---------------------------------------------------------------------------

class TestSendContracts:
    @pytest.mark.asyncio
    async def test_avatto_raw_send_raises_clear_error(self):
        info = BlasterInfo(
            id="x", vendor="avatto",
            extras={"blaster_entity_id": "remote.x"},
        )
        bl = AvattoHABlaster(info)
        with pytest.raises(NotImplementedError, match="raw"):
            await bl.send_raw("AAAA", repeat=0)

    @pytest.mark.asyncio
    async def test_avatto_listen_raises_clear_error(self):
        info = BlasterInfo(
            id="x", vendor="avatto",
            extras={"blaster_entity_id": "remote.x"},
        )
        bl = AvattoHABlaster(info)
        with pytest.raises(NotImplementedError, match="RX"):
            await bl.listen(lambda p, r: None)
