import yaml
import os
import threading
from datetime import datetime
from collections import deque

MEMORY_PATH = os.path.join(os.path.dirname(__file__), '..', 'config', 'ziggy_memory.yaml')
SHORT_TERM_HISTORY = deque(maxlen=20)

# In-memory cache for long-term memory YAML. Reads were happening on every
# recall/remember/list — once per command — even though writes are rare.
# The cache is invalidated by mtime so external edits to the YAML still load.
_lock = threading.Lock()
_cache: dict | None = None
_cache_mtime: float = 0.0


def _file_mtime() -> float:
    try:
        return os.path.getmtime(MEMORY_PATH)
    except OSError:
        return 0.0


def load_long_term_memory():
    global _cache, _cache_mtime
    with _lock:
        if not os.path.exists(MEMORY_PATH):
            _cache = {}
            _cache_mtime = 0.0
            return dict(_cache)
        mtime = _file_mtime()
        if _cache is None or mtime != _cache_mtime:
            with open(MEMORY_PATH, 'r', encoding='utf-8') as f:
                _cache = yaml.safe_load(f) or {}
            _cache_mtime = mtime
        return dict(_cache)


def save_long_term_memory(data):
    global _cache, _cache_mtime
    with _lock:
        os.makedirs(os.path.dirname(os.path.abspath(MEMORY_PATH)), exist_ok=True)
        tmp = MEMORY_PATH + ".tmp"
        with open(tmp, 'w', encoding='utf-8') as f:
            yaml.dump(data, f, allow_unicode=True, default_flow_style=False)
        os.replace(tmp, MEMORY_PATH)
        _cache = dict(data) if isinstance(data, dict) else {}
        _cache_mtime = _file_mtime()


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


def search_memory(keyword: str):
    if not keyword:
        return []
    data = load_long_term_memory() or {}
    q = keyword.lower()
    return [{"key": k, "value": v} for k, v in data.items() if q in f"{k} {v}".lower()]
