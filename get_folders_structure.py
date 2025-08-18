import os

EXCLUDE_DIRS = {
    '.git', '.venv', 'node_modules', '__pycache__', '.emergent',
    'dist', 'build', 'Scripts', 'Lib', 'share', 'man', 'tests',
    '.next', '.cache', '.parcel-cache', 'migrations'
}

EXCLUDE_PATTERNS = ['.dist-info', '.egg-info', '.spec']
EXCLUDE_EXTS = {'.pyc', '.pyd', '.exe', '.lock', '.log'}

def should_exclude(name, path):
    if name in EXCLUDE_DIRS:
        return True
    if any(part.endswith(pattern) for pattern in EXCLUDE_PATTERNS for part in path.split(os.sep)):
        return True
    if os.path.splitext(name)[1] in EXCLUDE_EXTS:
        return True
    return False

def print_tree(root, prefix=""):
    try:
        entries = [e for e in os.listdir(root) if not should_exclude(e, os.path.join(root, e))]
    except PermissionError:
        return
    entries.sort()
    for idx, entry in enumerate(entries):
        path = os.path.join(root, entry)
        is_last = idx == len(entries) - 1
        connector = "└── " if is_last else "├── "
        print(prefix + connector + entry)
        if os.path.isdir(path):
            new_prefix = prefix + ("    " if is_last else "│   ")
            print_tree(path, new_prefix)

print_tree(".")
