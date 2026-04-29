import json
import os
import uuid

TASK_FILE_PATH = "user_files/tasks.json"


def load_task_json():
    if not os.path.exists(TASK_FILE_PATH):
        return []
    try:
        with open(TASK_FILE_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
            tasks = data if isinstance(data, list) else []
            # Backfill IDs for tasks created before this field existed
            changed = False
            for t in tasks:
                if not t.get("id"):
                    t["id"] = str(uuid.uuid4())
                    changed = True
            if changed:
                _save(tasks)
            return tasks
    except Exception as e:
        print(f"[Task Loader] ⚠️ Error loading tasks: {e}")
        return []


def _save(tasks):
    os.makedirs(os.path.dirname(TASK_FILE_PATH), exist_ok=True)
    with open(TASK_FILE_PATH, "w", encoding="utf-8") as f:
        json.dump(tasks, f, indent=2, ensure_ascii=False)


def get_task(task_id: str):
    for t in load_task_json():
        if t.get("id") == task_id:
            return t
    return None


def patch_task(task_id: str, updates: dict):
    tasks = load_task_json()
    for t in tasks:
        if t.get("id") == task_id:
            t.update({k: v for k, v in updates.items() if k != "id"})
            _save(tasks)
            return t
    return None


def delete_task(task_id: str):
    tasks = load_task_json()
    new_tasks = [t for t in tasks if t.get("id") != task_id]
    if len(new_tasks) == len(tasks):
        return False
    _save(new_tasks)
    return True
