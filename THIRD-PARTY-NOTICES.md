# Third-party notices / Lizenzen Dritter

| Component | Use in Blueprint Studio | Licence |
|---|---|---|
| **Satisfactory** game content (game data `CommunityResources`, icons, 3D models, map tiles) – © Coffee Stain Studios AB | **Not included.** Read at runtime from the user's own installation; icons/models are extracted on the user's PC (built-in extractor or FModel). | Proprietary – do not redistribute |
| [Font Awesome Free](https://fontawesome.com) 6.7.2 – © Fonticons, Inc. | Some icons are embedded as inline SVG | Icons: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) – see fontawesome.com/license/free |
| [FModel](https://github.com/4sval/FModel) by 4sval | Optional. Downloaded by the setup wizard from the official GitHub releases into `werkzeuge/FModel` and started as a separate program. Not included. | GPL-3.0 |
| [satisfactory-3d-map](https://github.com/moritz-h/satisfactory-3d-map) repository by moritz-h | Optional. Only the four map tiles are downloaded from it by the setup wizard for the map background. No program code is used or included. | Map tiles: © Coffee Stain Studios |
| [CUE4Parse](https://github.com/FabianFG/CUE4Parse) by FabianFG (incl. CUE4Parse-Conversion) | Optional. Downloaded as source code from GitHub (pinned commit) by the setup wizard and built locally into the helpers `werkzeuge/extraktor` and `werkzeuge/gelaende` (terrain and rocks for the world view; own code in `Program.cs`). Downloads Oodle (OodleUE) and zlib-ng itself at runtime. Not included. | Apache-2.0 |
| [.NET 10 SDK / Desktop Runtime](https://dotnet.microsoft.com) – Microsoft | Installed via winget when needed (SDK to build the extractor, Desktop Runtime for FModel). Not included. | MIT |
| [satisfactory-symbol-db](https://github.com/nova-tech-build/satisfactory-symbol-db) by nova-tech-build | Character list for special character signs (`app/lib/symbol-db`, shortened to group names + code points) | [The Unlicense](https://unlicense.org) (public domain) |
| Community blueprint “Alternate Prod Sign (3/6 inputs)” | Optional. Used as a style template for plan boards **only if it is in the user’s own blueprint folders**. Not included. | – |
| [Node.js](https://nodejs.org) | Runtime, installed by `start.bat` via winget if missing. Not included. | MIT |

Blueprint Studio itself uses **no third-party npm packages**. The file formats `.sbp`, `.sbpcfg`, `.sav` and `.cbp` are read and written by own code for interoperability.

The app icon (hexagon with a building) is an original design.
