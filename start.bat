@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Blueprint Studio

if not exist "app\server.mjs" goto broken

rem ---------- 1. Node.js suchen ----------
set "NODE_EXE="
where node >nul 2>nul
if not errorlevel 1 set "NODE_EXE=node"
if not defined NODE_EXE call :findnode

rem ---------- 2. Node.js bei Bedarf automatisch installieren ----------
if not defined NODE_EXE call :installnode
if not defined NODE_EXE goto nonode

rem ---------- 3. Version pruefen (mindestens 18) ----------
"%NODE_EXE%" -e "process.exit(parseInt(process.versions.node)<18?1:0)"
if errorlevel 1 call :installnode
"%NODE_EXE%" -e "process.exit(parseInt(process.versions.node)<18?1:0)"
if errorlevel 1 goto oldnode

rem ---------- 4. Einmalig: Desktop-Verknuepfung anbieten ----------
if not exist "userdata" mkdir "userdata"
if exist "userdata\.setup-done" goto launch
echo.
echo  Willkommen bei Blueprint Studio!
echo.
choice /c JN /n /m " Desktop-Verknuepfung mit Blueprint-Symbol anlegen? [J/N] "
if errorlevel 2 goto markdone
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0app\create-shortcut.ps1"
:markdone
echo done> "userdata\.setup-done"

rem ---------- 5. Starten ----------
:launch
rem Server ohne eigenes Fenster starten; er oeffnet das App-Fenster selbst und beendet sich,
rem sobald das Fenster geschlossen wird. Ausgaben: in der App unter Einstellungen - Server-Protokoll
rem bzw. in userdata\server.log.
echo  Blueprint Studio startet ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0app\start-server.ps1" -Node "%NODE_EXE%" -Root "%~dp0."
if errorlevel 1 goto startfehler
exit /b 0

rem ---------- Unterprogramme ----------
:findnode
if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LocalAppData%\Programs\nodejs\node.exe" set "NODE_EXE=%LocalAppData%\Programs\nodejs\node.exe"
exit /b 0

:installnode
where winget >nul 2>nul
if errorlevel 1 exit /b 1
echo.
echo  Node.js wird automatisch installiert bzw. aktualisiert (einmalig, Windows fragt evtl. nach Erlaubnis) ...
winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
set "NODE_EXE="
call :findnode
exit /b 0

rem ---------- Fehlerfaelle ----------
:nonode
echo.
echo  Node.js konnte nicht automatisch installiert werden.
echo  Bitte einmalig von https://nodejs.org die Version "LTS" installieren
echo  und danach start.bat erneut ausfuehren.
start "" "https://nodejs.org/en/download"
echo.
pause
exit /b 1

:oldnode
echo.
echo  Die installierte Node.js-Version ist zu alt (mindestens Version 18 noetig).
echo  Bitte die aktuelle LTS-Version von https://nodejs.org installieren.
echo.
pause
exit /b 1

:startfehler
echo.
echo  Der Server von Blueprint Studio hat nicht geantwortet. Letzte Meldungen:
echo.
if exist "userdata\server.log" powershell -NoProfile -Command "Get-Content -Tail 25 'userdata\server.log'"
echo.
echo  Vollstaendiges Protokoll: userdata\server.log
echo.
echo  Blueprint Studio wird jetzt wie frueher mit eigenem Serverfenster gestartet ...
start "Blueprint Studio (Server)" /min "%NODE_EXE%" "%~dp0app\server.mjs" --open
timeout /t 8 >nul
exit /b 0

:broken
echo.
echo  Die Programmdateien fehlen (app\server.mjs). Bitte den Ordner vollstaendig kopieren.
echo.
pause
exit /b 1
