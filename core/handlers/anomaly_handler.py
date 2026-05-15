from __future__ import annotations

from core.intent_utils import wrap


async def handle_get_active_anomalies(params: dict, *, source: str = "unknown") -> dict:
    try:
        from services.ha_subscriber import active_anomalies
    except ImportError:
        return wrap("Anomaly engine is not running.")

    all_items: list[dict] = []
    for room_id, items in active_anomalies.items():
        for item in items:
            all_items.append({**item, "room_id": room_id})

    if not all_items:
        return wrap("No active anomalies right now — everything looks normal.")

    # Sort: critical first, then warning, then by room
    order = {"critical": 0, "warning": 1, "info": 2}
    all_items.sort(key=lambda x: (order.get(x.get("severity", "info"), 3), x.get("room_id", "")))

    lines = []
    for a in all_items:
        sev  = a.get("severity", "warning").upper()
        msg  = a.get("message", "")
        conf = a.get("confidence", 1.0)
        conf_str = f" (conf: {conf:.0%})" if conf < 0.9 else ""
        lines.append(f"[{sev}]{conf_str} {msg}")

    return wrap("\n".join(lines))


HANDLERS = {
    "get_active_anomalies": handle_get_active_anomalies,
}
