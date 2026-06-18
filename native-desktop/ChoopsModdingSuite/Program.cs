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
    private static readonly string[] GameProfiles = { "choops2k8", "nba2k8", "apf2k8", "nhl2k8", "mlb2k8", "nba2k9", "default" };
    private static readonly Regex HexColorPattern = new("^(#|0x)?[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$", RegexOptions.Compiled);

    private readonly string _cliPath;
    private readonly Panel _contentHost = new() { Dock = DockStyle.Fill, BackColor = Ui.Bg };
    private readonly Label _sectionTitle = new() { AutoSize = true, Font = Ui.Font(22, FontStyle.Bold), ForeColor = Ui.White };
    private readonly Label _sectionSubtitle = new() { AutoSize = true, MaximumSize = new Size(880, 0), Font = Ui.Font(10.5f), ForeColor = Ui.Muted };
    private readonly RichTextBox _log = new() { Dock = DockStyle.Fill, ReadOnly = true, BorderStyle = BorderStyle.None, Font = Ui.Mono(9f), BackColor = Ui.LogBg, ForeColor = Ui.LogText, DetectUrls = false };
    private readonly ProgressBar _progressBar = new() { Dock = DockStyle.Fill, Minimum = 0, Maximum = 100, Value = 0, Style = ProgressBarStyle.Continuous };
    private readonly Label _progressLabel = new() { Dock = DockStyle.Fill, Text = "Ready", AutoEllipsis = true, ForeColor = Ui.White, Font = Ui.Font(9.5f, FontStyle.Bold), TextAlign = ContentAlignment.MiddleLeft };
    private readonly Label _progressPercent = new() { Dock = DockStyle.Right, Width = 46, Text = "0%", ForeColor = Ui.Ice, Font = Ui.Font(9.5f, FontStyle.Bold), TextAlign = ContentAlignment.MiddleRight };
    private readonly Dictionary<string, Button> _navButtons = new(StringComparer.OrdinalIgnoreCase);

    private TextBox? _rosterSourcePath;
    private TextBox? _rosterOutputPath;
    private TextBox? _rosterSearch;
    private Label? _rosterBanner;
    private Label? _selectedTeamLabel;
    private TabControl? _rosterTabControl;
    private readonly Dictionary<string, DataTable> _rosterTables = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, BindingSource> _rosterBindings = new(StringComparer.OrdinalIgnoreCase);
    private readonly List<PaletteSlot> _paletteSlots = new();

    public MainForm()
    {
        _cliPath = FindCliPath();

        Text = "CHoops Native Modding Suite";
        Width = 1520;
        Height = 940;
        MinimumSize = new Size(1240, 760);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Ui.Bg;
        ForeColor = Ui.White;
        Font = Ui.Font(9.5f);

        Controls.Add(BuildShell());
        ShowSection("dashboard");

        AppendLog("CHoops Native Modding Suite ready.");
        AppendLog($"CLI backend: {_cliPath}");
        AppendLog("Native icy-blue UI loaded. No Chrome, browser, Electron, or webview is used.");
    }

    private Control BuildShell()
    {
        var root = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 2, ColumnCount = 1, BackColor = Ui.Bg };
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 84));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        root.Controls.Add(BuildHeader(), 0, 0);

        var body = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 3, RowCount = 1, Padding = new Padding(12, 10, 12, 12), BackColor = Ui.Bg };
        body.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 236));
        body.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        body.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 390));
        body.Controls.Add(BuildSidebar(), 0, 0);
        body.Controls.Add(BuildMainArea(), 1, 0);
        body.Controls.Add(BuildLogPanel(), 2, 0);
        root.Controls.Add(body, 0, 1);
        return root;
    }

    private Control BuildHeader()
    {
        var panel = new Panel { Dock = DockStyle.Fill, BackColor = Ui.Header, Padding = new Padding(18, 10, 18, 10) };
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 1, BackColor = Ui.Header };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 420));

        var titleStack = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 2, ColumnCount = 1, BackColor = Ui.Header };
        titleStack.RowStyles.Add(new RowStyle(SizeType.Absolute, 36));
        titleStack.RowStyles.Add(new RowStyle(SizeType.Absolute, 28));
        titleStack.Controls.Add(new Label { Text = "CHoops Native Modding Suite", Dock = DockStyle.Fill, Font = Ui.Font(23, FontStyle.Bold), ForeColor = Ui.White, TextAlign = ContentAlignment.BottomLeft }, 0, 0);
        titleStack.Controls.Add(new Label { Text = "College Hoops 2K8 PS3 toolkit • safe JB-folder builds • rosters • IFF/CDF research", Dock = DockStyle.Fill, Font = Ui.Font(10.5f), ForeColor = Ui.Muted, TextAlign = ContentAlignment.TopLeft }, 0, 1);

        var badges = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.RightToLeft, WrapContents = false, BackColor = Ui.Header, Padding = new Padding(0, 14, 0, 0) };
        badges.Controls.Add(Badge("Native WinForms", Ui.IceDark));
        badges.Controls.Add(Badge("No browser", Ui.DeepBlue));
        badges.Controls.Add(Badge("Preserve-first", Ui.Good));

        layout.Controls.Add(titleStack, 0, 0);
        layout.Controls.Add(badges, 1, 0);
        panel.Controls.Add(layout);
        return panel;
    }

    private Control BuildSidebar()
    {
        var sidebar = new Panel { Dock = DockStyle.Fill, BackColor = Ui.Sidebar, Padding = new Padding(12) };
        var stack = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, WrapContents = false, AutoScroll = true, BackColor = Ui.Sidebar };

        stack.Controls.Add(new Label { Text = "WORKSPACE", AutoSize = false, Width = 198, Height = 28, Font = Ui.Font(8.5f, FontStyle.Bold), ForeColor = Ui.Muted, TextAlign = ContentAlignment.MiddleLeft });
        AddNav(stack, "dashboard", "Dashboard", "Project overview and quick actions");
        AddNav(stack, "build", "Safe Build", "Build copy / in-place tools");
        AddNav(stack, "rip", "Rip / Cache", "Full rip and cache tools");
        AddNav(stack, "roster", "Roster Studio", "Players, teams, colors, slots");
        AddNav(stack, "assets", "Assets", "IFF/CDF texture utilities");
        AddNav(stack, "courts", "Courts / SCNE", "Court and model research");
        AddNav(stack, "research", "Research Tools", "Scans, probes, profiles");
        AddNav(stack, "about", "About / Help", "Workflow and safety notes");

        var spacer = new Panel { Height = 16, Width = 198, BackColor = Ui.Sidebar };
        stack.Controls.Add(spacer);
        stack.Controls.Add(SidebarTip("Tip", "Use Safe Build Copy so your vanilla JB folder stays untouched."));
        stack.Controls.Add(SidebarTip("Roster", "Open USERDATA, ZIP, IFF, or raw ROST. The app decodes first, then shows tables."));

        sidebar.Controls.Add(stack);
        return sidebar;
    }

    private void AddNav(FlowLayoutPanel stack, string key, string title, string hint)
    {
        var btn = new Button
        {
            Text = title + "\r\n" + hint,
            Width = 198,
            Height = 58,
            FlatStyle = FlatStyle.Flat,
            TextAlign = ContentAlignment.MiddleLeft,
            Padding = new Padding(12, 0, 8, 0),
            Font = Ui.Font(9.25f, FontStyle.Bold),
            ForeColor = Ui.White,
            BackColor = Ui.SidebarButton,
            Margin = new Padding(0, 0, 0, 8)
        };
        btn.FlatAppearance.BorderColor = Ui.Border;
        btn.FlatAppearance.MouseOverBackColor = Ui.SidebarHover;
        btn.Click += (_, _) => ShowSection(key);
        _navButtons[key] = btn;
        stack.Controls.Add(btn);
    }

    private static Control SidebarTip(string title, string text)
    {
        var box = new Panel { Width = 198, Height = 104, BackColor = Ui.Card, Padding = new Padding(10), Margin = new Padding(0, 0, 0, 10) };
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 2, ColumnCount = 1, BackColor = Ui.Card };
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 24));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.Controls.Add(new Label { Text = title, Dock = DockStyle.Fill, Font = Ui.Font(9f, FontStyle.Bold), ForeColor = Ui.Ice }, 0, 0);
        layout.Controls.Add(new Label { Text = text, Dock = DockStyle.Fill, Font = Ui.Font(8.7f), ForeColor = Ui.Muted }, 0, 1);
        box.Controls.Add(layout);
        return box;
    }

    private Control BuildMainArea()
    {
        var panel = new Panel { Dock = DockStyle.Fill, BackColor = Ui.Bg, Padding = new Padding(12, 0, 12, 0) };
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 2, ColumnCount = 1, BackColor = Ui.Bg };
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 82));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));

        var title = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 2, ColumnCount = 1, BackColor = Ui.Bg };
        title.RowStyles.Add(new RowStyle(SizeType.Absolute, 40));
        title.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        title.Controls.Add(_sectionTitle, 0, 0);
        title.Controls.Add(_sectionSubtitle, 0, 1);

        layout.Controls.Add(title, 0, 0);
        layout.Controls.Add(_contentHost, 0, 1);
        panel.Controls.Add(layout);
        return panel;
    }

    private Control BuildLogPanel()
    {
        var card = new Panel { Dock = DockStyle.Fill, BackColor = Ui.Card, Padding = new Padding(12) };
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 5, ColumnCount = 1, BackColor = Ui.Card };
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 36));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 44));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 18));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 38));

        var header = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, BackColor = Ui.Card };
        header.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        header.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 98));
        header.Controls.Add(new Label { Text = "Job Status", Dock = DockStyle.Fill, Font = Ui.Font(13f, FontStyle.Bold), ForeColor = Ui.White, TextAlign = ContentAlignment.MiddleLeft }, 0, 0);
        var clear = SecondaryButton("Clear Log");
        clear.Click += (_, _) => _log.Clear();
        header.Controls.Add(clear, 1, 0);

        var status = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, BackColor = Ui.Card };
        status.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        status.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 48));
        status.Controls.Add(_progressLabel, 0, 0);
        status.Controls.Add(_progressPercent, 1, 0);

        layout.Controls.Add(header, 0, 0);
        layout.Controls.Add(status, 0, 1);
        layout.Controls.Add(_progressBar, 0, 2);
        layout.Controls.Add(_log, 0, 3);
        layout.Controls.Add(new Label { Text = "Structured rip/build progress is parsed automatically.", ForeColor = Ui.Muted, Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft, Font = Ui.Font(8.5f) }, 0, 4);
        card.Controls.Add(layout);
        return card;
    }

    private void ShowSection(string section)
    {
        foreach (var pair in _navButtons)
        {
            pair.Value.BackColor = pair.Key.Equals(section, StringComparison.OrdinalIgnoreCase) ? Ui.IceDark : Ui.SidebarButton;
            pair.Value.ForeColor = Ui.White;
        }

        _contentHost.Controls.Clear();
        Control body;
        switch (section.ToLowerInvariant())
        {
            case "build":
                _sectionTitle.Text = "Safe Build";
                _sectionSubtitle.Text = "Create JB-folder modded copies without touching your vanilla game. The advanced in-place command stays available for disposable test folders only.";
                body = CreateCommandSection(SafeBuildSpecs(), "Recommended", "Build Copy is the default workflow for College Hoops Reborn packages.");
                break;
            case "rip":
                _sectionTitle.Text = "Rip / Cache";
                _sectionSubtitle.Text = "Full enhanced ripping, cache building, single-file targeting, and machine-readable progress for long jobs.";
                body = CreateCommandSection(RipSpecs(), "Extraction", "Use the choops2k8 profile for CH2K8 PS3 unless testing another 2K game.");
                break;
            case "roster":
                _sectionTitle.Text = "Roster Studio";
                _sectionSubtitle.Text = "Open roster_english.iff, decrypted save ZIPs, USERDATA, or raw ROST payloads. The app decodes first, then shows players, teams, slots, arenas, coaches, and color research tools.";
                body = CreateRosterStudio();
                break;
            case "assets":
                _sectionTitle.Text = "Assets";
                _sectionSubtitle.Text = "Texture, CDF, teamselectlogo, and asset extraction tools grouped for easier modding workflows.";
                body = CreateCommandSection(AssetSpecs(), "Asset Tools", "CDF-backed texture banks are handled separately from standard IFF textures.");
                break;
            case "courts":
                _sectionTitle.Text = "Courts / SCNE";
                _sectionSubtitle.Text = "Court, floor.scne, and model research tools. SCNE swaps are treated as binary assets unless you explicitly inspect/export them.";
                body = CreateCommandSection(CourtSpecs(), "Court Tools", "Use these for inspection/export. Normal builds can pass SCNE files through untouched.");
                break;
            case "research":
                _sectionTitle.Text = "Research Tools";
                _sectionSubtitle.Text = "Profiles, archive scans, reference scans, compression probes, and broad research utilities.";
                body = CreateCommandSection(ResearchSpecs(), "Research", "These commands help identify unknown archive names, references, and embedded assets.");
                break;
            case "about":
                _sectionTitle.Text = "About / Help";
                _sectionSubtitle.Text = "Safety rules, supported formats, and recommended workflow.";
                body = CreateAboutPage();
                break;
            default:
                _sectionTitle.Text = "Dashboard";
                _sectionSubtitle.Text = "Everything local, browser-free, and organized around safe College Hoops 2K8 PS3 modding.";
                body = CreateDashboard();
                break;
        }

        _contentHost.Controls.Add(body);
    }

    private Control CreateDashboard()
    {
        var scroll = ScrollHost();
        var grid = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 2, BackColor = Ui.Bg, Padding = new Padding(0, 0, 0, 20) };
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));

        grid.Controls.Add(DashboardCard("Safe Build Copy", "Create a modded JB-folder copy without touching vanilla.", "Open Safe Build", () => ShowSection("build")), 0, 0);
        grid.Controls.Add(DashboardCard("Dynamic Full Rip", "Rip all game assets with cache support and progress.", "Open Rip Tools", () => ShowSection("rip")), 1, 0);
        grid.Controls.Add(DashboardCard("Roster Studio", "Decode USERDATA/ZIP/IFF and edit real tables, not raw bytes.", "Open Roster Studio", () => ShowSection("roster")), 0, 1);
        grid.Controls.Add(DashboardCard("Research Tools", "Inspect IFF/CDF/SCNE, scan refs, and export assets.", "Open Research", () => ShowSection("research")), 1, 1);

        var overview = Card("Project Overview", "Current native suite status");
        var bullets = new Label
        {
            Dock = DockStyle.Top,
            AutoSize = true,
            MaximumSize = new Size(920, 0),
            Font = Ui.Font(10.5f),
            ForeColor = Ui.White,
            Text = "• Native WinForms shell; no Chrome/browser/WebView.\r\n" +
                   "• Commands are grouped by workflow instead of one crowded page.\r\n" +
                   "• Rip/build/build-copy progress drives the right-side progress bar.\r\n" +
                   "• Roster Studio now decodes source files before showing tables.\r\n" +
                   "• Icy blue/white theme with larger controls and readable spacing."
        };
        overview.Controls.Add(bullets);

        scroll.Controls.Add(overview);
        scroll.Controls.Add(grid);
        return scroll;
    }

    private Control DashboardCard(string title, string text, string action, Action click)
    {
        var card = Card(title, text);
        card.Width = 430;
        card.Height = 190;
        var button = PrimaryButton(action);
        button.Dock = DockStyle.Bottom;
        button.Height = 42;
        button.Click += (_, _) => click();
        card.Controls.Add(button);
        return card;
    }

    private Control CreateCommandSection(IEnumerable<CommandSpec> specs, string label, string note)
    {
        var scroll = ScrollHost();
        scroll.Controls.Add(InfoCard(label, note));
        foreach (var group in specs.GroupBy(s => s.Group))
        {
            scroll.Controls.Add(SectionLabel(string.IsNullOrWhiteSpace(group.Key) ? "Commands" : group.Key));
            var row = new FlowLayoutPanel { Dock = DockStyle.Top, AutoSize = true, FlowDirection = FlowDirection.LeftToRight, WrapContents = true, BackColor = Ui.Bg, Padding = new Padding(0) };
            foreach (var spec in group) row.Controls.Add(CreateCommandCard(spec));
            scroll.Controls.Add(row);
        }
        return scroll;
    }

    private Control CreateCommandCard(CommandSpec spec)
    {
        var card = Card(spec.Title, spec.Description);
        card.Width = 520;
        card.Margin = new Padding(0, 0, 16, 16);

        var layout = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 3, BackColor = Ui.Card, Padding = new Padding(0, 10, 0, 0) };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 142));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 94));

        var textInputs = new Dictionary<string, TextBox>(StringComparer.OrdinalIgnoreCase);
        var comboInputs = new Dictionary<string, ComboBox>(StringComparer.OrdinalIgnoreCase);
        var boolInputs = new Dictionary<string, CheckBox>(StringComparer.OrdinalIgnoreCase);
        var row = 0;

        foreach (var field in spec.Fields)
        {
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 36));
            layout.Controls.Add(FieldLabel(field.Label), 0, row);
            if (field.Kind == FieldKind.GameProfile || field.Kind == FieldKind.Select)
            {
                var combo = new ComboBox { Dock = DockStyle.Fill, DropDownStyle = ComboBoxStyle.DropDownList, BackColor = Ui.Input, ForeColor = Ui.White, FlatStyle = FlatStyle.Flat, Font = Ui.Font(9f) };
                combo.Items.AddRange((field.Kind == FieldKind.GameProfile ? GameProfiles : field.Options).Cast<object>().ToArray());
                combo.SelectedItem = field.DefaultValue ?? (field.Kind == FieldKind.GameProfile ? "choops2k8" : field.Options.FirstOrDefault() ?? "");
                comboInputs[field.Name] = combo;
                layout.Controls.Add(combo, 1, row);
                layout.Controls.Add(new Label { Dock = DockStyle.Fill }, 2, row);
            }
            else
            {
                var box = TextInput(field.DefaultValue ?? "");
                textInputs[field.Name] = box;
                layout.Controls.Add(box, 1, row);
                if (field.Kind == FieldKind.File || field.Kind == FieldKind.Folder || field.Kind == FieldKind.SaveFile)
                {
                    var browse = SecondaryButton(field.Kind == FieldKind.SaveFile ? "Save" : "Browse");
                    browse.Dock = DockStyle.Fill;
                    browse.Click += (_, _) => BrowseInto(box, field.Kind);
                    layout.Controls.Add(browse, 2, row);
                }
                else layout.Controls.Add(new Label { Dock = DockStyle.Fill }, 2, row);
            }
            row++;
        }

        foreach (var sw in spec.Switches)
        {
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 32));
            var check = new CheckBox { Text = sw.Label, Checked = sw.DefaultValue, AutoSize = true, ForeColor = Ui.White, BackColor = Ui.Card, Font = Ui.Font(9f) };
            boolInputs[sw.Name] = check;
            layout.Controls.Add(new Label { Dock = DockStyle.Fill }, 0, row);
            layout.Controls.Add(check, 1, row);
            layout.SetColumnSpan(check, 2);
            row++;
        }

        var run = spec.IsDangerous ? DangerButton("Run Advanced") : PrimaryButton("Run");
        run.Dock = DockStyle.Top;
        run.Height = 40;
        run.Margin = new Padding(0, 10, 0, 0);
        run.Click += async (_, _) =>
        {
            var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var item in textInputs) values[item.Key] = item.Value.Text.Trim();
            foreach (var item in comboInputs) values[item.Key] = Convert.ToString(item.Value.SelectedItem) ?? string.Empty;
            var switches = boolInputs.ToDictionary(kv => kv.Key, kv => kv.Value.Checked, StringComparer.OrdinalIgnoreCase);
            run.Enabled = false;
            try { await RunCliAsync(spec.BuildArgs(values, switches)); }
            catch (Exception ex) { AppendLog("[ERROR] " + ex.Message); }
            finally { run.Enabled = true; }
        };

        card.Controls.Add(run);
        card.Controls.Add(layout);
        return card;
    }

    private Control CreateRosterStudio()
    {
        var root = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 3, ColumnCount = 1, BackColor = Ui.Bg };
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 178));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 116));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        root.Controls.Add(CreateRosterOpenCard(), 0, 0);
        root.Controls.Add(CreatePaletteCard(), 0, 1);
        root.Controls.Add(CreateRosterTablesArea(), 0, 2);
        return root;
    }

    private Control CreateRosterOpenCard()
    {
        var card = Card("Open Roster Source", "ZIP, USERDATA, roster_english.iff, or raw ROST payload. The suite decodes first, then loads clean CSV tables.");
        card.Dock = DockStyle.Fill;

        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 3, ColumnCount = 4, BackColor = Ui.Card, Padding = new Padding(0, 8, 0, 0) };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 112));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 106));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 128));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 36));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 36));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 42));

        _rosterSourcePath = TextInput();
        _rosterOutputPath = TextInput(Path.Combine(Path.GetTempPath(), "CHoopsRosterStudio", DateTime.Now.ToString("yyyyMMdd_HHmmss")));
        var sourceBrowse = SecondaryButton("Browse");
        sourceBrowse.Click += (_, _) => BrowseInto(_rosterSourcePath, FieldKind.File);
        var outputBrowse = SecondaryButton("Folder");
        outputBrowse.Click += (_, _) => BrowseInto(_rosterOutputPath, FieldKind.Folder);
        var decode = PrimaryButton("Decode & Load");
        decode.Click += async (_, _) => await DecodeAndLoadRosterAsync();
        var openFolder = SecondaryButton("Open Folder");
        openFolder.Click += (_, _) => OpenFolder(_rosterOutputPath?.Text);
        var saveTable = SecondaryButton("Save Active CSV");
        saveTable.Click += (_, _) => SaveActiveRosterTable();

        layout.Controls.Add(FieldLabel("Source"), 0, 0);
        layout.Controls.Add(_rosterSourcePath, 1, 0);
        layout.Controls.Add(sourceBrowse, 2, 0);
        layout.Controls.Add(decode, 3, 0);
        layout.Controls.Add(FieldLabel("Decoded output"), 0, 1);
        layout.Controls.Add(_rosterOutputPath, 1, 1);
        layout.Controls.Add(outputBrowse, 2, 1);
        layout.Controls.Add(openFolder, 3, 1);
        _rosterBanner = new Label { Text = "No roster loaded yet.", Dock = DockStyle.Fill, ForeColor = Ui.Muted, Font = Ui.Font(9f), TextAlign = ContentAlignment.MiddleLeft };
        layout.Controls.Add(_rosterBanner, 0, 2);
        layout.SetColumnSpan(_rosterBanner, 3);
        layout.Controls.Add(saveTable, 3, 2);

        card.Controls.Add(layout);
        return card;
    }

    private Control CreatePaletteCard()
    {
        var card = Card("Color Picker / Palette Lab", "Experimental roster color editor for school/court palette research. Double-click any hex color cell in a table, or use these slots while mapping team color offsets.");
        card.Dock = DockStyle.Fill;

        var strip = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.LeftToRight, WrapContents = false, AutoScroll = true, BackColor = Ui.Card, Padding = new Padding(0, 8, 0, 0) };
        _selectedTeamLabel = new Label { Text = "Selected team: none", Width = 170, Height = 66, ForeColor = Ui.White, Font = Ui.Font(9f, FontStyle.Bold), TextAlign = ContentAlignment.MiddleLeft };
        strip.Controls.Add(_selectedTeamLabel);

        foreach (var slot in PaletteSlot.Defaults())
        {
            _paletteSlots.Add(slot);
            strip.Controls.Add(CreatePaletteSlotControl(slot));
        }

        var export = SecondaryButton("Export palette JSON");
        export.Width = 150;
        export.Height = 36;
        export.Margin = new Padding(8, 16, 0, 0);
        export.Click += (_, _) => ExportPaletteJson();
        strip.Controls.Add(export);
        card.Controls.Add(strip);
        return card;
    }

    private Control CreatePaletteSlotControl(PaletteSlot slot)
    {
        var panel = new Panel { Width = 122, Height = 68, BackColor = Ui.Card, Margin = new Padding(0, 0, 8, 0) };
        var label = new Label { Text = slot.Label, Dock = DockStyle.Top, Height = 20, ForeColor = Ui.Muted, Font = Ui.Font(8.4f), TextAlign = ContentAlignment.MiddleCenter };
        var box = new TextBox { Text = slot.Hex, Dock = DockStyle.Bottom, Height = 22, BackColor = Ui.Input, ForeColor = Ui.White, BorderStyle = BorderStyle.FixedSingle, Font = Ui.Mono(8.5f), TextAlign = HorizontalAlignment.Center };
        var color = new Button { Dock = DockStyle.Fill, BackColor = ParseColor(slot.Hex), FlatStyle = FlatStyle.Flat, Text = string.Empty };
        color.FlatAppearance.BorderColor = Ui.Ice;
        color.Click += (_, _) =>
        {
            using var dialog = new ColorDialog { Color = color.BackColor, FullOpen = true };
            if (dialog.ShowDialog(this) != DialogResult.OK) return;
            color.BackColor = dialog.Color;
            box.Text = ToRosterHex(dialog.Color);
            slot.Hex = box.Text;
        };
        box.TextChanged += (_, _) => { slot.Hex = box.Text; if (TryParseColor(box.Text, out var parsed)) color.BackColor = parsed; };
        panel.Controls.Add(color);
        panel.Controls.Add(label);
        panel.Controls.Add(box);
        return panel;
    }

    private Control CreateRosterTablesArea()
    {
        var outer = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 2, ColumnCount = 1, BackColor = Ui.Bg };
        outer.RowStyles.Add(new RowStyle(SizeType.Absolute, 44));
        outer.RowStyles.Add(new RowStyle(SizeType.Percent, 100));

        var toolbar = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 4, BackColor = Ui.Bg, Padding = new Padding(0, 6, 0, 6) };
        toolbar.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 80));
        toolbar.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        toolbar.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 150));
        toolbar.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 160));
        _rosterSearch = TextInput();
        _rosterSearch.TextChanged += (_, _) => ApplyRosterSearch();
        var reload = SecondaryButton("Reload CSVs");
        reload.Click += (_, _) => LoadDecodedRosterFolder(_rosterOutputPath?.Text);
        var clear = SecondaryButton("Clear Search");
        clear.Click += (_, _) => { if (_rosterSearch != null) _rosterSearch.Text = string.Empty; };
        toolbar.Controls.Add(FieldLabel("Search"), 0, 0);
        toolbar.Controls.Add(_rosterSearch, 1, 0);
        toolbar.Controls.Add(reload, 2, 0);
        toolbar.Controls.Add(clear, 3, 0);

        _rosterTabControl = new TabControl { Dock = DockStyle.Fill, BackColor = Ui.Bg, Font = Ui.Font(9.5f) };
        foreach (var table in new[] { "Players", "Teams", "Roster Slots", "Arenas", "Coaches" })
        {
            var tab = new TabPage(table) { BackColor = Ui.Bg, ForeColor = Ui.White };
            var grid = CreateRosterGrid();
            grid.Tag = table;
            tab.Controls.Add(grid);
            _rosterTabControl.TabPages.Add(tab);
        }
        _rosterTabControl.SelectedIndexChanged += (_, _) => ApplyRosterSearch();

        outer.Controls.Add(toolbar, 0, 0);
        outer.Controls.Add(_rosterTabControl, 0, 1);
        return outer;
    }

    private DataGridView CreateRosterGrid()
    {
        var grid = new DataGridView
        {
            Dock = DockStyle.Fill,
            AllowUserToAddRows = false,
            AllowUserToDeleteRows = false,
            AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.DisplayedCells,
            BackgroundColor = Ui.Bg,
            BorderStyle = BorderStyle.None,
            GridColor = Ui.Border,
            RowHeadersVisible = false,
            EnableHeadersVisualStyles = false,
            SelectionMode = DataGridViewSelectionMode.FullRowSelect,
            MultiSelect = false,
            Font = Ui.Font(9f)
        };
        grid.ColumnHeadersDefaultCellStyle.BackColor = Ui.Header;
        grid.ColumnHeadersDefaultCellStyle.ForeColor = Ui.White;
        grid.ColumnHeadersDefaultCellStyle.Font = Ui.Font(9f, FontStyle.Bold);
        grid.DefaultCellStyle.BackColor = Ui.Input;
        grid.DefaultCellStyle.ForeColor = Ui.White;
        grid.DefaultCellStyle.SelectionBackColor = Ui.IceDark;
        grid.DefaultCellStyle.SelectionForeColor = Ui.White;
        grid.AlternatingRowsDefaultCellStyle.BackColor = Color.FromArgb(27, 45, 58);
        grid.CellDoubleClick += (_, e) => TryEditColorCell(grid, e);
        grid.SelectionChanged += (_, _) => UpdateSelectedTeamLabel(grid);
        return grid;
    }

    private async Task DecodeAndLoadRosterAsync()
    {
        if (_rosterSourcePath == null || _rosterOutputPath == null) return;
        if (!File.Exists(_rosterSourcePath.Text)) { AppendLog("[Roster] Source file not found: " + _rosterSourcePath.Text); return; }
        if (string.IsNullOrWhiteSpace(_rosterOutputPath.Text)) _rosterOutputPath.Text = Path.Combine(Path.GetTempPath(), "CHoopsRosterStudio", DateTime.Now.ToString("yyyyMMdd_HHmmss"));
        Directory.CreateDirectory(_rosterOutputPath.Text);

        SetRosterBanner("Decoding roster source...", false);
        var exitCode = await RunCliAsync(Args("roster-decode", _rosterSourcePath.Text, _rosterOutputPath.Text));
        if (exitCode == 0)
        {
            LoadDecodedRosterFolder(_rosterOutputPath.Text);
        }
        else
        {
            SetRosterBanner("Roster decode failed. See job log.", true);
        }
    }

    private void LoadDecodedRosterFolder(string? folder)
    {
        if (string.IsNullOrWhiteSpace(folder) || !Directory.Exists(folder)) { SetRosterBanner("Decoded folder not found.", true); return; }
        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["Players"] = "players.csv",
            ["Teams"] = "teams.csv",
            ["Roster Slots"] = "roster_slots.csv",
            ["Arenas"] = "arenas.csv",
            ["Coaches"] = "coaches.csv"
        };

        _rosterTables.Clear();
        _rosterBindings.Clear();
        foreach (var item in map)
        {
            var path = Path.Combine(folder, item.Value);
            if (!File.Exists(path)) continue;
            var table = ReadCsv(path);
            table.TableName = item.Key;
            table.ExtendedProperties["path"] = path;
            _rosterTables[item.Key] = table;
            _rosterBindings[item.Key] = new BindingSource { DataSource = table };
        }

        if (_rosterTabControl != null)
        {
            foreach (TabPage page in _rosterTabControl.TabPages)
            {
                var tableName = page.Text;
                var grid = page.Controls.OfType<DataGridView>().FirstOrDefault();
                if (grid == null) continue;
                grid.DataSource = _rosterBindings.TryGetValue(tableName, out var binding) ? binding : null;
            }
        }

        ApplyRosterSearch();
        var summaryPath = Path.Combine(folder, "roster_summary.json");
        var summaryText = File.Exists(summaryPath) ? File.ReadAllText(summaryPath) : string.Empty;
        var compactSummary = summaryText.Length > 0 ? ExtractRosterSummary(summaryText) : "Decoded tables loaded.";
        SetRosterBanner(compactSummary, false);
        AppendLog($"[Roster] Loaded decoded tables from {folder}");
    }

    private static string ExtractRosterSummary(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            var source = root.TryGetProperty("sourceType", out var sourceElement) ? sourceElement.GetString() : "unknown source";
            var payload = root.TryGetProperty("payloadSize", out var payloadElement) ? payloadElement.GetInt32().ToString("N0") : "?";
            var players = root.TryGetProperty("players", out var playersElement) ? playersElement.GetInt32().ToString("N0") : "?";
            var teams = root.TryGetProperty("teams", out var teamsElement) ? teamsElement.GetInt32().ToString("N0") : "?";
            return $"Source: {source} • Payload: {payload} bytes • Players: {players} • Teams: {teams}";
        }
        catch { return "Decoded tables loaded."; }
    }

    private void SetRosterBanner(string message, bool error)
    {
        if (_rosterBanner == null) return;
        _rosterBanner.Text = message;
        _rosterBanner.ForeColor = error ? Ui.Bad : Ui.Ice;
    }

    private void ApplyRosterSearch()
    {
        if (_rosterTabControl == null || _rosterSearch == null) return;
        var tableName = _rosterTabControl.SelectedTab?.Text;
        if (string.IsNullOrWhiteSpace(tableName) || !_rosterBindings.TryGetValue(tableName, out var binding)) return;
        var filter = _rosterSearch.Text.Trim().Replace("'", "''");
        if (string.IsNullOrWhiteSpace(filter)) { binding.RemoveFilter(); return; }
        var table = _rosterTables[tableName];
        var stringColumns = table.Columns.Cast<DataColumn>().Where(c => c.DataType == typeof(string)).Select(c => $"CONVERT([{c.ColumnName}], 'System.String') LIKE '%{filter}%'" ).ToArray();
        binding.Filter = stringColumns.Length == 0 ? string.Empty : string.Join(" OR ", stringColumns);
    }

    private void SaveActiveRosterTable()
    {
        if (_rosterTabControl == null) return;
        var tableName = _rosterTabControl.SelectedTab?.Text;
        if (string.IsNullOrWhiteSpace(tableName) || !_rosterTables.TryGetValue(tableName, out var table)) { AppendLog("[Roster] No active roster table loaded."); return; }
        if (table.ExtendedProperties["path"] is not string path) { AppendLog("[Roster] Active table path not known."); return; }
        WriteCsv(path, table);
        AppendLog($"[Roster] Saved {tableName} table: {path}");
    }

    private void TryEditColorCell(DataGridView grid, DataGridViewCellEventArgs e)
    {
        if (e.RowIndex < 0 || e.ColumnIndex < 0) return;
        var value = Convert.ToString(grid.Rows[e.RowIndex].Cells[e.ColumnIndex].Value) ?? string.Empty;
        if (!HexColorPattern.IsMatch(value.Trim())) return;
        var current = ParseColor(value);
        using var dialog = new ColorDialog { Color = current, FullOpen = true };
        if (dialog.ShowDialog(this) != DialogResult.OK) return;
        grid.Rows[e.RowIndex].Cells[e.ColumnIndex].Value = ToRosterHex(dialog.Color);
    }

    private void UpdateSelectedTeamLabel(DataGridView grid)
    {
        if (_selectedTeamLabel == null || grid.Tag?.ToString() != "Teams" || grid.CurrentRow == null) return;
        var row = grid.CurrentRow;
        var school = TryCell(row, "school_name");
        var abbr = TryCell(row, "abbreviation");
        var asset = TryCell(row, "asset_id");
        if (!string.IsNullOrWhiteSpace(school)) _selectedTeamLabel.Text = $"Selected team:\r\n{school} ({abbr})\r\nAsset {asset}";
    }

    private static string TryCell(DataGridViewRow row, string column)
    {
        if (!row.DataGridView.Columns.Contains(column)) return string.Empty;
        return Convert.ToString(row.Cells[column].Value) ?? string.Empty;
    }

    private void ExportPaletteJson()
    {
        var folder = _rosterOutputPath?.Text;
        if (string.IsNullOrWhiteSpace(folder)) folder = Environment.CurrentDirectory;
        Directory.CreateDirectory(folder);
        var path = Path.Combine(folder, "palette_research.json");
        var payload = _paletteSlots.Select(s => new { s.Offset, s.Label, s.Hex }).ToArray();
        File.WriteAllText(path, JsonSerializer.Serialize(payload, new JsonSerializerOptions { WriteIndented = true }));
        AppendLog("[Palette] Wrote " + path);
    }

    private Control CreateAboutPage()
    {
        var scroll = ScrollHost();
        var workflow = Card("Recommended Workflow", "Safe, repeatable College Hoops Reborn build flow");
        workflow.Controls.Add(new Label
        {
            Dock = DockStyle.Top,
            AutoSize = true,
            MaximumSize = new Size(980, 0),
            Font = Ui.Font(10.3f),
            ForeColor = Ui.White,
            Text = "1. Keep a clean vanilla JB folder.\r\n" +
                   "2. Rip or prepare your mod folder.\r\n" +
                   "3. Use Safe Build Copy for console-safe output.\r\n" +
                   "4. Use Roster Studio only on decoded tables; do not edit raw USERDATA as CSV.\r\n" +
                   "5. Treat unknown fields as research until one-change tests confirm them."
        });
        var formats = Card("Format Awareness", "Why the suite separates asset families");
        formats.Controls.Add(new Label
        {
            Dock = DockStyle.Top,
            AutoSize = true,
            MaximumSize = new Size(980, 0),
            Font = Ui.Font(10.3f),
            ForeColor = Ui.White,
            Text = "• Standard PS3 IFF: uniforms, courts, roster_english, UI banks.\r\n" +
                   "• CDF-backed IFF/CDF: teamselectlogo, arenapics, overlaycache, many audio banks.\r\n" +
                   "• SCNE files are passed through in normal builds unless you choose inspection/export tools.\r\n" +
                   "• ROST payloads can be wrapped in IFF, USERDATA, save ZIP, or raw payload form."
        });
        scroll.Controls.Add(formats);
        scroll.Controls.Add(workflow);
        return scroll;
    }

    private static IEnumerable<CommandSpec> SafeBuildSpecs()
    {
        yield return new CommandSpec("build-copy", "Build Copy", "Copies your vanilla JB folder to a new output folder, then applies the mod only to that copy. This is the recommended workflow.", "Safe Build",
            new[] { Field.Game("gameName"), Field.Folder("vanillaGame", "Vanilla game / PS3_GAME / USRDIR"), Field.Folder("modDir", "Mod folder"), Field.Folder("outputGame", "Output copied game"), Field.Text("copyConcurrency", "Copy concurrency", "8") },
            new[] { Switch.Option("overwrite", "Overwrite output folder") },
            (v, s) => Args("build-copy", v["vanillaGame"], v["modDir"], v["outputGame"], Opt("--game-name", v["gameName"]), Opt("--copy-concurrency", v["copyConcurrency"]), Flag("--overwrite", s["overwrite"])));
        yield return new CommandSpec("build", "Build In-Place", "Applies mods directly to a selected USRDIR. Use only on disposable copies.", "Advanced",
            new[] { Field.Game("gameName"), Field.Folder("gameDir", "Game USRDIR folder"), Field.Folder("modDir", "Mod folder") }, Array.Empty<Switch>(),
            (v, _) => Args("build", v["gameDir"], v["modDir"], Opt("--game-name", v["gameName"])), true);
    }

    private static IEnumerable<CommandSpec> RipSpecs()
    {
        yield return new CommandSpec("rip", "Dynamic Full Rip", "Rips game/archive content using the selected profile and optional dynamic cache support.", "Rip",
            new[] { Field.Game("gameName"), Field.Folder("gameDir", "Game USRDIR folder"), Field.Folder("outputDir", "Output/rip folder"), Field.Text("fileName", "Optional single file"), Field.Text("index", "Optional archive index") },
            new[] { Switch.Option("buildCache", "Build/update archive cache", true), Switch.Option("showConsole", "Show extractor console"), Switch.Option("iffOnly", "IFF only"), Switch.Option("rawIff", "Raw IFF"), Switch.Option("rawType", "Raw type") },
            (v, s) => Args("rip", v["gameDir"], v["outputDir"], Opt("--game-name", v["gameName"]), Opt("--file", v["fileName"]), Opt("--index", v["index"]), Flag("--build-cache", s["buildCache"]), Flag("--show-console", s["showConsole"]), Flag("--iff-only", s["iffOnly"]), Flag("--raw-iff", s["rawIff"]), Flag("--raw-type", s["rawType"])));
        yield return new CommandSpec("build-cache", "Build Cache", "Rebuild only the selected game profile's archive cache.", "Cache",
            new[] { Field.Game("gameName"), Field.Folder("gameDir", "Game USRDIR folder") }, Array.Empty<Switch>(),
            (v, _) => Args("build-cache", v["gameDir"], Opt("--game-name", v["gameName"])));
    }

    private static IEnumerable<CommandSpec> AssetSpecs()
    {
        yield return new CommandSpec("extract-assets", "Extract Asset Candidates", "Extract model/database/roster/animation candidates from game archives.", "General Assets",
            new[] { Field.Game("gameName"), Field.Folder("gameDir", "Game USRDIR folder"), Field.Folder("outputDir", "Output folder"), Field.Text("fileName", "Optional file"), Field.Text("index", "Optional index"), Field.Text("category", "Optional category"), Field.Text("maxProbeHits", "Max probe hits") },
            new[] { Switch.Option("cache", "Force cache rebuild"), Switch.Option("scanAll", "Scan all"), Switch.Option("dumpTopLevelRaw", "Dump raw containers"), Switch.Option("includeAllUnknown", "Include unknown") },
            (v, s) => Args("extract-assets", v["gameDir"], v["outputDir"], Opt("--game-name", v["gameName"]), Opt("--file", v["fileName"]), Opt("--index", v["index"]), Opt("--category", v["category"]), Opt("--max-probe-hits", v["maxProbeHits"]), Flag("--cache", s["cache"]), Flag("--scan-all", s["scanAll"]), Flag("--dump-top-level-raw", s["dumpTopLevelRaw"]), Flag("--include-all-unknown", s["includeAllUnknown"])));
        yield return new CommandSpec("extract-cdf-textures", "Extract CDF Textures", "Extract GTF/DDS from a CDF, optionally paired to one IFF.", "CDF / Textures",
            new[] { Field.File("cdfFile", "CDF file"), Field.File("iffFile", "Optional paired IFF"), Field.Folder("outputDir", "Output folder") },
            new[] { Switch.Option("dds", "Write DDS", true), Switch.Option("verbose", "Verbose") },
            (v, s) => Args("extract-cdf-textures", v["cdfFile"], v["outputDir"], Opt("--iff", v["iffFile"]), Flag("--dds", s["dds"]), Flag("--verbose", s["verbose"])));
        yield return new CommandSpec("export-teamselectlogo-dds", "Export Teamselectlogo DDS", "Dedicated teamselectlogo CDF/IFF DDS export workflow.", "CDF / Textures",
            new[] { Field.File("cdfFile", "teamselectlogo.cdf"), Field.File("iffFile", "teamselectlogo.iff"), Field.Folder("outputDir", "Output folder") },
            new[] { Switch.Option("verbose", "Verbose") },
            (v, s) => Args("export-teamselectlogo-dds", v["cdfFile"], v["iffFile"], v["outputDir"], Flag("--verbose", s["verbose"])));
        yield return new CommandSpec("import-teamselectlogo-dds", "Import Teamselectlogo DDS", "Rebuild a teamselectlogo CDF from edited DDS files and the export manifest.", "CDF / Textures",
            new[] { Field.File("originalCdf", "Original CDF"), Field.File("manifestFile", "Manifest JSON"), Field.Folder("editedDdsDir", "Edited DDS folder"), Field.SaveFile("outputCdf", "Output CDF path") }, Array.Empty<Switch>(),
            (v, _) => Args("import-teamselectlogo-dds", v["originalCdf"], v["manifestFile"], v["editedDdsDir"], v["outputCdf"]));
        yield return new CommandSpec("decompress-cdf", "Decompress CDF Research", "Heuristically split/decompress a standalone CDF.", "CDF / Textures",
            new[] { Field.File("cdfFile", "CDF file"), Field.Folder("outputDir", "Output folder"), Field.Text("maxHits", "Max hits") },
            new[] { Switch.Option("dumpTableChunks", "Dump table chunks") },
            (v, s) => Args("decompress-cdf", v["cdfFile"], v["outputDir"], Opt("--max-hits", v["maxHits"]), Flag("--dump-table-chunks", s["dumpTableChunks"])));
    }

    private static IEnumerable<CommandSpec> CourtSpecs()
    {
        yield return new CommandSpec("export-scne-obj", "Export SCNE OBJ", "Export stadium/court/presentation SCNE models.", "SCNE / Models",
            new[] { Field.File("scneFile", "SCNE file"), Field.Folder("outputDir", "Output folder"), Field.Select("primitiveMode", "Primitive mode", new[] { "strip", "list" }, "strip") },
            new[] { Switch.Option("splitParts", "Split parts"), Switch.Option("flipV", "Flip V") },
            (v, s) => Args("export-scne-obj", v["scneFile"], v["outputDir"], Opt("--primitive-mode", v["primitiveMode"]), Flag("--split-parts", s["splitParts"]), Flag("--flip-v", s["flipV"])));
        yield return new CommandSpec("inspect-floor-scne", "Inspect Floor SCNE", "Dump texture, model-part, material, and draw-run tables for floor.scne.", "SCNE / Models",
            new[] { Field.File("scneFile", "floor.scne"), Field.Folder("outputDir", "Output folder") }, Array.Empty<Switch>(),
            (v, _) => Args("inspect-floor-scne", v["scneFile"], v["outputDir"]));
    }

    private static IEnumerable<CommandSpec> ResearchSpecs()
    {
        yield return new CommandSpec("profiles", "List Game Profiles", "Print supported dynamic game profiles.", "Profiles", Array.Empty<Field>(), new[] { Switch.Option("json", "JSON output") }, (v, s) => Args("profiles", Flag("--json", s["json"])));
        yield return new CommandSpec("inspect-iff", "Inspect IFF", "Deep-inspect one IFF and optionally dump subfiles.", "Inspection", new[] { Field.File("inputFile", "IFF file"), Field.Folder("outputDir", "Output folder") }, new[] { Switch.Option("dumpSubfiles", "Dump subfiles") }, (v, s) => Args("inspect-iff", v["inputFile"], v["outputDir"], Flag("--dump-subfiles", s["dumpSubfiles"])));
        yield return new CommandSpec("smart-scan", "Smart Scan", "Recursive asset/container scan for research folders.", "Inspection", new[] { Field.Folder("inputPath", "Input folder"), Field.Folder("outputDir", "Output folder"), Field.Text("maxDepth", "Max depth", "4") }, new[] { Switch.Option("dumpCandidates", "Dump candidates") }, (v, s) => Args("smart-scan", v["inputPath"], v["outputDir"], Opt("--max-depth", v["maxDepth"]), Flag("--dump-candidates", s["dumpCandidates"])));
        yield return new CommandSpec("scan-refs", "Scan References", "Extract strings and filename references from files/folders.", "Inspection", new[] { Field.Folder("inputPath", "Input folder"), Field.Folder("outputDir", "Output folder"), Field.Text("minLength", "Minimum length", "4") }, new[] { Switch.Option("onlyMatches", "Only matches") }, (v, s) => Args("scan-refs", v["inputPath"], v["outputDir"], Opt("--min-length", v["minLength"]), Flag("--only-matches", s["onlyMatches"])));
        yield return new CommandSpec("probe", "Compression Probe", "Probe an IFF/CDF for alternate compression layouts and embedded streams.", "Inspection", new[] { Field.File("inputFile", "IFF/CDF file") }, Array.Empty<Switch>(), (v, _) => Args("probe", v["inputFile"]));
    }

    private async Task<int> RunCliAsync(IReadOnlyList<string> rawArgs)
    {
        if (!File.Exists(_cliPath)) { AppendLog($"[ERROR] CLI backend not found: {_cliPath}"); return -1; }
        var args = AddProgressFlagForLongJobs(rawArgs);
        ResetProgress($"Starting {args.FirstOrDefault() ?? "job"}...");
        AppendLog("> " + _cliPath + " " + string.Join(" ", args.Select(QuoteIfNeeded)));
        var startInfo = new ProcessStartInfo { FileName = _cliPath, UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true, CreateNoWindow = true, WorkingDirectory = AppContext.BaseDirectory };
        foreach (var arg in args) startInfo.ArgumentList.Add(arg);
        using var process = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
        process.OutputDataReceived += (_, e) => { if (e.Data != null) HandleProcessLine(e.Data); };
        process.ErrorDataReceived += (_, e) => { if (e.Data != null) HandleProcessLine(e.Data); };
        process.Start();
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        await process.WaitForExitAsync();
        if (process.ExitCode == 0) SetProgress("Complete", 100, false);
        else SetProgress($"Exited with code {process.ExitCode}", null, false);
        AppendLog($"[DONE] Exit code {process.ExitCode}");
        return process.ExitCode;
    }

    private void HandleProcessLine(string line)
    {
        if (TryHandleProgressLine(line)) return;
        AppendLog(line);
    }

    private bool TryHandleProgressLine(string line)
    {
        if (!line.StartsWith(ProgressPrefix, StringComparison.Ordinal)) return false;
        try
        {
            using var doc = JsonDocument.Parse(line[ProgressPrefix.Length..]);
            var root = doc.RootElement;
            var phase = root.TryGetProperty("phase", out var phaseElement) ? phaseElement.GetString() : "Working";
            var message = root.TryGetProperty("message", out var messageElement) ? messageElement.GetString() : phase;
            var indeterminate = root.TryGetProperty("indeterminate", out var indeterminateElement) && indeterminateElement.GetBoolean();
            double? percent = null;
            if (!indeterminate && root.TryGetProperty("percent", out var percentElement) && percentElement.ValueKind == JsonValueKind.Number) percent = percentElement.GetDouble();
            SetProgress($"{phase}: {message}", percent, indeterminate);
            return true;
        }
        catch (Exception ex)
        {
            AppendLog("[WARN] Failed to parse progress event: " + ex.Message);
            return true;
        }
    }

    private void ResetProgress(string message) => SetProgress(message, 0, false);

    private void SetProgress(string message, double? percent, bool indeterminate)
    {
        if (InvokeRequired) { BeginInvoke(new Action<string, double?, bool>(SetProgress), message, percent, indeterminate); return; }
        _progressLabel.Text = message;
        if (indeterminate || percent == null)
        {
            _progressBar.Style = ProgressBarStyle.Marquee;
            _progressPercent.Text = "...";
            return;
        }
        _progressBar.Style = ProgressBarStyle.Continuous;
        var value = Math.Max(0, Math.Min(100, (int)Math.Round(percent.Value)));
        _progressBar.Value = value;
        _progressPercent.Text = value + "%";
    }

    private static List<string> AddProgressFlagForLongJobs(IReadOnlyList<string> args)
    {
        var result = args.ToList();
        var command = result.FirstOrDefault() ?? string.Empty;
        var longRunning = command.Equals("rip", StringComparison.OrdinalIgnoreCase)
            || command.Equals("build", StringComparison.OrdinalIgnoreCase)
            || command.Equals("build-copy", StringComparison.OrdinalIgnoreCase);
        if (longRunning && !result.Any(a => a.Equals("--progress", StringComparison.OrdinalIgnoreCase))) result.Add("--progress");
        return result;
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
        using var open = new OpenFileDialog { Filter = "Roster/save/IFF/CDF/SCNE/CSV files (*.zip;*.iff;*.cdf;*.scne;*.bin;*.dat;*.csv)|*.zip;*.iff;*.cdf;*.scne;*.bin;*.dat;*.csv|USERDATA|USERDATA|All files (*.*)|*.*" };
        if (open.ShowDialog(this) == DialogResult.OK) box.Text = open.FileName;
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
            if (string.IsNullOrEmpty(lines[i])) continue;
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
                if (inQuotes && i + 1 < line.Length && line[i + 1] == '"') { current.Append('"'); i++; }
                else inQuotes = !inQuotes;
            }
            else if (c == ',' && !inQuotes) { result.Add(current.ToString()); current.Clear(); }
            else current.Append(c);
        }
        result.Add(current.ToString());
        return result;
    }

    private static string EscapeCsv(string value) => value.Contains('"') || value.Contains(',') || value.Contains('\n') || value.Contains('\r') ? "\"" + value.Replace("\"", "\"\"") + "\"" : value;

    private void AppendLog(string message)
    {
        if (InvokeRequired) { BeginInvoke(new Action<string>(AppendLog), message); return; }
        _log.AppendText(message + Environment.NewLine);
        _log.SelectionStart = _log.TextLength;
        _log.ScrollToCaret();
    }

    private void OpenFolder(string? folder)
    {
        if (string.IsNullOrWhiteSpace(folder) || !Directory.Exists(folder)) { AppendLog("[OPEN] Folder not found: " + folder); return; }
        Process.Start(new ProcessStartInfo { FileName = folder, UseShellExecute = true });
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

    private static List<string> Args(params string?[] parts)
    {
        var list = new List<string>();
        foreach (var part in parts)
        {
            if (string.IsNullOrWhiteSpace(part)) continue;
            if (part.Contains('\0'))
            {
                var pieces = part.Split('\0');
                if (!string.IsNullOrWhiteSpace(pieces[0])) list.Add(pieces[0]);
                if (pieces.Length > 1 && !string.IsNullOrWhiteSpace(pieces[1])) list.Add(pieces[1]);
            }
            else list.Add(part);
        }
        return list;
    }

    private static string? Opt(string flag, string? value) => string.IsNullOrWhiteSpace(value) ? null : flag + "\0" + value;
    private static string? Flag(string flag, bool enabled) => enabled ? flag : null;
    private static string QuoteIfNeeded(string arg) => arg.Any(char.IsWhiteSpace) ? "\"" + arg.Replace("\"", "\\\"") + "\"" : arg;

    private static Panel ScrollHost()
    {
        return new Panel { Dock = DockStyle.Fill, AutoScroll = true, BackColor = Ui.Bg, Padding = new Padding(0, 0, 8, 8) };
    }

    private static Panel Card(string title, string subtitle)
    {
        var card = new Panel { BackColor = Ui.Card, Padding = new Padding(16), Margin = new Padding(0, 0, 0, 16), AutoSize = true, Dock = DockStyle.Top };
        var sub = new Label { Text = subtitle, Dock = DockStyle.Top, AutoSize = true, MaximumSize = new Size(980, 0), Font = Ui.Font(9.2f), ForeColor = Ui.Muted, Padding = new Padding(0, 0, 0, 8) };
        var head = new Label { Text = title, Dock = DockStyle.Top, Height = 28, Font = Ui.Font(13.5f, FontStyle.Bold), ForeColor = Ui.White, TextAlign = ContentAlignment.MiddleLeft };
        card.Controls.Add(sub);
        card.Controls.Add(head);
        return card;
    }

    private static Control InfoCard(string title, string text)
    {
        var card = Card(title, text);
        card.Controls.Add(new Panel { Dock = DockStyle.Top, Height = 2, BackColor = Ui.Ice, Margin = new Padding(0, 8, 0, 0) });
        return card;
    }

    private static Control SectionLabel(string text) => new Label { Text = text, Dock = DockStyle.Top, Height = 36, Font = Ui.Font(12f, FontStyle.Bold), ForeColor = Ui.Ice, TextAlign = ContentAlignment.MiddleLeft, BackColor = Ui.Bg };

    private static Label FieldLabel(string text) => new() { Text = text, Dock = DockStyle.Fill, Font = Ui.Font(9f, FontStyle.Bold), ForeColor = Ui.Muted, TextAlign = ContentAlignment.MiddleLeft };

    private static TextBox TextInput(string value = "") => new() { Text = value, Dock = DockStyle.Fill, BackColor = Ui.Input, ForeColor = Ui.White, BorderStyle = BorderStyle.FixedSingle, Font = Ui.Font(9f) };

    private static Button PrimaryButton(string text) => StyledButton(text, Ui.IceDark, Color.White, Ui.Ice);
    private static Button SecondaryButton(string text) => StyledButton(text, Ui.Card2, Ui.White, Ui.Border);
    private static Button DangerButton(string text) => StyledButton(text, Ui.BadDark, Color.White, Ui.Bad);

    private static Button StyledButton(string text, Color back, Color fore, Color border)
    {
        var btn = new Button { Text = text, BackColor = back, ForeColor = fore, FlatStyle = FlatStyle.Flat, Font = Ui.Font(9f, FontStyle.Bold), Cursor = Cursors.Hand };
        btn.FlatAppearance.BorderColor = border;
        btn.FlatAppearance.MouseOverBackColor = ControlPaint.Light(back, 0.18f);
        return btn;
    }

    private static Control Badge(string text, Color color)
    {
        var label = new Label { Text = text, AutoSize = false, Width = 118, Height = 28, Margin = new Padding(8, 0, 0, 0), BackColor = color, ForeColor = Color.White, Font = Ui.Font(8.5f, FontStyle.Bold), TextAlign = ContentAlignment.MiddleCenter };
        return label;
    }

    private static Color ParseColor(string value) => TryParseColor(value, out var color) ? color : Color.White;

    private static bool TryParseColor(string value, out Color color)
    {
        color = Color.White;
        if (string.IsNullOrWhiteSpace(value)) return false;
        var hex = value.Trim().Replace("#", string.Empty).Replace("0x", string.Empty, StringComparison.OrdinalIgnoreCase);
        if (hex.Length == 8) hex = hex[..6];
        if (hex.Length != 6) return false;
        try
        {
            color = Color.FromArgb(Convert.ToInt32(hex[..2], 16), Convert.ToInt32(hex.Substring(2, 2), 16), Convert.ToInt32(hex.Substring(4, 2), 16));
            return true;
        }
        catch { return false; }
    }

    private static string ToRosterHex(Color color) => $"{color.R:X2}{color.G:X2}{color.B:X2}FF";
}

