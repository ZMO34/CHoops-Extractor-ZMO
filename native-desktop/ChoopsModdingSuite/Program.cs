using System;
using System.Collections.Generic;
using System.Data;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace ChoopsModdingSuite;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new MainForm());
    }
}

internal sealed class MainForm : Form
{
    private readonly RichTextBox _log = new() { Dock = DockStyle.Fill, ReadOnly = true, Font = new Font("Consolas", 9f), BackColor = Color.FromArgb(13, 17, 23), ForeColor = Color.FromArgb(230, 237, 243) };
    private readonly string _cliPath;
    private DataTable? _csvTable;
    private DataGridView? _csvGrid;
    private TextBox? _csvPath;

    private static readonly string[] GameProfiles =
    {
        "choops2k8", "nba2k8", "apf2k8", "nhl2k8", "mlb2k8", "nba2k9", "default"
    };

    public MainForm()
    {
        _cliPath = FindCliPath();
        Text = "CHoops Native Modding Suite";
        Width = 1440;
        Height = 940;
        MinimumSize = new Size(1180, 720);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(13, 17, 23);
        ForeColor = Color.FromArgb(230, 237, 243);

        var split = new SplitContainer
        {
            Dock = DockStyle.Fill,
            Orientation = Orientation.Vertical,
            SplitterDistance = 850,
            BackColor = Color.FromArgb(13, 17, 23)
        };

        split.Panel1.Controls.Add(CreateTabs());
        split.Panel2.Controls.Add(CreateLogPanel());
        Controls.Add(split);

        AppendLog("CHoops Native Modding Suite ready.");
        AppendLog($"CLI backend: {_cliPath}");
        AppendLog("This native UI does not host a browser/webview. It runs local desktop controls and spawns the CLI backend.");
    }

    private Control CreateLogPanel()
    {
        var panel = new Panel { Dock = DockStyle.Fill, Padding = new Padding(8), BackColor = Color.FromArgb(13, 17, 23) };
        var clear = new Button { Text = "Clear Log", Dock = DockStyle.Top, Height = 34 };
        clear.Click += (_, _) => _log.Clear();
        panel.Controls.Add(_log);
        panel.Controls.Add(clear);
        return panel;
    }

    private Control CreateTabs()
    {
        var tabs = new TabControl { Dock = DockStyle.Fill };
        tabs.TabPages.Add(CreateCommandTab("Safe Build", SafeBuildSpecs()));
        tabs.TabPages.Add(CreateCommandTab("Rip / Cache", RipSpecs()));
        tabs.TabPages.Add(CreateRosterTab());
        tabs.TabPages.Add(CreateCommandTab("Research Tools", ResearchSpecs()));
        tabs.TabPages.Add(CreateAboutTab());
        return tabs;
    }

    private TabPage CreateCommandTab(string title, IEnumerable<CommandSpec> specs)
    {
        var page = new TabPage(title) { BackColor = Color.FromArgb(13, 17, 23), ForeColor = Color.FromArgb(230, 237, 243) };
        var flow = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            AutoScroll = true,
            FlowDirection = FlowDirection.TopDown,
            WrapContents = false,
            Padding = new Padding(10),
            BackColor = Color.FromArgb(13, 17, 23)
        };

        foreach (var spec in specs)
        {
            flow.Controls.Add(CreateCommandCard(spec));
        }

