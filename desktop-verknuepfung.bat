@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0app\create-shortcut.ps1"
echo.
pause
