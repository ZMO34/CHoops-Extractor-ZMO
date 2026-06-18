using System;
using System.Collections;
using System.Collections.Generic;
using System.Data;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace ChoopsModdingSuite;

/// <summary>
/// Small native stability layer. It does not inject art or mutate text/iconography.
/// It repairs layout sizing, applies the generated app icon, prevents non-palette
/// hex fields from being mistaken for colors, and wires existing dashboard workflow
/// buttons to the form's existing CLI runner.
/// </summary>
internal static class IconRuntimePolish
{
    private static readonly HashSet<Form> Forms = new();
    private static readonly HashSet<FlowLayoutPanel> Flows = new();
    private static readonly HashSet<Button> WiredButtons = new();
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
                WireWorkflowButton(button);
            }
        }
    }

    private static void WireWorkflowButton(Button button)
    {
        if (!button.Text.Contains("Run / Configure", StringComparison.OrdinalIgnoreCase)) return;
        if (!WiredButtons.Add(button)) return;
        button.Click += async (_, _) => await RunWorkflowForButton(button);
    }

    private static async Task RunWorkflowForButton(Button button)
    {
        var form = button.FindForm();
        if (form == null) return;
        var title = FindTileTitle(button);
        try
        {
            if (title.Contains("Safe Build Copy", StringComparison.OrdinalIgnoreCase))
            {
                var vanilla = AskFolder("Select vanilla JB folder or USRDIR"); if (vanilla == null) return;
                var mod = AskFolder("Select mod folder"); if (mod == null) return;
                var output = AskFolder("Select output folder for copied build"); if (output == null) return;
                await InvokeExistingRunner(form, new[] { "build-copy", vanilla, mod, output, "--overwrite", "--progress" });
            }
            else if (title.Contains("Dynamic Full Rip", StringComparison.OrdinalIgnoreCase))
            {
                var usrdir = AskFolder("Select game USRDIR"); if (usrdir == null) return;
                var output = AskFolder("Select rip output folder"); if (output == null) return;
                await InvokeExistingRunner(form, new[] { "rip", usrdir, output, "--build-cache", "--game-name", "choops2k8", "--progress" });
            }
            else if (title.Contains("Build Cache", StringComparison.OrdinalIgnoreCase))
            {
                var usrdir = AskFolder("Select game USRDIR"); if (usrdir == null) return;
                await InvokeExistingRunner(form, new[] { "build-cache", usrdir, "--game-name", "choops2k8", "--progress" });
            }
        }
        catch (Exception ex)
        {
            MessageBox.Show(ex.Message, title, MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private static async Task InvokeExistingRunner(Form form, IEnumerable<string> args)
    {
        var method = form.GetType().GetMethod("RunCliAsync", BindingFlags.Instance | BindingFlags.NonPublic);
        if (method == null) throw new InvalidOperationException("Native command runner was not found on the main form.");
        if (method.Invoke(form, new object[] { args }) is Task task) await task;
    }

    private static string FindTileTitle(Control control)
    {
        var root = control.Parent;
        while (root != null && root.GetType().Name != "GlassPanel") root = root.Parent;
        if (root == null) return string.Empty;
        foreach (var label in Walk(root).OfType<Label>())
        {
            if (!string.IsNullOrWhiteSpace(label.Text)) return label.Text;
        }
        return string.Empty;
    }

    private static string? AskFolder(string description)
    {
        using var dialog = new FolderBrowserDialog { Description = description };
        return dialog.ShowDialog() == DialogResult.OK ? dialog.SelectedPath : null;
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