internal static class Ui
{
    public static readonly Color Bg = Color.FromArgb(8, 22, 34);
    public static readonly Color Header = Color.FromArgb(16, 44, 66);
    public static readonly Color Sidebar = Color.FromArgb(10, 31, 48);
    public static readonly Color SidebarButton = Color.FromArgb(15, 45, 66);
    public static readonly Color SidebarHover = Color.FromArgb(28, 79, 108);
    public static readonly Color Card = Color.FromArgb(18, 43, 60);
    public static readonly Color Card2 = Color.FromArgb(26, 58, 76);
    public static readonly Color Input = Color.FromArgb(11, 27, 39);
    public static readonly Color LogBg = Color.FromArgb(5, 16, 25);
    public static readonly Color LogText = Color.FromArgb(226, 246, 255);
    public static readonly Color Border = Color.FromArgb(68, 119, 145);
    public static readonly Color Ice = Color.FromArgb(129, 218, 255);
    public static readonly Color IceDark = Color.FromArgb(23, 111, 159);
    public static readonly Color DeepBlue = Color.FromArgb(32, 77, 131);
    public static readonly Color White = Color.FromArgb(246, 252, 255);
    public static readonly Color Muted = Color.FromArgb(178, 215, 231);
    public static readonly Color Good = Color.FromArgb(26, 139, 115);
    public static readonly Color Bad = Color.FromArgb(255, 112, 112);
    public static readonly Color BadDark = Color.FromArgb(139, 45, 55);

