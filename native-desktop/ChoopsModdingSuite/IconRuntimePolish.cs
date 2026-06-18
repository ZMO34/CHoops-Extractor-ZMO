using System;
using System.Collections.Generic;
using System.Data;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Linq;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Windows.Forms;

namespace ChoopsModdingSuite;

/// <summary>
/// One-shot native UI fixups that are safe to run after the main form is created.
/// No paint/layout loops are used here. This file only fixes startup sizing,
/// runtime icon/titlebar branding, roster-slot dropdown data, and palette previews.
/// </summary>
internal static class IconRuntimePolish
{
    private const int WmSetIcon = 0x0080;
    private static bool _installed;
    private static Icon? _largeIcon;
    private static Icon? _smallIcon;

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    private static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

    [ModuleInitializer]
    internal static void Register()
    {
        Application.Idle += OnFirstIdle;
    }

    private static void OnFirstIdle(object? sender, EventArgs e)
    {
        Application.Idle -= OnFirstIdle;
        var form = Application.OpenForms.Cast<Form>().FirstOrDefault(f => f.GetType().Name == "MainForm");
        if (form == null) return;
        Install(form);
    }

    private static void Install(Form form)
    {
        if (_installed) return;
        _installed = true;

        ApplyRuntimeIcon(form);
        ApplyShellSizing(form);
        ApplyBrandPainting(form);
        ApplyTabSizing(form);
        ApplyEditorFixups(form);

        var content = GetField<Panel>(form, "_content");
        if (content != null)
        {
            content.ControlAdded += (_, _) =>
            {
                if (form.IsDisposed) return;
                form.BeginInvoke(() =>
                {
                    ApplyBrandPainting(form);
                    ApplyTabSizing(form);
                    ApplyEditorFixups(form);
                });
            };
        }

        var teamCombo = GetField<ComboBox>(form, "_teamCombo");
        if (teamCombo != null)
        {
            teamCombo.SelectedIndexChanged += (_, _) =>
            {
                if (form.IsDisposed) return;
                form.BeginInvoke(() => ApplyEditorFixups(form));
            };
        }
    }

    private static void ApplyRuntimeIcon(Form form)
    {
        try
        {
            _largeIcon ??= RuntimeBrandIcon.CreateIcon(256);
            _smallIcon ??= RuntimeBrandIcon.CreateIcon(32);
            form.Icon = _largeIcon;
            if (form.IsHandleCreated)
            {
                SendMessage(form.Handle, WmSetIcon, IntPtr.Zero, _smallIcon.Handle);
                SendMessage(form.Handle, WmSetIcon, new IntPtr(1), _largeIcon.Handle);
            }
            else
            {
                form.HandleCreated += (_, _) =>
                {
                    if (_smallIcon != null) SendMessage(form.Handle, WmSetIcon, IntPtr.Zero, _smallIcon.Handle);
                    if (_largeIcon != null) SendMessage(form.Handle, WmSetIcon, new IntPtr(1), _largeIcon.Handle);
                };
            }
        }
        catch { }
    }

