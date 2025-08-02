@echo off
cd /d "%~dp0"

start "Ziggy Main" cmd /k ".venv\Scripts\activate && python core\ziggy_main.py"
start "Web Server" cmd /k ".venv\Scripts\activate && python core\web_server.py"
start "Frontend Dev Server" cmd /k "cd web_interface\frontend && yarn start"
start "Backend API Server" cmd /k "cd web_interface\backend && C:\Users\YouvalPolacsek\Downloads\Ziggy_PC_FULL\.venv\Scripts\uvicorn.exe server:app --host 0.0.0.0 --port 8001"
