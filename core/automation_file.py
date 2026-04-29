import json
import os
import uuid
from datetime import datetime

AUTOMATION_FILE = "user_files/automations.json"


def _load() -> list:
    if not os.path.exists(AUTOMATION_FILE):
        return []
    try:
        with open(AUTOMATION_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, list) else []
    except Exception as e:
        print(f"[AutomationFile] Error loading: {e}")
        return []


def _save(data: list):
    os.makedirs(os.path.dirname(AUTOMATION_FILE), exist_ok=True)
    with open(AUTOMATION_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def list_automations() -> list:
    return _load()


def get_automation(automation_id: str) -> dict | None:
    return next((a for a in _load() if a.get("id") == automation_id), None)


def create_automation(data: dict) -> dict:
    automations = _load()
    now = datetime.utcnow().isoformat()
    automation = {
        "id": str(uuid.uuid4()),
        "name": data.get("name", "Unnamed"),
        "description": data.get("description", ""),
        "enabled": data.get("enabled", True),
        "trigger": data.get("trigger", {}),
        "conditions": data.get("conditions", []),
        "actions": data.get("actions", []),
        "created_at": now,
        "updated_at": now,
    }
    automations.append(automation)
    _save(automations)
    return automation


def update_automation(automation_id: str, patch: dict) -> dict | None:
    automations = _load()
    for i, a in enumerate(automations):
        if a.get("id") == automation_id:
            automations[i] = {**a, **patch, "id": automation_id, "updated_at": datetime.utcnow().isoformat()}
            _save(automations)
            return automations[i]
    return None


def delete_automation(automation_id: str) -> bool:
    automations = _load()
    filtered = [a for a in automations if a.get("id") != automation_id]
    if len(filtered) == len(automations):
        return False
    _save(filtered)
    return True
