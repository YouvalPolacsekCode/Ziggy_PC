import os

BASE_DIR = "user_files"
os.makedirs(BASE_DIR, exist_ok=True)

def save_file(filename, content):
    """
    Save content to a file inside the user_files directory.
    """
    path = os.path.join(BASE_DIR, filename)
    try:
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        return f"{filename} saved."
    except Exception as e:
        return f"Error saving file: {e}"

def read_file(filename):
    """
    Read and return the contents of a file from user_files.
    """
    path = os.path.join(BASE_DIR, filename)
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        return "File not found."
    except Exception as e:
        return f"Error reading file: {e}"

def list_files():
    """
    List all files in the user_files directory.
    """
    try:
        return os.listdir(BASE_DIR)
    except Exception as e:
        return [f"Error listing files: {e}"]

def create_note(content):
    """
    Create a note with auto-generated timestamped filename.
    """
    from datetime import datetime
    filename = f"note_{datetime.now().strftime('%Y-%m-%d_%H-%M-%S')}.txt"
    return save_file(filename, content)

def read_notes(limit=5):
    """
    Read the latest `limit` notes from user_files (based on filename sort).
    """
    notes = sorted([f for f in os.listdir(BASE_DIR) if f.startswith("note_")], reverse=True)[:limit]
    if not notes:
        return "No notes found."

    output = []
    for filename in notes:
        content = read_file(filename)
        output.append(f"{filename}:\n{content}")
    return "\n\n".join(output)