    private static void ApplyShellSizing(Form form)
    {
        form.MinimumSize = new Size(Math.Max(form.MinimumSize.Width, 1500), Math.Max(form.MinimumSize.Height, 860));

        var root = All<TableLayoutPanel>(form).FirstOrDefault(t => t.RowCount == 4 && t.ColumnCount == 1);
        if (root != null && root.RowStyles.Count >= 4)
        {
            root.RowStyles[0].SizeType = SizeType.Absolute;
            root.RowStyles[0].Height = 158;
            root.RowStyles[1].SizeType = SizeType.Absolute;
            root.RowStyles[1].Height = 136;
            root.RowStyles[3].SizeType = SizeType.Absolute;
            root.RowStyles[3].Height = 36;
        }

        var headerLayout = All<TableLayoutPanel>(form)
            .FirstOrDefault(t => t.RowCount == 3 && t.ColumnCount == 4 && t.ColumnStyles.Count >= 4 && t.RowStyles.Count >= 3);
        if (headerLayout != null)
        {
            headerLayout.RowStyles[0].SizeType = SizeType.Absolute;
            headerLayout.RowStyles[0].Height = 54;
            headerLayout.RowStyles[1].SizeType = SizeType.Absolute;
            headerLayout.RowStyles[1].Height = 24;
            headerLayout.RowStyles[2].SizeType = SizeType.Absolute;
            headerLayout.RowStyles[2].Height = 56;
            headerLayout.ColumnStyles[0].SizeType = SizeType.Absolute;
            headerLayout.ColumnStyles[0].Width = 138;
            headerLayout.ColumnStyles[3].SizeType = SizeType.Absolute;
            headerLayout.ColumnStyles[3].Width = 178;
        }

        foreach (var table in All<TableLayoutPanel>(form).Where(t => t.RowCount == 2 && t.ColumnCount == 3 && t.RowStyles.Count >= 2))
        {
            table.RowStyles[0].SizeType = SizeType.Absolute;
            table.RowStyles[0].Height = 60;
            table.RowStyles[1].SizeType = SizeType.Absolute;
            table.RowStyles[1].Height = 54;
        }

        foreach (var table in All<TableLayoutPanel>(form).Where(t => t.RowCount == 2 && t.ColumnCount == 1 && t.RowStyles.Count >= 2))
        {
            if (!All<Label>(table).Any()) continue;
            table.RowStyles[0].SizeType = SizeType.Absolute;
            table.RowStyles[0].Height = 24;
            table.RowStyles[1].SizeType = SizeType.Percent;
            table.RowStyles[1].Height = 100;
        }

        foreach (var label in All<Label>(form))
        {
            if (label.Text == "College Hoops 2K8 Roster Studio")
            {
                label.Font = Theme.Font(22f, FontStyle.Bold);
                label.TextAlign = ContentAlignment.MiddleLeft;
            }
        }

        foreach (var box in All<TextBox>(form))
        {
            box.MinimumSize = new Size(120, 32);
            box.Font = Theme.Font(9.8f);
        }

        foreach (var combo in All<ComboBox>(form))
        {
            combo.MinimumSize = new Size(120, 32);
            combo.Font = Theme.Font(9.8f);
        }

        foreach (var button in All<Button>(form))
        {
            if (button.Text is "Configure" or "Config" or "Open")
            {
                button.Text = button.Text == "Config" ? "Configure" : button.Text;
                button.AutoSize = false;
                button.Width = Math.Max(button.Width, 112);
                button.Height = Math.Max(button.Height, 36);
                button.MinimumSize = new Size(112, 36);
            }
        }
    }

    private static void ApplyBrandPainting(Control root)
    {
        foreach (var badge in All<Control>(root).Where(c => c.GetType().Name == "BrandBadge"))
        {
            if (Equals(badge.Tag, "runtime-brand-applied")) continue;
            badge.Tag = "runtime-brand-applied";
            badge.Paint += (_, e) =>
            {
                e.Graphics.SmoothingMode = SmoothingMode.HighQuality;
                e.Graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                e.Graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
                using var brush = new SolidBrush(Theme.Header);
                e.Graphics.FillRectangle(brush, badge.ClientRectangle);
                RuntimeBrandIcon.DrawCentered(e.Graphics, badge.ClientRectangle, includeGlow: true);
            };
            badge.Invalidate();
        }
    }

    private static void ApplyTabSizing(Control root)
    {
        var widths = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase)
        {
            ["Dashboard"] = 132,
            ["School"] = 112,
            ["Spirit"] = 112,
            ["Colors / Floor / Basket / Cheer"] = 310,
            ["Roster Slots"] = 150,
            ["Depth Chart / Rotation"] = 212,
            ["Assets"] = 116,
            ["Conferences"] = 150,
            ["Unknown / Research"] = 198
        };

