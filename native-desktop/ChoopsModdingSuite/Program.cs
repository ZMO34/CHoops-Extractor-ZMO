using System;
using System.Collections.Generic;
using System.Data;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
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
    private const string ProgressPrefix = "__CHOOPS_PROGRESS__";
    private static readonly string[] EditorTabs =
    {
        "Dashboard",
        "School",
        "Spirit",
        "Colors / Floor / Basket / Cheer",
        "Roster Slots",
        "Depth Chart / Rotation",
        "Assets",
        "Conferences",
        "Unknown / Research"
    };

    private readonly string _cliPath;
    private readonly string? _devIndexJs;
    private readonly Dictionary<string, Button> _tabButtons = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, DataTable> _tables = new(StringComparer.OrdinalIgnoreCase);
    private readonly List<QueuedEdit> _queuedEdits = new();

    private readonly TextBox _rosterPath = new() { Dock = DockStyle.Fill };
    private readonly TextBox _assetFolder = new() { Dock = DockStyle.Fill };
    private readonly ComboBox _teamCombo = new() { Dock = DockStyle.Fill, DropDownStyle = ComboBoxStyle.DropDownList };
    private readonly TextBox _savePath = new() { Dock = DockStyle.Fill };
    private readonly Label _status = new() { Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft };
    private readonly Label _queuedText = new() { AutoSize = true };
    private readonly Panel _tabHost = new() { Dock = DockStyle.Fill };
    private readonly Panel _content = new() { Dock = DockStyle.Fill };
    private readonly RichTextBox _log = new() { Dock = DockStyle.Fill, ReadOnly = true, BorderStyle = BorderStyle.None, DetectUrls = false };
    private readonly ProgressBar _progress = new() { Dock = DockStyle.Fill, Minimum = 0, Maximum = 100 };
    private readonly Label _progressText = new() { Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft };
    private readonly Label _footer = new() { Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft };

    private string _decodedFolder = string.Empty;
    private string _activeTab = "Dashboard";

    public MainForm()
    {
        (_cliPath, _devIndexJs) = LocateCli();

        Text = "College Hoops 2K8 Roster Studio";
        Width = 1720;
        Height = 1000;
        MinimumSize = new Size(1320, 760);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Theme.App;
        ForeColor = Theme.Text;
        Font = Theme.Font(9.5f);
        DoubleBuffered = true;

        ApplyInputTheme();
        Controls.Add(BuildShell());
        BuildTabs();
        SetStatus("Ready. Open a roster ZIP, USERDATA, roster_english.iff, or raw ROST payload.", false);
        AppendLog("College Hoops 2K8 Roster Studio ready.");
        AppendLog($"CLI backend: {_cliPath}" + (_devIndexJs == null ? string.Empty : $" {_devIndexJs}"));
        AppendLog("Native WinForms UI only. No Chrome, browser, Electron, or webview is used.");
        ShowTab("Dashboard");
    }

    private Control BuildShell()
    {
        var root = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 4, ColumnCount = 1, BackColor = Theme.App, Padding = new Padding(8) };
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 130));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 116));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 34));
        root.Controls.Add(BuildHeader(), 0, 0);
        root.Controls.Add(BuildEditorStrip(), 0, 1);
        root.Controls.Add(BuildWorkspace(), 0, 2);

        _footer.ForeColor = Theme.Muted;
        _footer.Font = Theme.Font(9f, FontStyle.Bold);
        _footer.Padding = new Padding(18, 0, 18, 0);
        _footer.Text = "Roster File: none   |   Team: none   |   Game: College Hoops 2K8   |   Platform: PS3   |   Version 1.0.0";
        root.Controls.Add(_footer, 0, 3);
        return root;
    }

    private Control BuildHeader()
    {
        var header = new GradientPanel(Theme.HeaderTop, Theme.HeaderBottom) { Dock = DockStyle.Fill, Padding = new Padding(18, 12, 18, 10), BorderColor = Theme.BlueBorder, Radius = 12 };
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 4, RowCount = 3, BackColor = Color.Transparent };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 120));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 47));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 43));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 160));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 36));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 20));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 46));

        var logo = new GlassPanel { Dock = DockStyle.Fill, Margin = new Padding(0, 0, 14, 0), BackColor = Theme.CardDeep, BorderColor = Theme.IceDark, Radius = 14 };
        logo.Controls.Add(new Label { Dock = DockStyle.Fill, Text = "🏀\r\nCH 2K8", TextAlign = ContentAlignment.MiddleCenter, Font = Theme.Font(16, FontStyle.Bold), ForeColor = Theme.Ice, BackColor = Color.Transparent });
        layout.Controls.Add(logo, 0, 0);
        layout.SetRowSpan(logo, 3);

        layout.Controls.Add(new Label { Text = "College Hoops 2K8 Roster Studio", Dock = DockStyle.Fill, Font = Theme.Font(19, FontStyle.Bold), ForeColor = Theme.Text, BackColor = Color.Transparent, TextAlign = ContentAlignment.BottomLeft }, 1, 0);
        layout.Controls.Add(new Label { Text = "Roster file (.zip / USERDATA / roster_english.iff / raw ROST)", Dock = DockStyle.Fill, Font = Theme.Font(9f), ForeColor = Theme.Muted, BackColor = Color.Transparent, TextAlign = ContentAlignment.TopLeft }, 1, 1);
        layout.Controls.Add(new Label { Text = "Optional ripped asset folder for uh\\ua\\ux\\s\\m lookup", Dock = DockStyle.Fill, Font = Theme.Font(9f), ForeColor = Theme.Muted, BackColor = Color.Transparent, TextAlign = ContentAlignment.BottomLeft }, 2, 1);

        layout.Controls.Add(PathPicker(_rosterPath, "Browse", () => BrowseFile(_rosterPath)), 1, 2);
        layout.Controls.Add(PathPicker(_assetFolder, "Browse", () => BrowseFolder(_assetFolder)), 2, 2);

        var open = AccentButton("📂  Open Roster", ButtonRole.Success);
        open.Dock = DockStyle.Fill;
        open.Click += async (_, _) => await OpenRosterAsync();
        layout.Controls.Add(open, 3, 2);

        _status.ForeColor = Theme.GoodBright;
        _status.Font = Theme.Font(9f, FontStyle.Bold);
        layout.Controls.Add(_status, 1, 0);
        layout.SetColumnSpan(_status, 3);
        _status.SendToBack();
        header.Controls.Add(layout);
        return header;
    }

    private Control BuildEditorStrip()
    {
        var outer = new Panel { Dock = DockStyle.Fill, BackColor = Theme.App, Padding = new Padding(12, 10, 12, 0) };
        var strip = new GlassPanel { Dock = DockStyle.Fill, Padding = new Padding(16, 10, 16, 10), BackColor = Theme.Card, BorderColor = Theme.Border, Radius = 14 };
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 3, RowCount = 2, BackColor = Color.Transparent };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 34));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 42));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 24));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 48));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 48));

        _savePath.PlaceholderText = "Example: C:\\CH2K8\\USERDATA_modded";
        layout.Controls.Add(LabeledControl("Team", _teamCombo), 0, 0);
        layout.Controls.Add(LabeledControl("Save output copy path", _savePath), 1, 0);

        var saveStack = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 2, ColumnCount = 1, BackColor = Color.Transparent };
        var save = AccentButton("💾  Save Copy With Queued Edits", ButtonRole.Gold);
        save.Dock = DockStyle.Top;
        save.Height = 40;
        save.Click += (_, _) => MessageBox.Show("Queued edits are tracked visually now. Binary write-back is held behind the next safety pass so the editor does not corrupt roster saves.", "Safe queued edits", MessageBoxButtons.OK, MessageBoxIcon.Information);
        _queuedText.Text = "Queued edits: 0";
        _queuedText.ForeColor = Theme.Muted;
        _queuedText.Font = Theme.Font(9f);
        saveStack.Controls.Add(save, 0, 0);
        saveStack.Controls.Add(_queuedText, 0, 1);
        layout.Controls.Add(saveStack, 2, 0);
        layout.SetRowSpan(saveStack, 2);

        _tabHost.BackColor = Color.Transparent;
        layout.Controls.Add(_tabHost, 0, 1);
        layout.SetColumnSpan(_tabHost, 2);
        strip.Controls.Add(layout);
        outer.Controls.Add(strip);
        return outer;
    }

    private Control BuildWorkspace()
    {
        var shell = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 1, BackColor = Theme.App, Padding = new Padding(12, 0, 12, 12) };
        shell.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        shell.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 360));
        _content.BackColor = Theme.App;
        shell.Controls.Add(_content, 0, 0);
        shell.Controls.Add(BuildLogRail(), 1, 0);
        return shell;
    }

    private Control BuildLogRail()
    {
        var rail = new GlassPanel { Dock = DockStyle.Fill, Padding = new Padding(14), BackColor = Theme.Card, BorderColor = Theme.Border, Radius = 14 };
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 5, BackColor = Color.Transparent };
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 38));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 42));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 18));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 34));

        var head = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, BackColor = Color.Transparent };
        head.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        head.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 86));
        head.Controls.Add(TitleLabel("Job Log", 13), 0, 0);
        var clear = AccentButton("Clear", ButtonRole.Dark);
        clear.Click += (_, _) => _log.Clear();
        head.Controls.Add(clear, 1, 0);

        _progressText.Text = "Ready";
        _progressText.ForeColor = Theme.Text;
        _progressText.Font = Theme.Font(9f, FontStyle.Bold);
        _log.BackColor = Theme.LogBg;
        _log.ForeColor = Theme.LogText;
        _log.Font = Theme.Mono(9f);

        layout.Controls.Add(head, 0, 0);
        layout.Controls.Add(_progressText, 0, 1);
        layout.Controls.Add(_progress, 0, 2);
        layout.Controls.Add(_log, 0, 3);
        layout.Controls.Add(new Label { Text = "Rip/build progress is parsed automatically.", Dock = DockStyle.Fill, ForeColor = Theme.Muted, Font = Theme.Font(8.5f), TextAlign = ContentAlignment.MiddleLeft, BackColor = Color.Transparent }, 0, 4);
        rail.Controls.Add(layout);
        return rail;
    }

    private void BuildTabs()
    {
        _tabButtons.Clear();
        _tabHost.Controls.Clear();
        var flow = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.LeftToRight, WrapContents = false, AutoScroll = true, BackColor = Color.Transparent, Padding = new Padding(0, 6, 0, 0) };
        foreach (var tab in EditorTabs)
        {
            var button = AccentButton(tab, ButtonRole.Tab);
            button.AutoSize = true;
            button.MinimumSize = new Size(92, 36);
            button.Padding = new Padding(14, 0, 14, 0);
            button.Margin = new Padding(0, 0, 8, 0);
            button.Click += (_, _) => ShowTab(tab);
            _tabButtons[tab] = button;
            flow.Controls.Add(button);
        }
        _tabHost.Controls.Add(flow);
    }

    private void ShowTab(string tab)
    {
        _activeTab = tab;
        foreach (var pair in _tabButtons)
        {
            var active = pair.Key.Equals(tab, StringComparison.OrdinalIgnoreCase);
            pair.Value.BackColor = active ? Theme.Purple : Theme.Tab;
            pair.Value.FlatAppearance.BorderColor = active ? Theme.PurpleBorder : Theme.BlueBorder;
        }
        _content.Controls.Clear();
        _content.Controls.Add(tab switch
        {
            "Dashboard" => DashboardView(),
            "School" => SchoolView(),
            "Spirit" => SpiritView(),
            "Colors / Floor / Basket / Cheer" => ColorsView(),
            "Roster Slots" => RosterSlotsView(false),
            "Depth Chart / Rotation" => RosterSlotsView(true),
            "Assets" => AssetsView(),
            "Conferences" => ResearchNotice("Conferences", "Conference affiliation and prestige fields remain disabled until controlled roster diffs prove the offsets."),
            "Unknown / Research" => ResearchView(),
            _ => DashboardView()
        });
    }

    private Control DashboardView()
    {
        var scroll = ScrollHost();
        scroll.Controls.Add(CommandCenter());
        var grid = TwoColumnGrid(57, 43);
        grid.Controls.Add(SchoolView(), 0, 0);
        grid.Controls.Add(AssetsQuickInfo(), 1, 0);
        grid.Controls.Add(ColorsView(), 0, 1);
        grid.Controls.Add(RosterSlotsPreview(), 1, 1);
        scroll.Controls.Add(grid);
        return scroll;
    }

    private Control CommandCenter()
    {
        var card = Card("⚡ Command Center", "Common tools are grouped, readable, and launch through the same CLI backend while staying inside this native editor.");
        var row = new FlowLayoutPanel { Dock = DockStyle.Top, AutoSize = true, WrapContents = true, BackColor = Color.Transparent, Padding = new Padding(0, 10, 0, 0) };
        row.Controls.Add(CommandTile("Safe Build Copy", "Create a copied JB folder, then apply mods to the copy.", "build-copy"));
        row.Controls.Add(CommandTile("Dynamic Full Rip", "Enhanced rip with progress, raw preservation, and cache support.", "rip"));
        row.Controls.Add(CommandTile("Build Cache", "Resolve archive entries for this game profile.", "build-cache"));
        row.Controls.Add(CommandTile("Inspect / Research", "IFF, CDF, SCNE, scan refs, and probe tools live here.", "research"));
        card.Controls.Add(row);
        return card;
    }

    private Control CommandTile(string title, string text, string command)
    {
        var tile = new GlassPanel { Width = 280, Height = 120, Margin = new Padding(0, 0, 12, 12), Padding = new Padding(12), BackColor = Theme.CardDeep, BorderColor = Theme.BlueBorder, Radius = 12 };
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 3, ColumnCount = 1, BackColor = Color.Transparent };
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 28));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 34));
        layout.Controls.Add(TitleLabel(title, 11), 0, 0);
        layout.Controls.Add(MutedLabel(text), 0, 1);
        var run = AccentButton(command == "research" ? "Open Research" : "Run / Configure", ButtonRole.Ice);
        run.Click += (_, _) =>
        {
            if (command == "research") ShowTab("Unknown / Research");
            else AppendLog($"[INFO] {title} is exposed in CLI as `{command}`. Full parameter cards will be expanded in the next workflow pass.");
        };
        layout.Controls.Add(run, 0, 2);
        tile.Controls.Add(layout);
        return tile;
    }

    private Control SchoolView()
    {
        var card = Card("🏛 School", "Edit school identity fields with clear, readable staging controls.");
        var grid = TwoColumnGrid(50, 50, Theme.Card);
        AddEditField(grid, "School Name short", TeamValue("short", "team", "school"), "school.short");
        AddEditField(grid, "School Name full", TeamValue("full", "school"), "school.full");
        AddEditField(grid, "Nickname", TeamValue("nickname", "mascot plural", "mascot_plural"), "school.nickname");
        AddEditField(grid, "Abbreviation", TeamValue("abbr", "abbreviation"), "school.abbr");
        AddWideEditField(grid, "Mascot text", TeamValue("mascot", "mascot name"), "school.mascot");
        card.Controls.Add(grid);
        return card;
    }

    private Control SpiritView()
    {
        var card = Card("📣 Spirit", "Student section, Midnight Madness, and rivalry routing.");
        var grid = TwoColumnGrid(42, 58, Theme.Card);
        var left = new FlowLayoutPanel { Dock = DockStyle.Top, AutoSize = true, FlowDirection = FlowDirection.TopDown, WrapContents = false, BackColor = Color.Transparent };
        AddEditField(left, "Student Section", TeamValue("student", "student section"), "spirit.student", true);
        AddEditField(left, "Mid. Madness", TeamValue("midnight", "madness", "event"), "spirit.midnight", true);
        grid.Controls.Add(left, 0, 0);

        var rivals = new FlowLayoutPanel { Dock = DockStyle.Top, AutoSize = true, FlowDirection = FlowDirection.TopDown, WrapContents = false, BackColor = Color.Transparent };
        rivals.Controls.Add(TitleLabel("Rivals", 13));
        for (var i = 1; i <= 5; i++) rivals.Controls.Add(RivalRow(i));
        grid.Controls.Add(rivals, 1, 0);
        card.Controls.Add(grid);
        return card;
    }

    private Control AssetsView() => AssetsQuickInfo();

    private Control AssetsQuickInfo()
    {
        var card = Card("▣ Assets & Quick Info", "Asset IDs connect roster teams to uh/ua/ux/s/m families and arena routing.");
        var grid = TwoColumnGrid(50, 50, Theme.Card);
        AddEditField(grid, "Asset ID (uh/ua/ux/s/m)", TeamValue("asset", "asset_id"), "assets.asset");
        AddEditField(grid, "Arena", TeamValue("arena"), "assets.arena");
        AddEditField(grid, "Primary Logo", TeamValue("logo", "primary"), "assets.logo");
        AddEditField(grid, "Alt Logo", TeamValue("alt logo", "alt_logo"), "assets.altLogo");
        grid.Controls.Add(UniformSwatch("Home Uniform", Color.White, Color.Firebrick), 0, 2);
        grid.Controls.Add(UniformSwatch("Away Uniform", Color.FromArgb(22, 26, 33), Color.Firebrick), 1, 2);
        grid.Controls.Add(UniformSwatch("Alternate Uniform", Color.Firebrick, Color.White), 0, 3);
        var notes = TextInput($"Default roster for {CurrentTeamName()}. Asset and arena links are shown for quick mod planning.");
        notes.Multiline = true;
        notes.Height = 58;
        grid.Controls.Add(LabeledControl("Notes", notes), 1, 3);
        card.Controls.Add(grid);
        return card;
    }

    private Control ColorsView()
    {
        var card = Card("🎨 Colors / Floor / Basket / Cheer", "Large, high-contrast palette rows with editable RGB, live swatches, and queue buttons.");
        var table = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 5, BackColor = Color.Transparent, Padding = new Padding(0, 10, 0, 0) };
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 96));
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 160));
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 260));
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 132));
        AddTableHeader(table, "Slot", "Current", "Hint", "New RGB", "Action");
        var slots = ExtractTeamColors().Take(18).ToList();
        if (slots.Count == 0) slots = DefaultGeorgiaColors();
        for (var i = 0; i < slots.Count; i++) AddColorRow(table, i, slots[i]);
        card.Controls.Add(InfoLine("Double-click a color preview to open the native color picker. Queue Color stages the slot for safe write-back testing."));
        card.Controls.Add(table);
        return card;
    }

    private Control RosterSlotsView(bool rotation)
    {
        var card = Card(rotation ? "↕ Depth Chart / Rotation" : "👥 Roster Slots", rotation ? "Use roster slots as a rotation planning surface." : "Assign players to the 16 roster slots with readable dropdown cards.");
        var slots = new FlowLayoutPanel { Dock = DockStyle.Fill, AutoScroll = true, WrapContents = true, BackColor = Color.Transparent, Padding = new Padding(0, 10, 0, 0) };
        foreach (var slot in CurrentSlots().Take(16)) slots.Controls.Add(SlotCard(slot, false));
        card.Controls.Add(slots);
        return card;
    }

    private Control RosterSlotsPreview()
    {
        var card = Card("👥 Roster Slots (Preview)", "First eight roster slots for quick review.");
        var grid = TwoColumnGrid(50, 50, Theme.Card);
        var slots = CurrentSlots().Take(8).ToList();
        for (var i = 0; i < slots.Count; i++) grid.Controls.Add(SlotCard(slots[i], true), i % 2, i / 2);
        card.Controls.Add(grid);
        return card;
    }

    private Control ResearchView()
    {
        var scroll = ScrollHost();
        scroll.Controls.Add(ResearchNotice("Unknown / Research", "Raw fields and candidate offsets remain research-only. Confirmed fields graduate into the main editor tabs."));
        scroll.Controls.Add(CommandReference());
        return scroll;
    }

    private Control ResearchNotice(string title, string message)
    {
        var card = Card("🧪 " + title, message);
        card.Controls.Add(InfoLine("Preserve-first rule: view, diff, document, then enable writing only after controlled saves prove the field."));
        return card;
    }

    private Control CommandReference()
    {
        var card = Card("Research command reference", "Quick CLI targets kept visible inside the polished editor.");
        var commands = new[]
        {
            "inspect-iff <iffFile> <output>",
            "smart-scan <input> <output>",
            "scan-refs <input> <output>",
            "extract-cdf-textures <cdfFile> <output> --iff <iffFile> --dds",
            "export-teamselectlogo-dds <cdf> <iff> <output>",
            "export-scne-obj <scneFile> <output>",
            "probe <input> <output>"
        };
        var stack = new FlowLayoutPanel { Dock = DockStyle.Top, AutoSize = true, FlowDirection = FlowDirection.TopDown, WrapContents = false, BackColor = Color.Transparent, Padding = new Padding(0, 8, 0, 0) };
        foreach (var command in commands) stack.Controls.Add(new Label { Text = command, AutoSize = false, Width = 900, Height = 30, ForeColor = Theme.Text, Font = Theme.Mono(9.5f), BackColor = Theme.CardDeep, Padding = new Padding(8, 6, 8, 0), Margin = new Padding(0, 0, 0, 6) });
        card.Controls.Add(stack);
        return card;
    }

    private async Task OpenRosterAsync()
    {
        var source = _rosterPath.Text.Trim();
        if (string.IsNullOrWhiteSpace(source) || !File.Exists(source))
        {
            MessageBox.Show("Choose a roster ZIP, USERDATA, roster_english.iff, or raw ROST payload first.", "Open roster", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }
        var baseName = Path.GetFileNameWithoutExtension(source);
        _decodedFolder = Path.Combine(Path.GetTempPath(), "CHoopsRosterStudio", Sanitize(baseName) + "_" + DateTime.Now.ToString("yyyyMMdd_HHmmss"));
        Directory.CreateDirectory(_decodedFolder);
        SetStatus("Decoding roster source...", false);
        await RunCliAsync(new[] { "roster-decode", source, _decodedFolder });
        LoadDecodedTables(_decodedFolder);
        SetStatus("Roster loaded.", true);
        ShowTab(_activeTab);
    }

    private void LoadDecodedTables(string folder)
    {
        _tables.Clear();
        foreach (var name in new[] { "players", "teams", "roster_slots", "arenas", "coaches" })
        {
            var path = Path.Combine(folder, name + ".csv");
            if (File.Exists(path)) _tables[name] = Csv.Read(path);
        }
        _teamCombo.SelectedIndexChanged -= TeamChanged;
        _teamCombo.Items.Clear();
        foreach (var team in TeamItems()) _teamCombo.Items.Add(team);
        if (_teamCombo.Items.Count > 0)
        {
            var georgia = _teamCombo.Items.Cast<string>().FirstOrDefault(x => x.Contains("Georgia", StringComparison.OrdinalIgnoreCase));
            _teamCombo.SelectedItem = georgia ?? _teamCombo.Items[0];
        }
        _teamCombo.SelectedIndexChanged += TeamChanged;
        UpdateFooter();
        AppendLog($"Loaded decoded roster tables from {folder}");
    }

    private void TeamChanged(object? sender, EventArgs e)
    {
        UpdateFooter();
        ShowTab(_activeTab);
    }

    private IEnumerable<string> TeamItems()
    {
        if (!_tables.TryGetValue("teams", out var teams)) yield break;
        foreach (DataRow row in teams.Rows)
        {
            var id = FirstCell(row, "index", "team_index", "row", "id");
            var name = FirstCell(row, "school", "school_name", "short", "team", "name");
            if (string.IsNullOrWhiteSpace(id)) id = teams.Rows.IndexOf(row).ToString();
            if (string.IsNullOrWhiteSpace(name)) name = "Team " + id;
            yield return $"{id} - {name}";
        }
    }

    private DataRow? CurrentTeamRow()
    {
        if (!_tables.TryGetValue("teams", out var teams) || teams.Rows.Count == 0) return null;
        var selected = Convert.ToString(_teamCombo.SelectedItem) ?? string.Empty;
        var selectedId = selected.Split('-').FirstOrDefault()?.Trim();
        foreach (DataRow row in teams.Rows)
        {
            var id = FirstCell(row, "index", "team_index", "row", "id");
            if (!string.IsNullOrWhiteSpace(id) && id == selectedId) return row;
        }
        var selectedName = selected.Contains('-') ? selected[(selected.IndexOf('-') + 1)..].Trim() : selected;
        foreach (DataRow row in teams.Rows)
        {
            var name = FirstCell(row, "school", "school_name", "short", "team", "name");
            if (!string.IsNullOrWhiteSpace(name) && name.Equals(selectedName, StringComparison.OrdinalIgnoreCase)) return row;
        }
        return teams.Rows[0];
    }

    private string TeamValue(params string[] hints)
    {
        var row = CurrentTeamRow();
        return row == null ? string.Empty : FirstCell(row, hints);
    }

    private string CurrentTeamName()
    {
        var value = Convert.ToString(_teamCombo.SelectedItem) ?? "No team loaded";
        return value.Contains('-') ? value[(value.IndexOf('-') + 1)..].Trim() : value;
    }

    private List<ColorSlot> ExtractTeamColors()
    {
        var result = new List<ColorSlot>();
        var row = CurrentTeamRow();
        if (row == null) return result;
        for (var i = 0; i < row.Table.Columns.Count; i++)
        {
            var value = Convert.ToString(row[i])?.Trim() ?? string.Empty;
            var match = Regex.Match(value, "^(#|0x)?([0-9A-Fa-f]{6})([0-9A-Fa-f]{2})?$");
            if (!match.Success) continue;
            var hex = (match.Groups[2].Value + (match.Groups[3].Success ? match.Groups[3].Value : "FF")).ToUpperInvariant();
            result.Add(new ColorSlot(result.Count, $"+0x{0x1A0 + result.Count * 4:X}", hex, PaletteHint(result.Count)));
        }
        return result;
    }

    private IEnumerable<RosterSlot> CurrentSlots()
    {
        var players = PlayerItems().ToList();
        var fallback = new[] { "4316 - Jordan Ross", "2532 - Blue Cain", "469 - Kanon Catchings", "3331 - Dylan James", "1294 - Somtochukwu Cyril", "3978 - Marcus Millender", "3911 - Kareem Stagg", "4205 - Jake Wilkins", "4788 - Jackson McVey", "3586 - Justin Abson", "851 - Jeremiah Wilkinson", "1974 - Justin Bailey", "0 - Bryce Goldman", "0 - Bryce Goldman", "0 - Bryce Goldman", "0 - Bryce Goldman" };
        if (!_tables.TryGetValue("roster_slots", out var slots) || slots.Rows.Count == 0)
        {
            for (var i = 0; i < fallback.Length; i++) yield return new RosterSlot(i + 1, $"+0x{0x6C + i * 4:X}", fallback[i], players);
            yield break;
        }
        var selectedId = (Convert.ToString(_teamCombo.SelectedItem) ?? "0").Split('-').FirstOrDefault()?.Trim() ?? "0";
        var rows = slots.Rows.Cast<DataRow>().Where(r => RowMatchesTeam(r, selectedId)).Take(16).ToList();
        if (rows.Count == 0) rows = slots.Rows.Cast<DataRow>().Take(16).ToList();
        for (var i = 0; i < 16; i++)
        {
            var value = i < rows.Count ? FirstCell(rows[i], "player", "name", "player_name", "player_id", "id") : string.Empty;
            if (string.IsNullOrWhiteSpace(value) && i < players.Count) value = players[i];
            if (string.IsNullOrWhiteSpace(value) && i < fallback.Length) value = fallback[i];
            yield return new RosterSlot(i + 1, $"+0x{0x6C + i * 4:X}", value, players.Count == 0 ? fallback : players);
        }
    }

    private bool RowMatchesTeam(DataRow row, string teamId)
    {
        foreach (DataColumn col in row.Table.Columns)
        {
            var name = col.ColumnName;
            if (!name.Contains("team", StringComparison.OrdinalIgnoreCase) && !name.Contains("row", StringComparison.OrdinalIgnoreCase)) continue;
            if ((Convert.ToString(row[col]) ?? string.Empty).Trim() == teamId) return true;
        }
        return false;
    }

    private IEnumerable<string> PlayerItems()
    {
        if (!_tables.TryGetValue("players", out var players)) yield break;
        foreach (DataRow row in players.Rows)
        {
            var id = FirstCell(row, "id", "index", "player_id");
            var first = FirstCell(row, "first", "first_name");
            var last = FirstCell(row, "last", "last_name");
            var name = (first + " " + last).Trim();
            if (string.IsNullOrWhiteSpace(name)) name = FirstCell(row, "name", "player");
            if (string.IsNullOrWhiteSpace(id)) id = players.Rows.IndexOf(row).ToString();
            if (string.IsNullOrWhiteSpace(name)) name = "Player " + id;
            yield return $"{id} - {name}";
        }
    }

    private static string FirstCell(DataRow row, params string[] hints)
    {
        foreach (var hint in hints)
        {
            foreach (DataColumn col in row.Table.Columns)
            {
                var normalized = col.ColumnName.Replace("_", " ").Replace("-", " ");
                if (!normalized.Contains(hint.Replace("_", " "), StringComparison.OrdinalIgnoreCase)) continue;
                var value = Convert.ToString(row[col])?.Trim() ?? string.Empty;
                if (!string.IsNullOrWhiteSpace(value) && value != "0") return value;
            }
        }
        foreach (DataColumn col in row.Table.Columns)
        {
            var value = Convert.ToString(row[col])?.Trim() ?? string.Empty;
            if (!string.IsNullOrWhiteSpace(value)) return value;
        }
        return string.Empty;
    }

    private void AddEditField(Control parent, string label, string value, string editKey, bool wide = false)
    {
        var box = TextInput(value);
        var queue = AccentButton("Queue", ButtonRole.Success);
        queue.Width = 88;
        queue.Click += (_, _) => Queue(editKey, box.Text, label);
        var panel = FieldCard(label, box, queue);
        if (parent is TableLayoutPanel table)
        {
            table.Controls.Add(panel);
            if (wide) table.SetColumnSpan(panel, table.ColumnCount);
        }
        else parent.Controls.Add(panel);
    }

    private void AddWideEditField(TableLayoutPanel table, string label, string value, string editKey) => AddEditField(table, label, value, editKey, true);

    private Control FieldCard(string label, Control input, Button action)
    {
        var card = new GlassPanel { Dock = DockStyle.Top, Height = 96, Margin = new Padding(0, 0, 12, 12), Padding = new Padding(10), BackColor = Theme.CardDeep, BorderColor = Theme.Border, Radius = 12 };
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 3, ColumnCount = 1, BackColor = Color.Transparent };
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 22));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 34));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.Controls.Add(FieldLabel(label), 0, 0);
        layout.Controls.Add(input, 0, 1);
        layout.Controls.Add(action, 0, 2);
        card.Controls.Add(layout);
        return card;
    }

    private Control RivalRow(int number)
    {
        var row = new TableLayoutPanel { Width = 520, Height = 40, ColumnCount = 3, BackColor = Color.Transparent, Margin = new Padding(0, 0, 0, 8) };
        row.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 82));
        row.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        row.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 112));
        row.Controls.Add(FieldLabel($"Rival #{number}"), 0, 0);
        var combo = Combo(TeamItems().DefaultIfEmpty("0 - Albany").ToArray());
        if (combo.Items.Count > number) combo.SelectedIndex = Math.Min(number * 2, combo.Items.Count - 1);
        row.Controls.Add(combo, 1, 0);
        var queue = AccentButton("Queue Rival", ButtonRole.Success);
        queue.Click += (_, _) => Queue($"rival.{number}", Convert.ToString(combo.SelectedItem) ?? string.Empty, $"Rival #{number}");
        row.Controls.Add(queue, 2, 0);
        return row;
    }

    private void AddTableHeader(TableLayoutPanel table, params string[] headers)
    {
        for (var i = 0; i < headers.Length; i++)
        {
            var label = new Label { Text = headers[i], Dock = DockStyle.Fill, Font = Theme.Font(9f, FontStyle.Bold), ForeColor = Theme.Text, BackColor = Theme.TableHeader, TextAlign = ContentAlignment.MiddleLeft, Padding = new Padding(10, 0, 0, 0) };
            table.Controls.Add(label, i, 0);
        }
    }

    private void AddColorRow(TableLayoutPanel table, int index, ColorSlot slot)
    {
        var row = index + 1;
        table.RowStyles.Add(new RowStyle(SizeType.Absolute, 38));
        table.Controls.Add(TableCell($"{slot.Index}\r\n{slot.Offset}", Theme.Muted), 0, row);
        table.Controls.Add(ColorCell(slot.Hex), 1, row);
        table.Controls.Add(TableCell(slot.Hint, Theme.Text), 2, row);
        var input = TextInput(slot.Hex);
        var preview = ColorPreview(ParseHex(slot.Hex));
        input.TextChanged += (_, _) => preview.BackColor = ParseHex(input.Text);
        var picker = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, BackColor = Theme.CardDeep };
        picker.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 60));
        picker.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 40));
        picker.Controls.Add(input, 0, 0);
        picker.Controls.Add(preview, 1, 0);
        picker.DoubleClick += (_, _) => PickColorInto(input);
        preview.DoubleClick += (_, _) => PickColorInto(input);
        table.Controls.Add(picker, 3, row);
        var queue = AccentButton("Queue Color", ButtonRole.Success);
        queue.Click += (_, _) => Queue($"color.{slot.Offset}", input.Text, $"Palette {slot.Offset}");
        table.Controls.Add(queue, 4, row);
    }

    private Control SlotCard(RosterSlot slot, bool compact)
    {
        var card = new GlassPanel { Width = compact ? 260 : 290, Height = compact ? 78 : 116, Margin = new Padding(0, 0, 12, 12), Padding = new Padding(10), BackColor = Theme.CardDeep, BorderColor = Theme.Border, Radius = 12 };
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 3, ColumnCount = 1, BackColor = Color.Transparent };
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, compact ? 18 : 24));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 34));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.Controls.Add(new Label { Text = $"Slot {slot.Number}  {slot.Offset}", Dock = DockStyle.Fill, ForeColor = Theme.Muted, Font = Theme.Font(8.5f), BackColor = Color.Transparent }, 0, 0);
        var combo = Combo(slot.PlayerOptions.DefaultIfEmpty(slot.CurrentPlayer).ToArray(), slot.CurrentPlayer);
        layout.Controls.Add(combo, 0, 1);
        var queue = AccentButton("Queue", ButtonRole.Success);
        queue.Width = 76;
        queue.Height = compact ? 24 : 30;
        queue.Click += (_, _) => Queue($"slot.{slot.Number}", Convert.ToString(combo.SelectedItem) ?? string.Empty, $"Slot {slot.Number}");
        layout.Controls.Add(queue, 0, 2);
        card.Controls.Add(layout);
        return card;
    }

    private Control UniformSwatch(string label, Color jersey, Color trim)
    {
        var panel = new GlassPanel { Height = 76, Dock = DockStyle.Top, BackColor = Theme.CardDeep, BorderColor = Theme.Border, Radius = 12, Padding = new Padding(10), Margin = new Padding(0, 0, 12, 12) };
        var text = FieldLabel(label);
        text.Dock = DockStyle.Top;
        var swatch = new Panel { Width = 52, Dock = DockStyle.Left, BackColor = Theme.Input, Margin = new Padding(0, 4, 8, 0) };
        swatch.Paint += (_, e) =>
        {
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            using var fill = new SolidBrush(jersey);
            using var pen = new Pen(trim, 3);
            var rect = new Rectangle(14, 9, 24, 32);
            e.Graphics.FillRectangle(fill, rect);
            e.Graphics.DrawRectangle(pen, rect);
        };
        panel.Controls.Add(swatch);
        panel.Controls.Add(text);
        return panel;
    }

    private Control ColorCell(string hex)
    {
        var panel = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, BackColor = Theme.CardDeep, Padding = new Padding(8, 4, 4, 4) };
        panel.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 48));
        panel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        panel.Controls.Add(ColorPreview(ParseHex(hex)), 0, 0);
        panel.Controls.Add(TableCell(hex, Theme.Text), 1, 0);
        return panel;
    }

    private Label TableCell(string text, Color color) => new() { Dock = DockStyle.Fill, Text = text, ForeColor = color, Font = Theme.Font(9f), BackColor = Theme.CardDeep, TextAlign = ContentAlignment.MiddleLeft, Padding = new Padding(8, 0, 0, 0) };

    private Panel ColorPreview(Color color)
    {
        var panel = new Panel { Dock = DockStyle.Fill, BackColor = color, Margin = new Padding(4) };
        panel.Paint += (_, e) => DrawRect(e.Graphics, panel.ClientRectangle, Theme.Border);
        return panel;
    }

    private void PickColorInto(TextBox input)
    {
        using var dialog = new ColorDialog { FullOpen = true, Color = ParseHex(input.Text) };
        if (dialog.ShowDialog(this) == DialogResult.OK) input.Text = $"{dialog.Color.R:X2}{dialog.Color.G:X2}{dialog.Color.B:X2}FF";
    }

    private void Queue(string key, string value, string label)
    {
        _queuedEdits.Add(new QueuedEdit(key, value));
        _queuedText.Text = $"Queued edits: {_queuedEdits.Count}";
        AppendLog($"[QUEUE] {label}: {value}");
    }

    private async Task RunCliAsync(IEnumerable<string> args)
    {
        var argList = args.ToList();
        if (_devIndexJs != null) argList.Insert(0, _devIndexJs);
        if ((argList.Contains("rip") || argList.Contains("build") || argList.Contains("build-copy")) && !argList.Contains("--progress")) argList.Add("--progress");
        AppendLog("> " + _cliPath + " " + string.Join(" ", argList.Select(QuoteArg)));
        _progress.Style = ProgressBarStyle.Marquee;
        _progressText.Text = "Running command...";
        var psi = new ProcessStartInfo { FileName = _cliPath, WorkingDirectory = AppContext.BaseDirectory, UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true, CreateNoWindow = true };
        foreach (var arg in argList) psi.ArgumentList.Add(arg);
        using var process = new Process { StartInfo = psi, EnableRaisingEvents = true };
        process.OutputDataReceived += (_, e) => HandleProcessLine(e.Data, false);
        process.ErrorDataReceived += (_, e) => HandleProcessLine(e.Data, true);
        process.Start();
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        await process.WaitForExitAsync();
        _progress.Style = ProgressBarStyle.Continuous;
        _progress.Value = process.ExitCode == 0 ? 100 : 0;
        _progressText.Text = process.ExitCode == 0 ? "Complete" : "Failed";
        if (process.ExitCode != 0) throw new InvalidOperationException($"Command failed with exit code {process.ExitCode}");
    }

    private void HandleProcessLine(string? line, bool error)
    {
        if (string.IsNullOrWhiteSpace(line)) return;
        if (line.StartsWith(ProgressPrefix, StringComparison.Ordinal))
        {
            try
            {
                var evt = JsonSerializer.Deserialize<ProgressEvent>(line[ProgressPrefix.Length..].Trim());
                if (evt != null) BeginInvoke(() => ApplyProgress(evt));
            }
            catch { }
            return;
        }
        BeginInvoke(() => AppendLog((error ? "[ERR] " : "") + line));
    }

    private void ApplyProgress(ProgressEvent evt)
    {
        _progress.Style = evt.Percent.HasValue ? ProgressBarStyle.Continuous : ProgressBarStyle.Marquee;
        if (evt.Percent.HasValue) _progress.Value = Math.Max(0, Math.Min(100, evt.Percent.Value));
        _progressText.Text = string.IsNullOrWhiteSpace(evt.Message) ? evt.Phase ?? "Working..." : evt.Message;
    }

    private void AppendLog(string text)
    {
        _log.AppendText(text + Environment.NewLine);
        _log.ScrollToCaret();
    }

    private void SetStatus(string text, bool ok)
    {
        _status.Text = ok ? "✓ " + text : text;
        _status.ForeColor = ok ? Theme.GoodBright : Theme.Muted;
    }

    private void UpdateFooter()
    {
        _footer.Text = $"Roster File: {Path.GetFileName(_rosterPath.Text)}   |   Team: {Convert.ToString(_teamCombo.SelectedItem) ?? "none"}   |   Game: College Hoops 2K8   |   Platform: PS3   |   Version 1.0.0";
    }

    private static (string Cli, string? DevIndexJs) LocateCli()
    {
        var baseDir = AppContext.BaseDirectory;
        var exeCandidates = new[]
        {
            Path.Combine(baseDir, "choops-extractor.exe"),
            Path.Combine(baseDir, "..", "dist", "choops-extractor.exe"),
            Path.Combine(Directory.GetCurrentDirectory(), "dist", "choops-extractor.exe")
        };
        foreach (var candidate in exeCandidates)
        {
            var full = Path.GetFullPath(candidate);
            if (File.Exists(full)) return (full, null);
        }
        var jsCandidates = new[]
        {
            Path.Combine(Directory.GetCurrentDirectory(), "index.js"),
            Path.Combine(baseDir, "..", "..", "..", "index.js")
        };
        foreach (var candidate in jsCandidates)
        {
            var full = Path.GetFullPath(candidate);
            if (File.Exists(full)) return ("node", full);
        }
        return (Path.Combine(baseDir, "choops-extractor.exe"), null);
    }

    private void BrowseFile(TextBox target)
    {
        using var dialog = new OpenFileDialog { Filter = "Roster sources|*.zip;*.iff;*.bin;*.*|All files|*.*" };
        if (dialog.ShowDialog(this) == DialogResult.OK) target.Text = dialog.FileName;
    }

    private void BrowseFolder(TextBox target)
    {
        using var dialog = new FolderBrowserDialog();
        if (dialog.ShowDialog(this) == DialogResult.OK) target.Text = dialog.SelectedPath;
    }

    private Control PathPicker(TextBox box, string buttonText, Action browse)
    {
        StyleTextBox(box);
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, BackColor = Color.Transparent };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 94));
        layout.Controls.Add(box, 0, 0);
        var button = AccentButton(buttonText, ButtonRole.Dark);
        button.Click += (_, _) => browse();
        layout.Controls.Add(button, 1, 0);
        return layout;
    }

    private Control LabeledControl(string label, Control control)
    {
        if (control is TextBox tb) StyleTextBox(tb);
        if (control is ComboBox cb) StyleCombo(cb);
        var stack = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 2, ColumnCount = 1, BackColor = Color.Transparent };
        stack.RowStyles.Add(new RowStyle(SizeType.Absolute, 18));
        stack.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        stack.Controls.Add(FieldLabel(label), 0, 0);
        stack.Controls.Add(control, 0, 1);
        return stack;
    }

    private static FlowLayoutPanel ScrollHost() => new() { Dock = DockStyle.Fill, AutoScroll = true, FlowDirection = FlowDirection.TopDown, WrapContents = false, BackColor = Theme.App, Padding = new Padding(0, 0, 12, 20) };

    private static TableLayoutPanel TwoColumnGrid(int leftPercent, int rightPercent, Color? back = null)
    {
        var grid = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 2, BackColor = back ?? Theme.App, Padding = new Padding(0) };
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, leftPercent));
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, rightPercent));
        return grid;
    }

    private static GlassPanel Card(string title, string subtitle)
    {
        var card = new GlassPanel { Dock = DockStyle.Top, AutoSize = true, Padding = new Padding(14), Margin = new Padding(0, 0, 12, 12), BackColor = Theme.Card, BorderColor = Theme.BlueBorder, Radius = 14 };
        var head = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, RowCount = 2, ColumnCount = 1, BackColor = Color.Transparent };
        head.Controls.Add(TitleLabel(title, 13), 0, 0);
        if (!string.IsNullOrWhiteSpace(subtitle)) head.Controls.Add(MutedLabel(subtitle), 0, 1);
        card.Controls.Add(head);
        return card;
    }

    private Control InfoLine(string text) => new Label { Dock = DockStyle.Top, AutoSize = true, ForeColor = Theme.Muted, Font = Theme.Font(9f), Text = "ⓘ  " + text, Padding = new Padding(4, 10, 4, 0), BackColor = Color.Transparent };

    private static Label TitleLabel(string text, float size) => new() { Text = text, Dock = DockStyle.Fill, AutoSize = true, ForeColor = Theme.Text, Font = Theme.Font(size, FontStyle.Bold), BackColor = Color.Transparent };
    private static Label MutedLabel(string text) => new() { Text = text, Dock = DockStyle.Fill, AutoSize = true, ForeColor = Theme.Muted, Font = Theme.Font(9f), BackColor = Color.Transparent };
    private static Label FieldLabel(string text) => new() { Text = text, Dock = DockStyle.Fill, ForeColor = Theme.Muted, Font = Theme.Font(8.6f), BackColor = Color.Transparent, TextAlign = ContentAlignment.BottomLeft };

    private static TextBox TextInput(string text = "")
    {
        var box = new TextBox { Text = text };
        StyleTextBox(box);
        return box;
    }

    private static ComboBox Combo(string[] items, string? selected = null)
    {
        var combo = new ComboBox { Dock = DockStyle.Fill, DropDownStyle = ComboBoxStyle.DropDownList };
        StyleCombo(combo);
        combo.Items.AddRange(items.Cast<object>().ToArray());
        if (combo.Items.Count > 0) combo.SelectedItem = selected != null && combo.Items.Contains(selected) ? selected : combo.Items[0];
        return combo;
    }

    private static Button AccentButton(string text, ButtonRole role)
    {
        var colors = role switch
        {
            ButtonRole.Success => (Theme.Green, Theme.GreenHover, Theme.GreenBorder),
            ButtonRole.Gold => (Theme.Gold, Theme.GoldHover, Theme.GoldBorder),
            ButtonRole.Ice => (Theme.IceButton, Theme.IceButtonHover, Theme.BlueBorder),
            ButtonRole.Tab => (Theme.Tab, Theme.TabHover, Theme.BlueBorder),
            _ => (Theme.DarkButton, Theme.TabHover, Theme.Border)
        };
        var button = new Button { Text = text, Height = 34, FlatStyle = FlatStyle.Flat, BackColor = colors.Item1, ForeColor = Theme.Text, Font = Theme.Font(9.2f, FontStyle.Bold), Margin = new Padding(6, 0, 0, 0) };
        button.FlatAppearance.BorderColor = colors.Item3;
        button.FlatAppearance.MouseOverBackColor = colors.Item2;
        button.FlatAppearance.MouseDownBackColor = colors.Item2;
        return button;
    }

    private static void StyleTextBox(TextBox box)
    {
        box.BackColor = Theme.Input;
        box.ForeColor = Theme.Text;
        box.BorderStyle = BorderStyle.FixedSingle;
        box.Font = Theme.Font(9.4f);
    }

    private static void StyleCombo(ComboBox combo)
    {
        combo.BackColor = Theme.Input;
        combo.ForeColor = Theme.Text;
        combo.FlatStyle = FlatStyle.Flat;
        combo.Font = Theme.Font(9.2f);
    }

    private void ApplyInputTheme()
    {
        StyleTextBox(_rosterPath);
        StyleTextBox(_assetFolder);
        StyleTextBox(_savePath);
        StyleCombo(_teamCombo);
        _teamCombo.SelectedIndexChanged += TeamChanged;
    }

    private static string QuoteArg(string value) => value.Contains(' ') ? '"' + value + '"' : value;

    private static string Sanitize(string value)
    {
        foreach (var invalid in Path.GetInvalidFileNameChars()) value = value.Replace(invalid, '_');
        return string.IsNullOrWhiteSpace(value) ? "roster" : value;
    }

    private static Color ParseHex(string value)
    {
        var clean = value.Trim().Replace("#", "").Replace("0x", "", StringComparison.OrdinalIgnoreCase);
        if (clean.Length >= 6 && int.TryParse(clean[..2], System.Globalization.NumberStyles.HexNumber, null, out var r) && int.TryParse(clean.Substring(2, 2), System.Globalization.NumberStyles.HexNumber, null, out var g) && int.TryParse(clean.Substring(4, 2), System.Globalization.NumberStyles.HexNumber, null, out var b)) return Color.FromArgb(r, g, b);
        return Color.Black;
    }

    private static string PaletteHint(int i) => i switch
    {
        0 => "Secondary / white candidate",
        1 => "Primary / school color candidate",
        5 => "Secondary / trim candidate",
        13 => "Court material candidate",
        14 or 16 => "Line / paint candidate",
        _ => "Research slot"
    };

    private static List<ColorSlot> DefaultGeorgiaColors() => new()
    {
        new(0, "+0x1A0", "FFFFFFFF", "Secondary / white candidate"),
        new(1, "+0x1A4", "AD3640FF", "Primary / school color candidate"),
        new(2, "+0x1A8", "0A0A0AFF", "Research slot"),
        new(3, "+0x1AC", "0A0A0AFF", "Research slot"),
        new(4, "+0x1B0", "0A0A0AFF", "Research slot"),
        new(5, "+0x1B4", "DB280AFF", "Research slot"),
        new(6, "+0x1B8", "BEBEBEFF", "Research slot"),
        new(7, "+0x1BC", "DDD3B6FF", "Research slot"),
        new(8, "+0x1C0", "DDD3B5FF", "Research slot")
    };

    private static void DrawRect(Graphics graphics, Rectangle rect, Color color)
    {
        using var pen = new Pen(color);
        var r = rect;
        r.Width -= 1;
        r.Height -= 1;
        graphics.DrawRectangle(pen, r);
    }
}