    public static Font Font(float size, FontStyle style = FontStyle.Regular) => new("Segoe UI", size, style);
    public static Font Mono(float size, FontStyle style = FontStyle.Regular) => new("Cascadia Mono", size, style);
}

internal enum FieldKind { Text, File, Folder, SaveFile, GameProfile, Select }

internal sealed class Field
{
    public string Name { get; }
    public string Label { get; }
    public FieldKind Kind { get; }
    public string? DefaultValue { get; }
    public string[] Options { get; }
    private Field(string name, string label, FieldKind kind, string? defaultValue = null, string[]? options = null) { Name = name; Label = label; Kind = kind; DefaultValue = defaultValue; Options = options ?? Array.Empty<string>(); }
    public static Field Text(string name, string label, string? defaultValue = null) => new(name, label, FieldKind.Text, defaultValue);
    public static Field File(string name, string label) => new(name, label, FieldKind.File);
    public static Field Folder(string name, string label) => new(name, label, FieldKind.Folder);
    public static Field SaveFile(string name, string label) => new(name, label, FieldKind.SaveFile);
    public static Field Game(string name) => new(name, "Game profile", FieldKind.GameProfile, "choops2k8");
    public static Field Select(string name, string label, string[] options, string? defaultValue = null) => new(name, label, FieldKind.Select, defaultValue, options);
}

