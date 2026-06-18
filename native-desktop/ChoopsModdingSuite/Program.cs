using System;
using System.Collections.Generic;
using System.Data;
using System.Diagnostics;
using System.Drawing;
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
    private static readonly string[] TabKeys =
    {
        "Dashboard", "School", "Spirit", "Colors / Floor / Basket / Cheer", "Roster Slots",
        "Depth Chart / Rotation", "Assets", "Conferences", "Unknown / Research"
    };

    private readonly string _cliPath;
    private readonly Dictionary<string, DataTable> _tables = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, Button> _tabButtons = new(StringComparer.OrdinalIgnoreCase);
    private readonly List<QueuedEdit> _queuedEdits = new();

    private readonly TextBox _rosterPath = new() { Dock = DockStyle.Fill };
    private readonly TextBox _assetPath = new() { Dock = DockStyle.Fill };
    private readonly Label _status = new() { AutoSize = false, Height = 28, Dock = DockStyle.Top, TextAlign = ContentAlignment.MiddleLeft };
    private readonly ComboBox _teamCombo = new() { Dock = DockStyle.Fill, DropDownStyle = ComboBoxStyle.DropDownList };
    private readonly TextBox _savePath = new() { Dock = DockStyle.Fill };
    private readonly Label _queuedLabel = new() { AutoSize = true };
    private readonly Panel _tabStrip = new() { Dock = DockStyle.Top, Height = 54 };
    private readonly Panel _content = new() { Dock = DockStyle.Fill };
    private readonly RichTextBox _log = new() { Dock = DockStyle.Fill, ReadOnly = true, BorderStyle = BorderStyle.None, DetectUrls = false };
    private readonly ProgressBar _progress = new() { Dock = DockStyle.Fill, Minimum = 0, Maximum = 100 };
    private readonly Label _progressText = new() { Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft };
    private readonly Label _footer = new() { Dock = DockStyle.Bottom, Height = 34, TextAlign = ContentAlignment.MiddleLeft };

    private string _decodedFolder = string.Empty;
    private string _activeTab = "Dashboard";

    public MainForm()
    {
        _cliPath = FindCliPath();

        Text = "College Hoops 2K8 Roster Studio";
        Width = 1700;
        Height = 1000;
        MinimumSize = new Size(1320, 760);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Ui.App;
        ForeColor = Ui.Text;
        Font = Ui.Font(9.5f);
        DoubleBuffered = true;

        ApplyBaseControlTheme();
        Controls.Add(BuildRoot());
        SetStatus("Ready. Open a roster ZIP, USERDATA, roster_english.iff, or raw ROST payload.", false);
        AppendLog("College Hoops 2K8 Roster Studio ready.");
        AppendLog($"CLI backend: {_cliPath}");
        AppendLog("Native WinForms only: no Chrome, browser, Electron, or webview.");
        ShowTab("Dashboard");
    }

    private Control BuildRoot()
    {
        var root = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 4, ColumnCount = 1, BackColor = Ui.App, Padding = new Padding(6) };
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 128));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 108));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 34));

        root.Controls.Add(BuildHeader(), 0, 0);
        root.Controls.Add(BuildEditorBar(), 0, 1);
        root.Controls.Add(BuildWorkspace(), 0, 2);
        _footer.ForeColor = Ui.Muted;
        _footer.Font = Ui.Font(9f);
        _footer.Padding = new Padding(18, 0, 18, 0);
        _footer.Text = "Roster File: none   |   Team: none   |   Game: College Hoops 2K8   |   Platform: PS3   |   Version 1.0.0";
        root.Controls.Add(_footer, 0, 3);
        return root;
    }

    private Control BuildHeader()
    {
        var card = new GradientPanel(Ui.HeaderTop, Ui.HeaderBottom) { Dock = DockStyle.Fill, Padding = new Padding(18, 12, 18, 10) };
        card.Paint += (_, e) => DrawBorder(e.Graphics, card.ClientRectangle, Ui.BlueBorder);

        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 4, RowCount = 2, BackColor = Color.Transparent };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 118));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 47));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 43));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 154));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 52));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 48));

        var logo = new Label
        {
            Dock = DockStyle.Fill,
            Text = "🏀\r\nCH 2K8",
            TextAlign = ContentAlignment.MiddleCenter,
            Font = Ui.Font(16f, FontStyle.Bold),
            ForeColor = Ui.Ice,
            BackColor = Color.Transparent
        };
        layout.Controls.Add(logo, 0, 0);
        layout.SetRowSpan(logo, 2);

        var titleStack = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 2, ColumnCount = 1, BackColor = Color.Transparent };
        titleStack.RowStyles.Add(new RowStyle(SizeType.Absolute, 30));
        titleStack.RowStyles.Add(new RowStyle(SizeType.Absolute, 22));
        titleStack.Controls.Add(Label("College Hoops 2K8 Roster Studio", 18, FontStyle.Bold, Ui.Text), 0, 0);
        titleStack.Controls.Add(Label("Roster file (.zip / USERDATA / roster_english.iff / raw ROST)", 9, FontStyle.Regular, Ui.Muted), 0, 1);
        layout.Controls.Add(titleStack, 1, 0);

        var assetLabel = Label("Optional ripped asset folder for uh\\ua\\ux\\s\\m lookup", 9, FontStyle.Regular, Ui.Muted);
        assetLabel.Dock = DockStyle.Bottom;
        layout.Controls.Add(assetLabel, 2, 0);

        layout.Controls.Add(PathPicker(_rosterPath, "Browse", () => BrowseFile(_rosterPath)), 1, 1);
        layout.Controls.Add(PathPicker(_assetPath, "Browse", () => BrowseFolder(_assetPath)), 2, 1);

        var open = GreenButton("📂  Open Roster");
        open.Dock = DockStyle.Fill;
        open.Click += async (_, _) => await OpenRosterAsync();
        layout.Controls.Add(open, 3, 1);

        card.Controls.Add(layout);
        _status.ForeColor = Ui.Good;
        _status.Font = Ui.Font(9f, FontStyle.Bold);
        _status.Padding = new Padding(18, 0, 0, 0);
        card.Controls.Add(_status);
        _status.BringToFront();
        return card;
    }

    private Control BuildEditorBar()
    {
        var outer = new Panel { Dock = DockStyle.Fill, BackColor = Ui.App, Padding = new Padding(12, 10, 12, 0) };
        var card = new RoundedPanel { Dock = DockStyle.Fill, BackColor = Ui.Card, Padding = new Padding(14, 10, 14, 10), BorderColor = Ui.Border };
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 3, RowCount = 2, BackColor = Ui.Card };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 31));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 39));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 30));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 46));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 44));

        layout.Controls.Add(LabeledControl("Team", _teamCombo), 0, 0);
        layout.Controls.Add(LabeledControl("Save output copy path", _savePath), 1, 0);

        _savePath.PlaceholderText = "Example: C:\\CH2K8\\USERDATA_modded";
        var saveBox = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 2, BackColor = Ui.Card };
        var save = GoldButton("💾  Save Copy With Queued Edits");
        save.Height = 40;
        save.Dock = DockStyle.Top;
        save.Click += (_, _) => MessageBox.Show("Binary roster write-back is staged for the next safety pass. Queued edits are tracked in the UI now; CSV/research exports are safe.", "Queued edit write-back", MessageBoxButtons.OK, MessageBoxIcon.Information);
        _queuedLabel.Text = "Queued edits: 0";
        _queuedLabel.ForeColor = Ui.Muted;
        _queuedLabel.Font = Ui.Font(9f);
        saveBox.Controls.Add(save, 0, 0);
        saveBox.Controls.Add(_queuedLabel, 0, 1);
        layout.Controls.Add(saveBox, 2, 0);
        layout.SetRowSpan(saveBox, 2);

        _tabStrip.BackColor = Ui.Card;
        BuildTabStrip();
        layout.Controls.Add(_tabStrip, 0, 1);
        layout.SetColumnSpan(_tabStrip, 2);
        card.Controls.Add(layout);
        outer.Controls.Add(card);
        return outer;
    }

    private Control BuildWorkspace()
    {
        var split = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 1, BackColor = Ui.App, Padding = new Padding(12, 0, 12, 12) };
        split.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        split.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 360));
        _content.BackColor = Ui.App;
        split.Controls.Add(_content, 0, 0);
        split.Controls.Add(BuildRightRail(), 1, 0);
        return split;
    }

    private Control BuildRightRail()
    {
        var card = new RoundedPanel { Dock = DockStyle.Fill, BackColor = Ui.Card, Padding = new Padding(14), BorderColor = Ui.Border };
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 5, ColumnCount = 1, BackColor = Ui.Card };
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 36));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 42));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 18));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 36));

        var header = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, BackColor = Ui.Card };
        header.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        header.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 92));
        header.Controls.Add(Label("Job Log", 13, FontStyle.Bold, Ui.Text), 0, 0);
        var clear = DarkButton("Clear");
        clear.Click += (_, _) => _log.Clear();
        header.Controls.Add(clear, 1, 0);
        _progressText.ForeColor = Ui.Text;
        _progressText.Font = Ui.Font(9f, FontStyle.Bold);
        _progressText.Text = "Ready";
        _log.BackColor = Ui.LogBg;
        _log.ForeColor = Ui.LogText;
        _log.Font = Ui.Mono(9f);
        _progress.ForeColor = Ui.Ice;
        layout.Controls.Add(header, 0, 0);
        layout.Controls.Add(_progressText, 0, 1);
        layout.Controls.Add(_progress, 0, 2);
        layout.Controls.Add(_log, 0, 3);
        layout.Controls.Add(Label("Progress lines from rip/build are parsed automatically.", 8.5f, FontStyle.Regular, Ui.Muted), 0, 4);
        card.Controls.Add(layout);
        return card;
    }

    private void BuildTabStrip()
    {
        _tabStrip.Controls.Clear();
        _tabButtons.Clear();
        var flow = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.LeftToRight, WrapContents = false, AutoScroll = true, BackColor = Ui.Card, Padding = new Padding(0, 6, 0, 0) };
        foreach (var key in TabKeys)
        {
            var button = PillButton(key, false);
            button.Click += (_, _) => ShowTab(key);
            _tabButtons[key] = button;
            flow.Controls.Add(button);
        }
        _tabStrip.Controls.Add(flow);
    }

    private void ShowTab(string key)
    {
        _activeTab = key;
        foreach (var item in _tabButtons)
        {
            item.Value.BackColor = item.Key == key ? Ui.ActivePurple : Ui.Tab;
            item.Value.FlatAppearance.BorderColor = item.Key == key ? Ui.PurpleBorder : Ui.BlueBorder;
        }

        _content.Controls.Clear();
        Control view = key switch
        {
            "Dashboard" => DashboardView(),
            "School" => SchoolView(),
            "Spirit" => SpiritView(),
            "Colors / Floor / Basket / Cheer" => ColorsView(),
            "Roster Slots" => RosterSlotsView(false),
            "Depth Chart / Rotation" => RosterSlotsView(true),
            "Assets" => AssetsView(),
            "Conferences" => ResearchNotice("Conferences", "Conference affiliation and prestige fields are not confirmed yet. This panel is intentionally read-only until controlled roster diffs prove exact offsets."),
            "Unknown / Research" => UnknownResearchView(),
            _ => DashboardView()
        };
        _content.Controls.Add(view);
    }

    private Control DashboardView()
    {
        var scroll = ScrollHost();
        var grid = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 2, BackColor = Ui.App };
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 56));
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 44));
        grid.Controls.Add(SchoolView(), 0, 0);
        grid.Controls.Add(AssetsQuickInfo(true), 1, 0);
        grid.Controls.Add(ColorsView(), 0, 1);
        grid.Controls.Add(RosterSlotsPreview(), 1, 1);
        scroll.Controls.Add(grid);
        return scroll;
    }

    private Control SchoolView()
    {
        var card = Card("🏛  School", "Edit school identity fields. Queue buttons stage changes for future safe write-back.");
        var layout = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 2, BackColor = Ui.Card, Padding = new Padding(0, 8, 0, 0) };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        AddEditField(layout, "School Name short", GetTeamValue("short", "team", "school"), "school.short");
        AddEditField(layout, "School Name full", GetTeamValue("full", "school"), "school.full");
        AddEditField(layout, "Nickname", GetTeamValue("nickname", "mascot plural", "mascot_plural"), "school.nickname");
        AddEditField(layout, "Abbreviation", GetTeamValue("abbr", "abbreviation"), "school.abbr");
        AddWideEditField(layout, "Mascot text", GetTeamValue("mascot", "mascot name"), "school.mascot");
        card.Controls.Add(layout);
        return card;
    }

    private Control SpiritView()
    {
        var card = Card("📣  Spirit", "Student section, Midnight Madness, and rivalry routing.");
        var layout = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 2, BackColor = Ui.Card, Padding = new Padding(0, 8, 0, 0) };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 42));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 58));

        var spirit = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 1, BackColor = Ui.Card };
        AddEditField(spirit, "Student Section", GetTeamValue("student", "student section"), "spirit.student", singleColumn: true);
        AddEditField(spirit, "Mid. Madness", GetTeamValue("midnight", "madness", "event"), "spirit.midnight", singleColumn: true);
        layout.Controls.Add(spirit, 0, 0);

        var rivals = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 1, BackColor = Ui.Card };
        rivals.Controls.Add(Label("Rivals", 13, FontStyle.Bold, Ui.Text));
        for (var i = 1; i <= 5; i++) rivals.Controls.Add(RivalSelector(i));
        layout.Controls.Add(rivals, 1, 0);
        card.Controls.Add(layout);
        return card;
    }

    private Control AssetsView() => AssetsQuickInfo(false);

    private Control AssetsQuickInfo(bool compact)
    {
        var card = Card("▣  Assets & Quick Info", "Asset IDs connect roster teams to uh/ua/ux/s/m families.");
        var layout = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 2, BackColor = Ui.Card, Padding = new Padding(0, 8, 0, 0) };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        AddEditField(layout, "Asset ID (uh/ua/ux/s/m)", GetTeamValue("asset", "asset_id"), "assets.asset");
        AddEditField(layout, "Arena", GetTeamValue("arena"), "assets.arena");
        AddEditField(layout, "Primary Logo", GetTeamValue("logo", "primary"), "assets.logo");
        AddEditField(layout, "Alt Logo", GetTeamValue("alt logo", "alt_logo"), "assets.altLogo");
        layout.Controls.Add(UniformSwatch("Home Uniform", Color.White, Color.Firebrick), 0, 2);
        layout.Controls.Add(UniformSwatch("Away Uniform", Color.FromArgb(28, 30, 36), Color.Firebrick), 1, 2);
        layout.Controls.Add(UniformSwatch("Alternate Uniform", Color.Firebrick, Color.White), 0, 3);
        var notes = new TextBox { Dock = DockStyle.Top, Height = compact ? 42 : 70, Multiline = true, Text = $"Default roster for {CurrentTeamName()}. Asset and arena links are shown for quick mod planning." };
        StyleTextBox(notes);
        layout.Controls.Add(LabeledControl("Notes", notes), 1, 3);
        card.Controls.Add(layout);
        return card;
    }

    private Control ColorsView()
    {
        var card = Card("🎨  Colors / Floor / Basket / Cheer", "Edit by palette slot and test in-game. Slots are research-safe until fully confirmed by controlled diffs.");
        var table = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 5, BackColor = Ui.Card, Padding = new Padding(0, 8, 0, 0) };
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 100));
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 160));
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 260));
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 132));
        AddTableHeader(table, "Slot", "Current", "Hint", "New RGB", "Action");
        var colors = ExtractTeamColors().Take(18).ToList();
        if (colors.Count == 0) colors = DefaultGeorgiaColors();
        for (var i = 0; i < colors.Count; i++) AddColorRow(table, i, colors[i]);
        var note = Label("ⓘ  Palette edits can affect uniforms, floor/court details, baskets, cheer/crowd colors, and other school-driven materials. Queue a color, save a copy, then test in-game.", 9, FontStyle.Regular, Ui.Muted);
        note.Dock = DockStyle.Top;
        note.Padding = new Padding(4, 10, 4, 0);
        card.Controls.Add(note);
        card.Controls.Add(table);
        return card;
    }

    private Control RosterSlotsView(bool depthChart)
    {
        var card = Card(depthChart ? "↕  Depth Chart / Rotation" : "👥  Roster Slots", depthChart ? "View slots as a rotation planning surface." : "Assign players to the 16 team roster slots.");
        var grid = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.LeftToRight, WrapContents = true, AutoScroll = true, BackColor = Ui.Card, Padding = new Padding(0, 8, 0, 0) };
        foreach (var slot in CurrentRosterSlots().Take(16)) grid.Controls.Add(SlotCard(slot));
        card.Controls.Add(grid);
        return card;
    }

    private Control RosterSlotsPreview()
    {
        var card = Card("👥  Roster Slots (Preview)", "Quick view of the first eight roster slots.");
        var grid = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 2, BackColor = Ui.Card, Padding = new Padding(0, 6, 0, 0) };
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        var slots = CurrentRosterSlots().Take(8).ToList();
        for (var i = 0; i < slots.Count; i++) grid.Controls.Add(CompactSlot(slots[i]), i % 2, i / 2);
        card.Controls.Add(grid);
        return card;
    }

    private Control UnknownResearchView()
    {
        var scroll = ScrollHost();
        scroll.Controls.Add(ResearchNotice("Unknown / Research", "Raw fields and candidate offsets remain research-only. Confirmed fields graduate into School, Spirit, Assets, Colors, and Roster Slots."));
        scroll.Controls.Add(CommandMiniPanel("Useful research commands", new[]
        {
            ("Inspect IFF", "inspect-iff <iffFile> <output>"),
            ("Smart Scan", "smart-scan <input> <output>"),
            ("Scan References", "scan-refs <input> <output>"),
            ("Compression Probe", "probe <input> <output>")
        }));
        return scroll;
    }

    private Control ResearchNotice(string title, string message)
    {
        var card = Card(title, message);
        card.Controls.Add(Label("Preserve-first rule: unknown fields should be viewed, diffed, and documented before write-back is enabled.", 11, FontStyle.Bold, Ui.Ice));
        return card;
    }

    private Control CommandMiniPanel(string title, IEnumerable<(string Name, string Command)> commands)
    {
        var card = Card(title, "Quick reference. Full command cards remain in the workflow sections.");
        var stack = new FlowLayoutPanel { Dock = DockStyle.Top, AutoSize = true, FlowDirection = FlowDirection.TopDown, BackColor = Ui.Card, Padding = new Padding(0, 8, 0, 0) };
        foreach (var command in commands)
        {
            var line = Label($"{command.Name}:  {command.Command}", 10, FontStyle.Regular, Ui.Text);
            line.Width = 900;
            line.Height = 28;
            stack.Controls.Add(line);
        }
        card.Controls.Add(stack);
        return card;
    }

    private async Task OpenRosterAsync()
    {
        if (string.IsNullOrWhiteSpace(_rosterPath.Text) || !File.Exists(_rosterPath.Text.Trim()))
        {
            MessageBox.Show("Choose a roster ZIP, USERDATA, roster_english.iff, or raw ROST payload first.", "Open roster", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }

        var baseName = Path.GetFileNameWithoutExtension(_rosterPath.Text.Trim());
        _decodedFolder = Path.Combine(Path.GetTempPath(), "CHoopsRosterStudio", SanitizeName(baseName) + "_" + DateTime.Now.ToString("yyyyMMdd_HHmmss"));
        Directory.CreateDirectory(_decodedFolder);
        SetStatus("Decoding roster source...", false);
        await RunCliAsync(new[] { "roster-decode", _rosterPath.Text.Trim(), _decodedFolder });
        LoadDecodedTables(_decodedFolder);
        SetStatus("Roster loaded.", true);
        ShowTab(_activeTab);
    }

    private void LoadDecodedTables(string folder)
    {
        _tables.Clear();
        foreach (var name in new[] { "players", "teams", "roster_slots", "arenas", "coaches" })
        {
            var file = Path.Combine(folder, name + ".csv");
            if (File.Exists(file)) _tables[name] = Csv.Read(file);
        }

        _teamCombo.Items.Clear();
        foreach (var item in TeamItems()) _teamCombo.Items.Add(item);
        if (_teamCombo.Items.Count > 0)
        {
            var uga = _teamCombo.Items.Cast<string>().FirstOrDefault(x => x.Contains("Georgia", StringComparison.OrdinalIgnoreCase));
            _teamCombo.SelectedItem = uga ?? _teamCombo.Items[0];
        }
        _teamCombo.SelectedIndexChanged -= TeamChanged;
        _teamCombo.SelectedIndexChanged += TeamChanged;
        UpdateFooter();
        AppendLog($"Loaded decoded roster tables from {_decodedFolder}");
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
            var index = FirstCell(row, "index", "team_index", "row", "id");
            var name = FirstCell(row, "school", "school_name", "short", "team", "name");
            if (string.IsNullOrWhiteSpace(index)) index = teams.Rows.IndexOf(row).ToString();
            if (string.IsNullOrWhiteSpace(name)) name = "Team " + index;
            yield return $"{index} - {name}";
        }
    }

    private DataRow? CurrentTeamRow()
    {
        if (!_tables.TryGetValue("teams", out var teams) || teams.Rows.Count == 0) return null;
        var selected = Convert.ToString(_teamCombo.SelectedItem) ?? string.Empty;
        var selectedIndex = selected.Split('-').FirstOrDefault()?.Trim();
        foreach (DataRow row in teams.Rows)
        {
            var index = FirstCell(row, "index", "team_index", "row", "id");
            if (!string.IsNullOrWhiteSpace(index) && index == selectedIndex) return row;
        }
        var selectedName = selected.Contains('-') ? selected[(selected.IndexOf('-') + 1)..].Trim() : selected;
        foreach (DataRow row in teams.Rows)
        {
            var name = FirstCell(row, "school", "school_name", "short", "team", "name");
            if (!string.IsNullOrWhiteSpace(name) && name.Equals(selectedName, StringComparison.OrdinalIgnoreCase)) return row;
        }
        return teams.Rows[0];
    }

    private string GetTeamValue(params string[] hints)
    {
        var row = CurrentTeamRow();
        if (row == null) return string.Empty;
        return FirstCell(row, hints);
    }

    private string CurrentTeamName()
    {
        var selected = Convert.ToString(_teamCombo.SelectedItem) ?? "No team loaded";
        return selected.Contains('-') ? selected[(selected.IndexOf('-') + 1)..].Trim() : selected;
    }

    private List<ColorSlot> ExtractTeamColors()
    {
        var output = new List<ColorSlot>();
        var row = CurrentTeamRow();
        if (row == null) return output;
        for (var c = 0; c < row.Table.Columns.Count; c++)
        {
            var value = Convert.ToString(row[c])?.Trim() ?? string.Empty;
            var match = Regex.Match(value, "^(#|0x)?([0-9A-Fa-f]{6})([0-9A-Fa-f]{2})?$");
            if (!match.Success) continue;
            var hex = (match.Groups[2].Value + (match.Groups[3].Success ? match.Groups[3].Value : "FF")).ToUpperInvariant();
            output.Add(new ColorSlot(output.Count, $"+0x{0x1A0 + output.Count * 4:X}", hex, PaletteHint(output.Count)));
        }
        return output;
    }

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

    private static string PaletteHint(int i) => i switch
    {
        0 => "Secondary / white candidate",
        1 => "Primary / school color candidate",
        5 => "Secondary / trim candidate",
        13 => "Court material candidate",
        14 or 16 => "Line / paint candidate",
        _ => "Research slot"
    };

    private IEnumerable<RosterSlot> CurrentRosterSlots()
    {
        var players = PlayerItems().ToList();
        if (!_tables.TryGetValue("roster_slots", out var slots) || slots.Rows.Count == 0)
        {
            var fallback = new[] { "4316 - Jordan Ross", "2532 - Blue Cain", "469 - Kanon Catchings", "3331 - Dylan James", "1294 - Somtochukwu Cyril", "3978 - Marcus Millender", "3911 - Kareem Stagg", "4205 - Jake Wilkins", "4788 - Jackson McVey", "3586 - Justin Abson", "851 - Jeremiah Wilkinson", "1974 - Justin Bailey", "0 - Bryce Goldman", "0 - Bryce Goldman", "0 - Bryce Goldman", "0 - Bryce Goldman" };
            for (var i = 0; i < 16; i++) yield return new RosterSlot(i + 1, $"+0x{0x6C + i * 4:X}", fallback[i], players);
            yield break;
        }

        var selectedIndex = (Convert.ToString(_teamCombo.SelectedItem) ?? "0").Split('-').FirstOrDefault()?.Trim() ?? "0";
        var rows = slots.Rows.Cast<DataRow>().Where(r => RowMatchesTeam(r, selectedIndex)).Take(16).ToList();
        if (rows.Count == 0) rows = slots.Rows.Cast<DataRow>().Take(16).ToList();
        for (var i = 0; i < 16; i++)
        {
            var value = i < rows.Count ? FirstCell(rows[i], "player", "name", "player_name", "player_id", "id") : string.Empty;
            if (string.IsNullOrWhiteSpace(value) && i < players.Count) value = players[i];
            yield return new RosterSlot(i + 1, $"+0x{0x6C + i * 4:X}", value, players);
        }
    }

    private bool RowMatchesTeam(DataRow row, string teamIndex)
    {
        foreach (DataColumn col in row.Table.Columns)
        {
            if (!col.ColumnName.Contains("team", StringComparison.OrdinalIgnoreCase) && !col.ColumnName.Contains("row", StringComparison.OrdinalIgnoreCase)) continue;
            if ((Convert.ToString(row[col]) ?? string.Empty).Trim() == teamIndex) return true;
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
                if (normalized.Contains(hint.Replace("_", " "), StringComparison.OrdinalIgnoreCase))
                {
                    var value = Convert.ToString(row[col])?.Trim() ?? string.Empty;
                    if (!string.IsNullOrWhiteSpace(value) && value != "0") return value;
                }
            }
        }
        foreach (DataColumn col in row.Table.Columns)
        {
            var value = Convert.ToString(row[col])?.Trim() ?? string.Empty;
            if (!string.IsNullOrWhiteSpace(value)) return value;
        }
        return string.Empty;
    }

    private void AddEditField(TableLayoutPanel layout, string label, string value, string editKey, bool singleColumn = false)
    {
        var box = TextInput(value);
        var queue = GreenButton("Queue");
        queue.Height = 32;
        queue.Width = 82;
        queue.Click += (_, _) => Queue(editKey, box.Text, label);
        var panel = FieldCard(label, box, queue);
        layout.Controls.Add(panel);
        if (singleColumn) layout.SetColumnSpan(panel, layout.ColumnCount);
    }

    private void AddWideEditField(TableLayoutPanel layout, string label, string value, string editKey)
    {
        var box = TextInput(value);
        var queue = GreenButton("Queue");
        queue.Height = 32;
        queue.Width = 82;
        queue.Click += (_, _) => Queue(editKey, box.Text, label);
        var panel = FieldCard(label, box, queue);
        layout.Controls.Add(panel);
        layout.SetColumnSpan(panel, 2);
    }

    private Control RivalSelector(int number)
    {
        var row = new TableLayoutPanel { Dock = DockStyle.Top, Height = 38, ColumnCount = 2, BackColor = Ui.Card };
        row.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 72));
        row.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        row.Controls.Add(FieldLabel($"Rival #{number}"), 0, 0);
        var combo = Combo(TeamItems().DefaultIfEmpty("0 - Albany").ToArray());
        if (combo.Items.Count > number) combo.SelectedIndex = Math.Min(number * 2, combo.Items.Count - 1);
        var q = GreenButton("Queue Rival");
        q.Width = 104;
        q.Click += (_, _) => Queue($"rival.{number}", Convert.ToString(combo.SelectedItem) ?? "", $"Rival #{number}");
        var stack = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, BackColor = Ui.Card };
        stack.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        stack.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 112));
        stack.Controls.Add(combo, 0, 0);
        stack.Controls.Add(q, 1, 0);
        row.Controls.Add(stack, 1, 0);
        return row;
    }

    private void AddTableHeader(TableLayoutPanel table, params string[] labels)
    {
        for (var i = 0; i < labels.Length; i++)
        {
            var header = Label(labels[i], 9, FontStyle.Bold, Ui.Text);
            header.Height = 28;
            header.Padding = new Padding(10, 0, 0, 0);
            header.BackColor = Ui.TableHeader;
            table.Controls.Add(header, i, 0);
        }
    }

    private void AddColorRow(TableLayoutPanel table, int rowIndex, ColorSlot slot)
    {
        var row = rowIndex + 1;
        table.RowStyles.Add(new RowStyle(SizeType.Absolute, 34));
        table.Controls.Add(Cell($"{slot.Index}\r\n{slot.Offset}", Ui.Muted), 0, row);
        table.Controls.Add(ColorCell(slot.Hex), 1, row);
        table.Controls.Add(Cell(slot.Hint, Ui.Text), 2, row);
        var input = TextInput(slot.Hex);
        var preview = ColorPreview(ParseHexColor(slot.Hex));
        input.TextChanged += (_, _) => preview.BackColor = ParseHexColor(input.Text);
        var newRgb = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, BackColor = Ui.CardAlt };
        newRgb.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 60));
        newRgb.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 40));
        newRgb.Controls.Add(input, 0, 0);
        newRgb.Controls.Add(preview, 1, 0);
        newRgb.DoubleClick += (_, _) => PickColorInto(input);
        preview.DoubleClick += (_, _) => PickColorInto(input);
        table.Controls.Add(newRgb, 3, row);
        var q = GreenButton("Queue Color");
        q.Click += (_, _) => Queue($"color.{slot.Offset}", input.Text, $"Palette {slot.Offset}");
        table.Controls.Add(q, 4, row);
    }

    private Control SlotCard(RosterSlot slot)
    {
        var card = new RoundedPanel { Width = 246, Height = 112, BackColor = Ui.CardAlt, Padding = new Padding(10), BorderColor = Ui.Border, Margin = new Padding(0, 0, 12, 12) };
        var stack = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 3, ColumnCount = 1, BackColor = Ui.CardAlt };
        stack.RowStyles.Add(new RowStyle(SizeType.Absolute, 24));
        stack.RowStyles.Add(new RowStyle(SizeType.Absolute, 34));
        stack.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        stack.Controls.Add(Label($"Slot {slot.Number}  {slot.Offset}", 8.8f, FontStyle.Regular, Ui.Muted), 0, 0);
        var combo = Combo(slot.PlayerOptions.DefaultIfEmpty(slot.CurrentPlayer).ToArray());
        combo.SelectedItem = combo.Items.Cast<string>().FirstOrDefault(x => x == slot.CurrentPlayer) ?? (combo.Items.Count > 0 ? combo.Items[0] : null);
        stack.Controls.Add(combo, 0, 1);
        var q = GreenButton("Queue");
        q.Width = 78;
        q.Height = 30;
        q.Click += (_, _) => Queue($"slot.{slot.Number}", Convert.ToString(combo.SelectedItem) ?? "", $"Slot {slot.Number}");
        stack.Controls.Add(q, 0, 2);
        card.Controls.Add(stack);
        return card;
    }

    private Control CompactSlot(RosterSlot slot)
    {
        var panel = new Panel { Dock = DockStyle.Top, Height = 70, BackColor = Ui.Card, Padding = new Padding(4), Margin = new Padding(0, 0, 10, 8) };
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 3, ColumnCount = 1, BackColor = Ui.Card };
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 18));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 30));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 22));
        layout.Controls.Add(Label($"Slot {slot.Number} {slot.Offset}", 8.2f, FontStyle.Regular, Ui.Muted), 0, 0);
        layout.Controls.Add(Combo(slot.PlayerOptions.DefaultIfEmpty(slot.CurrentPlayer).ToArray(), slot.CurrentPlayer), 0, 1);
        var q = GreenButton("Queue");
        q.Width = 62;
        q.Height = 22;
        layout.Controls.Add(q, 0, 2);
        panel.Controls.Add(layout);
        return panel;
    }

    private void Queue(string key, string value, string label)
    {
        _queuedEdits.Add(new QueuedEdit(key, value));
        _queuedLabel.Text = $"Queued edits: {_queuedEdits.Count}";
        AppendLog($"[QUEUE] {label}: {value}");
    }

    private async Task RunCliAsync(IEnumerable<string> args)
    {
        var argList = args.ToList();
        if ((argList.Contains("rip") || argList.Contains("build") || argList.Contains("build-copy")) && !argList.Contains("--progress")) argList.Add("--progress");
        AppendLog("> " + _cliPath + " " + string.Join(" ", argList.Select(QuoteArg)));
        _progress.Style = ProgressBarStyle.Marquee;
        _progressText.Text = "Running command...";

        var psi = new ProcessStartInfo
        {
            FileName = _cliPath,
            WorkingDirectory = AppContext.BaseDirectory,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };
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
                var json = line[ProgressPrefix.Length..].Trim();
                var evt = JsonSerializer.Deserialize<ProgressEvent>(json);
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
        _status.Text = (ok ? "✓ " : "") + text;
        _status.ForeColor = ok ? Ui.GoodBright : Ui.Muted;
    }

    private void UpdateFooter()
    {
        _footer.Text = $"Roster File: {Path.GetFileName(_rosterPath.Text)}   |   Team: {Convert.ToString(_teamCombo.SelectedItem) ?? "none"}   |   Game: College Hoops 2K8   |   Platform: PS3   |   Version 1.0.0";
    }

    private static string FindCliPath()
    {
        var baseDir = AppContext.BaseDirectory;
        var candidates = new[]
        {
            Path.Combine(baseDir, "choops-extractor.exe"),
            Path.Combine(baseDir, "..", "dist", "choops-extractor.exe"),
            Path.Combine(Directory.GetCurrentDirectory(), "dist", "choops-extractor.exe"),
            Path.Combine(Directory.GetCurrentDirectory(), "index.js")
        };
        foreach (var candidate in candidates)
        {
            var full = Path.GetFullPath(candidate);
            if (File.Exists(full)) return full.EndsWith(".js", StringComparison.OrdinalIgnoreCase) ? "node" : full;
        }
        return Path.Combine(baseDir, "choops-extractor.exe");
    }

    private static string QuoteArg(string arg) => arg.Contains(' ') ? '"' + arg + '"' : arg;

    private void BrowseFile(TextBox target)
    {
        using var dialog = new OpenFileDialog { Filter = "Roster sources|*.zip;*.iff;*.*|All files|*.*" };
        if (dialog.ShowDialog(this) == DialogResult.OK) target.Text = dialog.FileName;
    }

    private void BrowseFolder(TextBox target)
    {
        using var dialog = new FolderBrowserDialog();
        if (dialog.ShowDialog(this) == DialogResult.OK) target.Text = dialog.SelectedPath;
    }

    private Control PathPicker(TextBox textBox, string buttonText, Action browse)
    {
        StyleTextBox(textBox);
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, BackColor = Color.Transparent };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 92));
        layout.Controls.Add(textBox, 0, 0);
        var button = DarkButton(buttonText);
        button.Click += (_, _) => browse();
        layout.Controls.Add(button, 1, 0);
        return layout;
    }

    private Control LabeledControl(string label, Control control)
    {
        var stack = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 2, ColumnCount = 1, BackColor = Color.Transparent };
        stack.RowStyles.Add(new RowStyle(SizeType.Absolute, 18));
        stack.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        stack.Controls.Add(FieldLabel(label), 0, 0);
        if (control is TextBox tb) StyleTextBox(tb);
        if (control is ComboBox cb) StyleCombo(cb);
        stack.Controls.Add(control, 0, 1);
        return stack;
    }

    private Control FieldCard(string label, Control input, Button queue)
    {
        var card = new RoundedPanel { Dock = DockStyle.Top, Height = 92, BackColor = Ui.CardAlt, Padding = new Padding(10), BorderColor = Ui.Border, Margin = new Padding(0, 0, 12, 12) };
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 3, ColumnCount = 1, BackColor = Ui.CardAlt };
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 20));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 32));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.Controls.Add(FieldLabel(label), 0, 0);
        layout.Controls.Add(input, 0, 1);
        layout.Controls.Add(queue, 0, 2);
        card.Controls.Add(layout);
        return card;
    }

    private Control UniformSwatch(string label, Color jersey, Color trim)
    {
        var panel = new Panel { Height = 70, Dock = DockStyle.Top, BackColor = Ui.Card, Padding = new Padding(8) };
        var title = FieldLabel(label);
        title.Dock = DockStyle.Top;
        var swatch = new Panel { Width = 46, Height = 38, BackColor = Ui.Input, Dock = DockStyle.Left, Margin = new Padding(0, 4, 8, 0) };
        swatch.Paint += (_, e) =>
        {
            using var fill = new SolidBrush(jersey);
            using var pen = new Pen(trim, 3);
            var rect = new Rectangle(12, 5, 22, 28);
            e.Graphics.FillRectangle(fill, rect);
            e.Graphics.DrawRectangle(pen, rect);
        };
        panel.Controls.Add(swatch);
        panel.Controls.Add(title);
        return panel;
    }

    private Control ColorCell(string hex)
    {
        var panel = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, BackColor = Ui.CardAlt, Padding = new Padding(8, 5, 4, 4) };
        panel.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 44));
        panel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        panel.Controls.Add(ColorPreview(ParseHexColor(hex)), 0, 0);
        panel.Controls.Add(Cell(hex, Ui.Text), 1, 0);
        return panel;
    }

    private Control Cell(string text, Color color)
    {
        return new Label { Dock = DockStyle.Fill, Text = text, ForeColor = color, Font = Ui.Font(9f), TextAlign = ContentAlignment.MiddleLeft, Padding = new Padding(8, 0, 0, 0), BackColor = Ui.CardAlt };
    }

    private Panel ColorPreview(Color color)
    {
        var panel = new Panel { Dock = DockStyle.Fill, BackColor = color, Margin = new Padding(4) };
        panel.Paint += (_, e) => DrawBorder(e.Graphics, panel.ClientRectangle, Ui.Border);
        return panel;
    }

    private void PickColorInto(TextBox input)
    {
        using var dialog = new ColorDialog { Color = ParseHexColor(input.Text), FullOpen = true };
        if (dialog.ShowDialog(this) == DialogResult.OK) input.Text = $"{dialog.Color.R:X2}{dialog.Color.G:X2}{dialog.Color.B:X2}FF";
    }

    private static Color ParseHexColor(string value)
    {
        var cleaned = value.Trim().Replace("#", "").Replace("0x", "", StringComparison.OrdinalIgnoreCase);
        if (cleaned.Length >= 6 && int.TryParse(cleaned[..2], System.Globalization.NumberStyles.HexNumber, null, out var r) && int.TryParse(cleaned.Substring(2, 2), System.Globalization.NumberStyles.HexNumber, null, out var g) && int.TryParse(cleaned.Substring(4, 2), System.Globalization.NumberStyles.HexNumber, null, out var b)) return Color.FromArgb(r, g, b);
        return Color.Black;
    }

    private static string SanitizeName(string value)
    {
        foreach (var invalid in Path.GetInvalidFileNameChars()) value = value.Replace(invalid, '_');
        return string.IsNullOrWhiteSpace(value) ? "roster" : value;
    }

    private static Control ScrollHost()
    {
        return new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, WrapContents = false, AutoScroll = true, BackColor = Ui.App, Padding = new Padding(0, 0, 12, 16) };
    }

    private static RoundedPanel Card(string title, string subtitle)
    {
        var card = new RoundedPanel { Dock = DockStyle.Top, AutoSize = true, BackColor = Ui.Card, Padding = new Padding(14), BorderColor = Ui.BlueBorder, Margin = new Padding(0, 0, 12, 12) };
        var head = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, RowCount = 2, ColumnCount = 1, BackColor = Ui.Card };
        head.Controls.Add(Label(title, 13, FontStyle.Bold, Ui.Text), 0, 0);
        if (!string.IsNullOrWhiteSpace(subtitle)) head.Controls.Add(Label(subtitle, 9, FontStyle.Regular, Ui.Muted), 0, 1);
        card.Controls.Add(head);
        return card;
    }

    private static Button PillButton(string text, bool active)
    {
        var button = new Button { Text = text, Height = 36, AutoSize = true, MinimumSize = new Size(92, 36), Padding = new Padding(14, 0, 14, 0), Margin = new Padding(0, 0, 8, 0), FlatStyle = FlatStyle.Flat, BackColor = active ? Ui.ActivePurple : Ui.Tab, ForeColor = Ui.Text, Font = Ui.Font(9.2f, FontStyle.Bold) };
        button.FlatAppearance.BorderColor = active ? Ui.PurpleBorder : Ui.BlueBorder;
        button.FlatAppearance.MouseOverBackColor = Ui.TabHover;
        return button;
    }

    private static Button GreenButton(string text) => StyledButton(text, Ui.Green, Ui.GreenHover, Ui.GreenBorder);
    private static Button GoldButton(string text) => StyledButton(text, Ui.Gold, Ui.GoldHover, Ui.GoldBorder);
    private static Button DarkButton(string text) => StyledButton(text, Ui.DarkButton, Ui.TabHover, Ui.Border);

    private static Button StyledButton(string text, Color back, Color hover, Color border)
    {
        var button = new Button { Text = text, Height = 34, FlatStyle = FlatStyle.Flat, BackColor = back, ForeColor = Ui.Text, Font = Ui.Font(9.2f, FontStyle.Bold), Margin = new Padding(6, 0, 0, 0) };
        button.FlatAppearance.BorderColor = border;
        button.FlatAppearance.MouseOverBackColor = hover;
        return button;
    }

    private static TextBox TextInput(string text = "")
    {
        var box = new TextBox { Text = text, BorderStyle = BorderStyle.FixedSingle, BackColor = Ui.Input, ForeColor = Ui.Text, Font = Ui.Font(9.2f) };
        StyleTextBox(box);
        return box;
    }

    private static ComboBox Combo(string[] values, string? selected = null)
    {
        var combo = new ComboBox { Dock = DockStyle.Fill, DropDownStyle = ComboBoxStyle.DropDownList, BackColor = Ui.Input, ForeColor = Ui.Text, FlatStyle = FlatStyle.Flat, Font = Ui.Font(9f) };
        combo.Items.AddRange(values.Cast<object>().ToArray());
        if (combo.Items.Count > 0) combo.SelectedItem = selected != null && combo.Items.Contains(selected) ? selected : combo.Items[0];
        return combo;
    }

    private static Label Label(string text, float size, FontStyle style, Color color)
    {
        return new Label { Text = text, Dock = DockStyle.Fill, AutoSize = true, ForeColor = color, Font = Ui.Font(size, style), BackColor = Color.Transparent };
    }

    private static Label FieldLabel(string text) => new() { Text = text, Dock = DockStyle.Fill, ForeColor = Ui.Muted, Font = Ui.Font(8.6f), TextAlign = ContentAlignment.BottomLeft, BackColor = Color.Transparent };

    private static void StyleTextBox(TextBox box)
    {
        box.BackColor = Ui.Input;
        box.ForeColor = Ui.Text;
        box.BorderStyle = BorderStyle.FixedSingle;
        box.Font = Ui.Font(9.2f);
    }

    private static void StyleCombo(ComboBox combo)
    {
        combo.BackColor = Ui.Input;
        combo.ForeColor = Ui.Text;
        combo.FlatStyle = FlatStyle.Flat;
        combo.Font = Ui.Font(9.2f);
    }

    private void ApplyBaseControlTheme()
    {
        _teamCombo.SelectedIndexChanged += TeamChanged;
        StyleTextBox(_rosterPath);
        StyleTextBox(_assetPath);
        StyleTextBox(_savePath);
        StyleCombo(_teamCombo);
    }

    private static void DrawBorder(Graphics g, Rectangle rect, Color color)
    {
        using var pen = new Pen(color);
        var r = rect;
        r.Width -= 1;
        r.Height -= 1;
        g.DrawRectangle(pen, r);
    }
}