internal enum ButtonRole { Dark, Success, Gold, Ice, Tab }
internal sealed record QueuedEdit(string Key, string Value);
internal sealed record ColorSlot(int Index, string Offset, string Hex, string Hint);
internal sealed record RosterSlot(int Number, string Offset, string CurrentPlayer, IReadOnlyList<string> PlayerOptions);
internal sealed class ProgressEvent { public string? Phase { get; set; } public string? Message { get; set; } public int? Percent { get; set; } }

internal sealed class GradientPanel : Panel
{
    public Color TopColor { get; set; }
    public Color BottomColor { get; set; }
    public Color BorderColor { get; set; } = Theme.Border;
    public int Radius { get; set; } = 12;

    public GradientPanel(Color top, Color bottom)
    {
        TopColor = top;
        BottomColor = bottom;
        DoubleBuffered = true;
    }

    protected override void OnPaintBackground(PaintEventArgs e)
    {
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        using var path = Theme.RoundRect(ClientRectangle, Radius);
        using var brush = new LinearGradientBrush(ClientRectangle, TopColor, BottomColor, 90f);
        e.Graphics.FillPath(brush, path);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        using var path = Theme.RoundRect(new Rectangle(0, 0, Width - 1, Height - 1), Radius);
        using var pen = new Pen(BorderColor);
        e.Graphics.DrawPath(pen, path);
    }
}

