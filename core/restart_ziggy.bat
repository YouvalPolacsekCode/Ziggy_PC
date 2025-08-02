@echo off
cd /d %~dp0

REM 🔹 Set the correct script name
set MAIN_SCRIPT=ziggy_main.py

REM 🔹 Optional: Check if already running
tasklist /FI "IMAGENAME eq python.exe" /V | findstr /I %MAIN_SCRIPT% > nul
if %ERRORLEVEL% == 0 (
    echo 🚫 Ziggy is already running. Restart skipped.
    exit /b
)

REM 🔹 Start using the venv Python directly
echo 🔁 Starting Ziggy...
timeout /t 2 /nobreak > NUL
start "" .venv\Scripts\python.exe %MAIN_SCRIPT%