internal sealed class GradientPanel : Panel
{
    private readonly Color _top;
    private readonly Color _bottom;

    public GradientPanel(Color top, Color bottom)
    {
        _top = top;
        _bottom = bottom;
        DoubleBuffered = true;
    }

    protected override void OnPaintBackground(PaintEventArgs e)
    {
        using var brush = new System.Drawing.Drawing2D.LinearGradientBrush(ClientRectangle, _top, _bottom, 90f);
        e.Graphics.FillRectangle(brush, ClientRectangle);
    }
}

internal sealed class RoundedPanel : Panel
{
    public Color BorderColor { get; set; } = Ui.Border;

    public RoundedPanel()
    {
        DoubleBuffered = true;
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        using var pen = new Pen(BorderColor);
        var rect = ClientRectangle;
        rect.Width -= 1;
        rect.Height -= 1;
        e.Graphics.DrawRectangle(pen, rect);
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
        var columns = ParseLine(header);
        foreach (var col in columns) table.Columns.Add(string.IsNullOrWhiteSpace(col) ? "Column" + table.Columns.Count : col);
        while (!reader.EndOfStream)
        {
            var line = reader.ReadLine() ?? string.Empty;
            var values = ParseLine(line);
            var row = table.NewRow();
            for (var i = 0; i < table.Columns.Count && i < values.Count; i++) row[i] = values[i];
            table.Rows.Add(row);
        }
        return table;
    }

