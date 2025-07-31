import yaml
import os
from datetime import datetime, timedelta
from collections import deque

MEMORY_PATH = os.path.join(os.path.dirname(__file__), '..', 'config', 'ziggy_memory.yaml')
SHORT_TERM_HISTORY = deque(maxlen=20)

def load_long_term_memory():
    if not os.path.exists(MEMORY_PATH):
        return {}
    with open(MEMORY_PATH, 'r', encoding='utf-8') as f:
        return yaml.safe_load(f) or {}

def save_long_term_memory(data):
    with open(MEMORY_PATH, 'w', encoding='utf-8') as f:
        yaml.dump(data, f, allow_unicode=True, default_flow_style=False)

def delete_memory(key):
    data = load_long_term_memory()
    if key in data:
        del data[key]
        save_long_term_memory(data)
        return True
    return False

# Long-term memory helpers
def remember(key, value):
    data = load_long_term_memory()
    data[key] = value
    save_long_term_memory(data)

def recall(key, default=None):
    data = load_long_term_memory()
    return data.get(key, default)

def list_memory():
    return load_long_term_memory()


# Short-term memory (chat context)
def append_chat(role, content):
    SHORT_TERM_HISTORY.append({
        "role": role,
        "content": content,
        "timestamp": datetime.utcnow().isoformat()
    })

def get_chat_history():
    return [{"role": msg["role"], "content": msg["content"]} for msg in SHORT_TERM_HISTORY]

def clear_chat_history():
    SHORT_TERM_HISTORY.clear()
