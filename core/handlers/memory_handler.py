from __future__ import annotations
from core.intent_utils import ok, err
from core.result_utils import L
from core.memory import remember, recall, list_memory, delete_memory


async def handle_remember_memory(params: dict, *, source: str = "unknown") -> dict:
    key = params.get("key")
    value = params.get("value")
    if key and value:
        remember(key, value)
        return ok(L(f"✅ Remembered: {key} → {value}", f"✅ שמרתי: {key} ← {value}"))
    return err(L("Missing key or value.", "חסר מפתח או ערך."))


async def handle_recall_memory(params: dict, *, source: str = "unknown") -> dict:
    key = params.get("key")
    if not key:
        return err(L("Missing key.", "חסר מפתח."))
    value = recall(key)
    if value:
        return ok(f"🧠 {key}: {value}")
    return ok(L(f"🤔 I have no memory of '{key}'.", f"🤔 אין לי זיכרון של '{key}'."))


async def handle_delete_memory(params: dict, *, source: str = "unknown") -> dict:
    key = params.get("key")
    if not key:
        return err(L("Missing key.", "חסר מפתח."))
    success = delete_memory(key)
    if success:
        return ok(L(f"🗑️ Deleted memory for '{key}'.", f"🗑️ מחקתי את הזיכרון של '{key}'."))
    return ok(L(f"🤷 Nothing found for '{key}'.", f"🤷 לא נמצא דבר עבור '{key}'."))


HANDLERS = {
    "remember_memory": handle_remember_memory,
    "recall_memory": handle_recall_memory,
    "delete_memory": handle_delete_memory,
}
