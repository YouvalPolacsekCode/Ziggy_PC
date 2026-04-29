from __future__ import annotations

from typing import Any, Dict, List, Optional

from core.logger_module import log_info, log_error
from core.memory import list_memory
from services import file_manager


# ---------------------------------------------------------------------------
# Public Scenarios
# ---------------------------------------------------------------------------

def read_note_or_file(query: str, device_hint: Optional[str] = None) -> Dict[str, Any]:
    """Find and read a note or file matching the query keyword."""
    matches = file_manager.search_notes(query)
    if matches:
        note = matches[0]
        content = note.get("content", "")
        title = note.get("title", query)
        return {
            "ok": True,
            "message": f"{title}:\n\n{content[:800]}",
            "data": {"title": title, "content": content, "filename": note.get("filename")},
        }

    # Try reading it as a named file
    content = file_manager.read_file(query)
    if not content.startswith("File not found") and not content.startswith("Error"):
        return {"ok": True, "message": content[:800], "data": {"filename": query, "content": content}}

    # Try with common extensions
    for ext in (".txt", ".md", ".json", ".yaml"):
        content = file_manager.read_file(query + ext)
        if not content.startswith("File not found") and not content.startswith("Error"):
            return {"ok": True, "message": content[:800], "data": {"filename": query + ext, "content": content}}

    return {"ok": False, "message": f"No note or file found matching '{query}'.", "data": {}}


def show_grocery_list(device_hint: Optional[str] = None) -> Dict[str, Any]:
    """Show the grocery list from HA or a local grocery note."""
    from services.home_automation import get_todo_items
    result = get_todo_items("shopping_list")
    if result.get("ok"):
        return result
    # Fallback: look for a local grocery note
    matches = file_manager.search_notes("grocery")
    if matches:
        note = matches[0]
        return {"ok": True, "message": f"Grocery list:\n{note.get('content', '')}", "data": note}
    return {"ok": False, "message": "No grocery list found. Add items via 'add to shopping list' or create a grocery note.", "data": {}}


def search_history_or_memory(keyword: str, device_hint: Optional[str] = None) -> Dict[str, Any]:
    """Search saved memory and note files for a keyword."""
    mem_results = _search_memory(keyword)
    note_results = file_manager.search_notes(keyword)

    parts = []
    if mem_results:
        parts.append("Memory:\n" + "\n".join(f"  {r['key']}: {r['value']}" for r in mem_results))
    if note_results:
        titles = [n.get("title", n.get("filename", "")) for n in note_results]
        parts.append("Notes:\n  " + "\n  ".join(titles))
    if not parts:
        return {"ok": False, "message": f"Nothing found for '{keyword}'.", "data": {}}
    return {
        "ok": True,
        "message": "\n\n".join(parts),
        "data": {"memory": mem_results, "notes": [n.get("filename") for n in note_results]},
    }


def read_saved_recipe(meal_name: str, device_hint: Optional[str] = None) -> Dict[str, Any]:
    """Find a saved recipe note and return it with extracted steps."""
    matches = file_manager.search_notes(meal_name)
    if not matches:
        matches = file_manager.search_notes("recipe")
    for note in matches:
        content = note.get("content", "")
        if meal_name.lower() in content.lower() or meal_name.lower() in (note.get("title") or "").lower():
            steps = _extract_steps(content)
            return {
                "ok": True,
                "message": f"Recipe: {note.get('title', meal_name)}\n\n" + "\n".join(steps),
                "data": {"title": note.get("title"), "content": content, "steps": steps},
            }
    return {"ok": False, "message": f"No saved recipe found for '{meal_name}'.", "data": {}}


def save_recipe_to_notes(recipe: Dict[str, Any]) -> Dict[str, Any]:
    """Save a parsed recipe dict as a note."""
    title = recipe.get("title", "Recipe")
    ingredients = "\n".join(recipe.get("ingredients", []))
    instructions = "\n".join(
        f"Step {i+1}: {s}" for i, s in enumerate(recipe.get("instructions", []))
    )
    content = f"Ingredients:\n{ingredients}\n\nSteps:\n{instructions}"
    result = file_manager.create_note(content, title=title)
    return {"ok": True, "message": f"Recipe '{title}' saved.", "data": {"result": result}}


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _search_memory(keyword: str) -> List[Dict[str, Any]]:
    try:
        mem = list_memory()
        q = keyword.lower()
        return [{"key": k, "value": v} for k, v in (mem or {}).items() if q in f"{k} {v}".lower()]
    except Exception:
        return []


def _extract_steps(content: str) -> List[str]:
    lines = [l.strip() for l in content.splitlines() if l.strip()]
    steps = [l for l in lines if l[:5].lower().startswith(("step ", "שלב "))]
    return steps or lines[:10]
