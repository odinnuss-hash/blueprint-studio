# Third-party notices / Lizenzen Dritter

| Component | Use in Blueprint Studio | Licence |
|---|---|---|
| **Satisfactory** game content (game data `CommunityResources`, icons, 3D models, map tiles) – © Coffee Stain Studios AB | **Not included.** Read at runtime from the user's own installation; icons/models are extracted on the user's PC (built-in extractor or FModel). | Proprietary – do not redistribute |
| [Font Awesome Free](https://fontawesome.com) 6.7.2 – © Fonticons, Inc. | Some icons are embedded as inline SVG | Icons: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) – see fontawesome.com/license/free |
| [FModel](https://github.com/4sval/FModel) by 4sval | Optional. Downloaded by the setup wizard from the official GitHub releases into `werkzeuge/FModel` and started as a separate program. Not included. | GPL-3.0 |
| [Satisfactory 3D Map](https://github.com/moritz-h/satisfactory-3d-map) by moritz-h | Optional. Downloaded by the setup wizard from the official GitHub releases into `werkzeuge/Satisfactory3DMap` and started as a separate program; its map tiles can be downloaded for the map background. Not included. | GPL-3.0 (map tiles: © Coffee Stain Studios) |
| `oodle-data-shared.dll` | Copied locally from the user's FModel folder to the 3D editor if present. Not included. | Proprietary (Epic Games / RAD) |
| [CUE4Parse](https://github.com/FabianFG/CUE4Parse) by FabianFG (incl. CUE4Parse-Conversion) | Optional. Downloaded as source code from GitHub (pinned commit) by the setup wizard and built locally into the helper `werkzeuge/extraktor` (own code in `Program.cs`). Downloads Oodle (OodleUE) and zlib-ng itself at runtime. Not included. | Apache-2.0 |
| [.NET 10 SDK / Desktop Runtime](https://dotnet.microsoft.com) – Microsoft | Installed via winget when needed (SDK to build the extractor, Desktop Runtime for FModel). Not included. | MIT |
| [Node.js](https://nodejs.org) | Runtime, installed by `start.bat` via winget if missing. Not included. | MIT |

Blueprint Studio itself uses **no third-party npm packages**. The file formats `.sbp`, `.sbpcfg`, `.sav` and `.cbp` are read and written by own code for interoperability.

The app icon (hexagon with a building) is an original design.
