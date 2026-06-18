using System;
using System.Collections.Generic;
using System.Data;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
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

    private static readonly string[] Tabs =
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
    private readonly Dictionary<string, DataTable> _tables = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, Button> _tabButtons = new(StringComparer.OrdinalIgnoreCase);
    private readonly List<QueuedEdit> _queued = new();

    private readonly TextBox _rosterPath = new();
    private readonly TextBox _assetFolder = new();
    private readonly ComboBox _teamCombo = new() { DropDownStyle = ComboBoxStyle.DropDownList };
    private readonly TextBox _savePath = new();
    private readonly Label _status = new();
    private readonly Label _queuedText = new();
    private readonly Panel _tabs = new();
    private readonly Panel _content = new();
    private readonly RichTextBox _log = new();
    private readonly ProgressBar _progress = new() { Minimum = 0, Maximum = 100 };
    private readonly Label _progressText = new();
    private readonly Label _footer = new();

    private string _activeTab = "Dashboard";
    private string _decodedFolder = string.Empty;

    public MainForm()
    {
        (_cliPath, _devIndexJs) = LocateCli();

        Text = "College Hoops 2K8 Roster Studio";
        Width = 1700;
        Height = 980;
        MinimumSize = new Size(1360, 800);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Theme.App;
        ForeColor = Theme.Text;
        Font = Theme.Font(9.25f);
        DoubleBuffered = true;
        Icon = AppIconFactory.CreateIcon(256);

        ApplyControlTheme();
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
        var root = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 4, ColumnCount = 1, BackColor = Theme.App, Padding = new Padding(10) };
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 128));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 112));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 34));
        root.Controls.Add(BuildHeader(), 0, 0);
        root.Controls.Add(BuildEditorStrip(), 0, 1);
        root.Controls.Add(BuildWorkspace(), 0, 2);

        _footer.Dock = DockStyle.Fill;
        _footer.ForeColor = Theme.Muted;
        _footer.Font = Theme.Font(9f, FontStyle.Bold);
        _footer.TextAlign = ContentAlignment.MiddleLeft;
        _footer.Padding = new Padding(18, 0, 18, 0);
        _footer.Text = "Roster File: none   |   Team: none   |   Game: College Hoops 2K8   |   Platform: PS3   |   Version 1.0.0";
        root.Controls.Add(_footer, 0, 3);
        return root;
    }

    private Control BuildHeader()
    {
        var header = new GlassPanel { Dock = DockStyle.Fill, Padding = new Padding(18, 12, 18, 12), BackColor = Theme.Header, BorderColor = Theme.BlueBorder, Radius = 14 };
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 4, RowCount = 3, BackColor = Color.Transparent };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 110));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 46));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 44));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 150));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 32));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 22));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 44));

        var logo = new BrandBadge { Dock = DockStyle.Fill, Margin = new Padding(0, 0, 16, 0) };
        layout.Controls.Add(logo, 0, 0);
        layout.SetRowSpan(logo, 3);

        var title = new Label { Dock = DockStyle.Fill, Text = "College Hoops 2K8 Roster Studio", Font = Theme.Font(20f, FontStyle.Bold), ForeColor = Theme.Text, TextAlign = ContentAlignment.BottomLeft, BackColor = Color.Transparent };
        layout.Controls.Add(title, 1, 0);
        layout.SetColumnSpan(title, 2);

        _status.Dock = DockStyle.Fill;
        _status.TextAlign = ContentAlignment.MiddleRight;
        _status.ForeColor = Theme.Muted;
        _status.Font = Theme.Font(8.8f, FontStyle.Bold);
        _status.BackColor = Color.Transparent;
        layout.Controls.Add(_status, 3, 0);

        layout.Controls.Add(HeaderLabel("Roster file (.zip / USERDATA / roster_english.iff / raw ROST)"), 1, 1);
        layout.Controls.Add(HeaderLabel("Optional ripped asset folder for uh\\ua\\ux\\s\\m lookup"), 2, 1);

        layout.Controls.Add(PathPicker(_rosterPath, "Browse", () => BrowseFile(_rosterPath)), 1, 2);
        layout.Controls.Add(PathPicker(_assetFolder, "Browse", () => BrowseFolder(_assetFolder)), 2, 2);
        var open = Button("Open Roster", ButtonRole.Success);
        open.Dock = DockStyle.Fill;
        open.Click += async (_, _) => await OpenRosterAsync();
        layout.Controls.Add(open, 3, 2);

        header.Controls.Add(layout);
        return header;
    }

    private Control BuildEditorStrip()
    {
        var outer = new Panel { Dock = DockStyle.Fill, BackColor = Theme.App, Padding = new Padding(8, 10, 8, 0) };
        var strip = new GlassPanel { Dock = DockStyle.Fill, Padding = new Padding(16, 9, 16, 9), BackColor = Theme.Card, BorderColor = Theme.Border, Radius = 14 };
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 3, RowCount = 2, BackColor = Color.Transparent };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 32));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 44));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 24));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 44));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 48));

        _savePath.PlaceholderText = "Example: C:\\CH2K8\\USERDATA_modded";
        layout.Controls.Add(LabeledControl("Team", _teamCombo), 0, 0);
        layout.Controls.Add(LabeledControl("Save output copy path", _savePath), 1, 0);

        var saveStack = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 2, ColumnCount = 1, BackColor = Color.Transparent };
        saveStack.RowStyles.Add(new RowStyle(SizeType.Absolute, 34));
        saveStack.RowStyles.Add(new RowStyle(SizeType.Absolute, 20));
        var save = Button("Save Copy With Queued Edits", ButtonRole.Gold);
        save.Dock = DockStyle.Fill;
        save.Click += (_, _) => MessageBox.Show("Queued edits are staged in the editor. Binary write-back remains guarded until the safety writer is completed.", "Safe queued edits", MessageBoxButtons.OK, MessageBoxIcon.Information);
        _queuedText.Text = "Queued edits: 0";
        _queuedText.Dock = DockStyle.Fill;
        _queuedText.ForeColor = Theme.Muted;
        _queuedText.Font = Theme.Font(8.8f);
        saveStack.Controls.Add(save, 0, 0);
        saveStack.Controls.Add(_queuedText, 0, 1);
        layout.Controls.Add(saveStack, 2, 0);
        layout.SetRowSpan(saveStack, 2);

        _tabs.Dock = DockStyle.Fill;
        _tabs.BackColor = Color.Transparent;
        layout.Controls.Add(_tabs, 0, 1);
        layout.SetColumnSpan(_tabs, 2);
        strip.Controls.Add(layout);
        outer.Controls.Add(strip);
        return outer;
    }

    private Control BuildWorkspace()
    {
        var shell = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 1, BackColor = Theme.App, Padding = new Padding(8, 0, 8, 10) };
        shell.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        shell.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 330));
        _content.Dock = DockStyle.Fill;
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
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 36));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 18));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 34));

        var head = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, BackColor = Color.Transparent };
        head.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        head.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 82));
        head.Controls.Add(Title("Job Log", 13), 0, 0);
        var clear = Button("Clear", ButtonRole.Dark);
        clear.Click += (_, _) => _log.Clear();
        head.Controls.Add(clear, 1, 0);

        _progressText.Text = "Ready";
        _progressText.Dock = DockStyle.Fill;
        _progressText.ForeColor = Theme.Text;
        _progressText.Font = Theme.Font(8.8f, FontStyle.Bold);
        _progressText.TextAlign = ContentAlignment.MiddleLeft;
        _progress.Dock = DockStyle.Fill;
        _log.Dock = DockStyle.Fill;
        _log.BackColor = Theme.LogBg;
        _log.ForeColor = Theme.LogText;
        _log.Font = Theme.Mono(9f);
        _log.BorderStyle = BorderStyle.None;
        _log.ReadOnly = true;

        layout.Controls.Add(head, 0, 0);
        layout.Controls.Add(_progressText, 0, 1);
        layout.Controls.Add(_progress, 0, 2);
        layout.Controls.Add(_log, 0, 3);
        layout.Controls.Add(new Label { Dock = DockStyle.Fill, Text = "Rip/build progress is parsed automatically.", ForeColor = Theme.Muted, Font = Theme.Font(8.5f), TextAlign = ContentAlignment.MiddleLeft, BackColor = Color.Transparent }, 0, 4);
        rail.Controls.Add(layout);
        return rail;
    }

    private void BuildTabs()
    {
        _tabButtons.Clear();
        _tabs.Controls.Clear();
        var flow = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.LeftToRight, WrapContents = false, AutoScroll = true, BackColor = Color.Transparent, Padding = new Padding(0, 4, 0, 0) };
        foreach (var tab in Tabs)
        {
            var button = Button(tab, ButtonRole.Tab);
            button.AutoSize = false;
            button.Height = 40;
            button.Width = tab switch
            {
                "Dashboard" => 124,
                "School" => 104,
                "Spirit" => 104,
                "Colors / Floor / Basket / Cheer" => 286,
                "Roster Slots" => 136,
                "Depth Chart / Rotation" => 190,
                "Assets" => 104,
                "Conferences" => 134,
                "Unknown / Research" => 178,
                _ => 120
            };
            button.Margin = new Padding(0, 0, 8, 0);
            button.Click += (_, _) => ShowTab(tab);
            _tabButtons[tab] = button;
            flow.Controls.Add(button);
        }
        _tabs.Controls.Add(flow);
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

        _content.SuspendLayout();
        _content.Controls.Clear();
        _content.Controls.Add(tab switch
        {
            "Dashboard" => DashboardView(),
            "School" => RequireRoster(SchoolView),
            "Spirit" => RequireRoster(SpiritView),
            "Colors / Floor / Basket / Cheer" => RequireRoster(ColorsView),
            "Roster Slots" => RequireRoster(() => RosterSlotsView(false)),
            "Depth Chart / Rotation" => RequireRoster(() => RosterSlotsView(true)),
            "Assets" => RequireRoster(AssetsView),
            "Conferences" => RequireRoster(() => InfoView("Conferences", "Conference affiliation and prestige editing is disabled until the exact offsets are fully proven.")),
            "Unknown / Research" => ResearchView(),
            _ => DashboardView()
        });
        _content.ResumeLayout(true);
    }

    private Control RequireRoster(Func<Control> viewFactory) => HasRoster ? viewFactory() : EmptyRosterView();

    private bool HasRoster => _tables.TryGetValue("teams", out var teams) && teams.Rows.Count > 0;

    private Control DashboardView()
    {
        var panel = new Panel { Dock = DockStyle.Fill, BackColor = Theme.App, AutoScroll = true };
        var body = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 1, BackColor = Theme.App, Padding = new Padding(0, 0, 10, 10) };
        body.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        body.Controls.Add(CommandCenter(), 0, 0);

        if (!HasRoster)
        {
            body.Controls.Add(EmptyRosterView(), 0, 1);
        }
        else
        {
            var editor = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 3, BackColor = Theme.App };
            editor.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 32));
            editor.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 36));
            editor.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 32));
            editor.Controls.Add(SchoolView(), 0, 0);
            editor.Controls.Add(SpiritView(), 1, 0);
            editor.Controls.Add(AssetsView(), 2, 0);
            editor.Controls.Add(ColorsView(), 0, 1);
            editor.SetColumnSpan(editor.GetControlFromPosition(0, 1)!, 2);
            editor.Controls.Add(RosterSlotsPreview(), 2, 1);
            body.Controls.Add(editor, 0, 1);
        }

        panel.Controls.Add(body);
        return panel;
    }

    private Control CommandCenter()
    {
        var card = Card("Command Center", "Build, rip, cache, and research tools are available here with progress/log output.");
        var grid = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 4, BackColor = Color.Transparent, Padding = new Padding(0, 10, 0, 0) };
        for (var i = 0; i < 4; i++) grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 25));
        grid.Controls.Add(CommandTile("Safe Build Copy", "Copy a JB folder first, then apply a mod folder to the copy.", "Configure", RunBuildCopyAsync), 0, 0);
        grid.Controls.Add(CommandTile("Dynamic Full Rip", "Enhanced rip with progress, manifests, CDF/IFF preservation, and cache support.", "Configure", RunFullRipAsync), 1, 0);
        grid.Controls.Add(CommandTile("Build Cache", "Build the archive lookup cache for a selected game folder/profile.", "Configure", RunBuildCacheAsync), 2, 0);
        grid.Controls.Add(CommandTile("Research Tools", "IFF, CDF, SCNE, reference scan, and probe command reference.", "Open", () => { ShowTab("Unknown / Research"); return Task.CompletedTask; }), 3, 0);
        card.Controls.Add(grid);
        return card;
    }

    private Control CommandTile(string title, string text, string buttonText, Func<Task> action)
    {
        var tile = new GlassPanel { Dock = DockStyle.Top, Height = 132, Margin = new Padding(0, 0, 12, 12), Padding = new Padding(12), BackColor = Theme.CardDeep, BorderColor = Theme.BlueBorder, Radius = 12 };
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 3, ColumnCount = 1, BackColor = Color.Transparent };
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 28));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 34));
        layout.Controls.Add(Title(title, 11), 0, 0);
        layout.Controls.Add(Muted(text), 0, 1);
        var run = Button(buttonText, ButtonRole.Ice);
        run.Click += async (_, _) => await SafeUiAction(action);
        layout.Controls.Add(run, 0, 2);
        tile.Controls.Add(layout);
        return tile;
    }

    private async Task RunBuildCopyAsync()
    {
        var source = PickFolder("Select vanilla JB game folder or USRDIR");
        if (source == null) return;
        var mod = PickFolder("Select mod override folder");
        if (mod == null) return;
        var output = PickFolder("Select output parent/folder for the modded copy");
        if (output == null) return;
        await RunCliAsync(new[] { "build-copy", source, mod, output, "--game-name", "choops2k8" });
    }

    private async Task RunFullRipAsync()
    {
        var source = PickFolder("Select vanilla JB game folder or USRDIR to rip");
        if (source == null) return;
        var output = PickFolder("Select rip output folder");
        if (output == null) return;
        await RunCliAsync(new[] { "rip", source, output, "--build-cache", "--game-name", "choops2k8" });
    }

    private async Task RunBuildCacheAsync()
    {
        var source = PickFolder("Select vanilla JB game folder or USRDIR for cache building");
        if (source == null) return;
        await RunCliAsync(new[] { "build-cache", source, "--game-name", "choops2k8" });
    }

    private Control EmptyRosterView()
    {
        var card = Card("Open a roster to begin", "No roster data is loaded yet. The editor will not invent school, player, palette, or asset values before a real file is decoded.");
        var line = new Label
        {
            Dock = DockStyle.Top,
            Height = 58,
            ForeColor = Theme.Text,
            BackColor = Color.Transparent,
            Font = Theme.Font(10f),
            Text = "Use the top file picker to open a roster ZIP, decrypted USERDATA, roster_english.iff, or raw ROST payload. Once loaded, the school, spirit, palette, roster-slot, and asset tabs populate from decoded CSV tables."
        };
        card.Controls.Add(line);
        return card;
    }

    private Control SchoolView()
    {
        var card = Card("School", "Core school identity fields.");
        var grid = TwoColumnGrid(50, 50);
        AddEditField(grid, "School Name short", TeamValue("short", "team", "school"), "school.short");
        AddEditField(grid, "School Name full", TeamValue("full", "school"), "school.full");
        AddEditField(grid, "Nickname", TeamValue("nickname", "mascot plural", "mascot_plural"), "school.nickname");
        AddEditField(grid, "Abbreviation", TeamValue("abbr", "abbreviation"), "school.abbr");
        AddEditField(grid, "Mascot text", TeamValue("mascot", "mascot name"), "school.mascot", true);
        card.Controls.Add(grid);
        return card;
    }

    private Control SpiritView()
    {
        var card = Card("Spirit", "Student section, Midnight Madness, and rival routing.");
        var grid = TwoColumnGrid(42, 58);
        var left = StackPanel();
        AddEditField(left, "Student Section", TeamValue("student", "student section"), "spirit.student");
        AddEditField(left, "Mid. Madness", TeamValue("midnight", "madness", "event"), "spirit.midnight");
        grid.Controls.Add(left, 0, 0);
        var rivals = StackPanel();
        rivals.Controls.Add(Title("Rivals", 13));
        for (var i = 1; i <= 5; i++) rivals.Controls.Add(RivalRow(i));
        grid.Controls.Add(rivals, 1, 0);
        card.Controls.Add(grid);
        return card;
    }

    private Control AssetsView()
    {
        var card = Card("Assets & Quick Info", "Asset IDs connect teams to uniforms, arenas, logos, and related resource families.");
        var grid = TwoColumnGrid(50, 50);
        AddEditField(grid, "Asset ID (uh/ua/ux/s/m)", TeamValue("asset", "asset_id", "team_index", "index"), "assets.asset");
        AddEditField(grid, "Arena", TeamValue("arena"), "assets.arena");
        AddEditField(grid, "Primary Logo", TeamValue("primary logo", "logo", "primary"), "assets.logo");
        AddEditField(grid, "Alt Logo", TeamValue("alt logo", "alt_logo"), "assets.altLogo");
        grid.Controls.Add(UniformSwatch("Home Uniform", Color.White, Color.Firebrick), 0, 2);
        grid.Controls.Add(UniformSwatch("Away Uniform", Color.FromArgb(24, 27, 34), Color.Firebrick), 1, 2);
        grid.Controls.Add(UniformSwatch("Alternate Uniform", Color.Firebrick, Color.White), 0, 3);
        card.Controls.Add(grid);
        return card;
    }

    private Control ColorsView()
    {
        var slots = ExtractTeamColors();
        if (slots.Count == 0)
        {
            return InfoView("Colors / Floor / Basket / Cheer", "This roster decode did not expose explicit palette_XX_hex columns yet. Re-decode the roster with the latest CLI, then reopen it here.");
        }

        var card = Card("Colors / Floor / Basket / Cheer", "Palette slots are read from explicit palette_XX_hex fields, not guessed from random hex-looking values.");
        var table = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 5, BackColor = Color.Transparent, Padding = new Padding(0, 10, 0, 0) };
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 96));
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 160));
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 250));
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 132));
        AddHeader(table, "Slot", "Current", "Hint", "New RGB", "Action");
        for (var i = 0; i < slots.Count; i++) AddColorRow(table, i, slots[i]);
        card.Controls.Add(InfoLine("Double-click a color preview to open the native color picker. Queue Color stages the slot for safe write-back testing."));
        card.Controls.Add(table);
        return card;
    }

    private Control RosterSlotsView(bool rotation)
    {
        var slots = CurrentSlots().ToList();
        if (slots.Count == 0) return InfoView(rotation ? "Depth Chart / Rotation" : "Roster Slots", "No roster slot table was found in this decode.");
        var card = Card(rotation ? "Depth Chart / Rotation" : "Roster Slots", rotation ? "Use roster slots as a rotation planning surface." : "Assign players to the 16 roster slots with readable dropdown cards.");
        var flow = new FlowLayoutPanel { Dock = DockStyle.Top, AutoSize = true, WrapContents = true, BackColor = Color.Transparent, Padding = new Padding(0, 10, 0, 0) };
        foreach (var slot in slots.Take(16)) flow.Controls.Add(SlotCard(slot, false));
        card.Controls.Add(flow);
        return card;
    }

    private Control RosterSlotsPreview()
    {
        var card = Card("Roster Slots Preview", "First eight roster slots for quick review.");
        var grid = TwoColumnGrid(50, 50);
        var slots = CurrentSlots().Take(8).ToList();
        for (var i = 0; i < slots.Count; i++) grid.Controls.Add(SlotCard(slots[i], true), i % 2, i / 2);
        card.Controls.Add(grid);
        return card;
    }

    private Control ResearchView()
    {
        var panel = new Panel { Dock = DockStyle.Fill, BackColor = Theme.App, AutoScroll = true };
        var body = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 1, BackColor = Theme.App, Padding = new Padding(0, 0, 10, 10) };
        body.Controls.Add(InfoView("Unknown / Research", "Raw fields and candidate offsets are read-only until controlled roster diffs prove exact offsets."), 0, 0);
        body.Controls.Add(CommandReference(), 0, 1);
        panel.Controls.Add(body);
        return panel;
    }

    private Control CommandReference()
    {
        var card = Card("Research command reference", "Commands visible here are available in the CLI backend.");
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
        var stack = StackPanel();
        foreach (var command in commands)
        {
            stack.Controls.Add(new Label { Text = command, AutoSize = false, Width = 980, Height = 30, ForeColor = Theme.Text, Font = Theme.Mono(9.5f), BackColor = Theme.CardDeep, Padding = new Padding(8, 6, 8, 0), Margin = new Padding(0, 0, 0, 6) });
        }
        card.Controls.Add(stack);
        return card;
    }

    private Control InfoView(string title, string message)
    {
        var card = Card(title, message);
        card.Controls.Add(InfoLine("This panel is intentionally conservative. Unknown fields are not write-enabled until they are proven safe."));
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
            var id = FirstCell(row, "team_index", "index", "id");
            var name = FirstCell(row, "school_name_short", "school", "team", "name");
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
            var id = FirstCell(row, "team_index", "index", "id");
            if (!string.IsNullOrWhiteSpace(id) && id == selectedId) return row;
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
        var selected = Convert.ToString(_teamCombo.SelectedItem) ?? "No team loaded";
        return selected.Contains('-') ? selected[(selected.IndexOf('-') + 1)..].Trim() : selected;
    }

    private List<ColorSlot> ExtractTeamColors()
    {
        var output = new List<ColorSlot>();
        var row = CurrentTeamRow();
        if (row == null) return output;
        for (var i = 0; i < 31; i++)
        {
            var hexCol = $"palette_{i:00}_hex";
            var offsetCol = $"palette_{i:00}_offset";
            if (!row.Table.Columns.Contains(hexCol)) continue;
            var hex = NormalizeHex(Convert.ToString(row[hexCol]) ?? string.Empty);
            if (hex == null) continue;
            var offset = row.Table.Columns.Contains(offsetCol) ? Convert.ToString(row[offsetCol]) ?? $"+0x{0x1A0 + i * 4:X}" : $"+0x{0x1A0 + i * 4:X}";
            output.Add(new ColorSlot(i, offset, hex, PaletteHint(i)));
        }
        return output;
    }

    private IEnumerable<RosterSlot> CurrentSlots()
    {
        if (!_tables.TryGetValue("roster_slots", out var slots) || slots.Rows.Count == 0) yield break;
        var players = PlayerItems().ToList();
        var selectedId = (Convert.ToString(_teamCombo.SelectedItem) ?? "0").Split('-').FirstOrDefault()?.Trim() ?? "0";
        var rows = slots.Rows.Cast<DataRow>().Where(r => RowMatchesTeam(r, selectedId)).Take(16).ToList();
        if (rows.Count == 0) rows = slots.Rows.Cast<DataRow>().Take(16).ToList();
        for (var i = 0; i < rows.Count; i++)
        {
            var value = FirstCell(rows[i], "player", "name", "player_name", "player_id", "id");
            if (string.IsNullOrWhiteSpace(value) && i < players.Count) value = players[i];
            yield return new RosterSlot(i + 1, $"+0x{0x6C + i * 4:X}", value, players);
        }
    }

    private bool RowMatchesTeam(DataRow row, string teamId)
    {
        foreach (DataColumn col in row.Table.Columns)
        {
            if (!col.ColumnName.Contains("team", StringComparison.OrdinalIgnoreCase)) continue;
            if ((Convert.ToString(row[col]) ?? string.Empty).Trim() == teamId) return true;
        }
        return false;
    }

    private IEnumerable<string> PlayerItems()
    {
        if (!_tables.TryGetValue("players", out var players)) yield break;
        foreach (DataRow row in players.Rows)
        {
            var id = FirstCell(row, "player_id", "id", "index");
            var first = FirstCell(row, "first_name", "first");
            var last = FirstCell(row, "last_name", "last");
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
        return string.Empty;
    }

    private void AddEditField(Control parent, string label, string value, string editKey, bool wide = false)
    {
        var box = TextInput(value);
        var queue = Button("Queue", ButtonRole.Success);
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

    private Control FieldCard(string label, Control input, Button action)
    {
        var card = new GlassPanel { Dock = DockStyle.Top, Height = 92, Margin = new Padding(0, 0, 12, 12), Padding = new Padding(10), BackColor = Theme.CardDeep, BorderColor = Theme.Border, Radius = 12 };
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 3, ColumnCount = 1, BackColor = Color.Transparent };
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 20));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 32));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.Controls.Add(FieldLabel(label), 0, 0);
        layout.Controls.Add(input, 0, 1);
        layout.Controls.Add(action, 0, 2);
        card.Controls.Add(layout);
        return card;
    }

    private Control RivalRow(int number)
    {
        var row = new TableLayoutPanel { Width = 520, Height = 38, ColumnCount = 3, BackColor = Color.Transparent, Margin = new Padding(0, 0, 0, 8) };
        row.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 82));
        row.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        row.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 112));
        row.Controls.Add(FieldLabel($"Rival #{number}"), 0, 0);
        var combo = Combo(TeamItems().DefaultIfEmpty("0 - Unknown").ToArray());
        if (combo.Items.Count > number) combo.SelectedIndex = Math.Min(number * 2, combo.Items.Count - 1);
        row.Controls.Add(combo, 1, 0);
        var queue = Button("Queue Rival", ButtonRole.Success);
        queue.Click += (_, _) => Queue($"rival.{number}", Convert.ToString(combo.SelectedItem) ?? string.Empty, $"Rival #{number}");
        row.Controls.Add(queue, 2, 0);
        return row;
    }

    private void AddHeader(TableLayoutPanel table, params string[] headers)
    {
        for (var i = 0; i < headers.Length; i++)
        {
            table.Controls.Add(new Label { Dock = DockStyle.Fill, Text = headers[i], Font = Theme.Font(9f, FontStyle.Bold), ForeColor = Theme.Text, BackColor = Theme.TableHeader, TextAlign = ContentAlignment.MiddleLeft, Padding = new Padding(10, 0, 0, 0) }, i, 0);
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
        var queue = Button("Queue Color", ButtonRole.Success);
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
        var queue = Button("Queue", ButtonRole.Success);
        queue.Width = 76;
        queue.Height = compact ? 24 : 30;
        queue.Click += (_, _) => Queue($"slot.{slot.Number}", Convert.ToString(combo.SelectedItem) ?? string.Empty, $"Slot {slot.Number}");
        layout.Controls.Add(queue, 0, 2);
        card.Controls.Add(layout);
        return card;
    }

    private Control UniformSwatch(string label, Color jersey, Color trim)
    {
        var panel = new GlassPanel { Height = 72, Dock = DockStyle.Top, BackColor = Theme.CardDeep, BorderColor = Theme.Border, Radius = 12, Padding = new Padding(10), Margin = new Padding(0, 0, 12, 12) };
        var text = FieldLabel(label);
        text.Dock = DockStyle.Top;
        var swatch = new Panel { Width = 52, Dock = DockStyle.Left, BackColor = Theme.Input, Margin = new Padding(0, 4, 8, 0) };
        swatch.Paint += (_, e) =>
        {
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            using var fill = new SolidBrush(jersey);
            using var pen = new Pen(trim, 3);
            var rect = new Rectangle(14, 9, 24, 30);
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
        panel.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 44));
        panel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        panel.Controls.Add(ColorPreview(ParseHex(hex)), 0, 0);
        panel.Controls.Add(TableCell(hex, Theme.Text), 1, 0);
        return panel;
    }

    private Control ColorPreview(Color color)
    {
        var panel = new Panel { Dock = DockStyle.Fill, BackColor = color, Margin = new Padding(4) };
        panel.Paint += (_, e) => e.Graphics.DrawRectangle(new Pen(Theme.Border), 0, 0, panel.Width - 1, panel.Height - 1);
        return panel;
    }

    private Control TableCell(string text, Color color) => new Label { Dock = DockStyle.Fill, Text = text, ForeColor = color, Font = Theme.Font(9f), TextAlign = ContentAlignment.MiddleLeft, Padding = new Padding(8, 0, 0, 0), BackColor = Theme.CardDeep };

    private void Queue(string key, string value, string label)
    {
        _queued.Add(new QueuedEdit(key, value));
        _queuedText.Text = $"Queued edits: {_queued.Count}";
        AppendLog($"[QUEUE] {label}: {value}");
    }

    private async Task SafeUiAction(Func<Task> action)
    {
        try { await action(); }
        catch (Exception ex)
        {
            AppendLog("[ERROR] " + ex.Message);
            MessageBox.Show(ex.Message, "CHoops Tool Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private async Task RunCliAsync(IEnumerable<string> args)
    {
        var list = args.ToList();
        var command = list.FirstOrDefault() ?? string.Empty;
        if ((command is "rip" or "build" or "build-copy") && !list.Contains("--progress")) list.Add("--progress");
        AppendLog("> " + (_devIndexJs == null ? _cliPath : "node " + _devIndexJs) + " " + string.Join(" ", list.Select(Quote)));
        _progress.Style = ProgressBarStyle.Marquee;
        _progressText.Text = "Running...";

        var psi = new ProcessStartInfo
        {
            FileName = _devIndexJs == null ? _cliPath : "node",
            WorkingDirectory = Directory.GetCurrentDirectory(),
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };
        if (_devIndexJs != null) psi.ArgumentList.Add(_devIndexJs);
        foreach (var arg in list) psi.ArgumentList.Add(arg);

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
                var evt = JsonSerializer.Deserialize<ProgressEvent>(line[ProgressPrefix.Length..].Trim(), new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                if (evt != null && !IsDisposed) BeginInvoke(() => ApplyProgress(evt));
            }
            catch { }
            return;
        }
        if (!IsDisposed) BeginInvoke(() => AppendLog((error ? "[ERR] " : string.Empty) + line));
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
        _status.Text = (ok ? "Roster loaded." : text);
        _status.ForeColor = ok ? Theme.GoodBright : Theme.Muted;
    }

    private void UpdateFooter()
    {
        _footer.Text = $"Roster File: {Path.GetFileName(_rosterPath.Text)}   |   Team: {Convert.ToString(_teamCombo.SelectedItem) ?? "none"}   |   Game: College Hoops 2K8   |   Platform: PS3   |   Version 1.0.0";
    }

    private string? PickFolder(string description)
    {
        using var dialog = new FolderBrowserDialog { Description = description };
        return dialog.ShowDialog(this) == DialogResult.OK ? dialog.SelectedPath : null;
    }

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

    private Control PathPicker(TextBox box, string buttonText, Action browse)
    {
        box.Dock = DockStyle.Fill;
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, BackColor = Color.Transparent };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 86));
        layout.Controls.Add(box, 0, 0);
        var button = Button(buttonText, ButtonRole.Dark);
        button.Dock = DockStyle.Fill;
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
        control.Dock = DockStyle.Fill;
        stack.Controls.Add(control, 0, 1);
        return stack;
    }

    private static TwoColumnPanel TwoColumnGrid(int left, int right)
    {
        var grid = new TwoColumnPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 2, BackColor = Color.Transparent, Padding = new Padding(0, 10, 0, 0) };
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, left));
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, right));
        return grid;
    }

    private static FlowLayoutPanel StackPanel() => new() { Dock = DockStyle.Top, AutoSize = true, FlowDirection = FlowDirection.TopDown, WrapContents = false, BackColor = Color.Transparent };

    private static GlassPanel Card(string title, string subtitle)
    {
        var card = new GlassPanel { Dock = DockStyle.Top, AutoSize = true, Margin = new Padding(0, 0, 12, 12), Padding = new Padding(14), BackColor = Theme.Card, BorderColor = Theme.BlueBorder, Radius = 14 };
        var head = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, RowCount = 2, ColumnCount = 1, BackColor = Color.Transparent };
        head.Controls.Add(Title(title, 14), 0, 0);
        if (!string.IsNullOrWhiteSpace(subtitle)) head.Controls.Add(Muted(subtitle), 0, 1);
        card.Controls.Add(head);
        return card;
    }

    private static Label Title(string text, float size) => new() { Dock = DockStyle.Fill, AutoSize = true, Text = text, ForeColor = Theme.Text, Font = Theme.Font(size, FontStyle.Bold), BackColor = Color.Transparent };
    private static Label Muted(string text) => new() { Dock = DockStyle.Fill, AutoSize = true, Text = text, ForeColor = Theme.Muted, Font = Theme.Font(9f), BackColor = Color.Transparent };
    private static Label HeaderLabel(string text) => new() { Dock = DockStyle.Fill, Text = text, ForeColor = Theme.Muted, Font = Theme.Font(8.8f), TextAlign = ContentAlignment.BottomLeft, BackColor = Color.Transparent };
    private static Label FieldLabel(string text) => new() { Dock = DockStyle.Fill, Text = text, ForeColor = Theme.Muted, Font = Theme.Font(8.5f), TextAlign = ContentAlignment.BottomLeft, BackColor = Color.Transparent };
    private static Label InfoLine(string text) => new() { Dock = DockStyle.Top, AutoSize = true, Text = text, ForeColor = Theme.Muted, Font = Theme.Font(9f), BackColor = Color.Transparent, Padding = new Padding(0, 8, 0, 0) };

    private static TextBox TextInput(string text = "")
    {
        var box = new TextBox { Text = text, BackColor = Theme.Input, ForeColor = Theme.Text, BorderStyle = BorderStyle.FixedSingle, Font = Theme.Font(9.2f) };
        return box;
    }

    private static ComboBox Combo(string[] values, string? selected = null)
    {
        var combo = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, BackColor = Theme.Input, ForeColor = Theme.Text, FlatStyle = FlatStyle.Flat, Font = Theme.Font(9.2f), Dock = DockStyle.Fill };
        combo.Items.AddRange(values.Cast<object>().ToArray());
        if (combo.Items.Count > 0) combo.SelectedItem = selected != null && combo.Items.Contains(selected) ? selected : combo.Items[0];
        return combo;
    }

    private static Button Button(string text, ButtonRole role)
    {
        var (back, hover, border) = role switch
        {
            ButtonRole.Success => (Theme.Green, Theme.GreenHover, Theme.GreenBorder),
            ButtonRole.Gold => (Theme.Gold, Theme.GoldHover, Theme.GoldBorder),
            ButtonRole.Ice => (Theme.IceButton, Theme.IceButtonHover, Theme.BlueBorder),
            ButtonRole.Tab => (Theme.Tab, Theme.TabHover, Theme.BlueBorder),
            _ => (Theme.DarkButton, Theme.TabHover, Theme.Border)
        };
        var button = new Button { Text = text, Height = 32, FlatStyle = FlatStyle.Flat, BackColor = back, ForeColor = Theme.Text, Font = Theme.Font(9f, FontStyle.Bold), TextAlign = ContentAlignment.MiddleCenter };
        button.FlatAppearance.BorderColor = border;
        button.FlatAppearance.MouseOverBackColor = hover;
        button.FlatAppearance.MouseDownBackColor = hover;
        return button;
    }

    private void ApplyControlTheme()
    {
        foreach (var box in new[] { _rosterPath, _assetFolder, _savePath })
        {
            box.BackColor = Theme.Input;
            box.ForeColor = Theme.Text;
            box.BorderStyle = BorderStyle.FixedSingle;
            box.Font = Theme.Font(9.2f);
        }
        _teamCombo.BackColor = Theme.Input;
        _teamCombo.ForeColor = Theme.Text;
        _teamCombo.FlatStyle = FlatStyle.Flat;
    }

    private void PickColorInto(TextBox input)
    {
        using var dialog = new ColorDialog { Color = ParseHex(input.Text), FullOpen = true };
        if (dialog.ShowDialog(this) == DialogResult.OK) input.Text = $"{dialog.Color.R:X2}{dialog.Color.G:X2}{dialog.Color.B:X2}FF";
    }

    private static Color ParseHex(string value)
    {
        var hex = NormalizeHex(value);
        if (hex == null) return Color.Black;
        var r = Convert.ToInt32(hex[..2], 16);
        var g = Convert.ToInt32(hex.Substring(2, 2), 16);
        var b = Convert.ToInt32(hex.Substring(4, 2), 16);
        return Color.FromArgb(r, g, b);
    }

    private static string? NormalizeHex(string value)
    {
        var cleaned = value.Trim().Replace("#", "").Replace("0x", "", StringComparison.OrdinalIgnoreCase);
        if (cleaned.Length == 8) cleaned = cleaned[..6] + cleaned.Substring(6, 2);
        if (cleaned.Length == 6) cleaned += "FF";
        if (cleaned.Length != 8) return null;
        return cleaned.All(Uri.IsHexDigit) ? cleaned.ToUpperInvariant() : null;
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

    private static string Sanitize(string value)
    {
        foreach (var c in Path.GetInvalidFileNameChars()) value = value.Replace(c, '_');
        return string.IsNullOrWhiteSpace(value) ? "roster" : value;
    }

    private static string Quote(string arg) => arg.Contains(' ') ? '"' + arg + '"' : arg;

    private static (string Cli, string? DevIndex) LocateCli()
    {
        var baseDir = AppContext.BaseDirectory;
        var current = Directory.GetCurrentDirectory();
        var cliCandidates = new[]
        {
            Path.Combine(baseDir, "choops-extractor.exe"),
            Path.Combine(current, "release", "choops-extractor.exe"),
            Path.Combine(current, "dist", "choops-extractor.exe")
        };
        foreach (var cli in cliCandidates)
        {
            var full = Path.GetFullPath(cli);
            if (File.Exists(full)) return (full, null);
        }
        var index = Path.Combine(current, "index.js");
        if (File.Exists(index)) return ("node", index);
        return (Path.Combine(baseDir, "choops-extractor.exe"), null);
    }
}

