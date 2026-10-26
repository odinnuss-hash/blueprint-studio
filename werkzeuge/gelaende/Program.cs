// Gelände-Probe: Landschaftsdaten (Höhenkarten) im Satisfactory-Paket finden.
// Aufruf: Gelaende --spiel "<Satisfactory-Ordner>" --daten "<Ordner mit Oodle/zlib>" [--muster <Regex>]
using System.Text;
using System.Text.RegularExpressions;
using CUE4Parse.Compression;
using CUE4Parse.FileProvider;
using CUE4Parse.MappingsProvider.Usmap;
using CUE4Parse.UE4.Objects.Core.Misc;
using CUE4Parse.UE4.Objects.Core.Serialization;
using CUE4Parse.UE4.Versions;
using CUE4Parse.UE4.Assets.Exports.Texture;
using Serilog;

Console.OutputEncoding = Encoding.UTF8;
var a = new Dictionary<string, string>();
for (int i = 0; i < args.Length; i++) if (args[i].StartsWith("--")) a[args[i][2..]] = i + 1 < args.Length && !args[i + 1].StartsWith("--") ? args[++i] : "1";
var spiel = a["spiel"]; var daten = a["daten"];
Log.Logger = new LoggerConfiguration().MinimumLevel.Error().WriteTo.Console().CreateLogger();
await OodleHelper.InitializeAsync(Path.Combine(daten, OodleHelper.OodleFileName));
await ZlibHelper.InitializeAsync(Path.Combine(daten, ZlibHelper.DllName));
var roh = File.ReadAllBytes(Path.Combine(spiel, "CommunityResources", "CustomVersions.json"));
var cvText = roh.Length > 1 && roh[0] == 0xFF && roh[1] == 0xFE ? Encoding.Unicode.GetString(roh, 2, roh.Length - 2) : roh.Length > 1 && roh[1] == 0 ? Encoding.Unicode.GetString(roh) : Encoding.UTF8.GetString(roh);
var cv = new FCustomVersionContainer(Regex.Matches(cvText, "\"Key\"\\s*:\\s*\"([0-9A-Fa-f-]{32,36})\"\\s*,\\s*\"Version\"\\s*:\\s*(-?\\d+)")
    .Select(m => new FCustomVersion(new FGuid(m.Groups[1].Value.Replace("-", "")), int.Parse(m.Groups[2].Value))).ToList());
var provider = new DefaultFileProvider(Path.Combine(spiel, "FactoryGame", "Content", "Paks"), SearchOption.TopDirectoryOnly,
    new VersionContainer(EGame.GAME_UE5_6, ETexturePlatform.DesktopMobile, default, cv), StringComparer.OrdinalIgnoreCase);
