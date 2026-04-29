from __future__ import annotations
from core.intent_utils import ok, err
from core.memory import remember, recall, list_memory, delete_memory


async def handle_remember_memory(params: dict, *, source: str = "unknown") -> dict:
    key = params.get("key")
    value = params.get("value")
    if key and value:
        remember(key, value)
        return ok(f"✅ Remembered: {key} → {value}")
    return err("Missing key or value.")


async def handle_recall_memory(params: dict, *, source: str = "unknown") -> dict:
    key = params.get("key")
    if not key:
        return err("Missing key.")
    value = recall(key)
    if value:
        return ok(f"🧠 {key}: {value}")
    return ok(f"🤔 I have no memory of '{key}'.")


async def handle_delete_memory(params: dict, *, source: str = "unknown") -> dict:
    key = params.get("key")
    if not key:
        return err("Missing key.")
    success = delete_memory(key)
    if success:
        return ok(f"🗑️ Deleted memory for '{key}'.")
    return ok(f"🤷 Nothing found for '{key}'.")


HANDLERS = {
    "remember_memory": handle_remember_memory,
    "recall_memory": handle_recall_memory,
    "delete_memory": handle_delete_memory,
}