internal enum ButtonRole { Dark, Success, Gold, Ice, Tab }
internal sealed record QueuedEdit(string Key, string Value);
internal sealed record ColorSlot(int Index, string Offset, string Hex, string Hint);
internal sealed record RosterSlot(int Number, string Offset, string CurrentPlayer, IReadOnlyList<string> PlayerOptions);
internal sealed class ProgressEvent
{
    public string? Phase { get; set; }
    public string? Message { get; set; }
    public int? Percent { get; set; }
}

internal sealed class TwoColumnPanel : TableLayoutPanel { }

internal sealed class BrandBadge : Control
{
    public BrandBadge()
    {
        DoubleBuffered = true;
        MinimumSize = new Size(92, 92);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        AppIconFactory.DrawBadge(e.Graphics, ClientRectangle, true);
    }
}

internal sealed class GlassPanel : Panel
{
    public Color BorderColor { get; set; } = Theme.Border;
    public int Radius { get; set; } = 10;

    public GlassPanel()
    {
        DoubleBuffered = true;
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        var rect = ClientRectangle;
        rect.Width -= 1;
        rect.Height -= 1;
        using var path = Drawing.RoundRect(rect, Radius);
        using var pen = new Pen(BorderColor);
        e.Graphics.DrawPath(pen, path);
    }
}

