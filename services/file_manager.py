from __future__ import annotations

import csv
import io
import json
import os
from datetime import datetime
from typing import Any, Optional

import yaml

BASE_DIR = "user_files"
os.makedirs(BASE_DIR, exist_ok=True)


# ---------------------------------------------------------------------------
# Low-level helpers
# ---------------------------------------------------------------------------

def _path(filename: str) -> str:
    return os.path.join(BASE_DIR, filename)


# ---------------------------------------------------------------------------
# Generic file I/O
# ---------------------------------------------------------------------------

def save_file(filename: str, content: str) -> str:
    try:
        with open(_path(filename), "w", encoding="utf-8") as f:
            f.write(content)
        return f"{filename} saved."
    except Exception as e:
        return f"Error saving file: {e}"


def read_file(filename: str) -> str:
    try:
        with open(_path(filename), "r", encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        return "File not found."
    except Exception as e:
        return f"Error reading file: {e}"


def delete_file(filename: str) -> str:
    p = _path(filename)
    if not os.path.exists(p):
        return f"File '{filename}' not found."
    try:
        os.remove(p)
        return f"Deleted {filename}."
    except Exception as e:
        return f"Error deleting file: {e}"


def list_files() -> list[str]:
    try:
        return os.listdir(BASE_DIR)
    except Exception as e:
        return [f"Error listing files: {e}"]


# ---------------------------------------------------------------------------
# Structured formats  (JSON / YAML / CSV)
# ---------------------------------------------------------------------------

def save_json(filename: str, data: Any) -> str:
    if not filename.endswith(".json"):
        filename += ".json"
    content = json.dumps(data, indent=2, ensure_ascii=False)
    return save_file(filename, content)


def read_json(filename: str) -> Any:
    text = read_file(filename)
    if text.startswith("File not found") or text.startswith("Error"):
        return None
    try:
        return json.loads(text)
    except Exception:
        return None


def save_yaml_file(filename: str, data: Any) -> str:
    if not filename.endswith((".yaml", ".yml")):
        filename += ".yaml"
    content = yaml.dump(data, allow_unicode=True, default_flow_style=False)
    return save_file(filename, content)


def read_yaml_file(filename: str) -> Any:
    text = read_file(filename)
    if text.startswith("File not found") or text.startswith("Error"):
        return None
    try:
        return yaml.safe_load(text)
    except Exception:
        return None


def save_csv(filename: str, rows: list[list], headers: Optional[list] = None) -> str:
    if not filename.endswith(".csv"):
        filename += ".csv"
    buf = io.StringIO()
    writer = csv.writer(buf)
    if headers:
        writer.writerow(headers)
    writer.writerows(rows)
    return save_file(filename, buf.getvalue())


def read_csv(filename: str) -> list[dict]:
    text = read_file(filename)
    if text.startswith("File not found") or text.startswith("Error"):
        return []
    try:
        reader = csv.DictReader(io.StringIO(text))
        return list(reader)
    except Exception:
        return []


# ---------------------------------------------------------------------------
# Notes
# ---------------------------------------------------------------------------

def create_note(content: str, title: Optional[str] = None) -> str:
    slug = title.replace(" ", "_").lower() if title else datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    filename = f"note_{slug}.txt"
    body = f"# {title}\n\n{content}" if title else content
    return save_file(filename, body)


def read_notes(limit: int = 5, query: Optional[str] = None) -> str | list[dict]:
    """Return recent notes as a formatted string, or a list of dicts if query is given."""
    note_files = sorted(
        [f for f in os.listdir(BASE_DIR) if f.startswith("note_")],
        reverse=True,
    )

    if query:
        # Search mode: return list of matching note dicts
        q = query.strip().lower()
        matches = []
        for fn in note_files:
            content = read_file(fn)
            if q in fn.lower() or q in content.lower():
                matches.append({
                    "id": fn,
                    "title": fn.replace("note_", "").replace(".txt", "").replace("_", " "),
                    "content": content,
                    "filename": fn,
                })
        return matches

    # Normal mode: return formatted string of latest N notes
    recent = note_files[:limit]
    if not recent:
        return "No notes found."
    output = []
    for fn in recent:
        content = read_file(fn)
        output.append(f"{fn}:\n{content}")
    return "\n\n".join(output)


def search_notes(query: str) -> list[dict]:
    """Return all notes whose filename or content contains query."""
    return read_notes(limit=9999, query=query)  # type: ignore[return-value]


def append_to_note(filename: str, content: str) -> str:
    """Append text to an existing note. If not found, create it."""
    p = _path(filename)
    if not os.path.exists(p):
        # Try a fuzzy match on note files
        matches = [f for f in os.listdir(BASE_DIR) if filename.lower() in f.lower() and f.startswith("note_")]
        if matches:
            p = _path(matches[0])
            filename = matches[0]
        else:
            return create_note(content, title=filename)
    try:
        with open(p, "a", encoding="utf-8") as f:
            f.write(f"\n{content}")
        return f"Appended to {filename}."
    except Exception as e:
        return f"Error appending to note: {e}"


def delete_note(query: str) -> str:
    """Delete a note by filename fragment or keyword match."""
    matches = [f for f in os.listdir(BASE_DIR) if query.lower() in f.lower() and f.startswith("note_")]
    if not matches:
        return f"No note matching '{query}' found."
    target = matches[0]
    return delete_file(target)