        foreach (var button in All<Button>(root))
        {
            if (!widths.TryGetValue(button.Text, out var width)) continue;
            button.AutoSize = false;
            button.Height = 44;
            button.Width = width;
            button.MinimumSize = new Size(width, 44);
            button.Font = Theme.Font(9.5f, FontStyle.Bold);
            button.TextAlign = ContentAlignment.MiddleCenter;
        }
    }

    private static void ApplyEditorFixups(Form form)
    {
        var content = GetField<Panel>(form, "_content");
        if (content == null) return;

        ApplySchoolFieldLimits(content);
        ApplyRosterSlotCombos(form, content);
        ApplyUniformPalettePreview(form, content);
    }

    private static void ApplySchoolFieldLimits(Control root)
    {
        foreach (var table in All<TableLayoutPanel>(root))
        {
            var labels = All<Label>(table).Select(l => l.Text ?? string.Empty).ToList();
            var schoolLabel = labels.FirstOrDefault(IsSchoolLimitedLabel);
            if (schoolLabel == null) continue;

            foreach (var textBox in All<TextBox>(table))
            {
                textBox.MaxLength = 16;
                textBox.Font = Theme.Font(10.8f);
                textBox.MinimumSize = new Size(220, 34);
                textBox.Height = 34;
            }

            foreach (var label in All<Label>(table).Where(l => IsSchoolLimitedLabel(l.Text ?? string.Empty)))
            {
                if (!label.Text.Contains("16 max", StringComparison.OrdinalIgnoreCase))
                    label.Text = label.Text + "  (16 max)";
                label.Font = Theme.Font(8.9f, FontStyle.Bold);
            }

            var panel = table.Parent;
            if (panel != null && panel.Height < 118) panel.Height = 118;
        }
    }

    private static bool IsSchoolLimitedLabel(string value)
    {
        return value.Equals("School Name short", StringComparison.OrdinalIgnoreCase)
            || value.Equals("School Name full", StringComparison.OrdinalIgnoreCase)
            || value.Equals("Nickname", StringComparison.OrdinalIgnoreCase)
            || value.Equals("Abbreviation", StringComparison.OrdinalIgnoreCase)
            || value.Equals("Mascot text", StringComparison.OrdinalIgnoreCase)
            || value.StartsWith("School Name short ", StringComparison.OrdinalIgnoreCase)
            || value.StartsWith("School Name full ", StringComparison.OrdinalIgnoreCase)
            || value.StartsWith("Nickname ", StringComparison.OrdinalIgnoreCase)
            || value.StartsWith("Abbreviation ", StringComparison.OrdinalIgnoreCase)
            || value.StartsWith("Mascot text ", StringComparison.OrdinalIgnoreCase);
    }

    private static void ApplyRosterSlotCombos(Form form, Control root)
    {
        var tables = GetField<Dictionary<string, DataTable>>(form, "_tables");
        var teamCombo = GetField<ComboBox>(form, "_teamCombo");
        if (tables == null || teamCombo == null) return;
        if (!tables.TryGetValue("roster_slots", out var slots) || !tables.TryGetValue("players", out var players)) return;
        if (slots.Rows.Count == 0 || players.Rows.Count == 0) return;

        var teamId = (Convert.ToString(teamCombo.SelectedItem) ?? string.Empty).Split('-').FirstOrDefault()?.Trim() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(teamId)) return;

        var playerOptions = BuildPlayerOptions(players).ToList();
        var slotRows = slots.Rows.Cast<DataRow>()
            .Where(r => Exact(r, "team_index") == teamId)
            .ToDictionary(r => ParseInt(Exact(r, "slot")), r => r);

        if (slotRows.Count == 0) return;

        foreach (var card in All<Control>(root).Where(c => c.GetType().Name == "GlassPanel"))
        {
            var slotLabel = All<Label>(card).FirstOrDefault(l => (l.Text ?? string.Empty).StartsWith("Slot ", StringComparison.OrdinalIgnoreCase));
            if (slotLabel == null) continue;
            var match = Regex.Match(slotLabel.Text ?? string.Empty, @"Slot\s+(\d+)");
            if (!match.Success) continue;
            var slotNumber = int.Parse(match.Groups[1].Value);
            if (!slotRows.TryGetValue(slotNumber, out var row)) continue;

            var current = FormatSlotPlayer(row);
            var combo = All<ComboBox>(card).FirstOrDefault();
            if (combo == null) continue;

            if (Equals(combo.Tag, $"slot-fixed:{teamId}:{slotNumber}:{current}")) continue;
            combo.BeginUpdate();
            combo.Items.Clear();
            combo.Items.Add("Unassigned");
            foreach (var player in playerOptions) combo.Items.Add(player);
            if (!combo.Items.Contains(current)) combo.Items.Insert(0, current);
            combo.SelectedItem = current;
            combo.Tag = $"slot-fixed:{teamId}:{slotNumber}:{current}";
            combo.EndUpdate();
        }
    }

    private static IEnumerable<string> BuildPlayerOptions(DataTable players)
    {
        foreach (DataRow row in players.Rows)
        {
            var id = Exact(row, "player_index");
            if (string.IsNullOrWhiteSpace(id)) id = Convert.ToString(players.Rows.IndexOf(row)) ?? "0";
            var display = Exact(row, "display_name");
            if (string.IsNullOrWhiteSpace(display)) display = (Exact(row, "first_name") + " " + Exact(row, "last_name")).Trim();
            if (string.IsNullOrWhiteSpace(display)) display = "Player " + id;
            yield return $"{id} - {display}";
        }
    }

    private static string FormatSlotPlayer(DataRow row)
    {
        var id = Exact(row, "player_index");
        var name = Exact(row, "player_name");
        if (string.IsNullOrWhiteSpace(id) && string.IsNullOrWhiteSpace(name)) return "Unassigned";
        if (string.IsNullOrWhiteSpace(name)) name = "Player " + id;
        if (string.IsNullOrWhiteSpace(id)) return name;
        return $"{id} - {name}";
    }

    private static void ApplyUniformPalettePreview(Form form, Control root)
    {
        var row = CurrentTeamRow(form);
        if (row == null) return;

        var secondary = Palette(row, 0, Color.White);
        var primary = Palette(row, 1, Color.Firebrick);
        var trim = Palette(row, 5, primary);

        foreach (var panel in All<Control>(root).Where(c => c.GetType().Name == "GlassPanel"))
        {
            var label = All<Label>(panel).FirstOrDefault(l => (l.Text ?? string.Empty).Contains("Uniform", StringComparison.OrdinalIgnoreCase));
            if (label == null) continue;
            var swatch = panel.Controls.OfType<Panel>().FirstOrDefault();
            if (swatch == null || Equals(swatch.Tag, "palette-uniform")) continue;

            var text = label.Text ?? string.Empty;
            var fill = text.Contains("Home", StringComparison.OrdinalIgnoreCase) ? secondary
                : text.Contains("Away", StringComparison.OrdinalIgnoreCase) ? primary
                : trim;
            var outline = text.Contains("Home", StringComparison.OrdinalIgnoreCase) ? primary : secondary;

            label.Text = text + " (palette preview)";
            swatch.Tag = "palette-uniform";
            swatch.Paint += (_, e) =>
            {
                e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
                using var fillBrush = new SolidBrush(fill);
                using var pen = new Pen(outline, 3);
                var rect = new Rectangle(12, 7, Math.Max(20, swatch.Width - 24), Math.Max(26, swatch.Height - 16));
                e.Graphics.FillRectangle(fillBrush, rect);
                e.Graphics.DrawRectangle(pen, rect);
            };
            swatch.Invalidate();
        }
    }

    private static DataRow? CurrentTeamRow(Form form)
    {
        var tables = GetField<Dictionary<string, DataTable>>(form, "_tables");
        var teamCombo = GetField<ComboBox>(form, "_teamCombo");
        if (tables == null || teamCombo == null || !tables.TryGetValue("teams", out var teams)) return null;
        var id = (Convert.ToString(teamCombo.SelectedItem) ?? string.Empty).Split('-').FirstOrDefault()?.Trim();
        if (string.IsNullOrWhiteSpace(id)) return null;
        return teams.Rows.Cast<DataRow>().FirstOrDefault(r => Exact(r, "team_index") == id);
    }

    private static Color Palette(DataRow row, int index, Color fallback)
    {
        var value = Exact(row, $"palette_{index:00}_hex");
        if (!TryParseHex(value, out var color)) return fallback;
        return color;
    }

    private static bool TryParseHex(string value, out Color color)
    {
        color = Color.Black;
        var cleaned = value.Trim().Replace("#", "").Replace("0x", "", StringComparison.OrdinalIgnoreCase);
        if (cleaned.Length >= 6) cleaned = cleaned[..6];
        if (cleaned.Length != 6 || !cleaned.All(Uri.IsHexDigit)) return false;
        color = Color.FromArgb(Convert.ToInt32(cleaned[..2], 16), Convert.ToInt32(cleaned.Substring(2, 2), 16), Convert.ToInt32(cleaned.Substring(4, 2), 16));
        return true;
    }

    private static string Exact(DataRow row, string column)
    {
        return row.Table.Columns.Contains(column) ? Convert.ToString(row[column])?.Trim() ?? string.Empty : string.Empty;
    }

    private static int ParseInt(string value)
    {
        return int.TryParse(value, out var parsed) ? parsed : -1;
    }

    private static T? GetField<T>(object instance, string name) where T : class
    {
        return instance.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(instance) as T;
    }

    private static IEnumerable<T> All<T>(Control root) where T : Control
    {
        foreach (Control child in root.Controls)
        {
            if (child is T typed) yield return typed;
            foreach (var nested in All<T>(child)) yield return nested;
        }
    }
}

