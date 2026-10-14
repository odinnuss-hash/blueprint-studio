@echo off
chcp 65001 >nul
cd /d "%~dp0.."
node werkzeuge\icons-uebernehmen.mjs %*
echo.
pause
