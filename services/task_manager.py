import json
import os

TASK_FILE = "user_files/tasks.json"

def load_tasks():
    if not os.path.exists(TASK_FILE):
        return []
    with open(TASK_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def save_tasks(tasks):
    os.makedirs(os.path.dirname(TASK_FILE), exist_ok=True)
    with open(TASK_FILE, "w", encoding="utf-8") as f:
        json.dump(tasks, f, indent=2)

def add_task(task):
    tasks = load_tasks()
    tasks.append({"task": task, "done": False})
    save_tasks(tasks)
    return f"Task added: {task}"

def list_tasks():
    tasks = load_tasks()
    if not tasks:
        return ["No tasks yet."]
    return [f"[{'x' if t['done'] else ' '}] {t['task']}" for t in tasks]

def mark_done(index):
    tasks = load_tasks()
    if 0 <= index < len(tasks):
        tasks[index]["done"] = True
        save_tasks(tasks)
        return f"Marked done: {tasks[index]['task']}"
    return "Invalid task index."

def remove_task(task_name):
    tasks = load_tasks()
    updated_tasks = [t for t in tasks if t["task"].lower() != task_name.lower()]
    if len(updated_tasks) == len(tasks):
        return f"Task not found: {task_name}"
    save_tasks(updated_tasks)
    return f"Task removed: {task_name}"
