# services/reference_manager.py
from __future__ import annotations

from typing import Optional, Dict, Any, List
from core.logger_module import log_info, log_error
from services import file_manager
from core.memory import list_memory, search_memory  # if you have search; else implement simple scan

# ---------- Public Scenarios ----------

def read_note_or_file(query: str, device_hint: Optional[str] = None) -> Dict[str, Any]:
    """
    Search notes/files and read content.

    Args:
        query: Title keyword or filename fragment.
        device_hint: Optional display target.

    Returns:
        Standard result dict.
    """
    matches = _notes_search(query)
    if not matches:
        return {"ok": False, "message": "No matching notes/files.", "data": {}}
    note = _notes_open(matches[0]["id"] if "id" in matches[0] else matches[0]["title"])
    return {"ok": True, "message": f"Opened '{note.get('title') or query}'.", "data": note}


def show_grocery_list(device_hint: Optional[str] = None) -> Dict[str, Any]:
    """
    Show the grocery list (from a known list file or note).
    """
    lst = _list_load("grocery")
    return {"ok": True, "message": "Grocery list.", "data": lst}


def search_history_or_memory(keyword: str, device_hint: Optional[str] = None) -> Dict[str, Any]:
    """
    Search command history and long-term memory.
    """
    hist = _history_search(keyword)
    mem = _memory_search(keyword)
    return {"ok": True, "message": "Search results.", "data": {"history": hist, "memory": mem}}


def read_saved_recipe(meal_name: str, device_hint: Optional[str] = None) -> Dict[str, Any]:
    """
    Read a saved recipe note by meal name.
    """
    matches = _notes_search(meal_name)
    if not matches:
        return {"ok": False, "message": "No saved recipe found.", "data": {}}
    note = _notes_open(matches[0].get("id") or matches[0].get("title"))
    steps = _recipe_extract_steps(note)
    return {"ok": True, "message": f"Recipe for {meal_name}.", "data": {"note": note, "steps": steps}}

# ---------- Atomic ----------

def _notes_search(query_or_title: str) -> List[Dict[str, Any]]:
    try:
        results = file_manager.read_notes(query=query_or_title)  # expect your file_manager to support query
        # Normalize to list of dicts
        if isinstance(results, dict):
            results = [results]
        return results or []
    except Exception as e:
        log_error(f"[reference._notes_search] {e}")
        return []


def _notes_open(note_id_or_title: str) -> Dict[str, Any]:
    try:
        # If your file_manager supports ID and title; otherwise treat as title
        note = file_manager.read_notes(query=note_id_or_title)
        if isinstance(note, list):
            note = note[0] if note else {}
        return note or {}
    except Exception as e:
        log_error(f"[reference._notes_open] {e}")
        return {}


def _save_recipe_to_notes(recipe: Dict[str, Any]) -> Dict[str, Any]:
    try:
        title = recipe.get("title", "Recipe")
        body = "\n".join(recipe.get("ingredients", [])) + "\n\n" + "\n".join(recipe.get("instructions", []))
        file_manager.create_note(title=title, content=body)
        return {"ok": True, "message": "Saved recipe.", "data": {"title": title}}
    except Exception as e:
        log_error(f"[reference._save_recipe_to_notes] {e}")
        return {"ok": False, "message": str(e), "data": {}}


def _list_load(name: str) -> Dict[str, Any]:
    # Minimal: use a note named 'grocery' or a CSV under data/. Adjust to your system.
    try:
        res = file_manager.read_notes(query=name)
        if isinstance(res, list):
            res = res[0] if res else {}
        return {"name": name, "items": (res.get("content") or "").splitlines()}
    except Exception as e:
        log_error(f"[reference._list_load] {e}")
        return {"name": name, "items": []}


def _list_add_items(name: str, items: List[str]) -> Dict[str, Any]:
    return {"ok": False, "message": "Not implemented.", "data": {}}


def _list_remove_items(name: str, items: List[str]) -> Dict[str, Any]:
    return {"ok": False, "message": "Not implemented.", "data": {}}


def _history_search(keyword: str) -> List[Dict[str, Any]]:
    # TODO: If you maintain logs/command history files, scan them here
    return []


def _memory_search(keyword: str) -> List[Dict[str, Any]]:
    try:
        # If you don't have search_memory, emulate via list_memory
        try:
            return search_memory(keyword)  # type: ignore
        except Exception:
            mem = list_memory()
            out = []
            for k, v in (mem or {}).items():
                if keyword.lower() in f"{k} {v}".lower():
                    out.append({"key": k, "value": v})
            return out
    except Exception:
        return []


def _recipe_extract_steps(note: Dict[str, Any]) -> List[str]:
    content = (note or {}).get("content") or ""
    lines = [l.strip() for l in content.splitlines() if l.strip()]
    steps = [l for l in lines if l[0:5].lower().startswith(("step ", "שלב "))]
    return steps or lines[:10]


def _tts_speak(text: str) -> Dict[str, Any]:
    return {"ok": False, "message": "TTS not wired here; use communication_manager.broadcast_announcement.", "data": {}}
