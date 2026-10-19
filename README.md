# Blueprint Studio

**View, edit and organise _Satisfactory_ blueprints outside the game – in 2D and 3D.**
*(Deutsch: siehe [unten](#deutsch))*

Blueprint Studio is a free Windows tool for players of [Satisfactory](https://www.satisfactorygame.com/). It reads your blueprint files (`.sbp`) and save games (`.sav`) directly and runs completely locally – no account, no upload.

> Unofficial fan project. Not affiliated with or endorsed by Coffee Stain Studios. *Satisfactory* is a trademark of Coffee Stain Studios AB.

## Features

- **2D / 3D viewer & editor** – move, rotate, tilt, delete (lasso pen in 3D), swap materials and Mk tiers, undo/redo, WASD camera.
- **Shape generator** – round platforms, circles, rings, multi-storey buildings, round towers.
- **Organise** – reads thousands of blueprints, suggests consistent names (`Group_Subgroup_Topic`), finds duplicates and similar blueprints by their content, pre-sorts a whole library inbox into the archive structure, deletes to the recycle bin – everything undoable.
- **Archive (storage folders)** – drag blueprints into a folder structure, switch them in and out of a save game with one click; the structure is fully editable. Large window with list or **tiles with 3D previews** for small screens.
- **Categories in the game** – blueprints you bring into the game are sorted straight into the in-game blueprint menu (category / subcategory, with your own icons); the original save is backed up once.
- **Production planner** – enter what you want per minute; the app calculates the whole chain (machines, raw materials, power, alternate recipes) and **builds it as a blueprint**: a whole factory, a partial factory or a single machine row with belts, splitters, mergers, power and signs.
- **Master Class** – a collection of ready-made textbook factories by tier: view in 3D, copy into the game or use their products as planner targets.
- **Map** – view save games like an interactive map and **cut out any area as a new blueprint**; Megaprints (`.cbp`) from satisfactory-calculator.com are shown too.
- **Building catalog** – all buildings with costs, power, recipes – in the language of your game.
- **Setup wizard** – finds the game and your saves automatically, optional download of tools, and **fetches the real 3D models and icons automatically** from *your own* game (built-in extractor based on CUE4Parse; manual FModel guide as fallback).
- **Updates** – the app checks this repository's releases and installs new versions with one click (your settings, blueprints and models are kept).
- **Languages** – Deutsch, English, Français, 日本語.

## Quick start

1. Download the latest version from [**Releases**](https://github.com/odinnuss-hash/blueprint-studio/releases/latest) (*Source code (zip)*) and unpack it, e.g. to `C:\Games\BlueprintStudio`.
2. Double-click **`start.bat`**. Node.js is installed automatically via winget if missing. If Windows shows a blue SmartScreen warning, click *More info* → *Run anyway* (the app is not code-signed).
3. The setup wizard opens – follow it (about 2 minutes, plus optional 5–15 minutes once for real 3D models).

Requirements: Windows 10/11, Satisfactory 1.0 or newer (Steam or Epic), Edge or Chrome.

## Game content

3D models, icons and map images belong to Coffee Stain Studios and are **not included**. The wizard extracts them once from your own, legally owned game installation – automatically (it installs the .NET 10 SDK and builds a small extractor based on [CUE4Parse](https://github.com/FabianFG/CUE4Parse)) or manually with [FModel](https://github.com/4sval/FModel). Without them the 3D view shows simple boxes – everything else works.

## Licence

© 2026 ODINnuss. Free for private, non-commercial use. Commercial use and publishing modified versions require permission. See [`LICENSE`](LICENSE) and [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).

Issues and suggestions are welcome.

---

## Deutsch

**Satisfactory-Blaupausen außerhalb des Spiels ansehen, bearbeiten und ordnen – in 2D und 3D.**

Kostenloses Windows-Werkzeug, liest Blaupausen (`.sbp`) und Spielstände (`.sav`) direkt und läuft komplett lokal.

**Start:** Neueste Version unter [Releases](https://github.com/odinnuss-hash/blueprint-studio/releases/latest) herunterladen („Source code (zip)“), entpacken, **`start.bat`** doppelklicken (bei der blauen Windows-Warnung „Weitere Informationen“ → „Trotzdem ausführen“) – der Einrichtungs-Assistent führt durch alles Weitere (Sprache, Ordner, Spielstand, 3D-Darstellung).

Funktionen: 2D/3D-Ansicht und -Bearbeitung (Stift, WASD, Material/Mk-Stufe tauschen), Formen-Generator, Ordnen mit Namensschema, Duplikat-Erkennung nach Inhalt und Vorsortierung ganzer Bibliotheken, Ablage mit eigener Ordnerstruktur (auch als großes Fenster mit 3D-Kacheln), Kategorien im Bauplan-Menü des Spiels, Produktionsplaner mit Blaupausen-Bau, Master-Class-Sammlung, Karte mit „Bereich als Blaupause speichern“, Gebäude-Katalog, Assistent (holt 3D-Modelle und Icons automatisch aus dem eigenen Spiel, alternativ FModel-Anleitung), Update-Funktion mit einem Klick, Sprachen DE/EN/FR/JA.

Spielinhalte (Modelle, Icons, Kartenbild) gehören Coffee Stain Studios und sind nicht enthalten – der Assistent holt sie einmalig aus deiner eigenen Spielinstallation.

Nutzung kostenlos für private, nicht-kommerzielle Zwecke – siehe `LICENSE`. Inoffizielles Fan-Projekt ohne Verbindung zu Coffee Stain Studios.