internal static class AppIconFactory
{
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool DestroyIcon(IntPtr hIcon);

    public static Icon CreateIcon(int size)
    {
        using var bitmap = new Bitmap(size, size, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(bitmap)) DrawBadge(g, new Rectangle(0, 0, size, size), false);
        var handle = bitmap.GetHicon();
        try
        {
            using var temp = Icon.FromHandle(handle);
            return (Icon)temp.Clone();
        }
        finally
        {
            DestroyIcon(handle);
        }
    }

    public static void DrawBadge(Graphics g, Rectangle bounds, bool includeWordmark)
    {
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
        var size = Math.Min(bounds.Width, bounds.Height);
        var x = bounds.Left + (bounds.Width - size) / 2;
        var y = bounds.Top + (bounds.Height - size) / 2;
        var r = new Rectangle(x + size / 18, y + size / 18, size - size / 9, size - size / 9);

        using var bg = new LinearGradientBrush(r, Color.FromArgb(6, 19, 35), Color.FromArgb(5, 58, 96), 90f);
        using var path = Drawing.RoundRect(r, size / 7);
        g.FillPath(bg, path);
        using var edge = new Pen(Color.FromArgb(235, 192, 78), Math.Max(3, size / 26f));
        using var ice = new Pen(Color.FromArgb(120, 220, 255), Math.Max(2, size / 52f));
        g.DrawPath(edge, path);

        var ball = new RectangleF(r.Left + r.Width * .18f, r.Top + r.Height * .10f, r.Width * .64f, r.Height * .40f);
        using var ballFill = new LinearGradientBrush(ball, Color.FromArgb(220, 123, 20), Color.FromArgb(88, 36, 7), 90f);
        g.FillEllipse(ballFill, ball);
        g.DrawEllipse(edge, ball.X, ball.Y, ball.Width, ball.Height);
        using var seam = new Pen(Color.FromArgb(250, 243, 225), Math.Max(2, size / 48f)) { StartCap = LineCap.Round, EndCap = LineCap.Round };
        g.DrawArc(seam, ball, 198, 144);
        g.DrawArc(seam, ball, 18, 144);
        g.DrawLine(seam, ball.Left + ball.Width / 2, ball.Top + 2, ball.Left + ball.Width / 2, ball.Bottom - 2);

        using var inner = Drawing.RoundRect(new RectangleF(r.Left + r.Width * .12f, r.Top + r.Height * .12f, r.Width * .76f, r.Height * .76f), size / 10f);
        g.DrawPath(ice, inner);

        DrawText(g, "CH", new RectangleF(r.Left, r.Top + r.Height * .46f, r.Width * .58f, r.Height * .27f), Color.White, size * .28f, "Segoe UI Black");
        DrawText(g, "2K", new RectangleF(r.Left + r.Width * .52f, r.Top + r.Height * .47f, r.Width * .42f, r.Height * .26f), Color.FromArgb(235, 189, 72), size * .24f, "Segoe UI Black");
        if (includeWordmark) DrawText(g, "REBORN", new RectangleF(r.Left, r.Top + r.Height * .74f, r.Width, r.Height * .12f), Color.FromArgb(120, 220, 255), size * .072f, "Segoe UI Semibold");
    }

