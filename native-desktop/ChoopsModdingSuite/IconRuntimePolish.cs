using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace ChoopsModdingSuite;

/// <summary>
/// One-shot native startup stabilization only.
///
/// No generated .ico files, no repeated idle/layout repair loops, and no post-render icon
/// mutation pass. The repo carries the static SVG source asset in Assets/app-icon.svg, while
/// this class renders the same simple CH/Reborn basketball mark directly for the running
/// window/taskbar icon.
/// </summary>
internal static class IconRuntimePolish
{
    private static bool Applied;

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool DestroyIcon(IntPtr hIcon);

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
            ApplyRuntimeIcon(form);
            FixTabButtons(form);
        }
    }

    private static void ApplyRuntimeIcon(Form form)
    {
        try
        {
            form.Icon = CreateRuntimeIcon(256);
        }
        catch
        {
            // Never crash startup because of icon rendering.
        }
    }

    private static Icon CreateRuntimeIcon(int size)
    {
        using var bitmap = new Bitmap(size, size, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(bitmap))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
            g.Clear(Color.Transparent);

            var navyTop = Color.FromArgb(255, 3, 21, 38);
            var navyBottom = Color.FromArgb(255, 4, 62, 103);
            var ice = Color.FromArgb(255, 115, 219, 255);
            var white = Color.FromArgb(255, 248, 253, 255);
            var gold = Color.FromArgb(255, 225, 169, 42);
            var ballTop = Color.FromArgb(255, 190, 107, 24);
            var ballBottom = Color.FromArgb(255, 85, 37, 8);

            var outer = new RectangleF(size * .055f, size * .055f, size * .89f, size * .89f);
            using var outerPath = RoundRect(outer, size * .18f);
            using var bg = new LinearGradientBrush(outer, navyTop, navyBottom, 90f);
            using var goldPen = new Pen(gold, Math.Max(5, size * .045f));
            using var icePen = new Pen(ice, Math.Max(2, size * .022f));
            g.FillPath(bg, outerPath);
            g.DrawPath(goldPen, outerPath);

            var inner = new RectangleF(size * .135f, size * .135f, size * .73f, size * .73f);
            using var innerPath = RoundRect(inner, size * .13f);
            g.DrawPath(icePen, innerPath);

            var ball = new RectangleF(size * .20f, size * .18f, size * .60f, size * .44f);
            using var ballBrush = new LinearGradientBrush(ball, ballTop, ballBottom, 90f);
            using var seamPen = new Pen(gold, Math.Max(3, size * .028f)) { StartCap = LineCap.Round, EndCap = LineCap.Round };
            g.FillEllipse(ballBrush, ball);
            g.DrawEllipse(seamPen, ball);
            g.DrawArc(seamPen, ball, 205, 130);
            g.DrawArc(seamPen, ball, 25, 130);
            g.DrawLine(seamPen, size * .50f, size * .19f, size * .50f, size * .61f);

            DrawCenteredText(g, "CH", new RectangleF(size * .13f, size * .49f, size * .43f, size * .24f), white, size * .26f, "Segoe UI Black");
            DrawCenteredText(g, "2K", new RectangleF(size * .54f, size * .50f, size * .31f, size * .23f), gold, size * .23f, "Segoe UI Black");
            DrawCenteredText(g, "REBORN", new RectangleF(size * .18f, size * .75f, size * .64f, size * .095f), ice, size * .075f, "Segoe UI");
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

    private static void DrawCenteredText(Graphics g, string text, RectangleF rect, Color color, float size, string family)
    {
        using var font = new Font(family, size, FontStyle.Bold, GraphicsUnit.Pixel);
        using var brush = new SolidBrush(color);
        using var format = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
        g.DrawString(text, font, brush, rect, format);
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

            button.Width = button.Text switch
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
