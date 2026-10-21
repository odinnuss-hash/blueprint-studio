// Blueprint Studio – Extraktor
// Holt die Daten, die Blueprint Studio braucht, direkt aus der eigenen Satisfactory-Installation
// (ersetzt die Handarbeit in FModel; nutzt dieselbe Bibliothek CUE4Parse, Apache-2.0):
//   - Bauteil-Daten   Build_*.json   (wie FModel „Export → Properties (json)“)
//   - 3D-Modelle      SM_*.glb       (wie FModel „Export → Model“, glTF 2.0 binary)
//   - Icons           IconDesc*.png  (wie FModel „Export → Texture“, PNG)
// Ergebnis landet im Ziel-Ordner mit derselben Ordnerstruktur wie ein FModel-Export, danach
// übernehmen werkzeuge\icons-uebernehmen.mjs und werkzeuge\modelle-aufbereiten.mjs alles in die App.
//
// Aufruf: BsExtraktor --spiel "<Satisfactory-Ordner>" --ziel "<Export-Ordner>" [--ue GAME_UE5_6] [--daten "<Ordner für Hilfs-DLLs>"]
// Ausgabe-Zeilen für die App: SCHRITT …, FORTSCHRITT n m, INFO …, WARNUNG …, FEHLER …, FERTIG …

using System.Collections.Concurrent;
using System.Text;
using System.Text.RegularExpressions;
using CUE4Parse.Compression;
using CUE4Parse.FileProvider;
using CUE4Parse.MappingsProvider.Usmap;
using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Assets.Exports.StaticMesh;
using CUE4Parse.UE4.Assets.Exports.Texture;
using CUE4Parse.UE4.Objects.Core.Misc;
using CUE4Parse.UE4.Objects.Core.Serialization;
using CUE4Parse.UE4.Versions;
using CUE4Parse_Conversion;
using CUE4Parse_Conversion.Options;
using CUE4Parse_Conversion.Textures;
using Newtonsoft.Json;
using Serilog;

namespace BsExtraktor;