    private static void DrawText(Graphics g, string text, RectangleF rect, Color color, float px, string family)
    {
        using var font = new Font(family, px, FontStyle.Bold, GraphicsUnit.Pixel);
        using var brush = new SolidBrush(color);
        using var format = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
        g.DrawString(text, font, brush, rect, format);
    }
}

internal static class Drawing
{
    public static GraphicsPath RoundRect(Rectangle rect, float radius) => RoundRect(new RectangleF(rect.X, rect.Y, rect.Width, rect.Height), radius);

    public static GraphicsPath RoundRect(RectangleF rect, float radius)
    {
        var path = new GraphicsPath();
        var d = radius * 2;
        path.AddArc(rect.Left, rect.Top, d, d, 180, 90);
        path.AddArc(rect.Right - d, rect.Top, d, d, 270, 90);
        path.AddArc(rect.Right - d, rect.Bottom - d, d, d, 0, 90);
        path.AddArc(rect.Left, rect.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
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
        foreach (var column in Parse(header)) table.Columns.Add(string.IsNullOrWhiteSpace(column) ? "Column" + table.Columns.Count : column);
        while (!reader.EndOfStream)
        {
            var values = Parse(reader.ReadLine() ?? string.Empty);
            var row = table.NewRow();
            for (var i = 0; i < table.Columns.Count && i < values.Count; i++) row[i] = values[i];
            table.Rows.Add(row);
        }
        return table;
    }

    private static List<string> Parse(string line)
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

internal static class Theme
{
    public static readonly Color App = Color.FromArgb(4, 11, 18);
    public static readonly Color Header = Color.FromArgb(4, 35, 61);
    public static readonly Color HeaderTop = Color.FromArgb(3, 22, 39);
    public static readonly Color HeaderBottom = Color.FromArgb(4, 54, 88);
    public static readonly Color Card = Color.FromArgb(11, 35, 55);
    public static readonly Color CardDeep = Color.FromArgb(5, 18, 30);
    public static readonly Color Input = Color.FromArgb(4, 12, 20);
    public static readonly Color TableHeader = Color.FromArgb(24, 58, 84);
    public static readonly Color LogBg = Color.FromArgb(3, 9, 15);
    public static readonly Color Text = Color.FromArgb(246, 251, 255);
    public static readonly Color Muted = Color.FromArgb(144, 169, 190);
    public static readonly Color LogText = Color.FromArgb(215, 232, 245);
    public static readonly Color Border = Color.FromArgb(39, 65, 85);
    public static readonly Color BlueBorder = Color.FromArgb(0, 125, 194);
    public static readonly Color IceDark = Color.FromArgb(40, 139, 180);
    public static readonly Color Purple = Color.FromArgb(120, 76, 230);
    public static readonly Color PurpleBorder = Color.FromArgb(165, 123, 255);
    public static readonly Color Tab = Color.FromArgb(8, 55, 88);
    public static readonly Color TabHover = Color.FromArgb(14, 76, 116);
    public static readonly Color Green = Color.FromArgb(30, 145, 65);
    public static readonly Color GreenHover = Color.FromArgb(42, 178, 84);
    public static readonly Color GreenBorder = Color.FromArgb(74, 234, 122);
    public static readonly Color GoodBright = Color.FromArgb(80, 245, 126);
    public static readonly Color Gold = Color.FromArgb(188, 128, 0);
    public static readonly Color GoldHover = Color.FromArgb(226, 160, 15);
    public static readonly Color GoldBorder = Color.FromArgb(255, 200, 58);
    public static readonly Color IceButton = Color.FromArgb(24, 111, 164);
    public static readonly Color IceButtonHover = Color.FromArgb(37, 141, 206);
    public static readonly Color DarkButton = Color.FromArgb(37, 53, 68);

    public static Font Font(float size, FontStyle style = FontStyle.Regular) => new("Segoe UI", size, style);
    public static Font Mono(float size, FontStyle style = FontStyle.Regular) => new("Consolas", size, style);
}
