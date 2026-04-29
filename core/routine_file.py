import json
import os
import uuid
from datetime import datetime

ROUTINE_FILE = "user_files/routines.json"


def _load() -> list:
    if not os.path.exists(ROUTINE_FILE):
        return []
    try:
        with open(ROUTINE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, list) else []
    except Exception as e:
        print(f"[RoutineFile] Error loading: {e}")
        return []


def _save(data: list):
    os.makedirs(os.path.dirname(ROUTINE_FILE), exist_ok=True)
    with open(ROUTINE_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def list_routines() -> list:
    return _load()


def get_routine(routine_id: str) -> dict | None:
    return next((r for r in _load() if r.get("id") == routine_id), None)


def create_routine(data: dict) -> dict:
    routines = _load()
    now = datetime.utcnow().isoformat()
    routine = {
        "id": str(uuid.uuid4()),
        "name": data.get("name", "Unnamed"),
        "description": data.get("description", ""),
        "icon": data.get("icon", "⚡"),
        "enabled": data.get("enabled", True),
        "schedule": data.get("schedule", {"type": "manual"}),
        "steps": data.get("steps", []),
        "created_at": now,
        "updated_at": now,
    }
    routines.append(routine)
    _save(routines)
    return routine


def update_routine(routine_id: str, patch: dict) -> dict | None:
    routines = _load()
    for i, r in enumerate(routines):
        if r.get("id") == routine_id:
            routines[i] = {**r, **patch, "id": routine_id, "updated_at": datetime.utcnow().isoformat()}
            _save(routines)
            return routines[i]
    return None


def delete_routine(routine_id: str) -> bool:
    routines = _load()
    filtered = [r for r in routines if r.get("id") != routine_id]
    if len(filtered) == len(routines):
        return False
    _save(filtered)
    return True