public static class Programm
{
    // Teile, die nicht zum sichtbaren Gebäude gehören (wie in modelle-aufbereiten.mjs)
    private static readonly Regex Skip = new(@"(^|/)Cube$|Hologram|Indicator|Clearance|Collision|Snap|Preview|Overlap|Fog|Broken|_Holo|Arrows|Pause|SmokePlane|BlenderLiquid|LandingPad_Jelly|^/Engine/|FicsmasHat|GiftTree|Mercer_Rings", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    // Bauteile, deren Mesh erst zur Laufzeit gewählt wird (MANUELL in modelle-aufbereiten.mjs)
    // Zusätzlich exportieren, obwohl der Filter sie verwerfen würde bzw. sie erst zur Laufzeit gewählt werden
    // (SM_StatusInd_01 = Rohr-Durchflussanzeige, liegt unter …/FlowIndicator/ – „Indicator“ steht im Filter)
    private static readonly string[] ZusatzMeshes = ["SM_ConveyorPole_01", "SM_HyperTubePole_01", "SM_SignPole_200cm", "SM_SignPole_350cm", "SM_SignPole_500cm", "SM_StatusInd_01"];
    private static readonly Regex MeshRef = new("\"ObjectName\":\\s*\"StaticMesh'([^']+)'\",\\s*\"ObjectPath\":\\s*\"([^\"]+)\"", RegexOptions.Compiled);
    private static readonly Regex IconRef = new("\"m(?:PersistentBigIcon|SmallIcon)\"\\s*:\\s*\"Texture2D ([^\"]+)\"", RegexOptions.Compiled);

    private static readonly object Konsole = new();
    private static void Zeile(string s) { lock (Konsole) { Console.WriteLine(s); Console.Out.Flush(); } }

    public static async Task<int> Main(string[] args)
    {
        Console.OutputEncoding = Encoding.UTF8;
        var a = Argumente(args);
        if (!a.TryGetValue("spiel", out var spiel) || !a.TryGetValue("ziel", out var ziel))
        {
            Zeile("FEHLER Aufruf: BsExtraktor --spiel \"<Satisfactory-Ordner>\" --ziel \"<Export-Ordner>\" [--ue GAME_UE5_6]");
            return 2;
        }
        var ueText = a.GetValueOrDefault("ue", "GAME_UE5_6");
        var daten = a.GetValueOrDefault("daten", Path.Combine(AppContext.BaseDirectory, "daten"));
        var nurIcons = a.ContainsKey("nur-icons");
        var nurModelle = a.ContainsKey("nur-modelle");

        Log.Logger = new LoggerConfiguration().MinimumLevel.Error().WriteTo.Console().CreateLogger();
        try
        {
            var paks = Path.Combine(spiel, "FactoryGame", "Content", "Paks");
            if (!Directory.Exists(paks)) { Zeile($"FEHLER Spieldateien nicht gefunden: {paks}"); return 3; }
            if (!Enum.TryParse<EGame>(ueText, true, out var ue)) { Zeile($"FEHLER Unbekannte UE-Version: {ueText}"); return 2; }
            Directory.CreateDirectory(ziel);
            Directory.CreateDirectory(daten);

            Zeile("SCHRITT Hilfsbibliotheken (Oodle, zlib) vorbereiten");
            await OodleHelper.InitializeAsync(Path.Combine(daten, OodleHelper.OodleFileName));
            await ZlibHelper.InitializeAsync(Path.Combine(daten, ZlibHelper.DllName));
            TextureDecoder.UseAssetRipperTextureDecoder = true; // rein verwaltete Dekodierung, keine Zusatz-DLL nötig

            Zeile($"SCHRITT Spieldateien öffnen ({ue})");
            // Satisfactory liefert eigene „Custom Versions“ mit (wie in FModel unter Settings → Custom Versions einzutragen)
            var cvDatei = Path.Combine(spiel, "CommunityResources", "CustomVersions.json");
            FCustomVersionContainer? customVersions = null;
            if (File.Exists(cvDatei))
            {
                var roh = File.ReadAllBytes(cvDatei);
                var cvText = roh.Length > 1 && roh[0] == 0xFF && roh[1] == 0xFE ? Encoding.Unicode.GetString(roh, 2, roh.Length - 2)
                           : roh.Length > 1 && roh[1] == 0 ? Encoding.Unicode.GetString(roh) : Encoding.UTF8.GetString(roh);
                var liste = Regex.Matches(cvText, "\"Key\"\\s*:\\s*\"([0-9A-Fa-f-]{32,36})\"\\s*,\\s*\"Version\"\\s*:\\s*(-?\\d+)")
                    .Select(m => new FCustomVersion(new FGuid(m.Groups[1].Value.Replace("-", "")), int.Parse(m.Groups[2].Value))).ToList();
                customVersions = new FCustomVersionContainer(liste);
                Zeile($"INFO {liste.Count} Custom Versions aus CustomVersions.json");
            }
            else Zeile("WARNUNG CustomVersions.json nicht gefunden – Bauteil-Daten können unvollständig sein.");
            var provider = new DefaultFileProvider(paks, SearchOption.TopDirectoryOnly, new VersionContainer(ue, ETexturePlatform.DesktopMobile, default, customVersions), StringComparer.OrdinalIgnoreCase);
            var usmap = Path.Combine(spiel, "CommunityResources", "FactoryGame.usmap");
            if (File.Exists(usmap))
            {
                Zeile("INFO Lade Mapping-Datei FactoryGame.usmap");
                try { provider.MappingsContainer = new FileUsmapTypeMappingsProvider(usmap); }
                catch (Exception e) when (e is ArgumentOutOfRangeException or IndexOutOfRangeException or CUE4Parse.UE4.Exceptions.ParserException)
                {
                    // Satisfactorys Mapping-Datei (Format v1) speichert „OptionalProperty“ ohne inneren Typ –
                    // CUE4Parse erwartet einen. Angepasste Kopie schreiben und die laden.
                    var kopie = Path.Combine(daten, "FactoryGame-angepasst.usmap");
                    var n = UsmapAnpassen(usmap, kopie);
                    Zeile($"INFO Mapping-Datei angepasst ({n} Stellen) – lade Kopie");
                    provider.MappingsContainer = new FileUsmapTypeMappingsProvider(kopie);
                }
            }
            else Zeile($"WARNUNG Keine Mapping-Datei gefunden ({usmap}) – Bauteil-Daten können unvollständig sein.");
            Zeile("INFO Archive suchen");
            provider.Initialize();
            Zeile($"INFO {provider.UnloadedVfs.Count} Archive gefunden – öffne sie");
            var gemountet = provider.Mount();
            try { provider.PostMount(); }
            catch (Exception e) { Zeile($"WARNUNG Nachbereitung übersprungen ({e.GetType().Name}: {e.Message})"); }
            Zeile($"INFO {gemountet} Archive geöffnet, {provider.Files.Count} Dateien");
            if (provider.Files.Count == 0) { Zeile("FEHLER Keine Dateien gelesen – stimmt der Spiel-Ordner?"); return 4; }

            var objekte = new ConcurrentDictionary<string, UObject>(StringComparer.OrdinalIgnoreCase);

            // ---------------------------------------------------------------- 1. Bauteil-Daten
            if (!nurIcons)
            {
                var builds = provider.Files.Values
                    .Where(f => f.Extension.Equals("uasset", StringComparison.OrdinalIgnoreCase)
                             && f.Name.StartsWith("Build_", StringComparison.OrdinalIgnoreCase)
                             && f.Path.StartsWith("FactoryGame/", StringComparison.OrdinalIgnoreCase))
                    .ToList();
                Zeile($"SCHRITT Bauteil-Daten lesen ({builds.Count} Bauteile)");
                var meshes = new ConcurrentDictionary<string, string>(StringComparer.OrdinalIgnoreCase); // Paket.Objekt -> Name
                int n = 0, fehler = 0;
                Parallel.ForEach(builds, new ParallelOptions { MaxDegreeOfParallelism = Math.Max(1, Environment.ProcessorCount - 1) }, f =>
                {
                    try
                    {
                        var pkg = provider.LoadPackage(f);
                        var json = JsonConvert.SerializeObject(pkg.GetExports(), Formatting.Indented);
                        var datei = Path.Combine(ziel, f.PathWithoutExtension.Replace('/', Path.DirectorySeparatorChar) + ".json");
                        Directory.CreateDirectory(Path.GetDirectoryName(datei)!);
                        File.WriteAllText(datei, json, new UTF8Encoding(false));
                        foreach (Match m in MeshRef.Matches(json))
                        {
                            var name = m.Groups[1].Value;
                            var paket = m.Groups[2].Value.Split('.')[0];
                            if (Skip.IsMatch(paket) || Skip.IsMatch(name)) continue;
                            meshes.TryAdd(paket + "." + name, name);
                        }
                    }
                    catch (Exception e) { Interlocked.Increment(ref fehler); if (fehler <= 20) Zeile($"WARNUNG {f.Name}: {e.Message}"); }
                    var k = Interlocked.Increment(ref n);
                    if (k % 50 == 0 || k == builds.Count) Zeile($"FORTSCHRITT {k} {builds.Count}");
                });
                Zeile($"INFO {builds.Count - fehler} Bauteil-Daten gespeichert, {meshes.Count} verschiedene Modelle gefunden");

                {
                    Zeile("SCHRITT Modelle laden");
                    foreach (var (pfad, name) in meshes)
                    {
                        try { if (provider.TryLoadPackageObject<UStaticMesh>(pfad, out var mesh)) objekte.TryAdd("M:" + name, mesh); }
                        catch (Exception e) { Zeile($"WARNUNG {name}: {e.Message}"); }
                    }
                    foreach (var name in ZusatzMeshes)
                    {
                        if (objekte.ContainsKey("M:" + name)) continue;
                        var gf = provider.Files.Values.FirstOrDefault(x => x.Extension.Equals("uasset", StringComparison.OrdinalIgnoreCase)
                                                                           && x.NameWithoutExtension.Equals(name, StringComparison.OrdinalIgnoreCase));
                        if (gf is null) continue;
                        try { if (provider.TryLoadPackageObject<UStaticMesh>(gf.PathWithoutExtension + "." + gf.NameWithoutExtension, out var mesh)) objekte.TryAdd("M:" + name, mesh); }
                        catch (Exception e) { Zeile($"WARNUNG {name}: {e.Message}"); }
                    }
                    Zeile($"INFO {objekte.Count} Modelle zum Export");
                }
            }

            // ---------------------------------------------------------------- 2. Icons
            if (!nurModelle)
            {
                var docs = new[] { "de.json", "en-US.json" }.Select(x => Path.Combine(spiel, "CommunityResources", "Docs", x)).FirstOrDefault(File.Exists);
                if (docs is null) Zeile("WARNUNG Spieldaten (CommunityResources\\Docs) nicht gefunden – keine Icons.");
                else
                {
                    var roh = File.ReadAllBytes(docs);
                    var text = roh.Length > 1 && roh[0] == 0xFF && roh[1] == 0xFE ? Encoding.Unicode.GetString(roh, 2, roh.Length - 2) : Encoding.UTF8.GetString(roh);
                    var icons = IconRef.Matches(text).Select(m => m.Groups[1].Value).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
                    Zeile($"SCHRITT Icons laden ({icons.Count})");
                    var vorher = objekte.Count;
                    foreach (var pfad in icons)
                    {
                        try { if (provider.TryLoadPackageObject<UTexture>(pfad, out var tex)) objekte.TryAdd("T:" + pfad, tex); }
                        catch (Exception e) { Zeile($"WARNUNG {pfad}: {e.Message}"); }
                    }
                    Zeile($"INFO {objekte.Count - vorher} Icons zum Export");
                }
            }

            // ---------------------------------------------------------------- 3. Exportieren
            Zeile($"SCHRITT Modelle und Icons speichern ({objekte.Count})");
            var session = new ExportSession { MaxDegreeOfParallelism = Math.Max(1, Environment.ProcessorCount - 1) };
            foreach (var o in objekte.Values)
            {
                try { session.Add(o); } catch (Exception e) { Zeile($"WARNUNG {o.Name}: {e.Message}"); }
            }
            var optionen = new ExportOptions(
                meshFormat: EMeshFormat.Gltf2,
                meshQuality: EMeshQuality.Highest,
                textureFormat: ETextureFormat.Png,
                exportMaterials: false,
                exportMorphTargets: false);
            var ergebnisse = await session.RunAsync(ziel, optionen, new Fortschritt());
            var ok = ergebnisse.Count(r => r.Success);
            foreach (var r in ergebnisse.Where(r => !r.Success).Take(20)) Zeile($"WARNUNG {r.ObjectPath}: {r.Error?.Message}");
            Zeile($"FERTIG {ok} von {ergebnisse.Count} Dateien gespeichert in {ziel}");
            return ok > 0 ? 0 : 5;
        }
        catch (Exception e)
        {
            Zeile($"FEHLER {e.GetType().Name}: {e.Message}");
            foreach (var z in e.ToString().Split('\n').Skip(1).Take(25)) Zeile("  " + z.TrimEnd());
            return 1;
        }
    }

    /// <summary>
    /// Läuft die .usmap genau so durch wie CUE4Parse, behandelt Typ 28 (OptionalProperty) aber als Typ ohne
    /// inneren Typ und ersetzt ihn durch 29 (gleiche Länge, ebenfalls ohne inneren Typ). Liefert die Zahl der Stellen.
    /// </summary>
    private static int UsmapAnpassen(string quelle, string ziel)
    {
        var b = File.ReadAllBytes(quelle);
        var o = 0;
        int I32() { var v = BitConverter.ToInt32(b, o); o += 4; return v; }
        uint U32() { var v = BitConverter.ToUInt32(b, o); o += 4; return v; }
        ushort U16() { var v = BitConverter.ToUInt16(b, o); o += 2; return v; }
        byte U8() => b[o++];
        if (U16() != 0x30C4) throw new InvalidDataException("Keine usmap-Datei");
        var ver = U8();
        if (ver >= 5) throw new InvalidDataException($"usmap-Version {ver} wird von der Anpassung nicht unterstützt");
        if (ver >= 1 && I32() != 0)
        {
            I32(); I32();                 // Paketversion
            var n = I32(); o += n * 20;   // Custom Versions (GUID + int)
            U32();                        // NetCL
        }
        var komp = U8(); var cs = U32(); var ds = U32();
        if (komp != 0 || cs != ds) throw new InvalidDataException("Komprimierte usmap wird von der Anpassung nicht unterstützt");
        var anzahl = 0;
        void Typ()
        {
            var stelle = o; var t = U8();
            switch (t)
            {
                case 28: b[stelle] = 29; anzahl++; break;     // OptionalProperty ohne inneren Typ
                case 26: Typ(); I32(); break;                 // EnumProperty: innerer Typ + Enum-Name
                case 9: I32(); break;                         // StructProperty: Struct-Name
                case 8: case 25: Typ(); break;                // Array / Set
                case 24: Typ(); Typ(); break;                 // Map
            }
        }
        var namen = U32();
        for (var i = 0; i < namen; i++) { int laenge = ver >= 2 ? U16() : U8(); o += laenge; } // erst lesen, dann addieren
        var enums = U32();
        for (var i = 0; i < enums; i++)
        {
            I32();
            int m = ver >= 3 ? U16() : U8();
            o += m * (ver >= 4 ? 12 : 4);
        }
        var structs = U32();
        for (var i = 0; i < structs; i++)
        {
            I32(); I32(); U16();
            var props = U16();
            for (var k = 0; k < props; k++) { U16(); U8(); I32(); Typ(); }
        }
        File.WriteAllBytes(ziel, b);
        return anzahl;
    }

    private sealed class Fortschritt : IProgress<ExportProgress>
    {
        private int _letzte = -1;
        public void Report(ExportProgress p)
        {
            if (p.Completed == p.Total || p.Completed - Volatile.Read(ref _letzte) >= 25)
            {
                Volatile.Write(ref _letzte, p.Completed);
                Zeile($"FORTSCHRITT {p.Completed} {p.Total}");
            }
        }
    }

    private static Dictionary<string, string> Argumente(string[] args)
    {
        var d = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        for (var i = 0; i < args.Length; i++)
        {
            if (!args[i].StartsWith("--")) continue;
            var k = args[i][2..];
            if (i + 1 < args.Length && !args[i + 1].StartsWith("--")) d[k] = args[++i];
            else d[k] = "1";
        }
        return d;
    }
}
