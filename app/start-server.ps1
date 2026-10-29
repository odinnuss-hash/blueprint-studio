# Startet den Server von Blueprint Studio ohne eigenes Fenster (aufgerufen von start.bat) und wartet, bis er antwortet.
# Der Server oeffnet das App-Fenster selbst und beendet sich, sobald es geschlossen wird. Seine Ausgaben stehen in der App
# unter Einstellungen -> Server-Protokoll und in userdata\server.log.
# Rueckgabe: 0 = Server laeuft, 1 = Server hat nicht geantwortet (start.bat zeigt dann das Protokoll).
param([string]$Node = 'node', [string]$Root = (Split-Path -Parent $PSScriptRoot))
$server = Join-Path $Root 'app\server.mjs'
Start-Process -FilePath $Node -ArgumentList @("`"$server`"", '--open') -WorkingDirectory $Root -WindowStyle Hidden
$port = if ($env:BS_PORT) { $env:BS_PORT } else { 37474 }
for ($i = 0; $i -lt 60; $i++) {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 "http://127.0.0.1:$port/api/ping"
    if ($r.StatusCode -eq 200) { exit 0 }
  } catch { }
  Start-Sleep -Milliseconds 500
}
exit 1