internal static class RuntimeBrandIcon
{
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool DestroyIcon(IntPtr hIcon);

    public static Icon CreateIcon(int size)
    {
        using var bitmap = new Bitmap(size, size, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
        using (var graphics = Graphics.FromImage(bitmap))
        {
            graphics.Clear(Color.Transparent);
            DrawCentered(graphics, new Rectangle(0, 0, size, size), includeGlow: false);
        }
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

    public static void DrawCentered(Graphics g, Rectangle bounds, bool includeGlow)
    {
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
        var size = Math.Min(bounds.Width, bounds.Height);
        var pad = Math.Max(4, size / 16);
        var rect = new Rectangle(bounds.Left + (bounds.Width - size) / 2 + pad, bounds.Top + (bounds.Height - size) / 2 + pad, size - pad * 2, size - pad * 2);
        DrawBadge(g, rect, includeGlow);
    }

    private static void DrawBadge(Graphics g, Rectangle rect, bool includeGlow)
    {
        using var bg = new LinearGradientBrush(rect, Color.FromArgb(5, 18, 34), Color.FromArgb(2, 50, 82), 90f);
        using var framePath = RoundRect(rect, rect.Width / 8f);
        if (includeGlow)
        {
            using var glow = new Pen(Color.FromArgb(95, 70, 210, 255), Math.Max(5, rect.Width / 18f));
            g.DrawPath(glow, framePath);
        }
        g.FillPath(bg, framePath);
        using var outerBlue = new Pen(Color.FromArgb(130, 223, 255), Math.Max(3, rect.Width / 42f));
        using var innerBlue = new Pen(Color.FromArgb(18, 128, 232), Math.Max(2, rect.Width / 60f));
        g.DrawPath(outerBlue, framePath);
        var inset = Inflate(rect, -rect.Width / 13);
        using var innerPath = RoundRect(inset, inset.Width / 9f);
        g.DrawPath(innerBlue, innerPath);

        var gold = Color.FromArgb(247, 176, 33);
        using var goldPen = new Pen(gold, Math.Max(4, rect.Width / 28f)) { StartCap = LineCap.Round, EndCap = LineCap.Round };
        g.DrawArc(goldPen, new Rectangle(rect.Left + rect.Width / 8, rect.Top + rect.Height / 9, rect.Width * 3 / 4, rect.Height / 3), 205, 130);
        g.DrawArc(goldPen, new Rectangle(rect.Left + rect.Width / 8, rect.Bottom - rect.Height * 4 / 9, rect.Width * 3 / 4, rect.Height / 3), 25, 130);

        var centerX = rect.Left + rect.Width * 0.52f;
        using var divider = new Pen(Color.FromArgb(245, 252, 255), Math.Max(4, rect.Width / 28f)) { StartCap = LineCap.Round, EndCap = LineCap.Round };
        g.DrawLine(divider, centerX, rect.Top + rect.Height * .22f, centerX, rect.Bottom - rect.Height * .18f);

        var ballRect = new RectangleF(rect.Left + rect.Width * .17f, rect.Top + rect.Height * .28f, rect.Width * .43f, rect.Height * .42f);
        using var ballPen = new Pen(Color.White, Math.Max(4, rect.Width / 30f)) { StartCap = LineCap.Round, EndCap = LineCap.Round };
        using var ballBlue = new Pen(Color.FromArgb(120, 220, 255), Math.Max(2, rect.Width / 70f)) { StartCap = LineCap.Round, EndCap = LineCap.Round };
        g.DrawArc(ballPen, ballRect, 80, 210);
        g.DrawArc(ballBlue, ballRect, -88, 210);
        g.DrawArc(ballPen, new RectangleF(ballRect.Left + ballRect.Width * .15f, ballRect.Top, ballRect.Width * .55f, ballRect.Height), 90, 180);
        g.DrawArc(ballBlue, new RectangleF(ballRect.Left + ballRect.Width * .32f, ballRect.Top, ballRect.Width * .55f, ballRect.Height), 90, 180);
        g.DrawLine(ballPen, ballRect.Left + 4, ballRect.Top + ballRect.Height * .56f, centerX - rect.Width * .04f, ballRect.Top + ballRect.Height * .56f);

        var board = new RectangleF(rect.Left + rect.Width * .58f, rect.Top + rect.Height * .28f, rect.Width * .28f, rect.Height * .42f);
        using var boardPen = new Pen(Color.FromArgb(112, 218, 255), Math.Max(3, rect.Width / 42f)) { StartCap = LineCap.Round, EndCap = LineCap.Round };
        using var boardPath = RoundRect(board, rect.Width / 18f);
        g.DrawPath(boardPen, boardPath);
        var clip = new RectangleF(board.Left + board.Width * .18f, board.Top - board.Height * .11f, board.Width * .50f, board.Height * .16f);
        using var clipPath = RoundRect(clip, rect.Width / 30f);
        g.DrawPath(boardPen, clipPath);
        for (var i = 0; i < 4; i++)
        {
            var y = board.Top + board.Height * (.25f + i * .18f);
            var dotColor = i == 3 ? gold : Color.White;
            using var dot = new SolidBrush(dotColor);
            using var linePen = new Pen(Color.White, Math.Max(3, rect.Width / 48f)) { StartCap = LineCap.Round, EndCap = LineCap.Round };
            g.FillEllipse(dot, board.Left + board.Width * .17f, y - rect.Width * .018f, rect.Width * .04f, rect.Width * .04f);
            g.DrawLine(linePen, board.Left + board.Width * .38f, y, board.Right - board.Width * .08f, y);
        }

        DrawStar(g, new PointF(rect.Left + rect.Width * .50f, rect.Bottom - rect.Height * .13f), rect.Width * .075f, gold);
    }

    private static Rectangle Inflate(Rectangle rect, int amount) => new(rect.Left + amount, rect.Top + amount, rect.Width - amount * 2, rect.Height - amount * 2);

    private static GraphicsPath RoundRect(Rectangle rect, float radius) => RoundRect(new RectangleF(rect.X, rect.Y, rect.Width, rect.Height), radius);

    private static GraphicsPath RoundRect(RectangleF rect, float radius)
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

    private static void DrawStar(Graphics g, PointF center, float radius, Color color)
    {
        var points = new PointF[10];
        for (var i = 0; i < points.Length; i++)
        {
            var angle = -Math.PI / 2 + i * Math.PI / 5;
            var r = i % 2 == 0 ? radius : radius * .42f;
            points[i] = new PointF(center.X + (float)Math.Cos(angle) * r, center.Y + (float)Math.Sin(angle) * r);
        }
        using var fill = new LinearGradientBrush(new RectangleF(center.X - radius, center.Y - radius, radius * 2, radius * 2), Color.FromArgb(255, 226, 93), color, 90f);
        using var outline = new Pen(Color.FromArgb(255, 245, 190), Math.Max(1, radius / 9f));
        g.FillPolygon(fill, points);
        g.DrawPolygon(outline, points);
    }
}
