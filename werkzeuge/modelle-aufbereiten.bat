@echo off
chcp 65001 >nul
cd /d "%~dp0.."
node werkzeuge\modelle-aufbereiten.mjs %*
echo.
pause
