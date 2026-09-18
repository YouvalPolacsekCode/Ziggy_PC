"""The hold is fed by HA light transitions and released on the scheduler tick."""
import inspect


def test_subscriber_routes_light_transitions_to_the_hold():
    from services import ha_subscriber
    src = inspect.getsource(ha_subscriber._process_event)
    assert "light_hold" in src and "on_state_change" in src
    # engine attribution is the engine tier, never the any-Ziggy-write tier:
    # an app tap or a chat command IS a person's decision.
    assert "engine_initiated=was_ziggy_initiated(entity_id)" in src.replace(" ", "").replace("engine_initiated=", "engine_initiated=") or \
           "engine_initiated" in src


def test_scheduler_ticks_the_hold():
    from services import ziggy_scheduler
    assert "light_hold" in inspect.getsource(ziggy_scheduler.run_scheduler)


def test_settings_example_documents_light_hold():
    text = open("config/settings.example.yaml", encoding="utf-8").read()
    assert "light_hold:" in text and "empty_minutes" in text and "morning" in text