    private static List<string> ParseLine(string line)
    {
        var values = new List<string>();
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
                values.Add(sb.ToString());
                sb.Clear();
            }
            else sb.Append(ch);
        }
        values.Add(sb.ToString());
        return values;
    }
}

internal sealed record QueuedEdit(string Key, string Value);
internal sealed record ColorSlot(int Index, string Offset, string Hex, string Hint);
internal sealed record RosterSlot(int Number, string Offset, string CurrentPlayer, IReadOnlyList<string> PlayerOptions);
internal sealed class ProgressEvent
{
    public string? Phase { get; set; }
    public string? Message { get; set; }
    public int? Percent { get; set; }
}

internal static class Ui
{
    public static readonly Color App = Color.FromArgb(7, 14, 22);
    public static readonly Color HeaderTop = Color.FromArgb(5, 20, 36);
    public static readonly Color HeaderBottom = Color.FromArgb(4, 45, 74);
    public static readonly Color Header = Color.FromArgb(4, 32, 55);
    public static readonly Color Card = Color.FromArgb(17, 30, 43);
    public static readonly Color CardAlt = Color.FromArgb(9, 20, 31);
    public static readonly Color Input = Color.FromArgb(5, 13, 22);
    public static readonly Color TableHeader = Color.FromArgb(24, 49, 72);
    public static readonly Color LogBg = Color.FromArgb(4, 10, 16);
    public static readonly Color Text = Color.FromArgb(244, 250, 255);
    public static readonly Color Muted = Color.FromArgb(142, 164, 184);
    public static readonly Color Ice = Color.FromArgb(104, 209, 255);
    public static readonly Color BlueBorder = Color.FromArgb(0, 119, 190);
    public static readonly Color Border = Color.FromArgb(36, 54, 70);
    public static readonly Color Tab = Color.FromArgb(7, 42, 70);
    public static readonly Color TabHover = Color.FromArgb(15, 66, 102);
    public static readonly Color ActivePurple = Color.FromArgb(121, 77, 232);
    public static readonly Color PurpleBorder = Color.FromArgb(162, 118, 255);
    public static readonly Color Green = Color.FromArgb(31, 145, 63);
    public static readonly Color GreenHover = Color.FromArgb(42, 176, 80);
    public static readonly Color GreenBorder = Color.FromArgb(38, 210, 94);
    public static readonly Color Good = Color.FromArgb(31, 145, 63);
    public static readonly Color GoodBright = Color.FromArgb(80, 245, 126);
    public static readonly Color Gold = Color.FromArgb(176, 121, 0);
    public static readonly Color GoldHover = Color.FromArgb(218, 153, 0);
    public static readonly Color GoldBorder = Color.FromArgb(255, 199, 58);
    public static readonly Color DarkButton = Color.FromArgb(39, 51, 64);
    public static readonly Color LogText = Color.FromArgb(210, 230, 245);

    public static Font Font(float size, FontStyle style = FontStyle.Regular) => new("Segoe UI", size, style);
    public static Font Mono(float size, FontStyle style = FontStyle.Regular) => new("Consolas", size, style);
}
