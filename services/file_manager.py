import os
BASE_DIR = "user_files"
os.makedirs(BASE_DIR, exist_ok=True)

def save_file(filename, content):
    with open(os.path.join(BASE_DIR, filename), "w") as f:
        f.write(content)
    return f"{filename} saved."

def read_file(filename):
    try:
        with open(os.path.join(BASE_DIR, filename), "r") as f:
            return f.read()
    except FileNotFoundError:
        return "File not found."

def list_files():
    return os.listdir(BASE_DIR)