"""Room keys must survive non-Latin area names.

REGRESSION (2026-08-08, Tslil's home / Ziggy_03): assigning a device to a
Hebrew-named room made it vanish from every room view while the device page
still showed the room. Both screens were honest — they read different stores.

The room key was derived by slugifying the area's DISPLAY NAME with
`re.sub(r"[^a-z0-9]+", "_", name)`. That keeps only ASCII, so every Hebrew name
collapsed to "". Stored next to room_source="user", the empty string is poison
twice over:

  1. `if not room:` in /api/rooms/devices sends the device to `no_room`, so it
     shows up in no room at all.
  2. HA-area adoption starts with `if room_source == "user": continue`, so the
     correct HA area is never adopted and the state can never self-heal.

Hebrew is this product's primary language, so this stranded every device a
Hebrew-speaking customer assigned. HA already solves the transliteration
("סלון" → "slvn"); the fix is to use HA's area_id instead of re-deriving one.
"""
import pytest

from backend.routers.device_router import _area_to_room_key, _norm_room_key


# Real areas from Tslil's home, as HA stores them.
HEBREW_AREAS = [
    ({"area_id": "slvn", "name": "סלון"}, "slvn"),
    ({"area_id": "khdr_shynh", "name": "חדר שינה"}, "khdr_shynh"),
    ({"area_id": "mtbkh", "name": "מטבח"}, "mtbkh"),
    ({"area_id": "msdrvn", "name": "מסדרון"}, "msdrvn"),
    ({"area_id": "mrpst", "name": "מרפסת"}, "mrpst"),
]


@pytest.mark.parametrize("area,expected", HEBREW_AREAS)
def test_hebrew_area_yields_its_ha_area_id(area, expected):
    assert _area_to_room_key(area) == expected


@pytest.mark.parametrize("area,_expected", HEBREW_AREAS)
def test_hebrew_area_never_yields_empty(area, _expected):
    """The specific failure: "" is falsy, so it reads as an explicit no-room."""
    key = _area_to_room_key(area)
    assert key, f"{area['name']} produced a falsy key ({key!r}) — device would strand in No Room"


def test_the_old_name_slug_would_have_failed():
    """Pin the actual defect so nobody reintroduces name-based slugging."""
    for area, _ in HEBREW_AREAS:
        assert _norm_room_key(area["name"]) == "", (
            "name-slugging Hebrew is expected to collapse to '' — that is why "
            "_area_to_room_key must use the HA area_id instead"
        )


def test_latin_area_still_uses_its_area_id():
    assert _area_to_room_key({"area_id": "living_room", "name": "Living Room"}) == "living_room"


def test_apostrophe_area_is_stable():
    """"Roni's Room" split into two cards before; the id keeps one identity."""
    assert _area_to_room_key({"area_id": "roni_s_room", "name": "Roni's Room"}) == "roni_s_room"


def test_get_areas_shape_is_accepted():
    """services.ha_areas.get_areas() returns `id`; the WS API returns `area_id`."""
    assert _area_to_room_key({"id": "slvn", "name": "סלון"}) == "slvn"


def test_missing_id_falls_back_to_name_slug():
    assert _area_to_room_key({"name": "Kitchen"}) == "kitchen"


def test_unusable_area_returns_none_not_empty_string():
    """None means "no room". "" would masquerade as a deliberate user choice."""
    assert _area_to_room_key({"name": "סלון"}) is None
    assert _area_to_room_key({}) is None
