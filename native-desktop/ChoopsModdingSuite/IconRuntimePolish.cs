using System;
using System.Collections;
using System.Collections.Generic;
using System.Data;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Text.RegularExpressions;
using System.Windows.Forms;

namespace ChoopsModdingSuite;

/// <summary>
/// Small native stability layer. It does not inject art or mutate text/iconography.
/// It only repairs layout sizing, applies the generated app icon to the window, and
/// prevents non-palette hex fields from being mistaken for team colors.
/// </summary>
internal static class IconRuntimePolish
{
    private static readonly HashSet<Form> Forms = new();
    private static readonly HashSet<FlowLayoutPanel> Flows = new();
    private static readonly Regex HexLike = new("^(#|0x)?[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$", RegexOptions.Compiled);
    private static readonly Regex PaletteHex = new("^palette_\\d{2}_hex$", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex PaletteOffset = new("^palette_\\d{2}_offset$", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    [ModuleInitializer]
    internal static void Initialize()
    {
        Application.Idle += (_, _) => Apply();
    }

    private static void Apply()
    {
        foreach (Form form in Application.OpenForms)
        {
            if (form.IsDisposed) continue;
            if (Forms.Add(form))
            {
                ApplyIcon(form);
                form.Resize += (_, _) => RepairLayout(form);
                form.ControlAdded += (_, _) => RepairLayout(form);
            }
            RepairLayout(form);
            SanitizeTeamPaletteData(form);
        }
    }

    private static void ApplyIcon(Form form)
    {
        foreach (var path in new[]
        {
            Path.Combine(AppContext.BaseDirectory, "app.ico"),
            Path.Combine(AppContext.BaseDirectory, "Assets", "app.ico"),
            Path.Combine(Directory.GetCurrentDirectory(), "native-desktop", "ChoopsModdingSuite", "Assets", "app.ico")
        })
        {
            if (!File.Exists(path)) continue;
            try { form.Icon = new Icon(path); return; }
            catch { }
        }

        try
        {
            var extracted = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            if (extracted != null) form.Icon = extracted;
        }
        catch { }
    }

    private static void RepairLayout(Control root)
    {
        foreach (Control control in Walk(root))
        {
            if (control is FlowLayoutPanel flow)
            {
                if (Flows.Add(flow))
                {
                    flow.ControlAdded += (_, _) => StretchFlow(flow);
                    flow.SizeChanged += (_, _) => StretchFlow(flow);
                    flow.Layout += (_, _) => StretchFlow(flow);
                }
                StretchFlow(flow);
            }

            if (control is Button button)
            {
                button.Image = null;
                if (button.Text == "Q") button.Text = "Queue";
                button.MinimumSize = new Size(Math.Max(80, button.MinimumSize.Width), Math.Max(28, button.MinimumSize.Height));
            }
        }
    }

    private static void StretchFlow(FlowLayoutPanel flow)
    {
        if (flow.FlowDirection != FlowDirection.TopDown || flow.WrapContents) return;
        var width = Math.Max(650, flow.ClientSize.Width - flow.Padding.Horizontal - SystemInformation.VerticalScrollBarWidth - 28);
        foreach (Control child in flow.Controls)
        {
            if (child.Width != width) child.Width = width;
        }
    }

    private static IEnumerable<Control> Walk(Control root)
    {
        var stack = new Stack<Control>();
        stack.Push(root);
        while (stack.Count > 0)
        {
            var current = stack.Pop();
            yield return current;
            foreach (Control child in current.Controls) stack.Push(child);
        }
    }

    private static void SanitizeTeamPaletteData(Form form)
    {
        var field = form.GetType().GetField("_tables", BindingFlags.Instance | BindingFlags.NonPublic);
        if (field?.GetValue(form) is not IDictionary tables) return;
        if (!tables.Contains("teams") || tables["teams"] is not DataTable teams) return;
        if (!HasPaletteColumns(teams)) return;

        foreach (DataColumn col in teams.Columns)
        {
            if (PaletteHex.IsMatch(col.ColumnName) || PaletteOffset.IsMatch(col.ColumnName)) continue;
            foreach (DataRow row in teams.Rows)
            {
                var value = Convert.ToString(row[col]) ?? string.Empty;
                if (HexLike.IsMatch(value.Trim())) row[col] = string.Empty;
            }
        }
    }

    private static bool HasPaletteColumns(DataTable table)
    {
        foreach (DataColumn col in table.Columns)
        {
            if (PaletteHex.IsMatch(col.ColumnName)) return true;
        }
        return false;
    }
}