internal sealed class GlassPanel : Panel
{
    public Color BorderColor { get; set; } = Theme.Border;
    public int Radius { get; set; } = 12;

    public GlassPanel()
    {
        DoubleBuffered = true;
    }

    protected override void OnPaintBackground(PaintEventArgs e)
    {
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        using var path = Theme.RoundRect(ClientRectangle, Radius);
        using var brush = new LinearGradientBrush(ClientRectangle, Theme.Lighten(BackColor, 12), BackColor, 90f);
        e.Graphics.FillPath(brush, path);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        using var path = Theme.RoundRect(new Rectangle(0, 0, Width - 1, Height - 1), Radius);
        using var pen = new Pen(BorderColor);
        e.Graphics.DrawPath(pen, path);
    }
}

internal static class Csv
{
    public static DataTable Read(string path)
    {
        var table = new DataTable(Path.GetFileNameWithoutExtension(path));
        using var reader = new StreamReader(path, Encoding.UTF8, true);
        var header = reader.ReadLine();
        if (header == null) return table;
        foreach (var column in ParseLine(header)) table.Columns.Add(string.IsNullOrWhiteSpace(column) ? "Column" + table.Columns.Count : column);
        while (!reader.EndOfStream)
        {
            var values = ParseLine(reader.ReadLine() ?? string.Empty);
            var row = table.NewRow();
            for (var i = 0; i < table.Columns.Count && i < values.Count; i++) row[i] = values[i];
            table.Rows.Add(row);
        }
        return table;
    }