        page.Controls.Add(flow);
        return page;
    }

    private Control CreateCommandCard(CommandSpec spec)
    {
        var card = new GroupBox
        {
            Text = spec.Title,
            Width = 790,
            AutoSize = true,
            ForeColor = Color.FromArgb(230, 237, 243),
            BackColor = Color.FromArgb(22, 27, 34),
            Padding = new Padding(12),
            Margin = new Padding(4, 4, 4, 14)
        };

        var layout = new TableLayoutPanel
        {
            Dock = DockStyle.Top,
            AutoSize = true,
            ColumnCount = 3,
            RowCount = spec.Fields.Count + spec.Switches.Count + 3,
            Padding = new Padding(6)
        };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 170));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 92));

        int row = 0;
        var description = new Label
        {
            Text = spec.Description,
            AutoSize = true,
            MaximumSize = new Size(720, 0),
            ForeColor = Color.FromArgb(139, 148, 158)
        };
        layout.Controls.Add(description, 0, row);
        layout.SetColumnSpan(description, 3);
        row++;

        var textInputs = new Dictionary<string, TextBox>();
        var comboInputs = new Dictionary<string, ComboBox>();
        var boolInputs = new Dictionary<string, CheckBox>();

        foreach (var field in spec.Fields)
        {
            var label = new Label { Text = field.Label, TextAlign = ContentAlignment.MiddleLeft, Dock = DockStyle.Fill };
            layout.Controls.Add(label, 0, row);

            if (field.Kind == FieldKind.GameProfile)
            {
                var combo = new ComboBox { Dock = DockStyle.Fill, DropDownStyle = ComboBoxStyle.DropDownList };
                combo.Items.AddRange(GameProfiles.Cast<object>().ToArray());
                combo.SelectedItem = field.DefaultValue ?? "choops2k8";
                comboInputs[field.Name] = combo;
                layout.Controls.Add(combo, 1, row);
                layout.Controls.Add(new Label(), 2, row);
            }
            else if (field.Kind == FieldKind.Select)
            {
                var combo = new ComboBox { Dock = DockStyle.Fill, DropDownStyle = ComboBoxStyle.DropDownList };
                combo.Items.AddRange(field.Options.Cast<object>().ToArray());
                combo.SelectedItem = field.DefaultValue ?? field.Options.FirstOrDefault() ?? "";
                comboInputs[field.Name] = combo;
                layout.Controls.Add(combo, 1, row);
                layout.Controls.Add(new Label(), 2, row);
            }
            else
            {
                var box = new TextBox { Dock = DockStyle.Fill, Text = field.DefaultValue ?? "" };
                textInputs[field.Name] = box;
                layout.Controls.Add(box, 1, row);

                if (field.Kind == FieldKind.File || field.Kind == FieldKind.Folder || field.Kind == FieldKind.SaveFile)
                {
                    var browse = new Button { Text = field.Kind == FieldKind.SaveFile ? "Save..." : "Browse...", Dock = DockStyle.Fill };
                    browse.Click += (_, _) => BrowseInto(box, field.Kind);
                    layout.Controls.Add(browse, 2, row);
                }
                else
                {
                    layout.Controls.Add(new Label(), 2, row);
                }
            }

            row++;
        }

        foreach (var sw in spec.Switches)
        {
            var check = new CheckBox { Text = sw.Label, Checked = sw.DefaultValue, AutoSize = true, ForeColor = Color.FromArgb(230, 237, 243) };
            boolInputs[sw.Name] = check;
            layout.Controls.Add(new Label(), 0, row);
            layout.Controls.Add(check, 1, row);
            layout.Controls.Add(new Label(), 2, row);
            row++;
        }

        var run = new Button { Text = spec.IsDangerous ? "Run Advanced Action" : "Run", Height = 38, Dock = DockStyle.Fill };
        if (spec.IsDangerous)
        {
            run.BackColor = Color.FromArgb(218, 54, 51);
            run.ForeColor = Color.White;
        }
        run.Click += async (_, _) =>
        {
            var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var item in textInputs) values[item.Key] = item.Value.Text.Trim();
            foreach (var item in comboInputs) values[item.Key] = Convert.ToString(item.Value.SelectedItem) ?? "";
            var switches = boolInputs.ToDictionary(kv => kv.Key, kv => kv.Value.Checked, StringComparer.OrdinalIgnoreCase);

            try
            {
                var args = spec.BuildArgs(values, switches);
                await RunCliAsync(args);
            }
            catch (Exception ex)
            {
                AppendLog("[ERROR] " + ex.Message);
            }
        };
        layout.Controls.Add(new Label(), 0, row);
        layout.Controls.Add(run, 1, row);
        layout.SetColumnSpan(run, 2);

        card.Controls.Add(layout);
        return card;
    }

    private TabPage CreateRosterTab()
    {
        var page = new TabPage("Roster") { BackColor = Color.FromArgb(13, 17, 23), ForeColor = Color.FromArgb(230, 237, 243) };
        var split = new SplitContainer { Dock = DockStyle.Fill, Orientation = Orientation.Horizontal, SplitterDistance = 330 };

        var topFlow = new FlowLayoutPanel { Dock = DockStyle.Fill, AutoScroll = true, FlowDirection = FlowDirection.LeftToRight, WrapContents = true, Padding = new Padding(10), BackColor = Color.FromArgb(13, 17, 23) };
        foreach (var spec in RosterSpecs()) topFlow.Controls.Add(CreateCommandCard(spec));
        split.Panel1.Controls.Add(topFlow);

        var editor = new Panel { Dock = DockStyle.Fill, Padding = new Padding(10), BackColor = Color.FromArgb(13, 17, 23) };
        var csvBar = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 42, FlowDirection = FlowDirection.LeftToRight };
        _csvPath = new TextBox { Width = 520 };
        var browseCsv = new Button { Text = "Open CSV..." };
        browseCsv.Click += (_, _) => BrowseInto(_csvPath, FieldKind.File);
        var loadCsv = new Button { Text = "Load CSV" };
        loadCsv.Click += (_, _) => LoadCsvEditor();
        var saveCsv = new Button { Text = "Save CSV" };
        saveCsv.Click += (_, _) => SaveCsvEditor();
        csvBar.Controls.Add(new Label { Text = "Roster CSV editor:", AutoSize = true, ForeColor = Color.FromArgb(230, 237, 243), Padding = new Padding(0, 8, 8, 0) });
        csvBar.Controls.Add(_csvPath);
        csvBar.Controls.Add(browseCsv);
        csvBar.Controls.Add(loadCsv);
        csvBar.Controls.Add(saveCsv);

        _csvGrid = new DataGridView
        {
            Dock = DockStyle.Fill,
            AllowUserToAddRows = true,
            AllowUserToDeleteRows = true,
            AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.DisplayedCells,
            BackgroundColor = Color.FromArgb(13, 17, 23),
            ForeColor = Color.Black
        };

        editor.Controls.Add(_csvGrid);
        editor.Controls.Add(csvBar);
        split.Panel2.Controls.Add(editor);
        page.Controls.Add(split);
        return page;
    }

    private TabPage CreateAboutTab()
    {
        var page = new TabPage("About") { BackColor = Color.FromArgb(13, 17, 23) };
        var text = new TextBox
        {
            Dock = DockStyle.Fill,
            Multiline = true,
            ReadOnly = true,
            ScrollBars = ScrollBars.Vertical,
            BackColor = Color.FromArgb(13, 17, 23),
            ForeColor = Color.FromArgb(230, 237, 243),
            Font = new Font("Consolas", 10f),
            Text = "CHoops Native Modding Suite\r\n\r\n" +
                   "This is the browser-free Windows desktop shell. It uses WinForms controls and spawns choops-extractor.exe for every backend job.\r\n\r\n" +
                   "Safe default workflow:\r\n" +
                   "1. Keep your vanilla extracted game folder untouched.\r\n" +
                   "2. Use Safe Build -> Build Copy.\r\n" +
                   "3. The tool copies the vanilla folder to a new output folder.\r\n" +
                   "4. Mods are applied only to the copied folder.\r\n\r\n" +
                   "Direct in-place build/revert are still available as advanced actions for debugging, but they are no longer the recommended normal workflow."
        };
        page.Controls.Add(text);
        return page;
    }

    private static IEnumerable<CommandSpec> SafeBuildSpecs()
    {
        yield return new CommandSpec(
            "build-copy",
            "Build Copy (recommended)",
            "Copies your vanilla extracted game folder to a new output folder, then applies the mod only to that copy. This keeps the vanilla source untouched.",
            new[]
            {
                Field.Game("gameName"),
                Field.Folder("vanillaGame", "Vanilla game folder / PS3_GAME / USRDIR"),
                Field.Folder("modDir", "Mod/rip folder"),
                Field.Folder("outputGame", "Output copied game folder"),
                Field.Text("copyConcurrency", "Copy concurrency", "8")
            },
            new[] { Switch.Option("overwrite", "Overwrite output folder") },
            (v, s) => Args("build-copy", v["vanillaGame"], v["modDir"], v["outputGame"], Opt("--game-name", v["gameName"]), Opt("--copy-concurrency", v["copyConcurrency"]), Flag("--overwrite", s["overwrite"])).ToList());

        yield return new CommandSpec(
            "build",
            "Build In-Place (advanced)",
            "Applies mods directly to the selected game USRDIR. Use only on a disposable copy. Prefer Build Copy.",
            new[] { Field.Game("gameName"), Field.Folder("gameDir", "Game USRDIR folder"), Field.Folder("modDir", "Mod/rip folder") },
            Array.Empty<Switch>(),
            (v, _) => Args("build", v["gameDir"], v["modDir"], Opt("--game-name", v["gameName"])).ToList(),
            isDangerous: true);
    }

    private static IEnumerable<CommandSpec> RipSpecs()
    {
        yield return new CommandSpec("rip", "Dynamic Full Rip", "Rips game/archive content using the selected game profile and dynamic cache support.",
            new[] { Field.Game("gameName"), Field.Folder("gameDir", "Game USRDIR folder"), Field.Folder("outputDir", "Output/rip folder"), Field.Text("fileName", "Optional single file"), Field.Text("index", "Optional archive index") },
            new[] { Switch.Option("buildCache", "Build/update archive cache", true), Switch.Option("showConsole", "Show extractor console"), Switch.Option("iffOnly", "IFF only"), Switch.Option("rawIff", "Raw IFF"), Switch.Option("rawType", "Raw type") },
            (v, s) => Args("rip", v["gameDir"], v["outputDir"], Opt("--game-name", v["gameName"]), Opt("--file", v["fileName"]), Opt("--index", v["index"]), Flag("--build-cache", s["buildCache"]), Flag("--show-console", s["showConsole"]), Flag("--iff-only", s["iffOnly"]), Flag("--raw-iff", s["rawIff"]), Flag("--raw-type", s["rawType"])).ToList());

        yield return new CommandSpec("build-cache", "Build Cache", "Rebuild only the selected game profile's archive cache.",
            new[] { Field.Game("gameName"), Field.Folder("gameDir", "Game USRDIR folder") },
            Array.Empty<Switch>(),
            (v, _) => Args("build-cache", v["gameDir"], Opt("--game-name", v["gameName"])).ToList());
    }

    private static IEnumerable<CommandSpec> RosterSpecs()
    {
        yield return new CommandSpec("roster-decode", "Decode Roster", "Exports players, teams, roster slots, arenas, and coaches to CSV/JSON.",
            new[] { Field.File("inputFile", "Roster / USERDATA / save ZIP"), Field.Folder("outputDir", "Output folder") },
            Array.Empty<Switch>(),
            (v, _) => Args("roster-decode", v["inputFile"], v["outputDir"]).ToList());

        yield return new CommandSpec("roster-compare", "Compare Rosters", "Diffs a base roster against an edited roster after normalizing both sources to ROST payloads.",
            new[] { Field.File("baseRoster", "Base roster"), Field.File("customRoster", "Custom roster"), Field.Folder("outputDir", "Output folder") },
            Array.Empty<Switch>(),
            (v, _) => Args("roster-compare", v["baseRoster"], v["customRoster"], v["outputDir"]).ToList());
    }

    private static IEnumerable<CommandSpec> ResearchSpecs()
    {
        yield return new CommandSpec("profiles", "List Game Profiles", "Print supported dynamic game profiles.", Array.Empty<Field>(), new[] { Switch.Option("json", "JSON output") }, (v, s) => Args("profiles", Flag("--json", s["json"])).ToList());
        yield return new CommandSpec("inspect-iff", "Inspect IFF", "Deep-inspect one IFF and optionally dump subfiles.", new[] { Field.File("inputFile", "IFF file"), Field.Folder("outputDir", "Output folder") }, new[] { Switch.Option("dumpSubfiles", "Dump subfiles") }, (v, s) => Args("inspect-iff", v["inputFile"], v["outputDir"], Flag("--dump-subfiles", s["dumpSubfiles"])).ToList());
        yield return new CommandSpec("smart-scan", "Smart Scan", "Recursive asset/container scan for research folders.", new[] { Field.Folder("inputPath", "Input folder"), Field.Folder("outputDir", "Output folder"), Field.Text("maxDepth", "Max depth", "4") }, new[] { Switch.Option("dumpCandidates", "Dump candidates") }, (v, s) => Args("smart-scan", v["inputPath"], v["outputDir"], Opt("--max-depth", v["maxDepth"]), Flag("--dump-candidates", s["dumpCandidates"])).ToList());
        yield return new CommandSpec("scan-refs", "Scan References", "Extract strings and filename references from files/folders.", new[] { Field.Folder("inputPath", "Input folder"), Field.Folder("outputDir", "Output folder"), Field.Text("minLength", "Minimum length", "4") }, new[] { Switch.Option("onlyMatches", "Only matches") }, (v, s) => Args("scan-refs", v["inputPath"], v["outputDir"], Opt("--min-length", v["minLength"]), Flag("--only-matches", s["onlyMatches"])).ToList());
        yield return new CommandSpec("extract-assets", "Extract Asset Candidates", "Extract model/database/roster/animation candidates from game archives.", new[] { Field.Game("gameName"), Field.Folder("gameDir", "Game USRDIR folder"), Field.Folder("outputDir", "Output folder"), Field.Text("fileName", "Optional file"), Field.Text("index", "Optional index"), Field.Text("category", "Optional category"), Field.Text("maxProbeHits", "Max probe hits") }, new[] { Switch.Option("cache", "Force cache rebuild"), Switch.Option("scanAll", "Scan all"), Switch.Option("dumpTopLevelRaw", "Dump raw containers"), Switch.Option("includeAllUnknown", "Include unknown") }, (v, s) => Args("extract-assets", v["gameDir"], v["outputDir"], Opt("--game-name", v["gameName"]), Opt("--file", v["fileName"]), Opt("--index", v["index"]), Opt("--category", v["category"]), Opt("--max-probe-hits", v["maxProbeHits"]), Flag("--cache", s["cache"]), Flag("--scan-all", s["scanAll"]), Flag("--dump-top-level-raw", s["dumpTopLevelRaw"]), Flag("--include-all-unknown", s["includeAllUnknown"])).ToList());
        yield return new CommandSpec("decompress-cdf", "Decompress CDF Research", "Heuristically split/decompress a standalone CDF.", new[] { Field.File("cdfFile", "CDF file"), Field.Folder("outputDir", "Output folder"), Field.Text("maxHits", "Max hits") }, new[] { Switch.Option("dumpTableChunks", "Dump table chunks") }, (v, s) => Args("decompress-cdf", v["cdfFile"], v["outputDir"], Opt("--max-hits", v["maxHits"]), Flag("--dump-table-chunks", s["dumpTableChunks"])).ToList());
        yield return new CommandSpec("extract-cdf-textures", "Extract CDF Textures", "Extract GTF/DDS from a CDF, optionally paired to one IFF.", new[] { Field.File("cdfFile", "CDF file"), Field.File("iffFile", "Optional paired IFF"), Field.Folder("outputDir", "Output folder") }, new[] { Switch.Option("dds", "Write DDS", true), Switch.Option("verbose", "Verbose") }, (v, s) => Args("extract-cdf-textures", v["cdfFile"], v["outputDir"], Opt("--iff", v["iffFile"]), Flag("--dds", s["dds"]), Flag("--verbose", s["verbose"])).ToList());
        yield return new CommandSpec("export-teamselectlogo-dds", "Export Teamselectlogo DDS", "Dedicated teamselectlogo CDF/IFF DDS export workflow.", new[] { Field.File("cdfFile", "teamselectlogo.cdf"), Field.File("iffFile", "teamselectlogo.iff"), Field.Folder("outputDir", "Output folder") }, new[] { Switch.Option("verbose", "Verbose") }, (v, s) => Args("export-teamselectlogo-dds", v["cdfFile"], v["iffFile"], v["outputDir"], Flag("--verbose", s["verbose"])).ToList());
        yield return new CommandSpec("import-teamselectlogo-dds", "Import Teamselectlogo DDS", "Rebuild a teamselectlogo CDF from edited DDS files and the export manifest.", new[] { Field.File("originalCdf", "Original CDF"), Field.File("manifestFile", "Manifest JSON"), Field.Folder("editedDdsDir", "Edited DDS folder"), Field.SaveFile("outputCdf", "Output CDF path") }, Array.Empty<Switch>(), (v, _) => Args("import-teamselectlogo-dds", v["originalCdf"], v["manifestFile"], v["editedDdsDir"], v["outputCdf"]).ToList());
        yield return new CommandSpec("export-scne-obj", "Export SCNE OBJ", "Export stadium/court/presentation SCNE models.", new[] { Field.File("scneFile", "SCNE file"), Field.Folder("outputDir", "Output folder"), Field.Select("primitiveMode", "Primitive mode", new[] { "strip", "list" }, "strip") }, new[] { Switch.Option("splitParts", "Split parts"), Switch.Option("flipV", "Flip V") }, (v, s) => Args("export-scne-obj", v["scneFile"], v["outputDir"], Opt("--primitive-mode", v["primitiveMode"]), Flag("--split-parts", s["splitParts"]), Flag("--flip-v", s["flipV"])).ToList());
        yield return new CommandSpec("inspect-floor-scne", "Inspect Floor SCNE", "Dump texture, model-part, material, and draw-run tables for floor.scne.", new[] { Field.File("scneFile", "floor.scne"), Field.Folder("outputDir", "Output folder") }, Array.Empty<Switch>(), (v, _) => Args("inspect-floor-scne", v["scneFile"], v["outputDir"]).ToList());
        yield return new CommandSpec("probe", "Compression Probe", "Probe an IFF/CDF for alternate compression layouts and embedded streams.", new[] { Field.File("inputFile", "IFF/CDF file") }, Array.Empty<Switch>(), (v, _) => Args("probe", v["inputFile"]).ToList());
    }

    private async Task RunCliAsync(IReadOnlyList<string> args)
    {
        if (!File.Exists(_cliPath))
        {
            AppendLog($"[ERROR] CLI backend not found: {_cliPath}");
            return;
        }

        AppendLog("> " + _cliPath + " " + string.Join(" ", args.Select(QuoteIfNeeded)));
        var startInfo = new ProcessStartInfo
        {
            FileName = _cliPath,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
            WorkingDirectory = AppContext.BaseDirectory
        };
        foreach (var arg in args) startInfo.ArgumentList.Add(arg);

        using var process = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
        process.OutputDataReceived += (_, e) => { if (e.Data != null) AppendLog(e.Data); };
        process.ErrorDataReceived += (_, e) => { if (e.Data != null) AppendLog(e.Data); };
        process.Start();
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        await process.WaitForExitAsync();
        AppendLog($"[DONE] Exit code {process.ExitCode}");
    }

    private void BrowseInto(TextBox? box, FieldKind kind)
    {
        if (box == null) return;
        if (kind == FieldKind.Folder)
        {
            using var dialog = new FolderBrowserDialog { ShowNewFolderButton = true };
            if (dialog.ShowDialog(this) == DialogResult.OK) box.Text = dialog.SelectedPath;
            return;
        }
        if (kind == FieldKind.SaveFile)
        {
            using var dialog = new SaveFileDialog { Filter = "All files (*.*)|*.*" };
            if (dialog.ShowDialog(this) == DialogResult.OK) box.Text = dialog.FileName;
            return;
        }
        using (var dialog = new OpenFileDialog { Filter = "Roster/save/IFF/CDF/SCNE files (*.zip;*.iff;*.cdf;*.scne;*.bin;*.dat;*.csv)|*.zip;*.iff;*.cdf;*.scne;*.bin;*.dat;*.csv|USERDATA|USERDATA|All files (*.*)|*.*" })
        {
            if (dialog.ShowDialog(this) == DialogResult.OK) box.Text = dialog.FileName;
        }
    }

    private void LoadCsvEditor()
    {
        if (_csvPath == null || _csvGrid == null) return;
        if (!File.Exists(_csvPath.Text))
        {
            AppendLog("[CSV] File not found: " + _csvPath.Text);
            return;
        }

        _csvTable = ReadCsv(_csvPath.Text);
        _csvGrid.DataSource = _csvTable;
        AppendLog($"[CSV] Loaded {_csvTable.Rows.Count} rows from {_csvPath.Text}");
    }

    private void SaveCsvEditor()
    {
        if (_csvPath == null || _csvTable == null)
        {
            AppendLog("[CSV] Load a CSV before saving.");
            return;
        }
        WriteCsv(_csvPath.Text, _csvTable);
        AppendLog("[CSV] Saved " + _csvPath.Text);
    }

    private static DataTable ReadCsv(string path)
    {
        var lines = File.ReadAllLines(path, Encoding.UTF8);
        var table = new DataTable();
        if (lines.Length == 0) return table;

        var headers = ParseCsvLine(lines[0]).ToList();
        foreach (var header in headers) table.Columns.Add(header);
        for (var i = 1; i < lines.Length; i++)
        {
            var values = ParseCsvLine(lines[i]).ToList();
            while (values.Count < headers.Count) values.Add(string.Empty);
            table.Rows.Add(values.Take(headers.Count).Cast<object>().ToArray());
        }
        return table;
    }

    private static void WriteCsv(string path, DataTable table)
    {
        using var writer = new StreamWriter(path, false, Encoding.UTF8);
        writer.WriteLine(string.Join(",", table.Columns.Cast<DataColumn>().Select(c => EscapeCsv(c.ColumnName))));
        foreach (DataRow row in table.Rows)
        {
            if (row.RowState == DataRowState.Deleted) continue;
            writer.WriteLine(string.Join(",", table.Columns.Cast<DataColumn>().Select(c => EscapeCsv(Convert.ToString(row[c]) ?? string.Empty))));
        }
    }

    private static IEnumerable<string> ParseCsvLine(string line)
    {
        var result = new List<string>();
        var current = new StringBuilder();
        var inQuotes = false;
        for (var i = 0; i < line.Length; i++)
        {
            var c = line[i];
            if (c == '"')
            {
                if (inQuotes && i + 1 < line.Length && line[i + 1] == '"')
                {
                    current.Append('"');
                    i++;
                }
                else inQuotes = !inQuotes;
            }
            else if (c == ',' && !inQuotes)
            {
                result.Add(current.ToString());
                current.Clear();
            }
            else current.Append(c);
        }
        result.Add(current.ToString());
        return result;
    }

    private static string EscapeCsv(string value)
    {
        if (value.Contains('"') || value.Contains(',') || value.Contains('\n') || value.Contains('\r'))
            return "\"" + value.Replace("\"", "\"\"") + "\"";
        return value;
    }

    private void AppendLog(string message)
    {
        if (InvokeRequired)
        {
            BeginInvoke(new Action<string>(AppendLog), message);
            return;
        }
        _log.AppendText(message + Environment.NewLine);
        _log.SelectionStart = _log.TextLength;
        _log.ScrollToCaret();
    }

    private static string FindCliPath()
    {
        var env = Environment.GetEnvironmentVariable("CHOOPS_EXTRACTOR_CLI");
        if (!string.IsNullOrWhiteSpace(env) && File.Exists(env)) return env;

        var candidates = new[]
        {
            Path.Combine(AppContext.BaseDirectory, "choops-extractor.exe"),
            Path.Combine(AppContext.BaseDirectory, "dist", "choops-extractor.exe"),
            Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "dist", "choops-extractor.exe")),
            Path.GetFullPath(Path.Combine(Environment.CurrentDirectory, "dist", "choops-extractor.exe"))
        };
        return candidates.FirstOrDefault(File.Exists) ?? candidates[0];
    }

    private static IEnumerable<string> Args(params string?[] parts)
    {
        foreach (var part in parts)
        {
            if (!string.IsNullOrWhiteSpace(part)) yield return part;
        }
    }

    private static string? Opt(string flag, string? value) => string.IsNullOrWhiteSpace(value) ? null : flag + "\0" + value;
    private static string? Flag(string flag, bool enabled) => enabled ? flag : null;

    private static string QuoteIfNeeded(string arg) => arg.Any(char.IsWhiteSpace) ? "\"" + arg.Replace("\"", "\\\"") + "\"" : arg;
}

