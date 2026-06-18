using System;
using System.Collections.Generic;
using System.Data;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Linq;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Text.RegularExpressions;
using System.Windows.Forms;

namespace ChoopsModdingSuite;

/// <summary>
/// One-shot native UI fixups that are safe to run after the main form is created.
/// This does not use a redraw/idle loop and it does not repeatedly mutate layout.
/// </summary>
internal static class IconRuntimePolish
{
    private static bool _installed;

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

        try { form.Icon = BrandImage.CreateIcon(256); } catch { }

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

    private static void ApplyShellSizing(Form form)
    {
        form.MinimumSize = new Size(Math.Max(form.MinimumSize.Width, 1440), Math.Max(form.MinimumSize.Height, 840));

        var root = All<TableLayoutPanel>(form).FirstOrDefault(t => t.RowCount == 4 && t.ColumnCount == 1);
        if (root != null && root.RowStyles.Count >= 4)
        {
            root.RowStyles[0].SizeType = SizeType.Absolute;
            root.RowStyles[0].Height = 150;
            root.RowStyles[1].SizeType = SizeType.Absolute;
            root.RowStyles[1].Height = 124;
            root.RowStyles[3].SizeType = SizeType.Absolute;
            root.RowStyles[3].Height = 36;
        }

        var headerLayout = All<TableLayoutPanel>(form)
            .FirstOrDefault(t => t.RowCount == 3 && t.ColumnCount == 4 && t.ColumnStyles.Count >= 4 && t.RowStyles.Count >= 3);
        if (headerLayout != null)
        {
            headerLayout.RowStyles[0].SizeType = SizeType.Absolute;
            headerLayout.RowStyles[0].Height = 44;
            headerLayout.RowStyles[1].SizeType = SizeType.Absolute;
            headerLayout.RowStyles[1].Height = 24;
            headerLayout.RowStyles[2].SizeType = SizeType.Absolute;
            headerLayout.RowStyles[2].Height = 54;
            headerLayout.ColumnStyles[0].SizeType = SizeType.Absolute;
            headerLayout.ColumnStyles[0].Width = 132;
            headerLayout.ColumnStyles[3].SizeType = SizeType.Absolute;
            headerLayout.ColumnStyles[3].Width = 170;
        }

        foreach (var label in All<Label>(form))
        {
            if (label.Text == "College Hoops 2K8 Roster Studio")
            {
                label.Font = Theme.Font(22f, FontStyle.Bold);
                label.TextAlign = ContentAlignment.MiddleLeft;
            }
        }
    }

    private static void ApplyBrandPainting(Control root)
    {
        foreach (var badge in All<Control>(root).Where(c => c.GetType().Name == "BrandBadge"))
        {
            if (Equals(badge.Tag, "brand-png-applied")) continue;
            badge.Tag = "brand-png-applied";
            badge.Paint += (_, e) =>
            {
                e.Graphics.SmoothingMode = SmoothingMode.HighQuality;
                e.Graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                e.Graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
                using var brush = new SolidBrush(Theme.Header);
                e.Graphics.FillRectangle(brush, badge.ClientRectangle);
                BrandImage.DrawCentered(e.Graphics, badge.ClientRectangle);
            };
            badge.Invalidate();
        }
    }

    private static void ApplyTabSizing(Control root)
    {
        var widths = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase)
        {
            ["Dashboard"] = 130,
            ["School"] = 110,
            ["Spirit"] = 110,
            ["Colors / Floor / Basket / Cheer"] = 300,
            ["Roster Slots"] = 144,
            ["Depth Chart / Rotation"] = 202,
            ["Assets"] = 112,
            ["Conferences"] = 146,
            ["Unknown / Research"] = 190
        };

        foreach (var button in All<Button>(root))
        {
            if (!widths.TryGetValue(button.Text, out var width)) continue;
            button.AutoSize = false;
            button.Height = 42;
            button.Width = width;
            button.MinimumSize = new Size(width, 42);
            button.Font = Theme.Font(9.4f, FontStyle.Bold);
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
                textBox.Font = Theme.Font(10.2f);
                textBox.MinimumSize = new Size(180, 30);
                textBox.Height = 30;
            }

            foreach (var label in All<Label>(table).Where(l => IsSchoolLimitedLabel(l.Text ?? string.Empty)))
            {
                if (!label.Text.Contains("16 max", StringComparison.OrdinalIgnoreCase))
                    label.Text = label.Text + "  (16 max)";
                label.Font = Theme.Font(8.8f, FontStyle.Bold);
            }

            var panel = table.Parent;
            if (panel != null && panel.Height < 110) panel.Height = 110;
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
            if (string.IsNullOrWhiteSpace(display))
            {
                display = (Exact(row, "first_name") + " " + Exact(row, "last_name")).Trim();
            }
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
