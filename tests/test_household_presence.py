"""Household presence: one person per account, and a picker that lists
everyone — not just the phones that happen to have checked in already.

Two real defects are locked down here, both found on a live home on
2026-09-22:

  1. A duplicate person ("Silentyouval" + "Silentyouval 2", same account, the
     second never reporting anything). `_resolve_or_create_my_person` read the
     persons file TWICE — once to look for a match, once to create — and a
     concurrent request slipped in between. The collision-avoidance loop then
     renamed the loser instead of returning the record that had just appeared.

  2. The automation wizard could not offer anyone to trigger on, because it
     listed HA `person.*` entities and Ziggy never creates those.
"""

import importlib
import threading

import pytest


@pytest.fixture()
def presence(tmp_path, monkeypatch):
    """presence_router + presence_engine pointed at one temp persons file.

    Both modules keep their own `_REGISTRY` path to the same persons.json, so
    both have to be redirected or the test writes one file and reads another.
    """
    import backend.routers.presence_router as pr
    import services.presence_engine as pe

    store = tmp_path / "persons.json"
    store.write_text("[]")
    monkeypatch.setattr(pr, "_REGISTRY", store)
    monkeypatch.setattr(pe, "_REGISTRY", store)
    return pr, pe, store


def test_concurrent_first_use_creates_one_person(presence):
    """The duplicate-ghost bug. Ten threads, one account, one person."""
    pr, pe, _ = presence
    user = {"username": "rachel@example.com", "display_name": "Rachel"}

    barrier = threading.Barrier(10)
    results, errors = [], []

    def go():
        try:
            barrier.wait(timeout=5)
            results.append(pr._resolve_or_create_my_person(user))
        except Exception as exc:  # pragma: no cover - surfaces as a failure below
            errors.append(exc)

    threads = [threading.Thread(target=go) for _ in range(10)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10)

    assert not errors, errors
    assert len(results) == 10
    ids = {r["id"] for r in results}
    assert len(ids) == 1, f"expected one person, got {len(ids)}"

    persons = pe.list_persons()
    assert len(persons) == 1, [p["name"] for p in persons]
    # And crucially NOT the "<Name> 2" shape the collision loop used to mint.
    assert persons[0]["name"] == "Rachel"


def test_person_is_named_from_the_account_not_the_email(presence):
    """An invited member is 'Rachel', not 'rachel.cohen'."""
    pr, pe, _ = presence
    pr._resolve_or_create_my_person(
        {"username": "rachel.cohen@example.com", "display_name": "Rachel"}
    )
    assert pe.list_persons()[0]["name"] == "Rachel"


def test_account_without_display_name_falls_back_to_email_local_part(presence):
    """Accounts predating the column keep the name they already had."""
    pr, pe, _ = presence
    pr._resolve_or_create_my_person({"username": "youval@example.com"})
    assert pe.list_persons()[0]["name"] == "Youval"


def test_display_name_for_prefers_explicit_then_derives():
    from services import auth_db
    assert auth_db.display_name_for({"username": "a@b.com", "display_name": "Rachel"}) == "Rachel"
    assert auth_db.display_name_for({"username": "rachel.cohen@b.com"}) == "Rachel.cohen"
    assert auth_db.display_name_for({"username": "", "display_name": " "}) == "Me"


def test_household_lists_invited_members_before_their_phone_reports(presence, monkeypatch):
    """The wizard's whole point: automate for someone who hasn't set up a phone.

    An account with no presence record must still appear, flagged untracked,
    so "when Rachel gets home" is writable the moment Rachel is invited.
    """
    import asyncio
    pr, pe, _ = presence

    # Youval is tracked (his phone has reported); Rachel was invited an hour ago.
    pr._resolve_or_create_my_person({"username": "youval@example.com", "display_name": "Youval"})
    persons = pr._load()
    persons[0]["last_seen"] = "2026-09-22T05:00:00+00:00"
    persons[0]["state"] = "home"
    pr._save(persons)

    monkeypatch.setattr(
        "services.auth_db.list_users",
        lambda: [
            {"username": "youval@example.com", "display_name": "Youval", "role": "super_admin"},
            {"username": "rachel@example.com", "display_name": "Rachel", "role": "user"},
        ],
    )

    out = asyncio.run(pr.list_household(_user={"username": "youval@example.com"}))
    members = {m["name"]: m for m in out["household"]}

    assert set(members) == {"Youval", "Rachel"}
    assert members["Youval"]["tracked"] is True
    assert members["Youval"]["state"] == "home"
    # Rachel is offerable, and honestly labelled as not-yet-reporting.
    assert members["Rachel"]["tracked"] is False
    assert members["Rachel"]["state"] is None
    # Tracked people sort first.
    assert out["household"][0]["name"] == "Youval"