    private static List<string> ParseLine(string line)
    {
        var result = new List<string>();
        var sb = new StringBuilder();
        var quoted = false;
        for (var i = 0; i < line.Length; i++)
        {
            var ch = line[i];
            if (ch == '"')
            {
                if (quoted && i + 1 < line.Length && line[i + 1] == '"') { sb.Append('"'); i++; }
                else quoted = !quoted;
            }
            else if (ch == ',' && !quoted)
            {
                result.Add(sb.ToString());
                sb.Clear();
            }
            else sb.Append(ch);
        }
        result.Add(sb.ToString());
        return result;
    }
}

internal static class Theme
{
    public static readonly Color App = Color.FromArgb(5, 11, 18);
    public static readonly Color HeaderTop = Color.FromArgb(5, 23, 42);
    public static readonly Color HeaderBottom = Color.FromArgb(3, 50, 84);
    public static readonly Color Card = Color.FromArgb(14, 32, 48);
    public static readonly Color CardDeep = Color.FromArgb(7, 19, 30);
    public static readonly Color Input = Color.FromArgb(4, 13, 23);
    public static readonly Color TableHeader = Color.FromArgb(26, 54, 80);
    public static readonly Color LogBg = Color.FromArgb(2, 8, 14);
    public static readonly Color Text = Color.FromArgb(246, 251, 255);
    public static readonly Color Muted = Color.FromArgb(144, 169, 190);
    public static readonly Color LogText = Color.FromArgb(214, 236, 250);
    public static readonly Color Ice = Color.FromArgb(126, 219, 255);
    public static readonly Color IceDark = Color.FromArgb(36, 128, 178);
    public static readonly Color IceButton = Color.FromArgb(22, 95, 145);
    public static readonly Color IceButtonHover = Color.FromArgb(35, 128, 187);
    public static readonly Color BlueBorder = Color.FromArgb(0, 132, 211);
    public static readonly Color Border = Color.FromArgb(34, 58, 78);
    public static readonly Color Tab = Color.FromArgb(7, 48, 80);
    public static readonly Color TabHover = Color.FromArgb(18, 72, 112);
    public static readonly Color Purple = Color.FromArgb(128, 78, 232);
    public static readonly Color PurpleBorder = Color.FromArgb(172, 126, 255);
    public static readonly Color Green = Color.FromArgb(27, 145, 67);
    public static readonly Color GreenHover = Color.FromArgb(42, 180, 86);
    public static readonly Color GreenBorder = Color.FromArgb(55, 224, 110);
    public static readonly Color GoodBright = Color.FromArgb(83, 244, 132);
    public static readonly Color Gold = Color.FromArgb(183, 122, 0);
    public static readonly Color GoldHover = Color.FromArgb(224, 157, 0);
    public static readonly Color GoldBorder = Color.FromArgb(255, 202, 64);
    public static readonly Color DarkButton = Color.FromArgb(40, 53, 68);

    public static Font Font(float size, FontStyle style = FontStyle.Regular) => new("Segoe UI", size, style);
    public static Font Mono(float size, FontStyle style = FontStyle.Regular) => new("Consolas", size, style);

    public static Color Lighten(Color color, int amount) => Color.FromArgb(Math.Min(255, color.R + amount), Math.Min(255, color.G + amount), Math.Min(255, color.B + amount));

    public static GraphicsPath RoundRect(Rectangle bounds, int radius)
    {
        var path = new GraphicsPath();
        var diameter = radius * 2;
        var arc = new Rectangle(bounds.Location, new Size(diameter, diameter));
        path.AddArc(arc, 180, 90);
        arc.X = bounds.Right - diameter;
        path.AddArc(arc, 270, 90);
        arc.Y = bounds.Bottom - diameter;
        path.AddArc(arc, 0, 90);
        arc.X = bounds.Left;
        path.AddArc(arc, 90, 90);
        path.CloseFigure();
        return path;
    }
}
