using System;
using System.Drawing;
using System.IO;
using System.Runtime.CompilerServices;
using System.Windows.Forms;

namespace ChoopsModdingSuite;

/// <summary>
/// One-shot native startup stabilization only.
///
/// This file intentionally does NOT subscribe to repeated idle/layout/resize loops. The
/// previous implementation mutated layout on every Application.Idle and during FlowLayout
/// Layout events, which caused Dashboard, Spirit, and Unknown/Research to flash rapidly.
/// Keep this class limited to safe one-time startup work: apply the app icon and give
/// top-tab buttons enough space so their text is not clipped.
/// </summary>
internal static class IconRuntimePolish
{
    private static bool Applied;

    [ModuleInitializer]
    internal static void Initialize()
    {
        Application.Idle += ApplyOnceOnIdle;
    }

    private static void ApplyOnceOnIdle(object? sender, EventArgs e)
    {
        Application.Idle -= ApplyOnceOnIdle;
        if (Applied) return;
        Applied = true;

        foreach (Form form in Application.OpenForms)
        {
            ApplyIcon(form);
            FixTabButtons(form);
        }
    }

    private static void ApplyIcon(Form form)
    {
        foreach (var path in new[]
        {
            Path.Combine(AppContext.BaseDirectory, "app.ico"),
            Path.Combine(AppContext.BaseDirectory, "Assets", "app.ico"),
            Path.Combine(Directory.GetCurrentDirectory(), "release", "app.ico"),
            Path.Combine(Directory.GetCurrentDirectory(), "native-desktop", "ChoopsModdingSuite", "Assets", "app.ico")
        })
        {
            if (!File.Exists(path)) continue;
            try
            {
                using var icon = new Icon(path);
                form.Icon = (Icon)icon.Clone();
                return;
            }
            catch
            {
                // Try the next candidate.
            }
        }

        try
        {
            var embedded = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            if (embedded != null) form.Icon = embedded;
        }
        catch
        {
            // If Windows cannot extract an icon, keep the default icon rather than crashing.
        }
    }

    private static void FixTabButtons(Control root)
    {
        foreach (Control control in Walk(root))
        {
            if (control is not Button button) continue;
            if (!LooksLikeTopTab(button)) continue;

            button.AutoSize = false;
            button.Height = 42;
            button.MinimumSize = new Size(110, 42);
            button.TextAlign = ContentAlignment.MiddleCenter;
            button.Padding = new Padding(12, 0, 12, 0);
            button.Margin = new Padding(0, 0, 8, 0);

            var width = button.Text switch
            {
                "Dashboard" => 124,
                "School" => 104,
                "Spirit" => 104,
                "Colors / Floor / Basket / Cheer" => 286,
                "Roster Slots" => 132,
                "Depth Chart / Rotation" => 190,
                "Assets" => 104,
                "Conferences" => 132,
                "Unknown / Research" => 178,
                _ => Math.Max(120, button.Width)
            };
            button.Width = width;
        }
    }

    private static bool LooksLikeTopTab(Button button)
    {
        var text = button.Text.Trim();
        return text is "Dashboard" or "School" or "Spirit" or "Colors / Floor / Basket / Cheer" or
            "Roster Slots" or "Depth Chart / Rotation" or "Assets" or "Conferences" or "Unknown / Research";
    }

    private static System.Collections.Generic.IEnumerable<Control> Walk(Control root)
    {
        var stack = new System.Collections.Generic.Stack<Control>();
        stack.Push(root);
        while (stack.Count > 0)
        {
            var current = stack.Pop();
            yield return current;
            foreach (Control child in current.Controls) stack.Push(child);
        }
    }
}