def test_rename_moves_the_person_and_the_automations_with_it(presence, monkeypatch, tmp_path):
    """Triggers match on the NAME, so a rename has to carry them along.

    Renaming only the account would leave "when Youval gets home" naming a
    person who no longer answers to it — the automation would sit there
    looking correct and never fire again.
    """
    import asyncio
    import core.automation_file as af
    pr, pe, _ = presence

    pr._resolve_or_create_my_person({"username": "y@example.com", "display_name": "Silentyouval"})

    autos = tmp_path / "automations.json"
    autos.write_text("[]")
    monkeypatch.setattr(af, "AUTOMATION_FILE", str(autos))

    af.create_automation({
        "id": "hall", "name": "Hall light",
        "trigger": {"type": "person_arrives", "person": "Silentyouval"},
        "actions": [{"type": "turn_off_all_lights"}],
    })
    af.create_automation({
        "id": "other", "name": "Someone else",
        "trigger": {"type": "person_arrives", "person": "Rachel"},
        "actions": [{"type": "turn_off_all_lights"}],
    })

    renamed = {}
    monkeypatch.setattr("services.auth_db.get_user_by_username",
                        lambda u: {"username": u, "display_name": "Silentyouval", "role": "super_admin"})
    monkeypatch.setattr("services.auth_db.update_display_name",
                        lambda u, n: renamed.setdefault(u, n) or True)

    out = asyncio.run(pr.rename_household_member(
        "y@example.com",
        pr.RenameMemberBody(name="Youval"),
        current={"username": "y@example.com", "role": "super_admin"},
    ))

    assert out["ok"] is True and out["name"] == "Youval"
    assert renamed["y@example.com"] == "Youval"
    # The presence record moved...
    assert pe.list_persons()[0]["name"] == "Youval"
    # ...and so did the automation that named them — but not anyone else's.
    by_id = {a["id"]: a for a in af.list_automations()}
    assert by_id["hall"]["trigger"]["person"] == "Youval"
    assert by_id["other"]["trigger"]["person"] == "Rachel"
    assert out["automations_updated"] == 1


def test_rename_rejects_a_name_someone_else_already_has(presence, monkeypatch):
    import asyncio
    pr, pe, _ = presence
    pr._resolve_or_create_my_person({"username": "y@example.com", "display_name": "Youval"})
    pr._resolve_or_create_my_person({"username": "r@example.com", "display_name": "Rachel"})

    monkeypatch.setattr("services.auth_db.get_user_by_username",
                        lambda u: {"username": u, "display_name": "Youval", "role": "user"})

    with pytest.raises(Exception) as exc:
        asyncio.run(pr.rename_household_member(
            "y@example.com",
            pr.RenameMemberBody(name="Rachel"),
            current={"username": "y@example.com", "role": "super_admin"},
        ))
    assert "409" in str(exc.value) or "already has that name" in str(exc.value)
    # Nothing moved.
    assert {p["name"] for p in pe.list_persons()} == {"Youval", "Rachel"}


def test_native_presence_triggers_stay_out_of_home_assistant():
    """person_arrives/leaves/all_persons_left run on Ziggy's engine.

    If `needs_ha` ever starts claiming these, they'd be written to HA — which
    has no person entity to bind them to — and would silently never fire.
    """
    from services.ha_automations import needs_ha
    for t in ("person_arrives", "person_leaves", "all_persons_left"):
        assert needs_ha({"trigger": {"type": t}}) is False, t
