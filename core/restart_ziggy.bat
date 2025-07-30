@echo off
cd /d %~dp0

REM Check if ziggy_main.py is already running
tasklist /FI "IMAGENAME eq python.exe" /V | findstr /I ziggy_main.py > nul

IF %ERRORLEVEL% == 0 (
    echo 🚫 Ziggy is already running. Restart skipped.
    exit /b
) ELSE (
    echo 🔁 Starting Ziggy...
    timeout /t 2 /nobreak > NUL
    start "" python ziggy_main.py
)