provider.MappingsContainer = new FileUsmapTypeMappingsProvider(Path.Combine(daten, "FactoryGame-angepasst.usmap"));
provider.Initialize(); provider.Mount(); try { provider.PostMount(); } catch { }
Console.WriteLine($"{provider.Files.Count} Dateien");
var muster = new Regex(a.GetValueOrDefault("muster", "Landscape|Heightmap|GameLevel01"), RegexOptions.IgnoreCase);
var treffer = provider.Files.Keys.Where(k => muster.IsMatch(k)).ToList();
Console.WriteLine($"{treffer.Count} Treffer für {muster}");
if (a.ContainsKey("json"))
{
    // Assets (Treffer von --muster) mit allen Exporten als JSON speichern – z. B. die Symbol-Bibliothek (IconLibrary) für Schild-Symbole
    var liste = new List<object>();
    foreach (var k in treffer.Where(k => k.EndsWith(".uasset", StringComparison.OrdinalIgnoreCase)))
    {
        try { var pkg = provider.LoadPackage(k); liste.Add(new { pfad = k, exporte = pkg.GetExports() }); Console.WriteLine("OK " + k); }
        catch (Exception e) { Console.WriteLine("FEHLER " + k + " " + e.Message); }
    }
    File.WriteAllText(a["json"], Newtonsoft.Json.JsonConvert.SerializeObject(liste, Newtonsoft.Json.Formatting.Indented));
    Console.WriteLine("FERTIG " + liste.Count + " Assets");
    return;
}
if (a.ContainsKey("punkte"))
{
    // Kartenpunkte für Welt/Karte/Planer: Rohstoff-Knoten (Art, Reinheit), Vorkommen, Geysire, Gasquellen, Absturzstellen, Sammelobjekte.
    // Lage = RelativeLocation der RootComponent des Akteurs; der Akteurname entspricht dem Namen im Spielstand (Abgleich belegt/eingesammelt).
    var arten = new HashSet<string> { "BP_ResourceNode_C", "BP_ResourceDeposit_C", "BP_ResourceNodeGeyser_C", "BP_FrackingCore_C", "BP_FrackingSatellite_C",
        "BP_DropPod_C", "BP_Crystal_C", "BP_Crystal_mk2_C", "BP_Crystal_mk3_C", "BP_WAT1_C", "BP_WAT2_C" };
    var punkte = new System.Collections.Concurrent.ConcurrentBag<string>();
    var zellenP = provider.Files.Keys.Where(k => k.Contains("Persistent_Level") && k.EndsWith(".umap")).ToList();
    int fertigP = 0;
    string Kurz(string? s) => s == null ? "" : s.Contains("::") ? s[(s.LastIndexOf("::") + 2)..] : s;
    Parallel.ForEach(zellenP, new ParallelOptions { MaxDegreeOfParallelism = Math.Max(1, Environment.ProcessorCount - 1) }, z =>
    {
        try
        {
            var pkg = provider.LoadPackage(z);
            foreach (var e in pkg.GetExports())
            {
                if (!arten.Contains(e.ExportType)) continue;
                var root = e.GetOrDefault<CUE4Parse.UE4.Objects.UObject.FPackageIndex>("RootComponent")?.ResolvedObject?.Load();
                if (root == null) continue;
                var p = root.GetOrDefault<CUE4Parse.UE4.Objects.Core.Math.FVector>("RelativeLocation");
                var res = e.GetOrDefault<CUE4Parse.UE4.Objects.UObject.FPackageIndex>("mResourceClass")?.Name ?? "";
                var pur = Kurz(e.Properties.FirstOrDefault(x => x.Name.Text == "mPurity")?.Tag?.GenericValue?.ToString()); // Enum, fehlt = Standard der Klasse
                punkte.Add($"{{\"t\":\"{e.ExportType}\",\"n\":\"{e.Name}\",\"x\":{Math.Round(p.X)},\"y\":{Math.Round(p.Y)},\"z\":{Math.Round(p.Z)},\"r\":\"{res}\",\"p\":\"{pur}\"}}");
            }
        }
        catch { }
        var f = Interlocked.Increment(ref fertigP); if (f % 50 == 0) Console.WriteLine($"FORTSCHRITT {f} {zellenP.Count}");
    });
    var liste = punkte.ToList(); liste.Sort(StringComparer.Ordinal);
    File.WriteAllText(a["punkte"], "[\n" + string.Join(",\n", liste) + "\n]\n");
    Console.WriteLine($"FERTIG {liste.Count} Kartenpunkte");
    return;
}
if (a.ContainsKey("export"))
{
    // Höhenraster der ganzen Karte: alle Streaming-Zellen, alle Landschaftskomponenten → Raster (Standard 4 m), höchster Wert je Feld.
    // Gemessen 21.10.2026: Komponente = 127 Quads, Textur 128×128 BGRA (R = hoch, G = tief), Höhe cm = (Wert − 32768) / 128 · ScaleZ;
    // Lage = RootComponent.RelativeLocation des LandscapeStreamingProxy + RelativeLocation der Komponente · Scale (100 cm je Quad).
    float raster = float.Parse(a.GetValueOrDefault("raster", "400")); // cm
    const float X0 = -500000, Y0 = -500000; int N = (int)(1000000 / raster);
    var gitter = new float[N * N]; Array.Fill(gitter, float.NaN);
    var zellen = provider.Files.Keys.Where(k => k.Contains("Persistent_Level/_Generated_") && k.EndsWith(".umap")).ToList();
    int fertig = 0, komp = 0;
    Parallel.ForEach(zellen, new ParallelOptions { MaxDegreeOfParallelism = Math.Max(1, Environment.ProcessorCount - 1) }, z =>
    {
        try
        {
            var pkg = provider.LoadPackage(z);
            var ex = pkg.GetExports().ToList();
            if (!ex.Any(e => e is CUE4Parse.UE4.Assets.Exports.Component.Landscape.ULandscapeComponent)) return;
            // Proxy-Wurzel: Lage + Maßstab
            var wurzeln = ex.Where(e => e.ExportType == "SceneComponent" && e.Name.StartsWith("RootComponent")).ToList();
            foreach (var lc in ex.OfType<CUE4Parse.UE4.Assets.Exports.Component.Landscape.ULandscapeComponent>())
            {
                var parent = lc.GetOrDefault<CUE4Parse.UE4.Objects.UObject.FPackageIndex>("AttachParent");
                var w = parent?.ResolvedObject?.Load() ?? wurzeln.FirstOrDefault();
                if (w == null) continue;
                var wl = w.GetOrDefault<CUE4Parse.UE4.Objects.Core.Math.FVector>("RelativeLocation");
                var ws = w.GetOrDefault("RelativeScale3D", new CUE4Parse.UE4.Objects.Core.Math.FVector(1, 1, 1));
                var rel = lc.GetOrDefault<CUE4Parse.UE4.Objects.Core.Math.FVector>("RelativeLocation");
                var hm = lc.GetHeightmap(); var mip = hm?.GetFirstMip(); var d = mip?.BulkData?.Data; if (d == null || mip == null) continue;
                int tw = mip.SizeX, th = mip.SizeY, q = lc.ComponentSizeQuads;
                int ox = (int)Math.Round(lc.HeightmapScaleBias.Z * tw), oy = (int)Math.Round(lc.HeightmapScaleBias.W * th);
                for (int py = 0; py <= q; py++) for (int px = 0; px <= q; px++)
                {
                    int ix = ox + px, iy = oy + py; if (ix >= tw || iy >= th) continue;
                    int o = (iy * tw + ix) * 4; var v = (d[o + 2] << 8) | d[o + 1];
                    float wx = wl.X + (rel.X + px) * ws.X, wy = wl.Y + (rel.Y + py) * ws.Y, wz = wl.Z + rel.Z * ws.Z + (v - 32768) / 128f * ws.Z;
                    int gx = raster <= 100 ? (int)Math.Round((wx - X0) / raster) : (int)((wx - X0) / raster), gy = raster <= 100 ? (int)Math.Round((wy - Y0) / raster) : (int)((wy - Y0) / raster); if (gx < 0 || gy < 0 || gx >= N || gy >= N) continue;
                    if (raster <= 100) gitter[gy * N + gx] = wz; // volle Auflösung: jeder Landschaftspunkt ist ein Rasterpunkt (Ränder doppelt, gleicher Wert)
                    else lock (gitter) { var alt = gitter[gy * N + gx]; if (float.IsNaN(alt) || wz > alt) gitter[gy * N + gx] = wz; }
                }
                Interlocked.Increment(ref komp);
            }
        }
        catch (Exception e) { Console.WriteLine($"WARNUNG {Path.GetFileName(z)}: {e.Message}"); }
        finally { var f = Interlocked.Increment(ref fertig); if (f % 250 == 0) Console.WriteLine($"FORTSCHRITT {f} {zellen.Count} ({komp} Komponenten)"); }
    });
    // Auf belegten Bereich zuschneiden, als Int16 in dm speichern (−32768 = keine Daten) + Kopf als JSON
    int gx0 = N, gy0 = N, gx1 = -1, gy1 = -1;
    for (int y = 0; y < N; y++) for (int x = 0; x < N; x++) if (!float.IsNaN(gitter[y * N + x])) { gx0 = Math.Min(gx0, x); gx1 = Math.Max(gx1, x); gy0 = Math.Min(gy0, y); gy1 = Math.Max(gy1, y); }
    int bw = gx1 - gx0 + 1, bh = gy1 - gy0 + 1; var aus = new short[bw * bh]; float mn = float.MaxValue, mx = float.MinValue;
    for (int y = 0; y < bh; y++) for (int x = 0; x < bw; x++) { var v = gitter[(y + gy0) * N + x + gx0]; if (float.IsNaN(v)) aus[y * bw + x] = short.MinValue; else { aus[y * bw + x] = (short)Math.Clamp(Math.Round(v / 10), -32767, 32767); mn = Math.Min(mn, v); mx = Math.Max(mx, v); } }
    var datei = a["export"]; var bytes = new byte[aus.Length * 2]; Buffer.BlockCopy(aus, 0, bytes, 0, bytes.Length); File.WriteAllBytes(datei + ".bin", bytes);
    File.WriteAllText(datei + ".json", $"{{\"version\":1,\"x0\":{X0 + gx0 * raster},\"y0\":{Y0 + gy0 * raster},\"raster\":{raster},\"breite\":{bw},\"hoehe\":{bh},\"einheit\":\"dm\",\"leer\":-32768,\"zMin\":{mn:F0},\"zMax\":{mx:F0},\"komponenten\":{komp}}}");
    Console.WriteLine($"FERTIG {komp} Komponenten, Raster {bw}x{bh} à {raster / 100} m, Höhe {mn / 100:F0}..{mx / 100:F0} m");
    return;
}
if (a.ContainsKey("felsen"))
{
    // Felsen/Klippen (Felsen sind eigene Modelle, nicht Teil der Landschaft):
    // Fels-Modelle (Name passt zu FELS) aus allen Zellen, Einzelobjekte und Instanzen, Dreiecke der gröbsten Detailstufe
    // in Weltlage rastern, höchster Wert je Feld; Ergebnis = max(Landschaft, Felsen) als neues Raster.
    var FELS = new Regex(a.GetValueOrDefault("muster-fels", "Cliff|Rock|Boulder|Mountain|Stone|Formation|Mesa|Canyon|Arch|Pillar|Plateau|Crag|Spire|Overhang"), RegexOptions.IgnoreCase);
    // Findlinge und Geröll (SM_Boulder, SM_RockPile, SmoothRock …) bleiben weg: Fundamente gehen im Spiel durch sie hindurch, sie würden die Fahrbahn nur überall anheben
    var OHNE = new Regex(a.GetValueOrDefault("ohne-fels", "Rubble|Pebble|Gravel|Ivy|Moss|Plant|Tree|Bush|Grass|Fern|Flower|Root|Decal|Shell|Boulder|RockPile|SmoothRock|Coral"), RegexOptions.IgnoreCase);
    var stamm = a["felsen"];
    var kopf = File.ReadAllText(stamm + ".json");
    float zahl(string k) => float.Parse(Regex.Match(kopf, "\"" + k + "\":(-?[0-9.]+)").Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture);
    float x0 = zahl("x0"), y0 = zahl("y0"), ras = zahl("raster"); int bw = (int)zahl("breite"), bh = (int)zahl("hoehe");
    var landRoh = File.ReadAllBytes(stamm + ".bin"); var land = new short[bw * bh]; Buffer.BlockCopy(landRoh, 0, land, 0, landRoh.Length);
    var fels = new int[bw * bh]; Array.Fill(fels, int.MinValue); // cm
    var meshCache = new System.Collections.Concurrent.ConcurrentDictionary<string, (float[] v, uint[] idx)?>();
    (float[] v, uint[] idx)? ladeMesh(CUE4Parse.UE4.Objects.UObject.FPackageIndex? pi)
    {
        if (pi == null || pi.IsNull) return null;
        var pfad = pi.ResolvedObject?.GetPathName() ?? pi.Name;
        return meshCache.GetOrAdd(pfad, _ =>
        {
            try
            {
                var sm = pi.Load<CUE4Parse.UE4.Assets.Exports.StaticMesh.UStaticMesh>();
                var lods = sm?.RenderData?.LODs; if (lods == null) return null;
                var lod = lods.LastOrDefault(l => !l.SkipLod) ?? lods.FirstOrDefault(l => !l.SkipLod); if (lod == null) return null;
                var vs = lod.PositionVertexBuffer!.Verts; var v = new float[vs.Length * 3];
                for (int i = 0; i < vs.Length; i++) { v[i * 3] = vs[i].X; v[i * 3 + 1] = vs[i].Y; v[i * 3 + 2] = vs[i].Z; }
                return (v, lod.IndexBuffer!.Buffer!);
            }
            catch { return null; }
        });
    }
    void hoch(int gx, int gy, int zcm) { if (gx < 0 || gy < 0 || gx >= bw || gy >= bh) return; ref int z = ref fels[gy * bw + gx]; int alt; do { alt = z; if (zcm <= alt) return; } while (Interlocked.CompareExchange(ref z, zcm, alt) != alt); }
    // Dreieck rastern: Feldmitten im Dreieck bekommen die interpolierte Höhe, Ecken immer
    void dreieck(CUE4Parse.UE4.Objects.Core.Math.FVector p, CUE4Parse.UE4.Objects.Core.Math.FVector q, CUE4Parse.UE4.Objects.Core.Math.FVector r)
    {
        float ax = (p.X - x0) / ras, ay = (p.Y - y0) / ras, bx = (q.X - x0) / ras, by = (q.Y - y0) / ras, cx = (r.X - x0) / ras, cy = (r.Y - y0) / ras;
        foreach (var (x, y, z) in new[] { (ax, ay, p.Z), (bx, by, q.Z), (cx, cy, r.Z) }) hoch((int)x, (int)y, (int)z);
        int minx = (int)Math.Floor(Math.Min(ax, Math.Min(bx, cx))), maxx = (int)Math.Ceiling(Math.Max(ax, Math.Max(bx, cx)));
        int miny = (int)Math.Floor(Math.Min(ay, Math.Min(by, cy))), maxy = (int)Math.Ceiling(Math.Max(ay, Math.Max(by, cy)));
        if (maxx - minx > 400 || maxy - miny > 400) return;
        float d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy); if (Math.Abs(d) < 1e-6f) return;
        for (int gy = miny; gy <= maxy; gy++) for (int gx = minx; gx <= maxx; gx++)
        {
            float px = gx + 0.5f, py = gy + 0.5f, l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / d, l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / d, l3 = 1 - l1 - l2;
            if (l1 < -0.01f || l2 < -0.01f || l3 < -0.01f) continue;
            hoch(gx, gy, (int)(l1 * p.Z + l2 * q.Z + l3 * r.Z));
        }
    }
    // Welt-Transform einer Komponente: über AttachParent nach oben verketten
    CUE4Parse.UE4.Objects.Core.Math.FTransform welt(CUE4Parse.UE4.Assets.Exports.UObject k)
    {
        var t = new CUE4Parse.UE4.Objects.Core.Math.FTransform(k.GetOrDefault("RelativeRotation", new CUE4Parse.UE4.Objects.Core.Math.FRotator(0, 0, 0)),
            k.GetOrDefault("RelativeLocation", new CUE4Parse.UE4.Objects.Core.Math.FVector(0, 0, 0)), k.GetOrDefault("RelativeScale3D", new CUE4Parse.UE4.Objects.Core.Math.FVector(1, 1, 1)));
        var p = k.GetOrDefault<CUE4Parse.UE4.Objects.UObject.FPackageIndex>("AttachParent");
        var po = p == null || p.IsNull ? null : p.Load();
        return po == null || po == k ? t : t * welt(po);
    }
    var zellen = provider.Files.Keys.Where(k => k.Contains("Persistent_Level/_Generated_") && k.EndsWith(".umap")).ToList();
    int fertig = 0, objekte = 0, instanzen = 0; var genutzt = new System.Collections.Concurrent.ConcurrentDictionary<string, int>();
    Parallel.ForEach(zellen, new ParallelOptions { MaxDegreeOfParallelism = Math.Max(1, Environment.ProcessorCount - 1) }, z =>
    {
        try
        {
            foreach (var e in provider.LoadPackage(z).GetExports())
            {
                if (e is not CUE4Parse.UE4.Assets.Exports.Component.StaticMesh.UStaticMeshComponent) continue;
                if (e.ExportType.StartsWith("HLOD")) continue;
                var pi = e.GetOrDefault<CUE4Parse.UE4.Objects.UObject.FPackageIndex>("StaticMesh");
                var name = pi?.Name ?? ""; if (!FELS.IsMatch(name) || OHNE.IsMatch(name)) continue;
                var m = ladeMesh(pi); if (m == null) continue;
                var (v, idx) = m.Value; var basis = welt(e);
                var inst = (e as CUE4Parse.UE4.Assets.Exports.Component.StaticMesh.UInstancedStaticMeshComponent)?.PerInstanceSMData;
                var trafos = inst is { Length: > 0 } ? inst.Select(i => i.TransformData * basis).ToArray() : new[] { basis };
                foreach (var t in trafos)
                {
                    for (int k = 0; k + 2 < idx.Length; k += 3)
                    {
                        CUE4Parse.UE4.Objects.Core.Math.FVector P(uint n) => t.TransformPosition(new CUE4Parse.UE4.Objects.Core.Math.FVector(v[n * 3], v[n * 3 + 1], v[n * 3 + 2]));
                        dreieck(P(idx[k]), P(idx[k + 1]), P(idx[k + 2]));
                    }
                }
                Interlocked.Increment(ref objekte); Interlocked.Add(ref instanzen, trafos.Length); genutzt.AddOrUpdate(name, trafos.Length, (_, n) => n + trafos.Length);
            }
        }
        catch (Exception ex) { Console.WriteLine($"WARNUNG {Path.GetFileName(z)}: {ex.Message}"); }
        finally { var f = Interlocked.Increment(ref fertig); if (f % 500 == 0) Console.WriteLine($"FORTSCHRITT {f} {zellen.Count} ({objekte} Fels-Komponenten, {instanzen} Platzierungen, {meshCache.Count} Modelle)"); }
    });
    int hoeher = 0; var aus = new short[bw * bh];
    for (int i = 0; i < aus.Length; i++)
    {
        int l = land[i] == short.MinValue ? int.MinValue : land[i] * 10, f = fels[i];
        int m = Math.Max(l, f); if (f > l && f != int.MinValue) hoeher++;
        aus[i] = m == int.MinValue ? short.MinValue : (short)Math.Clamp((int)Math.Round(m / 10.0), -32767, 32767);
    }
    var ziel = a.GetValueOrDefault("ziel", stamm + "_fels"); var bytes = new byte[aus.Length * 2]; Buffer.BlockCopy(aus, 0, bytes, 0, bytes.Length);
    File.WriteAllBytes(ziel + ".bin", bytes); File.WriteAllText(ziel + ".json", Regex.Replace(kopf, "\\}\\s*$", $",\"felsen\":{{\"komponenten\":{objekte},\"platzierungen\":{instanzen},\"modelle\":{meshCache.Count(kv => kv.Value != null)},\"felderHoeher\":{hoeher}}}}}"));
    Console.WriteLine($"FERTIG {objekte} Fels-Komponenten, {instanzen} Platzierungen, {meshCache.Count(kv => kv.Value != null)} Modelle; {hoeher} von {aus.Length} Feldern durch Felsen höher");
    foreach (var (n, c) in genutzt.OrderByDescending(kv => kv.Value).Take(25)) Console.WriteLine($"{c,7}  {n}");
    return;
}
if (a.ContainsKey("felsen-modelle"))
{
    // Fels-Modelle für die Welt-Ansicht (Stufe 2, 21.10.2026): je Modell zwei Detailstufen (nah: erste LOD mit ≤ 6000 Dreiecken,
    // fern: letzte LOD) im Format der App-Modelle (Int16-Positionen relativ zu min/max, Int8-Normalen, Indizes) + alle Platzierungen
    // (Matrix 3×3 + Verschiebung, Modellnummer). Instanzen: Instanz·Komponente (gemessen, siehe --fels-pruefen).
    var FELS = new Regex(a.GetValueOrDefault("muster-fels", "Cliff|Rock|Boulder|Mountain|Stone|Formation|Mesa|Canyon|Arch|Pillar|Plateau|Crag|Spire|Overhang"), RegexOptions.IgnoreCase);
    var OHNE = new Regex("Rubble|Pebble|Gravel|Ivy|Moss|Plant|Tree|Bush|Grass|Fern|Flower|Root|Decal|Shell|Coral", RegexOptions.IgnoreCase);
    var ordner = a["felsen-modelle"]; Directory.CreateDirectory(ordner);
    CUE4Parse.UE4.Objects.Core.Math.FTransform eigen(CUE4Parse.UE4.Assets.Exports.UObject k) => new(k.GetOrDefault("RelativeRotation", new CUE4Parse.UE4.Objects.Core.Math.FRotator(0, 0, 0)),
        k.GetOrDefault("RelativeLocation", new CUE4Parse.UE4.Objects.Core.Math.FVector(0, 0, 0)), k.GetOrDefault("RelativeScale3D", new CUE4Parse.UE4.Objects.Core.Math.FVector(1, 1, 1)));
    CUE4Parse.UE4.Objects.Core.Math.FTransform welt(CUE4Parse.UE4.Assets.Exports.UObject k)
    { var p = k.GetOrDefault<CUE4Parse.UE4.Objects.UObject.FPackageIndex>("AttachParent"); var po = p == null || p.IsNull ? null : p.Load(); return po == null || po == k ? eigen(k) : eigen(k) * welt(po); }
    var modelle = new System.Collections.Concurrent.ConcurrentDictionary<string, int>(); var modellListe = new System.Collections.Concurrent.ConcurrentDictionary<int, CUE4Parse.UE4.Objects.UObject.FPackageIndex>();
    var platz = new System.Collections.Concurrent.ConcurrentBag<float[]>();
    var zellen = provider.Files.Keys.Where(k => k.Contains("Persistent_Level/_Generated_") && k.EndsWith(".umap")).ToList();
    int naechste = 0;
    Parallel.ForEach(zellen, new ParallelOptions { MaxDegreeOfParallelism = Math.Max(1, Environment.ProcessorCount - 1) }, z =>
    {
        try
        {
            foreach (var e in provider.LoadPackage(z).GetExports())
            {
                if (e is not CUE4Parse.UE4.Assets.Exports.Component.StaticMesh.UStaticMeshComponent || e.ExportType.StartsWith("HLOD")) continue;
                var pi = e.GetOrDefault<CUE4Parse.UE4.Objects.UObject.FPackageIndex>("StaticMesh"); var name = pi?.Name ?? "";
                if (!FELS.IsMatch(name) || OHNE.IsMatch(name)) continue;
                var pfad = pi!.ResolvedObject?.GetPathName() ?? name;
                var idx = modelle.GetOrAdd(pfad, _ => { var n = Interlocked.Increment(ref naechste) - 1; modellListe[n] = pi; return n; });
                var basis = welt(e);
                var inst = (e as CUE4Parse.UE4.Assets.Exports.Component.StaticMesh.UInstancedStaticMeshComponent)?.PerInstanceSMData;
                foreach (var t in inst is { Length: > 0 } ? inst.Select(i => i.TransformData * basis) : new[] { basis })
                {
                    // Spalten der Matrix = gedrehte und skalierte Achsen
                    var o = t.TransformPosition(new CUE4Parse.UE4.Objects.Core.Math.FVector(0, 0, 0));
                    var ax = t.TransformPosition(new CUE4Parse.UE4.Objects.Core.Math.FVector(1, 0, 0)) - o; var ay = t.TransformPosition(new CUE4Parse.UE4.Objects.Core.Math.FVector(0, 1, 0)) - o; var az = t.TransformPosition(new CUE4Parse.UE4.Objects.Core.Math.FVector(0, 0, 1)) - o;
                    platz.Add(new[] { ax.X, ax.Y, ax.Z, ay.X, ay.Y, ay.Z, az.X, az.Y, az.Z, o.X, o.Y, o.Z, idx });
                }
            }
        }
        catch (Exception ex) { Console.WriteLine($"WARNUNG {Path.GetFileName(z)}: {ex.Message}"); }
    });
    // Modelle schreiben
    using var mb = new MemoryStream(); var bw = new BinaryWriter(mb); var meshes = new List<string>(); var liste = new List<string>(); int dreieckeNah = 0;
    void pad4() { while (mb.Length % 4 != 0) bw.Write((byte)0); }
    string schreibe(string key, CUE4Parse.UE4.Assets.Exports.StaticMesh.FStaticMeshLODResources lod)
    {
        var vs = lod.PositionVertexBuffer!.Verts; var ix = lod.IndexBuffer!.Buffer!;
        float mnx = vs.Min(v => v.X), mny = vs.Min(v => v.Y), mnz = vs.Min(v => v.Z), mxx = vs.Max(v => v.X), mxy = vs.Max(v => v.Y), mxz = vs.Max(v => v.Z);
        var nr = new float[vs.Length * 3];
        for (int i = 0; i + 2 < ix.Length; i += 3)
        {
            var A = vs[ix[i]]; var B = vs[ix[i + 1]]; var C = vs[ix[i + 2]];
            float ux = B.X - A.X, uy = B.Y - A.Y, uz = B.Z - A.Z, wx = C.X - A.X, wy = C.Y - A.Y, wz = C.Z - A.Z;
            float nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
            foreach (var k in new[] { ix[i], ix[i + 1], ix[i + 2] }) { nr[k * 3] += nx; nr[k * 3 + 1] += ny; nr[k * 3 + 2] += nz; }
        }
        long o = mb.Length;
        short q(float v, float mn, float mx) => (short)Math.Round(mx - mn < 1e-3 ? 0 : (v - mn) / (mx - mn) * 65534 - 32767);
        foreach (var v in vs) { bw.Write(q(v.X, mnx, mxx)); bw.Write(q(v.Y, mny, mxy)); bw.Write(q(v.Z, mnz, mxz)); }
        pad4();
        for (int i = 0; i < vs.Length; i++) { float l = MathF.Sqrt(nr[i * 3] * nr[i * 3] + nr[i * 3 + 1] * nr[i * 3 + 1] + nr[i * 3 + 2] * nr[i * 3 + 2]) + 1e-9f; bw.Write((sbyte)Math.Round(nr[i * 3] / l * 127)); bw.Write((sbyte)Math.Round(nr[i * 3 + 1] / l * 127)); bw.Write((sbyte)Math.Round(nr[i * 3 + 2] / l * 127)); bw.Write((sbyte)0); }
        bool u32 = vs.Length > 65535; foreach (var i in ix) { if (u32) bw.Write(i); else bw.Write((ushort)i); } pad4();
        var ci = System.Globalization.CultureInfo.InvariantCulture;
        meshes.Add($"\"{key}\":{{\"o\":{o},\"nv\":{vs.Length},\"ni\":{ix.Length},\"gi\":{ix.Length},\"u32\":{(u32 ? 1 : 0)},\"min\":[{mnx.ToString(ci)},{mny.ToString(ci)},{mnz.ToString(ci)}],\"max\":[{mxx.ToString(ci)},{mxy.ToString(ci)},{mxz.ToString(ci)}]}}");
        return key;
    }
    for (int n = 0; n < naechste; n++)
    {
        string nah = "", fern = ""; float radius = 0; var name = modellListe[n].Name;
        try
        {
            var sm = modellListe[n].Load<CUE4Parse.UE4.Assets.Exports.StaticMesh.UStaticMesh>(); var lods = sm?.RenderData?.LODs?.Where(l => !l.SkipLod).ToList();
            if (lods is { Count: > 0 })
            {
                var ln = lods.FirstOrDefault(l => l.IndexBuffer!.Buffer!.Length / 3 <= 6000) ?? lods.Last(); var lf = lods.Last();
                nah = schreibe(name + "#nah", ln); fern = lf == ln ? nah : schreibe(name + "#fern", lf); dreieckeNah += ln.IndexBuffer!.Buffer!.Length / 3;
                var vs = lf.PositionVertexBuffer!.Verts; radius = vs.Max(v => MathF.Sqrt(v.X * v.X + v.Y * v.Y + v.Z * v.Z));
            }
        }
        catch (Exception ex) { Console.WriteLine($"WARNUNG Modell {name}: {ex.Message}"); }
        liste.Add($"{{\"name\":\"{name}\",\"nah\":\"{nah}\",\"fern\":\"{fern}\",\"radius\":{radius.ToString(System.Globalization.CultureInfo.InvariantCulture)}}}");
    }
    File.WriteAllBytes(Path.Combine(ordner, "meshes.bin"), mb.ToArray());
    var alle = platz.ToArray(); var pb = new byte[alle.Length * 13 * 4]; for (int i = 0; i < alle.Length; i++) Buffer.BlockCopy(alle[i], 0, pb, i * 52, 52);
    File.WriteAllBytes(Path.Combine(ordner, "platzierungen.bin"), pb);
    File.WriteAllText(Path.Combine(ordner, "index.json"), $"{{\"version\":1,\"platzierungen\":{alle.Length},\"meshes\":{{{string.Join(",", meshes)}}},\"modelle\":[{string.Join(",", liste)}]}}");
    Console.WriteLine($"FERTIG {naechste} Modelle ({dreieckeNah} Dreiecke nah), {alle.Length} Platzierungen, Modelldaten {mb.Length / 1e6:F1} MB, Platzierungen {pb.Length / 1e6:F1} MB");
    return;
}
if (a.ContainsKey("fels-pruefen"))
{
    // Welche Zusammensetzung stimmt? Fels-Fuß (tiefster Punkt) soll nahe der Landschaft liegen.
    var stamm = a["fels-pruefen"]; var kopf = File.ReadAllText(stamm + ".json");
    float zahl(string k) => float.Parse(Regex.Match(kopf, "\"" + k + "\":(-?[0-9.]+)").Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture);
    float x0 = zahl("x0"), y0 = zahl("y0"), ras = zahl("raster"); int bw = (int)zahl("breite"), bh = (int)zahl("hoehe");
    var lr = File.ReadAllBytes(stamm + ".bin"); var land = new short[bw * bh]; Buffer.BlockCopy(lr, 0, land, 0, lr.Length);
    float? landZ(float x, float y) { int gx = (int)((x - x0) / ras), gy = (int)((y - y0) / ras); if (gx < 0 || gy < 0 || gx >= bw || gy >= bh || land[gy * bw + gx] == short.MinValue) return null; return land[gy * bw + gx] * 10f; }
    var FELS = new Regex("Cliff|Rock|Boulder|Stone|Formation", RegexOptions.IgnoreCase);
    CUE4Parse.UE4.Objects.Core.Math.FTransform eigen(CUE4Parse.UE4.Assets.Exports.UObject k) => new(k.GetOrDefault("RelativeRotation", new CUE4Parse.UE4.Objects.Core.Math.FRotator(0, 0, 0)),
        k.GetOrDefault("RelativeLocation", new CUE4Parse.UE4.Objects.Core.Math.FVector(0, 0, 0)), k.GetOrDefault("RelativeScale3D", new CUE4Parse.UE4.Objects.Core.Math.FVector(1, 1, 1)));
    CUE4Parse.UE4.Objects.Core.Math.FTransform welt(CUE4Parse.UE4.Assets.Exports.UObject k, bool kindZuerst)
    {
        var p = k.GetOrDefault<CUE4Parse.UE4.Objects.UObject.FPackageIndex>("AttachParent"); var po = p == null || p.IsNull ? null : p.Load();
        if (po == null || po == k) return eigen(k);
        return kindZuerst ? eigen(k) * welt(po, true) : welt(po, false) * eigen(k);
    }
    var zellen = provider.Files.Keys.Where(k => k.Contains("Persistent_Level/_Generated_") && k.EndsWith(".umap")).OrderBy(k => k).ToList();
    var erg = new Dictionary<string, List<float>>();
    void merk(string k, float v) { if (!erg.ContainsKey(k)) erg[k] = new(); erg[k].Add(v); }
    int n = 0;
    foreach (var z in zellen.Where((_, i) => i % 40 == 0))
    {
        foreach (var e in provider.LoadPackage(z).GetExports())
        {
            if (e is not CUE4Parse.UE4.Assets.Exports.Component.StaticMesh.UStaticMeshComponent || e.ExportType.StartsWith("HLOD")) continue;
            var pi = e.GetOrDefault<CUE4Parse.UE4.Objects.UObject.FPackageIndex>("StaticMesh"); if (pi == null || !FELS.IsMatch(pi.Name)) continue;
            var sm = pi.Load<CUE4Parse.UE4.Assets.Exports.StaticMesh.UStaticMesh>(); var lod = sm?.RenderData?.LODs?.LastOrDefault(l => !l.SkipLod); if (lod == null) continue;
            var vs = lod.PositionVertexBuffer!.Verts;
            var inst = (e as CUE4Parse.UE4.Assets.Exports.Component.StaticMesh.UInstancedStaticMeshComponent)?.PerInstanceSMData;
            var art = e.ExportType + (inst is { Length: > 0 } ? "[Inst]" : "") + (e.GetOrDefault<CUE4Parse.UE4.Objects.UObject.FPackageIndex>("AttachParent") is { IsNull: false } ? "[Eltern]" : "");
            foreach (var (name, basis) in new[] { ("KindZuerst", welt(e, true)), ("ElternZuerst", welt(e, false)) })
            {
                var trafos = inst is { Length: > 0 } ? inst.Take(20).SelectMany(i => new[] { ("I*B", i.TransformData * basis), ("B*I", basis * i.TransformData) }).ToArray() : new[] { ("-", basis) };
                foreach (var (ord, t) in trafos)
                {
                    float minz = float.MaxValue, sx = 0, sy = 0; foreach (var v in vs) { var w = t.TransformPosition(v); if (w.Z < minz) minz = w.Z; sx += w.X; sy += w.Y; }
                    var lz = landZ(sx / vs.Length, sy / vs.Length); if (lz == null) continue;
                    merk($"{art} {name} {ord}", (minz - lz.Value) / 100f);
                }
            }
            if (++n > 400) break;
        }
        if (n > 400) break;
    }
    foreach (var (k, l) in erg.OrderBy(kv => kv.Key)) { l.Sort(); Console.WriteLine($"{k,-70} n={l.Count,4}  Fuß−Landschaft m: Median {l[l.Count / 2],8:F1}  10% {l[l.Count / 10],8:F1}  90% {l[l.Count * 9 / 10],8:F1}"); }
    return;
}
if (a.ContainsKey("felsen-probe"))
{
    // Welche Mesh-Komponenten (Felsen/Klippen) stehen in den Zellen? Stichprobe: Typen, Mesh-Namen, Instanzzahlen
    var zellen = provider.Files.Keys.Where(k => k.Contains("Persistent_Level/_Generated_") && k.EndsWith(".umap")).OrderBy(k => k).ToList();
    var typen = new Dictionary<string, int>(); var meshes = new Dictionary<string, int>();
    foreach (var z in zellen.Where((_, i) => i % Math.Max(1, zellen.Count / int.Parse(a["felsen-probe"])) == 0))
    {
        try
        {
            foreach (var e in provider.LoadPackage(z).GetExports())
            {
                if (!e.ExportType.Contains("StaticMesh") && !e.ExportType.Contains("Foliage")) continue;
                typen[e.ExportType] = typen.GetValueOrDefault(e.ExportType) + 1;
                var sm = e.GetOrDefault<CUE4Parse.UE4.Objects.UObject.FPackageIndex>("StaticMesh");
                var name = sm?.Name ?? "-";
                int n = 1;
                if (e.ExportType.Contains("Instanced")) { var inst = e.Properties.FirstOrDefault(p => p.Name.Text == "PerInstanceSMData"); n = inst?.Tag?.GetValue(typeof(object)) is System.Collections.ICollection c ? c.Count : -1; }
                meshes[name] = meshes.GetValueOrDefault(name) + Math.Max(1, n);
            }
        }
        catch (Exception ex) { Console.WriteLine($"Fehler {Path.GetFileName(z)}: {ex.Message}"); }
    }
    foreach (var (t, n) in typen.OrderByDescending(kv => kv.Value)) Console.WriteLine($"{n,7}  {t}");
    Console.WriteLine("Meshes (Stichprobe):");
    foreach (var (m, n) in meshes.OrderByDescending(kv => kv.Value).Take(60)) Console.WriteLine($"{n,7}  {m}");
    return;
}
if (a.ContainsKey("zelle"))
{
    // Eine Zelle genau ansehen: Landschaftskomponenten, Lage, Maßstab, Höhen
    var pkg = provider.LoadPackage(a["zelle"]);
    foreach (var e in pkg.GetExports())
    {
        if (e.ExportType is "LandscapeStreamingProxy" or "SceneComponent")
        {
            Console.WriteLine($"{e.ExportType} {e.Name}: " + string.Join(" | ", e.Properties.Where(p => Regex.IsMatch(p.Name.Text, "Location|Scale|Rotation|Offset|Root|Guid|ComponentSize|Subsection")).Select(p => $"{p.Name.Text}={p.Tag?.GenericValue}")));
        }
        if (e is CUE4Parse.UE4.Assets.Exports.Component.Landscape.ULandscapeComponent lc)
        {
            var rel = lc.GetOrDefault<CUE4Parse.UE4.Objects.Core.Math.FVector>("RelativeLocation");
            var sc = lc.GetOrDefault("RelativeScale3D", new CUE4Parse.UE4.Objects.Core.Math.FVector(1, 1, 1));
            var hm = lc.GetHeightmap();
            var mip = hm?.GetFirstMip();
            var d = mip?.BulkData?.Data;
            string hoehen = "";
            if (d != null && mip != null)
            {
                int w = mip.SizeX, h = mip.SizeY; ushort mn = ushort.MaxValue, mx = 0;
                for (int i = 0; i + 3 < d.Length; i += 4) { var v = (ushort)((d[i + 2] << 8) | d[i + 1]); if (v < mn) mn = v; if (v > mx) mx = v; } // BGRA: R = hoch, G = tief
                hoehen = $"Tex {w}x{h} {hm!.Format} roh {mn}..{mx} → m {(mn - 32768) / 128.0 * sc.Z / 100:F1}..{(mx - 32768) / 128.0 * sc.Z / 100:F1} (+Z {rel.Z / 100:F1})";
            }
            Console.WriteLine($"LandscapeComponent {lc.Name}: Base {lc.SectionBaseX},{lc.SectionBaseY} Quads {lc.ComponentSizeQuads} Sub {lc.SubsectionSizeQuads}x{lc.NumSubsections} Rel {rel} Scale {sc} Bias {lc.HeightmapScaleBias} {hoehen}");
        }
    }
    return;
}
if (a.ContainsKey("zellen"))
{
    // Exporttypen in den Streaming-Zellen zählen (Stichprobe)
    var zellen = provider.Files.Keys.Where(k => k.Contains("Persistent_Level/_Generated_") && k.EndsWith(".umap")).OrderBy(k => k).ToList();
    var typen = new Dictionary<string, int>(); var mitLand = new List<string>();
    foreach (var z in zellen.Where((_, i) => i % Math.Max(1, zellen.Count / int.Parse(a["zellen"])) == 0))
    {
        try
        {
            var pkg = provider.LoadPackage(z);
            var ex = pkg.GetExports().ToList();
            foreach (var e in ex) { var t = e.ExportType; typen[t] = typen.GetValueOrDefault(t) + 1; }
            if (ex.Any(e => e.ExportType.Contains("Landscape"))) mitLand.Add(z);
        }
        catch (Exception e) { Console.WriteLine($"Fehler {Path.GetFileName(z)}: {e.Message}"); }
    }
    foreach (var (t, n) in typen.Where(kv => Regex.IsMatch(kv.Key, "Landscape|Texture|Heightfield|World|Level", RegexOptions.IgnoreCase)).OrderByDescending(kv => kv.Value)) Console.WriteLine($"{n,7}  {t}");
    Console.WriteLine($"Zellen mit Landschaft: {mitLand.Count}, z. B. {string.Join(", ", mitLand.Take(3))}");
    return;
}
foreach (var g in treffer.GroupBy(k => Regex.Replace(Path.GetDirectoryName(k)!.Replace('\\', '/'), "/[0-9A-Z]{1,3}(/|$)", "/*$1")).OrderByDescending(g => g.Count()).Take(40))
    Console.WriteLine($"{g.Count(),7}  {g.Key}   z. B. {Path.GetFileName(g.First())}");
