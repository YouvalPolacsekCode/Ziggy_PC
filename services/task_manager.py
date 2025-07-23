import json
import os

TASK_FILE = "user_files/tasks.json"

def load_tasks():
    if not os.path.exists(TASK_FILE):
        return []
    with open(TASK_FILE, "r") as f:
        return json.load(f)

def save_tasks(tasks):
    with open(TASK_FILE, "w") as f:
        json.dump(tasks, f, indent=2)

def add_task(task):
    tasks = load_tasks()
    tasks.append({"task": task, "done": False})
    save_tasks(tasks)
    return f"Task added: {task}"

def list_tasks():
    tasks = load_tasks()
    return [f"[{'x' if t['done'] else ' '}] {t['task']}" for t in tasks]

def mark_done(index):
    tasks = load_tasks()
    if 0 <= index < len(tasks):
        tasks[index]["done"] = True
        save_tasks(tasks)
        return f"Marked done: {tasks[index]['task']}"
    return "Invalid task index."