internal enum FieldKind { Text, File, Folder, SaveFile, GameProfile, Select }

internal sealed record Field(string Name, string Label, FieldKind Kind, string? DefaultValue = null, string[]? Options = null)
{
    public string[] Options { get; init; } = Options ?? Array.Empty<string>();
    public static Field Text(string name, string label, string? defaultValue = null) => new(name, label, FieldKind.Text, defaultValue);
    public static Field File(string name, string label) => new(name, label, FieldKind.File);
    public static Field Folder(string name, string label) => new(name, label, FieldKind.Folder);
    public static Field SaveFile(string name, string label) => new(name, label, FieldKind.SaveFile);
    public static Field Game(string name) => new(name, "Game profile", FieldKind.GameProfile, "choops2k8");
    public static Field Select(string name, string label, string[] options, string? defaultValue = null) => new(name, label, FieldKind.Select, defaultValue, options);
}

internal sealed record Switch(string Name, string Label, bool DefaultValue = false)
{
    public static Switch Option(string name, string label, bool defaultValue = false) => new(name, label, defaultValue);
}

internal sealed record CommandSpec(
    string Name,
    string Title,
    string Description,
    IReadOnlyList<Field> Fields,
    IReadOnlyList<Switch> Switches,
    Func<Dictionary<string, string>, Dictionary<string, bool>, List<string>> BuildArgs,
    bool IsDangerous = false)
{
    public CommandSpec(string name, string title, string description, IEnumerable<Field> fields, IEnumerable<Switch> switches, Func<Dictionary<string, string>, Dictionary<string, bool>, List<string>> buildArgs, bool isDangerous = false)
        : this(name, title, description, fields.ToList(), switches.ToList(), buildArgs, isDangerous) { }
}

internal static class ArgumentNormalizer
{
    public static List<string> ToList(this IEnumerable<string> args)
    {
        var list = new List<string>();
        foreach (var arg in args)
        {
            if (arg.Contains('\0'))
            {
                var pieces = arg.Split('\0');
                if (!string.IsNullOrWhiteSpace(pieces[0])) list.Add(pieces[0]);
                if (pieces.Length > 1 && !string.IsNullOrWhiteSpace(pieces[1])) list.Add(pieces[1]);
            }
            else if (!string.IsNullOrWhiteSpace(arg)) list.Add(arg);
        }
        return list;
    }
}
