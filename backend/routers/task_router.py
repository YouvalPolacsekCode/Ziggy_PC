from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.task_file import load_task_json, patch_task, delete_task as delete_task_file
from services.task_manager import add_task

router = APIRouter()


class TaskCreate(BaseModel):
    task: str
    due: Optional[str] = None
    priority: Optional[str] = None
    reminder: Optional[str] = None
    description: Optional[str] = None
    items: Optional[list] = None


class TaskPatch(BaseModel):
    task: Optional[str] = None
    done: Optional[bool] = None
    due: Optional[str] = None
    priority: Optional[str] = None
    description: Optional[str] = None
    items: Optional[list] = None


@router.get("/api/tasks")
async def get_tasks():
    return {"tasks": load_task_json()}


@router.post("/api/tasks")
async def create_task(body: TaskCreate):
    add_task(task=body.task, due=body.due, priority=body.priority, reminder=body.reminder)
    tasks = load_task_json()
    if tasks:
        last = tasks[-1]
        updates = {}
        if body.description is not None:
            updates["description"] = body.description
        if body.items is not None:
            updates["items"] = body.items
        if updates:
            patch_task(last["id"], updates)
    return {"ok": True}


@router.patch("/api/tasks/{task_id}")
async def update_task(task_id: str, body: TaskPatch):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    updated = patch_task(task_id, updates)
    if not updated:
        raise HTTPException(status_code=404, detail="Task not found")
    return updated


@router.delete("/api/tasks/{task_id}")
async def remove_task_endpoint(task_id: str):
    ok = delete_task_file(task_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"ok": True}