internal sealed class Switch
{
    public string Name { get; }
    public string Label { get; }
    public bool DefaultValue { get; }
    private Switch(string name, string label, bool defaultValue) { Name = name; Label = label; DefaultValue = defaultValue; }
    public static Switch Option(string name, string label, bool defaultValue = false) => new(name, label, defaultValue);
}

internal sealed class CommandSpec
{
    public string Name { get; }
    public string Title { get; }
    public string Description { get; }
    public string Group { get; }
    public IReadOnlyList<Field> Fields { get; }
    public IReadOnlyList<Switch> Switches { get; }
    public Func<Dictionary<string, string>, Dictionary<string, bool>, List<string>> BuildArgs { get; }
    public bool IsDangerous { get; }
    public CommandSpec(string name, string title, string description, string group, IEnumerable<Field> fields, IEnumerable<Switch> switches, Func<Dictionary<string, string>, Dictionary<string, bool>, List<string>> buildArgs, bool isDangerous = false)
    {
        Name = name;
        Title = title;
        Description = description;
        Group = group;
        Fields = fields.ToList();
        Switches = switches.ToList();
        BuildArgs = buildArgs;
        IsDangerous = isDangerous;
    }
}

internal sealed class PaletteSlot
{
    public string Offset { get; }
    public string Label { get; }
    public string Hex { get; set; }
    public PaletteSlot(string offset, string label, string hex) { Offset = offset; Label = label; Hex = hex; }
    public static IEnumerable<PaletteSlot> Defaults()
    {
        yield return new PaletteSlot("+0x1A4", "Primary", "81DAFFFF");
        yield return new PaletteSlot("+0x1B4", "Secondary", "FFFFFFCC");
        yield return new PaletteSlot("+0x1C4", "Trim", "1F6F9FFF");
        yield return new PaletteSlot("+0x1D8", "Line A", "BFEFFFFF");
        yield return new PaletteSlot("+0x1E0", "Line B", "FFFFFFCC");
        yield return new PaletteSlot("+0x200", "Court", "9DDCFFFF");
        yield return new PaletteSlot("+0x210", "Accent", "113B5AFF");
    }
}