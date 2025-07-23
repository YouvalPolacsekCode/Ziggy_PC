from flask import Flask, request, jsonify, render_template_string
from services.task_manager import list_tasks, add_task, mark_done
from services.file_manager import list_files, save_file, read_file
import os
import psutil
from datetime import datetime

app = Flask(__name__)

TEMPLATE = '''
<!doctype html>
<html lang="en">
<head><title>Ziggy Dashboard</title></head>
<body>
<h1>Ziggy Dashboard</h1>
<h2>Tasks</h2>
<ul>{% for task in tasks %}<li>{{ task }}</li>{% endfor %}</ul>
<h2>Files</h2>
<ul>{% for file in files %}<li>{{ file }}</li>{% endfor %}</ul>
</body>
</html>
'''

@app.route("/")
def index():
    return render_template_string(TEMPLATE, tasks=list_tasks(), files=list_files())

@app.route("/api/task", methods=["POST"])
def api_add_task():
    data = request.get_json()
    task = data.get("task")
    if not task:
        return jsonify({"status": "error", "message": "No task provided"}), 400
    message = add_task(task)
    return jsonify({"status": "success", "message": message})

@app.route("/api/tasks", methods=["GET"])
def api_list_tasks():
    return jsonify([{"task": t.strip("[x ]"), "done": t.startswith("[x]")} for t in list_tasks()])

@app.route("/api/task/done", methods=["POST"])
def api_mark_done():
    data = request.get_json()
    index = data.get("index")
    if index is None:
        return jsonify({"status": "error", "message": "No index provided"}), 400
    message = mark_done(index)
    return jsonify({"status": "success", "message": message})

@app.route("/api/file", methods=["POST"])
def api_save_file():
    data = request.get_json()
    filename = data.get("filename")
    content = data.get("content")
    if not filename or content is None:
        return jsonify({"status": "error", "message": "Invalid input"}), 400
    message = save_file(filename, content)
    return jsonify({"status": "success", "message": message})

@app.route("/api/files", methods=["GET"])
def api_list_files():
    return jsonify(list_files())

@app.route("/api/file", methods=["GET"])
def api_read_file():
    filename = request.args.get("filename")
    if not filename:
        return "Missing filename", 400
    return read_file(filename)

@app.route("/api/status", methods=["GET"])
def api_status():
    return jsonify({
        "cpu_percent": psutil.cpu_percent(),
        "memory": dict(psutil.virtual_memory()._asdict()),
        "uptime": str(datetime.now() - datetime.fromtimestamp(psutil.boot_time())),
        "running_threads": len(psutil.Process(os.getpid()).threads())
    })

@app.route("/api/logs", methods=["GET"])
def api_logs():
    log_file = sorted([f for f in os.listdir("logs") if f.endswith(".log")])[-1]
    with open(f"logs/{log_file}", "r") as f:
        return f.read()

def start_dashboard():
    print("[INFO] Starting Ziggy Dashboard on http://localhost:5000 ...")
    app.run(host="0.0.0.0", port=5000, debug=False, use_reloader=False)
