from __future__ import annotations

import json
import os
import time
from datetime import datetime, timedelta
from threading import Thread

import dateparser

TASK_FILE = "user_files/tasks.json"
REMINDER_CHECK_INTERVAL = 60
DEFAULT_PRIORITY = "medium"
DEFAULT_DUE_DAYS = 2



def load_tasks() -> list:
    if not os.path.exists(TASK_FILE):
        return []
    with open(TASK_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def save_tasks(tasks: list) -> None:
    os.makedirs(os.path.dirname(TASK_FILE), exist_ok=True)
    with open(TASK_FILE, "w", encoding="utf-8") as f:
        json.dump(tasks, f, indent=2, ensure_ascii=False)


def parse_date(text: str, fallback_days: int = DEFAULT_DUE_DAYS) -> str:
    dt = dateparser.parse(text)
    if not dt:
        dt = datetime.now() + timedelta(days=fallback_days)
    return dt.strftime("%Y-%m-%d %H:%M")


def add_task(task, due=None, priority=None, reminder=None, notes=None, repeat=None, source="unknown", time=None):
    tasks = load_tasks()
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    due_input = due or time or ""
    due_date = parse_date(due_input) if due_input else parse_date("")
    reminder_time = parse_date(reminder) if reminder else due_date

    task_data = {
        "task": task,
        "done": False,
        "due": due_date,
        "priority": (priority or DEFAULT_PRIORITY).lower(),
        "reminder": reminder_time,
        "reminded": False,
        "created": now,
        "notes": notes or "",
        "repeat": repeat or "none",
        "source": source,
        "missed": False,
    }
    tasks.append(task_data)
    save_tasks(tasks)
    return f"Task added: {task} (due: {due_date}, priority: {task_data['priority']})"


def list_tasks(formatted: bool = False):
    """Return tasks.

    formatted=True returns a single plain-prose string suitable for the
    chat surface (TTS-safe, no markdown / emoji / table separators — the
    chat shape contract requires plain prose).
    formatted=False returns the raw list[str] used by the dashboard.
    """
    tasks = load_tasks()
    if not tasks:
        return "No tasks yet." if formatted else ["No tasks yet."]

    now_dt = datetime.now()
    # Side-effect: stamp missed=True on overdue tasks. Preserved from the
    # previous implementation; other code paths read .missed downstream.
    for t in tasks:
        due_dt = datetime.strptime(t["due"], "%Y-%m-%d %H:%M")
        if not t["done"] and due_dt < now_dt:
            t["missed"] = True
    save_tasks(tasks)

    if not formatted:
        lines = [f"{i}. {t['task']}" for i, t in enumerate(tasks, 1)]
        return lines

    # Plain-prose summary. Examples:
    #   "You have 3 tasks: call mom, buy milk, feed the cat."
    #   "You have 1 task: call mom."
    titles = [t["task"] for t in tasks]
    count = len(titles)
    noun = "task" if count == 1 else "tasks"
    return f"You have {count} {noun}: " + ", ".join(titles) + "."


def task_summary() -> str:
    tasks = load_tasks()
    if not tasks:
        return "No tasks yet."
    now_dt = datetime.now()
    done = sum(1 for t in tasks if t["done"])
    pending = sum(1 for t in tasks if not t["done"])
    def _is_overdue(t):
        try:
            return datetime.strptime(t["due"], "%Y-%m-%d %H:%M") < now_dt
        except Exception:
            return False
    overdue = sum(1 for t in tasks if not t["done"] and _is_overdue(t))
    high = sum(1 for t in tasks if not t["done"] and t.get("priority") == "high")
    parts = [f"{len(tasks)} total", f"{done} done", f"{pending} pending"]
    if overdue:
        parts.append(f"{overdue} overdue")
    if high:
        parts.append(f"{high} high priority")
    return "Tasks: " + ", ".join(parts) + "."


def postpone_task(task_name: str, days: int = 1) -> str:
    tasks = load_tasks()
    target = task_name.strip().lower()
    for t in tasks:
        if t["task"].strip().lower() == target or target in t["task"].strip().lower():
            try:
                old_due = datetime.strptime(t["due"], "%Y-%m-%d %H:%M")
            except Exception:
                old_due = datetime.now()
            new_due = old_due + timedelta(days=days)
            t["due"] = new_due.strftime("%Y-%m-%d %H:%M")
            t["reminder"] = t["due"]
            t["reminded"] = False
            t["missed"] = False
            save_tasks(tasks)
            return f"Postponed '{t['task']}' to {t['due']}."
    return f"Task not found: {task_name}"


def get_overdue_tasks() -> list[str]:
    tasks = load_tasks()
    now_dt = datetime.now()
    overdue = []
    for t in tasks:
        due_dt = datetime.strptime(t["due"], "%Y-%m-%d %H:%M")
        if not t["done"] and due_dt < now_dt:
            t["missed"] = True
            overdue.append(f"[ ] {t['task']} | Due: {t['due']} | Priority: {t['priority']} | Status: Missed")
    save_tasks(tasks)
    return overdue or ["No overdue tasks."]


def mark_done(identifier) -> str:
    tasks = load_tasks()
    if isinstance(identifier, int) or (isinstance(identifier, str) and identifier.isdigit()):
        index = int(identifier)
        if 0 <= index < len(tasks):
            tasks[index]["done"] = True
            tasks[index]["missed"] = False
            save_tasks(tasks)
            return f"✅ Marked done by index: {tasks[index]['task']}"
        return "❌ Invalid task index."
    for t in tasks:
        if t["task"].strip().lower() == identifier.strip().lower():
            t["done"] = True
            t["missed"] = False
            save_tasks(tasks)
            return f"✅ Marked done: {t['task']}"
    return f"❌ Task not found: {identifier}"


def remove_task(task_name: str) -> str:
    tasks = load_tasks()
    normalized = task_name.strip().lower()
    if normalized in {"all", "delete all", "remove all", "delete all tasks", "remove all tasks"}:
        save_tasks([])
        return "🗑️ All tasks deleted."
    if normalized in {"last", "delete last", "remove last", "delete last task", "remove last task"}:
        if not tasks:
            return "⚠️ No tasks to delete."
        last_task = tasks.pop()
        save_tasks(tasks)
        return f"🗑️ Last task removed: {last_task['task']}"
    updated = [t for t in tasks if t["task"].lower() != normalized]
    if len(updated) == len(tasks):
        return f"❌ Task not found: {task_name}"
    save_tasks(updated)
    return f"🗑️ Task removed: {task_name}"


def start_reminder_thread():
    # Caller (ziggy_main) already wraps this in its own daemon Thread named
    # "Reminder". Spawning another inner Thread here made the wrapper exit
    # immediately, producing a misleading "[Thread:Reminder] Exited." line on
    # every startup. Run the loop directly in the caller's thread instead.
    check_reminders()


def check_reminders():
    while True:
        now_dt = datetime.now()
        tasks = load_tasks()
        updated = False

        for t in tasks:
            reminder_time = t.get("reminder")
            if not reminder_time or t.get("reminded", False) or t.get("done", False):
                continue
            try:
                reminder_dt = datetime.strptime(reminder_time, "%Y-%m-%d %H:%M")
            except Exception as e:
                print(f"[Reminder Thread] ⚠️ Invalid reminder format for '{t['task']}': {e}")
                continue

            if reminder_dt <= now_dt:
                late = now_dt > reminder_dt
                body = f"Due: {t.get('due', 'no due date')}" + (" [Late]" if late else "")
                try:
                    from services.push_notify import push_notify_fire_and_forget
                    # Reminder thread runs a sleep loop; blocking it on push
                    # delays every other reminder behind it.
                    push_notify_fire_and_forget(f"Reminder: {t['task']}", body, "/tasks", "task_reminder")
                except Exception:
                    pass
                t["reminded"] = True
                updated = True

            try:
                due_dt = datetime.strptime(t.get("due"), "%Y-%m-%d %H:%M")
                if not t.get("done") and due_dt < now_dt:
                    if not t.get("missed"):
                        t["missed"] = True
                        updated = True
                elif t.get("missed"):
                    t["missed"] = False
                    updated = True
            except Exception:
                pass

        if updated:
            save_tasks(tasks)
        time.sleep(REMINDER_CHECK_INTERVAL)


def get_all_tasks() -> list:
    return load_tasks()
