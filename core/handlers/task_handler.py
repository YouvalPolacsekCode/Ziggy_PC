from __future__ import annotations
from dateparser.search import search_dates
from core.intent_utils import ok, err, wrap
from core.result_utils import L
from services.task_manager import add_task, list_tasks, remove_task, mark_done, postpone_task, task_summary
from services.home_automation import add_todo_item, get_todo_items


async def handle_add_task(params: dict, *, source: str = "unknown") -> dict:
    task_text = (params.get("task") or "").strip()
    if not task_text:
        return ok(L("What task would you like to add?", "איזו משימה להוסיף?"))
    reminder = params.get("reminder")
    due = params.get("due")
    priority = params.get("priority")
    notes = params.get("notes")
    repeat = params.get("repeat")
    time_str = params.get("time")

    if not priority:
        if "high priority" in task_text.lower():
            priority = "high"
            task_text = task_text.replace("high priority", "").strip()
        elif "low priority" in task_text.lower():
            priority = "low"
            task_text = task_text.replace("low priority", "").strip()

    if not due and not reminder and not time_str:
        results = search_dates(task_text, settings={"PREFER_DATES_FROM": "future"})
        if results:
            text_to_remove, dt = results[-1]
            time_str = dt.strftime("%Y-%m-%d %H:%M")
            task_text = task_text.replace(text_to_remove, "").strip()

    return wrap(add_task(
        task=task_text, due=due, priority=priority,
        reminder=reminder or due or time_str,
        notes=notes, repeat=repeat, source=source, time=time_str,
    ))


async def handle_list_tasks(params: dict, *, source: str = "unknown") -> dict:
    return wrap(list_tasks(formatted=True))


async def handle_remove_task(params: dict, *, source: str = "unknown") -> dict:
    return wrap(remove_task(params.get("task", "")))


async def handle_remove_tasks(params: dict, *, source: str = "unknown") -> dict:
    return wrap(remove_task("all"))


async def handle_remove_last_task(params: dict, *, source: str = "unknown") -> dict:
    return wrap(remove_task("last"))


async def handle_mark_task_done(params: dict, *, source: str = "unknown") -> dict:
    task_ref = params.get("task") or params.get("task_name") or params.get("index")
    if not task_ref:
        return ok(L("Which task should I mark as done?", "איזו משימה לסמן כבוצעה?"))
    return wrap(mark_done(task_ref))


async def handle_postpone_task(params: dict, *, source: str = "unknown") -> dict:
    task_name = params.get("task") or params.get("task_name") or ""
    if not task_name:
        return ok(L("Which task should I postpone?", "איזו משימה לדחות?"))
    days = int(params.get("days", 1))
    return wrap(postpone_task(task_name, days))


async def handle_task_summary(params: dict, *, source: str = "unknown") -> dict:
    return ok(task_summary())


async def handle_add_shopping_list_item(params: dict, *, source: str = "unknown") -> dict:
    item = (params.get("item") or "").strip()
    if not item:
        return ok(L("What should I add to the shopping list?", "מה להוסיף לרשימת הקניות?"))
    return wrap(add_todo_item(item))


async def handle_get_shopping_list(params: dict, *, source: str = "unknown") -> dict:
    return wrap(get_todo_items())


HANDLERS = {
    "add_task": handle_add_task,
    "list_tasks": handle_list_tasks,
    "remove_task": handle_remove_task,
    "remove_tasks": handle_remove_tasks,
    "remove_last_task": handle_remove_last_task,
    "mark_task_done": handle_mark_task_done,
    "postpone_task": handle_postpone_task,
    "task_summary": handle_task_summary,
    "add_shopping_list_item": handle_add_shopping_list_item,
    "get_shopping_list": handle_get_shopping_list,
}
