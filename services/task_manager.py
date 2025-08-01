import json
import os
from datetime import datetime, timedelta
from threading import Thread
import time
import dateparser
from telegram.helpers import escape_markdown

TASK_FILE = "user_files/tasks.json"
REMINDER_CHECK_INTERVAL = 60  # seconds
DEFAULT_PRIORITY = "medium"
DEFAULT_DUE_DAYS = 2

reminder_callback = None  # Will be set when reminder system starts

def load_tasks():
    if not os.path.exists(TASK_FILE):
        return []
    with open(TASK_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def save_tasks(tasks):
    os.makedirs(os.path.dirname(TASK_FILE), exist_ok=True)
    with open(TASK_FILE, "w", encoding="utf-8") as f:
        json.dump(tasks, f, indent=2, ensure_ascii=False)

def parse_date(text, fallback_days=DEFAULT_DUE_DAYS):
    dt = dateparser.parse(text)
    if not dt:
        dt = datetime.now() + timedelta(days=fallback_days)
    return dt.strftime("%Y-%m-%d %H:%M")

def add_task(task, due=None, priority=None, reminder=None, notes=None, repeat=None, source="unknown", time=None):
    tasks = load_tasks()
    now = datetime.now().strftime("%Y-%m-%d %H:%M")

    # Use 'time' as fallback if due not provided
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
        "missed": False
    }
    tasks.append(task_data)
    save_tasks(tasks)
    return f"Task added: {task} (due: {due_date}, priority: {task_data['priority']})"

import inspect

def list_tasks(formatted=False):
    caller = inspect.stack()[1]
    print(f"[DEBUG] list_tasks called with formatted={formatted} from {caller.function} in {caller.filename}:{caller.lineno}")
    tasks = load_tasks()
    if not tasks:
        return "📭 No tasks yet." if formatted else ["No tasks yet."]

    now_dt = datetime.now()
    lines = []

    for i, t in enumerate(tasks, start=1):
        due_dt = datetime.strptime(t["due"], "%Y-%m-%d %H:%M")
        overdue = not t["done"] and due_dt < now_dt
        if overdue:
            t["missed"] = True

        if t.get("missed"):
            status = "❌ Missed"
        elif overdue:
            status = "⚠️ Overdue"
        elif t["done"]:
            status = "✅ Done"
        else:
            status = "🕒 Pending"

        task_text = (
            f"{i}. {t['task']}\n"
            f"📅 Due: {t['due']}\n"
            f"⚡ Priority: {t['priority']}\n"
            f"📌 Status: {status}"
        )

        if t.get("notes"):
            task_text += f"\n📝 Notes: {t['notes']}"

        lines.append(task_text)

    save_tasks(tasks)

    result = "📝 Your Tasks:\n\n" + "\n\n────────────\n\n".join(lines)

    if formatted:
        return escape_markdown(result, version=2)  # ✅ Escape text for MarkdownV2
    else:
        return lines

def get_overdue_tasks():
    tasks = load_tasks()
    now_dt = datetime.now()
    overdue_tasks = []

    for t in tasks:
        due_dt = datetime.strptime(t["due"], "%Y-%m-%d %H:%M")
        if not t["done"] and due_dt < now_dt:
            t["missed"] = True
            overdue_tasks.append(
                f"[ ] {t['task']} | Due: {t['due']} | Priority: {t['priority']} | Status: Missed"
            )

    save_tasks(tasks)
    return overdue_tasks or ["No overdue tasks."]

def mark_done(identifier):
    tasks = load_tasks()

    # If identifier is an index (int or numeric string)
    if isinstance(identifier, int) or (isinstance(identifier, str) and identifier.isdigit()):
        index = int(identifier)
        if 0 <= index < len(tasks):
            tasks[index]["done"] = True
            tasks[index]["missed"] = False  # ✅ Clear missed if exists
            save_tasks(tasks)
            return f"✅ Marked done by index: {tasks[index]['task']}"
        return "❌ Invalid task index."

    # Else, assume it's a task name
    for t in tasks:
        if t["task"].strip().lower() == identifier.strip().lower():
            t["done"] = True
            t["missed"] = False  # ✅ Clear missed if exists
            save_tasks(tasks)
            return f"✅ Marked done: {t['task']}"

    return f"❌ Task not found: {identifier}"

def remove_task(task_name):
    tasks = load_tasks()
    normalized = task_name.strip().lower()

    # Handle "delete all tasks"
    if normalized in ["all", "delete all", "remove all", "delete all tasks", "remove all tasks"]:
        save_tasks([])
        return "🗑️ All tasks deleted."

    # Handle "delete last task"
    if normalized in ["last", "delete last", "remove last", "delete last task", "remove last task"]:
        if not tasks:
            return "⚠️ No tasks to delete."
        last_task = tasks.pop()
        save_tasks(tasks)
        return f"🗑️ Last task removed: {last_task['task']}"

    # Remove by task name
    updated_tasks = [t for t in tasks if t["task"].lower() != normalized]
    if len(updated_tasks) == len(tasks):
        return f"❌ Task not found: {task_name}"
    save_tasks(updated_tasks)
    return f"🗑️ Task removed: {task_name}"

def start_reminder_thread(telegram_callback):
    global reminder_callback
    reminder_callback = telegram_callback

    thread = Thread(target=check_reminders, daemon=True, name="Reminder")
    thread.start()

def check_reminders():
    while True:
        now_dt = datetime.now()
        now_str = now_dt.strftime("%Y-%m-%d %H:%M")
        tasks = load_tasks()
        updated = False

        for t in tasks:
            reminder_time = t.get("reminder")
            already_reminded = t.get("reminded", False)
            is_done = t.get("done", False)

            print(f"[Reminder Thread] Checking: {t['task']} | Reminder: {reminder_time} | Now: {now_str}")

            if not reminder_time or already_reminded or is_done:
                continue

            try:
                reminder_dt = datetime.strptime(reminder_time, "%Y-%m-%d %H:%M")
            except Exception as e:
                print(f"[Reminder Thread] ⚠️ Invalid reminder format for task '{t['task']}': {e}")
                continue

            if reminder_dt <= now_dt:
                late = now_dt > reminder_dt
                msg = f"🔔 Reminder: {t['task']} (Due: {t['due']})"
                if late:
                    msg += " [Late]"

                if reminder_callback:
                    reminder_callback(msg)
                    print(f"[Reminder Thread] ✅ Sent reminder for: {t['task']}")

                t["reminded"] = True
                updated = True

            try:
                due_dt = datetime.strptime(t.get("due"), "%Y-%m-%d %H:%M")
                if not is_done and due_dt < now_dt:
                    if not t.get("missed"):
                        t["missed"] = True
                        updated = True
                else:
                    if t.get("missed"):
                        t["missed"] = False
                        updated = True
            except Exception as e:
                print(f"[Reminder Thread] ⚠️ Error parsing due date for task '{t['task']}': {e}")

        if updated:
            save_tasks(tasks)

        time.sleep(REMINDER_CHECK_INTERVAL)

def get_all_tasks():
    return load_tasks()
