import json
import os

TASK_FILE_PATH = "user_files/tasks.json"  # your confirmed location

def load_task_json():
    if not os.path.exists(TASK_FILE_PATH):
        return []

    try:
        with open(TASK_FILE_PATH, "r", encoding="utf-8") as file:
            data = json.load(file)
            return data if isinstance(data, list) else []
    except Exception as e:
        print(f"[Task Loader] ⚠️ Error loading tasks: {e}")
        return []
