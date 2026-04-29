from __future__ import annotations
from services import reference_manager


async def handle_read_note_or_file(params: dict, *, source: str = "unknown") -> dict:
    return reference_manager.read_note_or_file(
        query=params.get("query", ""),
        device_hint=params.get("device_hint"),
    )


async def handle_show_grocery(params: dict, *, source: str = "unknown") -> dict:
    return reference_manager.show_grocery_list(device_hint=params.get("device_hint"))


async def handle_search_history(params: dict, *, source: str = "unknown") -> dict:
    return reference_manager.search_history_or_memory(
        keyword=params.get("keyword", ""),
        device_hint=params.get("device_hint"),
    )


async def handle_read_saved_recipe(params: dict, *, source: str = "unknown") -> dict:
    return reference_manager.read_saved_recipe(
        meal_name=params.get("meal_name", ""),
        device_hint=params.get("device_hint"),
    )


HANDLERS = {
    "ref_read_note_or_file": handle_read_note_or_file,
    "ref_show_grocery": handle_show_grocery,
    "ref_search_history_or_memory": handle_search_history,
    "ref_read_saved_recipe": handle_read_saved_recipe,
}
