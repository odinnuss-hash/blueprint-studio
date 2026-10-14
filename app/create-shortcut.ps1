# Legt die Verknuepfungen "Blueprint Studio" (Desktop + Startmenue) mit dem Blueprint-Symbol an
# und erneuert dabei alle schon vorhandenen (auch an Start/Taskleiste angeheftete).
#
# Windows merkt sich Symbole in einem Zwischenspeicher. Damit das neue Symbol sicher erscheint,
# bekommt die Symboldatei einen eigenen Namen je Version (app\icon-<Kennung>.ico) und der
# Zwischenspeicher wird danach aufgefrischt.
$ErrorActionPreference = 'Stop'
$root   = Split-Path -Parent $PSScriptRoot
$quelle = Join-Path $root 'app\icon.ico'
if (-not (Test-Path $quelle)) { throw "Symboldatei fehlt: $quelle" }

# Symbol mit Kennung (aus dem Inhalt) ablegen, alte Kopien entfernen
$hash  = (Get-FileHash $quelle -Algorithm MD5).Hash.Substring(0, 8).ToLower()
$icon  = Join-Path $root "app\icon-$hash.ico"
if (-not (Test-Path $icon)) { Copy-Item $quelle $icon }
Get-ChildItem (Join-Path $root 'app') -Filter 'icon-*.ico' | Where-Object { $_.FullName -ne $icon } | Remove-Item -Force -ErrorAction SilentlyContinue

$shell  = New-Object -ComObject WScript.Shell
$ziel   = Join-Path $root 'start.bat'
function Setze($lnk) {
  $sc = $shell.CreateShortcut($lnk)
  $sc.TargetPath       = $ziel
  $sc.WorkingDirectory = $root
  $sc.IconLocation     = "$icon,0"
  $sc.WindowStyle      = 7   # minimiert
  $sc.Description      = 'Blueprint Studio - Satisfactory-Blaupausen und Spielstaende'
  $sc.Save()
  (Get-Item $lnk).LastWriteTime = Get-Date
  Write-Host "  erneuert: $lnk"
}

Write-Host ''
Write-Host 'Verknuepfungen:'
$desktop   = [Environment]::GetFolderPath('Desktop')
$startmenu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Blueprint Studio.lnk'
Setze (Join-Path $desktop 'Blueprint Studio.lnk')
Setze $startmenu

# bereits vorhandene Verknuepfungen auf start.bat bzw. "Blueprint Studio" (auch angeheftete) mit aktualisieren
$orte = @(
  $desktop,
  [Environment]::GetFolderPath('CommonDesktopDirectory'),
  [Environment]::GetFolderPath('Programs'),
  (Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar'),
  (Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\StartMenu'),
  (Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch')
) | Where-Object { $_ -and (Test-Path $_) }
foreach ($o in $orte) {
  Get-ChildItem $o -Filter '*.lnk' -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
    try {
      $s = $shell.CreateShortcut($_.FullName)
      $passt = ($s.TargetPath -ieq $ziel) -or ($_.BaseName -like 'Blueprint Studio*')
      if ($passt -and $_.FullName -ne (Join-Path $desktop 'Blueprint Studio.lnk') -and $_.FullName -ne $startmenu) { Setze $_.FullName }
    } catch { }
  }
}

# Symbol-Zwischenspeicher von Windows auffrischen
try { & "$env:SystemRoot\System32\ie4uinit.exe" -show } catch { }
try { & "$env:SystemRoot\System32\ie4uinit.exe" -ClearIconCache } catch { }

Write-Host ''
Write-Host 'Fertig. Falls irgendwo noch das alte Symbol zu sehen ist: Verknuepfung einmal'
Write-Host 'vom Start/der Taskleiste loesen und die neue aus dem Startmenue wieder anheften'
Write-Host '(Start -> "Blueprint Studio" -> Rechtsklick -> "An Start anheften").'
