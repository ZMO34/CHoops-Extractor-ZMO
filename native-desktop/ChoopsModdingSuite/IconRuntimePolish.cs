using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Windows.Forms;

namespace ChoopsModdingSuite;

/// <summary>
/// Applies the College Hoops Reborn mockup icon treatment to the native WinForms UI.
/// This class intentionally uses only stock WinForms/GDI+ APIs so the native EXE can
/// build on clean .NET SDK installs without extra browser/webview dependencies.
/// </summary>
internal static class IconRuntimePolish
{
    private const string AppliedPrefix = "chrb-icon-polish:";
    private static readonly Dictionary<string, Bitmap> BitmapCache = new(StringComparer.OrdinalIgnoreCase);
    private static readonly Dictionary<string, Icon> IconCache = new(StringComparer.OrdinalIgnoreCase);
    private static readonly HashSet<IntPtr> IconizedForms = new();

    private static readonly Color Navy0 = Color.FromArgb(7, 14, 23);
    private static readonly Color Navy1 = Color.FromArgb(6, 27, 47);
    private static readonly Color Navy2 = Color.FromArgb(8, 47, 78);
    private static readonly Color Ice = Color.FromArgb(96, 210, 255);
    private static readonly Color Ice2 = Color.FromArgb(178, 235, 255);
    private static readonly Color White = Color.FromArgb(248, 253, 255);
    private static readonly Color Silver = Color.FromArgb(185, 207, 225);
    private static readonly Color Gold = Color.FromArgb(221, 163, 36);
    private static readonly Color Green = Color.FromArgb(42, 188, 90);

    [ModuleInitializer]
    internal static void Initialize()
    {
        Application.Idle += (_, _) => PolishOpenForms();
    }

    private static void PolishOpenForms()
    {
        try
        {
            foreach (Form form in Application.OpenForms.Cast<Form>().ToArray())
            {
                if (form.IsDisposed) continue;
                ApplyFormBranding(form);
                PolishControlTree(form);
            }
        }
        catch
        {
            // Cosmetic layer only. The editor must never fail because an icon pass failed.
        }
    }

    private static void ApplyFormBranding(Form form)
    {
        if (form.Handle == IntPtr.Zero) return;
        if (!IconizedForms.Add(form.Handle)) return;

        form.Text = "College Hoops Reborn Modding Suite";
        form.Icon = GetIcon("app", 64);
    }

    private static void PolishControlTree(Control control)
    {
        if (control is Label label) PolishLabel(label);
        if (control is Button button) PolishButton(button);

        foreach (Control child in control.Controls.Cast<Control>().ToArray())
        {
            PolishControlTree(child);
        }
    }

    private static void PolishButton(Button button)
    {
        var cleanText = CleanText(button.Text ?? string.Empty);
        var iconKey = IconKeyForText(cleanText);
        if (iconKey == null) return;

        var applied = AppliedPrefix + "button:" + cleanText;
        if (button.AccessibleDescription == applied) return;

        button.Text = cleanText;
        button.Image = GetBitmap(iconKey, 18);
        button.ImageAlign = ContentAlignment.MiddleLeft;
        button.TextAlign = ContentAlignment.MiddleCenter;
        button.TextImageRelation = TextImageRelation.ImageBeforeText;
        button.Padding = new Padding(10, 0, 12, 0);
        button.AccessibleDescription = applied;
    }

    private static void PolishLabel(Label label)
    {
        var rawText = label.Text ?? string.Empty;

        if (rawText.Contains("CH 2K8", StringComparison.OrdinalIgnoreCase))
        {
            ReplaceHeaderLogo(label);
            return;
        }

        var cleanText = CleanText(rawText);
        var iconKey = IconKeyForText(cleanText);
        if (iconKey == null) return;

        var applied = AppliedPrefix + "label:" + cleanText;
        if (label.AccessibleDescription == applied) return;

        label.Text = "    " + cleanText;
        label.Image = GetBitmap(iconKey, cleanText.Length > 24 ? 18 : 22);
        label.ImageAlign = ContentAlignment.MiddleLeft;
        label.TextAlign = ContentAlignment.MiddleLeft;
        label.Padding = new Padding(2, 0, 0, 0);
        label.AccessibleDescription = applied;
    }

    private static void ReplaceHeaderLogo(Label label)
    {
        var parent = label.Parent;
        if (parent == null || parent.AccessibleDescription == AppliedPrefix + "brand-logo") return;

        parent.Controls.Clear();
        parent.Controls.Add(new PictureBox
        {
            Dock = DockStyle.Fill,
            BackColor = Color.Transparent,
            SizeMode = PictureBoxSizeMode.Zoom,
            Image = GetBitmap("app", 112),
            Padding = new Padding(7)
        });
        parent.AccessibleDescription = AppliedPrefix + "brand-logo";
    }

    private static string? IconKeyForText(string text)
    {
        if (text.Equals("Dashboard", StringComparison.OrdinalIgnoreCase) || text.Contains("Command Center", StringComparison.OrdinalIgnoreCase) || text.Contains("Job Log", StringComparison.OrdinalIgnoreCase)) return "dashboard";
        if (text.Equals("School", StringComparison.OrdinalIgnoreCase) || text.Contains("School", StringComparison.OrdinalIgnoreCase)) return "school";
        if (text.Equals("Spirit", StringComparison.OrdinalIgnoreCase) || text.Contains("Rivals", StringComparison.OrdinalIgnoreCase)) return "spirit";
        if (text.StartsWith("Colors", StringComparison.OrdinalIgnoreCase) || text.Contains("Palette", StringComparison.OrdinalIgnoreCase) || text.Contains("Color", StringComparison.OrdinalIgnoreCase)) return "colors";
        if (text.StartsWith("Roster Slots", StringComparison.OrdinalIgnoreCase)) return "roster";
        if (text.StartsWith("Depth Chart", StringComparison.OrdinalIgnoreCase) || text.Contains("Rotation", StringComparison.OrdinalIgnoreCase)) return "rotation";
        if (text.StartsWith("Assets", StringComparison.OrdinalIgnoreCase) || text.Contains("Quick Info", StringComparison.OrdinalIgnoreCase)) return "assets";
        if (text.StartsWith("Conferences", StringComparison.OrdinalIgnoreCase)) return "conferences";
        if (text.StartsWith("Unknown", StringComparison.OrdinalIgnoreCase) || text.Contains("Research", StringComparison.OrdinalIgnoreCase) || text.Contains("Inspect", StringComparison.OrdinalIgnoreCase)) return "research";
        if (text.Contains("Open Roster", StringComparison.OrdinalIgnoreCase) || text.Equals("Browse", StringComparison.OrdinalIgnoreCase)) return "folder";
        if (text.Contains("Save Copy", StringComparison.OrdinalIgnoreCase)) return "save";
        if (text.Contains("Safe Build", StringComparison.OrdinalIgnoreCase) || text.Contains("Build Copy", StringComparison.OrdinalIgnoreCase)) return "build";
        if (text.Contains("Full Rip", StringComparison.OrdinalIgnoreCase) || text.Equals("Rip", StringComparison.OrdinalIgnoreCase)) return "rip";
        if (text.Contains("Build Cache", StringComparison.OrdinalIgnoreCase) || text.Contains("Cache", StringComparison.OrdinalIgnoreCase)) return "cache";
        if (text.StartsWith("Run", StringComparison.OrdinalIgnoreCase)) return "dashboard";
        return null;
    }

    private static string CleanText(string text)
    {
        return text
            .Replace("🏀", string.Empty)
            .Replace("📂", string.Empty)
            .Replace("💾", string.Empty)
            .Replace("⚡", string.Empty)
            .Replace("🏛", string.Empty)
            .Replace("📣", string.Empty)
            .Replace("🎨", string.Empty)
            .Replace("👥", string.Empty)
            .Replace("↕", string.Empty)
            .Replace("▣", string.Empty)
            .Replace("🧪", string.Empty)
            .Trim();
    }

    private static Bitmap GetBitmap(string key, int size)
    {
        var cacheKey = key + ":" + size;
        if (BitmapCache.TryGetValue(cacheKey, out var cached)) return cached;

        var bitmap = new Bitmap(size, size, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
        using var g = Graphics.FromImage(bitmap);
        g.Clear(Color.Transparent);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;

        switch (key.ToLowerInvariant())
        {
            case "app": DrawAppBrand(g, size); break;
            case "dashboard": DrawDashboard(g, size); break;
            case "school": DrawSchool(g, size); break;
            case "spirit": DrawMegaphone(g, size); break;
            case "colors": DrawColors(g, size); break;
            case "roster": DrawRoster(g, size); break;
            case "rotation": DrawRotation(g, size); break;
            case "assets": DrawAssets(g, size); break;
            case "conferences": DrawConferences(g, size); break;
            case "research": DrawResearch(g, size); break;
            case "folder": DrawFolder(g, size); break;
            case "save": DrawSave(g, size); break;
            case "build": DrawBuild(g, size); break;
            case "rip": DrawRip(g, size); break;
            case "cache": DrawCache(g, size); break;
            default: DrawDashboard(g, size); break;
        }

        BitmapCache[cacheKey] = bitmap;
        return bitmap;
    }

    private static Icon GetIcon(string key, int size)
    {
        var cacheKey = key + ":" + size;
        if (IconCache.TryGetValue(cacheKey, out var icon)) return icon;
        icon = Icon.FromHandle(GetBitmap(key, size).GetHicon());
        IconCache[cacheKey] = icon;
        return icon;
    }

    private static void DrawAppBrand(Graphics g, int s)
    {
        var r = Rect(s, .07f, .07f, .86f, .86f);
        FillRound(g, r, s * .14f, Navy0, Navy2);
        StrokeRound(g, r, s * .14f, Gold, Math.Max(2, s * .034f));
        StrokeRound(g, Shrink(r, s * .07f), s * .10f, Ice, Math.Max(2, s * .020f));

        using var seamPen = new Pen(Ice2, Math.Max(1, s * .027f));
        var ball = Rect(s, .19f, .13f, .62f, .43f);
        g.DrawArc(seamPen, ball, 190, 160);
        g.DrawArc(seamPen, ball, -10, 160);
        g.DrawBezier(seamPen, new PointF(s * .27f, s * .20f), new PointF(s * .38f, s * .42f), new PointF(s * .58f, s * .40f), new PointF(s * .73f, s * .20f));

        var band = Rect(s, .13f, .45f, .74f, .24f);
        FillRound(g, band, s * .06f, Color.FromArgb(235, 3, 18, 31), Color.FromArgb(235, 5, 48, 82));
        StrokeRound(g, band, s * .06f, Ice, Math.Max(1, s * .016f));
        DrawCenteredText(g, "CHRB", Rect(s, .16f, .47f, .48f, .16f), White, "Segoe UI Black", s * .17f, FontStyle.Bold);
        DrawCenteredText(g, "2K", Rect(s, .61f, .47f, .23f, .16f), Gold, "Segoe UI Black", s * .17f, FontStyle.Bold);
        if (s >= 64) DrawCenteredText(g, "REBORN", Rect(s, .18f, .67f, .64f, .11f), Ice2, "Segoe UI", s * .075f, FontStyle.Bold);
    }

    private static void DrawDashboard(Graphics g, int s)
    {
        DrawShield(g, s);
        using var p = new Pen(Ice2, Math.Max(1, s * .035f));
        using var b = new SolidBrush(Ice);
        for (var i = 0; i < 4; i++)
        {
            var h = s * (.10f + i * .055f);
            g.FillRectangle(b, s * (.24f + i * .075f), s * .64f - h, s * .048f, h);
        }
        g.DrawArc(p, Rect(s, .58f, .26f, .24f, .24f), 20, 290);
        g.DrawLines(p, new[] { new PointF(s * .23f, s * .74f), new PointF(s * .38f, s * .63f), new PointF(s * .52f, s * .70f), new PointF(s * .77f, s * .53f) });
    }

    private static void DrawSchool(Graphics g, int s)
    {
        DrawGlow(g, Rect(s, .14f, .20f, .72f, .62f));
        using var white = new SolidBrush(White);
        using var dark = new SolidBrush(Navy1);
        using var pen = new Pen(Ice, Math.Max(1, s * .025f));
        var roof = new[] { new PointF(s * .18f, s * .42f), new PointF(s * .50f, s * .16f), new PointF(s * .82f, s * .42f) };
        g.FillPolygon(white, roof);
        g.DrawPolygon(pen, roof);
        g.FillRectangle(dark, Rect(s, .23f, .42f, .54f, .36f));
        for (var i = 0; i < 3; i++) g.FillRectangle(white, Rect(s, .29f + i * .16f, .47f, .075f, .25f));
        g.FillRectangle(white, Rect(s, .21f, .74f, .58f, .05f));
    }

    private static void DrawMegaphone(Graphics g, int s)
    {
        DrawGlow(g, Rect(s, .12f, .21f, .76f, .58f));
        using var dark = new SolidBrush(Navy1);
        using var blue = new SolidBrush(Ice);
        using var whitePen = new Pen(White, Math.Max(2, s * .045f));
        var horn = new[] { new PointF(s * .22f, s * .54f), new PointF(s * .74f, s * .25f), new PointF(s * .84f, s * .75f) };
        g.FillPolygon(dark, horn);
        g.DrawPolygon(whitePen, horn);
        g.DrawEllipse(whitePen, Rect(s, .70f, .25f, .18f, .50f));
        g.FillRectangle(dark, Rect(s, .15f, .48f, .14f, .14f));
        g.FillPolygon(blue, new[] { new PointF(s * .34f, s * .47f), new PointF(s * .55f, s * .40f), new PointF(s * .50f, s * .55f), new PointF(s * .34f, s * .58f) });
    }

    private static void DrawColors(Graphics g, int s)
    {
        DrawRoundedBadge(g, s);
        using var whitePen = new Pen(White, Math.Max(1, s * .035f));
        using var courtPen = new Pen(Ice2, Math.Max(1, s * .025f));
        g.DrawArc(whitePen, Rect(s, .20f, .20f, .42f, .38f), 80, 280);
        var wells = new[] { (Color.White, .34f, .28f), (Ice, .49f, .24f), (Gold, .26f, .43f), (Silver, .39f, .53f) };
        foreach (var (c, x, y) in wells)
        {
            using var b = new SolidBrush(c);
            g.FillEllipse(b, Rect(s, x, y, .09f, .09f));
        }
        g.DrawRectangle(courtPen, Rectangle.Round(Rect(s, .47f, .39f, .32f, .34f)));
        g.DrawArc(courtPen, Rect(s, .53f, .52f, .20f, .18f), 0, 180);
        g.DrawLine(courtPen, s * .63f, s * .39f, s * .63f, s * .73f);
    }

    private static void DrawRoster(Graphics g, int s)
    {
        DrawRoundRing(g, s);
        using var white = new SolidBrush(White);
        using var pen = new Pen(Ice, Math.Max(1, s * .018f));
        DrawPerson(g, s * .50f, s * .34f, s * .18f, white, pen);
        DrawPerson(g, s * .33f, s * .42f, s * .14f, white, pen);
        DrawPerson(g, s * .67f, s * .42f, s * .14f, white, pen);
        DrawCenteredText(g, "1", Rect(s, .26f, .70f, .14f, .16f), Ice2, "Segoe UI Black", s * .15f, FontStyle.Bold);
        DrawCenteredText(g, "2", Rect(s, .43f, .68f, .16f, .18f), White, "Segoe UI Black", s * .18f, FontStyle.Bold);
        DrawCenteredText(g, "3", Rect(s, .62f, .70f, .14f, .16f), Ice2, "Segoe UI Black", s * .15f, FontStyle.Bold);
    }

    private static void DrawRotation(Graphics g, int s)
    {
        DrawRoundRing(g, s);
        using var white = new SolidBrush(White);
        using var pen = new Pen(Ice, Math.Max(2, s * .035f)) { StartCap = LineCap.Round, EndCap = LineCap.ArrowAnchor };
        DrawPerson(g, s * .50f, s * .37f, s * .12f, white, new Pen(Ice, 1));
        DrawPerson(g, s * .50f, s * .55f, s * .15f, white, new Pen(Ice, 1));
        DrawPerson(g, s * .50f, s * .73f, s * .18f, white, new Pen(Ice, 1));
        g.DrawArc(pen, Rect(s, .20f, .22f, .60f, .60f), 145, 120);
        g.DrawArc(pen, Rect(s, .20f, .22f, .60f, .60f), -35, 120);
    }

    private static void DrawAssets(Graphics g, int s)
    {
        DrawGlow(g, Rect(s, .16f, .16f, .68f, .68f));
        using var pen = new Pen(White, Math.Max(2, s * .04f));
        using var fill = new LinearGradientBrush(Rect(s, .20f, .22f, .60f, .56f), Navy1, Navy2, 90f);
        var top = new[] { new PointF(s * .25f, s * .34f), new PointF(s * .50f, s * .18f), new PointF(s * .75f, s * .34f), new PointF(s * .50f, s * .49f) };
        var left = new[] { new PointF(s * .25f, s * .34f), new PointF(s * .50f, s * .49f), new PointF(s * .50f, s * .79f), new PointF(s * .25f, s * .63f) };
        var right = new[] { new PointF(s * .75f, s * .34f), new PointF(s * .50f, s * .49f), new PointF(s * .50f, s * .79f), new PointF(s * .75f, s * .63f) };
        g.FillPolygon(fill, top); g.FillPolygon(fill, left); g.FillPolygon(fill, right);
        g.DrawPolygon(pen, top); g.DrawPolygon(pen, left); g.DrawPolygon(pen, right);
        DrawBasketballMini(g, Rect(s, .42f, .25f, .16f, .16f));
        DrawFolderShape(g, Rect(s, .57f, .52f, .16f, .14f));
    }

    private static void DrawConferences(Graphics g, int s)
    {
        DrawGlow(g, Rect(s, .12f, .16f, .76f, .68f));
        using var pen = new Pen(Ice, Math.Max(2, s * .035f));
        using var fill = new SolidBrush(Navy1);
        var top = ShieldPath(Rect(s, .37f, .12f, .26f, .24f));
        var left = ShieldPath(Rect(s, .15f, .55f, .24f, .25f));
        var mid = ShieldPath(Rect(s, .38f, .58f, .24f, .25f));
        var right = ShieldPath(Rect(s, .61f, .55f, .24f, .25f));
        g.DrawLine(pen, s * .50f, s * .36f, s * .50f, s * .54f);
        g.DrawLine(pen, s * .27f, s * .54f, s * .73f, s * .54f);
        foreach (var path in new[] { top, left, mid, right }) { g.FillPath(fill, path); g.DrawPath(pen, path); path.Dispose(); }
        DrawBasketballMini(g, Rect(s, .43f, .17f, .14f, .14f));
        DrawStar(g, new PointF(s * .27f, s * .66f), s * .045f, White);
        DrawStar(g, new PointF(s * .50f, s * .69f), s * .045f, White);
        DrawStar(g, new PointF(s * .73f, s * .66f), s * .045f, White);
    }

    private static void DrawResearch(Graphics g, int s)
    {
        DrawShield(g, s);
        using var p = new Pen(White, Math.Max(2, s * .04f));
        using var thin = new Pen(Ice, Math.Max(1, s * .02f));
        g.DrawRectangle(thin, Rectangle.Round(Rect(s, .26f, .18f, .42f, .56f)));
        DrawBasketballMini(g, Rect(s, .31f, .25f, .14f, .14f));
        g.DrawLine(thin, s * .48f, s * .30f, s * .62f, s * .30f);
        g.DrawLine(thin, s * .48f, s * .38f, s * .60f, s * .38f);
        g.DrawEllipse(p, Rect(s, .42f, .38f, .28f, .28f));
        g.DrawLine(p, s * .63f, s * .62f, s * .78f, s * .77f);
        DrawCenteredText(g, "?", Rect(s, .46f, .40f, .20f, .22f), Ice2, "Segoe UI Black", s * .18f, FontStyle.Bold);
    }

    private static void DrawFolder(Graphics g, int s) => DrawFolderShape(g, Rect(s, .16f, .28f, .68f, .44f));

    private static void DrawSave(Graphics g, int s)
    {
        DrawRoundedBadge(g, s);
        using var p = new Pen(White, Math.Max(2, s * .04f));
        using var b = new SolidBrush(Gold);
        var body = Rect(s, .25f, .20f, .50f, .58f);
        using var bodyBrush = new SolidBrush(Navy1);
        g.FillRectangle(bodyBrush, body);
        g.DrawRectangle(p, Rectangle.Round(body));
        g.FillRectangle(b, Rect(s, .34f, .24f, .30f, .16f));
        g.DrawRectangle(p, Rectangle.Round(Rect(s, .34f, .55f, .30f, .18f)));
    }

    private static void DrawBuild(Graphics g, int s)
    {
        DrawAssets(g, s);
        using var b = new SolidBrush(Green);
        g.FillEllipse(b, Rect(s, .63f, .63f, .18f, .18f));
        using var p = new Pen(White, Math.Max(1, s * .025f));
        g.DrawLine(p, s * .67f, s * .72f, s * .71f, s * .76f);
        g.DrawLine(p, s * .71f, s * .76f, s * .78f, s * .66f);
    }

    private static void DrawRip(Graphics g, int s)
    {
        DrawRoundedBadge(g, s);
        using var p = new Pen(Ice2, Math.Max(2, s * .035f)) { EndCap = LineCap.ArrowAnchor };
        g.DrawLine(p, s * .25f, s * .50f, s * .73f, s * .50f);
        using var white = new SolidBrush(White);
        g.FillRectangle(white, Rect(s, .22f, .30f, .12f, .40f));
        DrawFolderShape(g, Rect(s, .58f, .34f, .22f, .26f));
    }

    private static void DrawCache(Graphics g, int s)
    {
        DrawRoundedBadge(g, s);
        using var p = new Pen(Ice2, Math.Max(2, s * .035f));
        var cylinder = Rect(s, .25f, .22f, .50f, .58f);
        g.DrawEllipse(p, Rect(s, .25f, .22f, .50f, .16f));
        g.DrawLine(p, cylinder.Left, cylinder.Top + s * .08f, cylinder.Left, cylinder.Bottom - s * .08f);
        g.DrawLine(p, cylinder.Right, cylinder.Top + s * .08f, cylinder.Right, cylinder.Bottom - s * .08f);
        g.DrawEllipse(p, Rect(s, .25f, .64f, .50f, .16f));
        g.DrawArc(p, Rect(s, .25f, .43f, .50f, .16f), 0, 180);
    }

    private static void DrawRoundedBadge(Graphics g, int s)
    {
        var r = Rect(s, .12f, .12f, .76f, .76f);
        FillRound(g, r, s * .10f, Navy0, Navy2);
        StrokeRound(g, r, s * .10f, Ice, Math.Max(2, s * .03f));
        StrokeRound(g, Shrink(r, s * .05f), s * .08f, Color.FromArgb(110, Ice), Math.Max(1, s * .012f));
    }

    private static void DrawShield(Graphics g, int s)
    {
        DrawGlow(g, Rect(s, .10f, .10f, .80f, .80f));
        using var path = new GraphicsPath();
        path.AddPolygon(new[]
        {
            new PointF(s * .18f, s * .26f), new PointF(s * .50f, s * .12f), new PointF(s * .82f, s * .26f),
            new PointF(s * .82f, s * .70f), new PointF(s * .50f, s * .88f), new PointF(s * .18f, s * .70f)
        });
        using var fill = new LinearGradientBrush(Rect(s, .12f, .10f, .76f, .78f), Navy0, Navy2, 90f);
        using var pen = new Pen(Ice, Math.Max(2, s * .032f));
        g.FillPath(fill, path);
        g.DrawPath(pen, path);
    }

    private static void DrawRoundRing(Graphics g, int s)
    {
        using var outer = new Pen(Ice2, Math.Max(2, s * .035f));
        using var inner = new SolidBrush(Navy1);
        g.FillEllipse(inner, Rect(s, .13f, .13f, .74f, .74f));
        g.DrawEllipse(outer, Rect(s, .13f, .13f, .74f, .74f));
    }

    private static void DrawFolderShape(Graphics g, RectangleF r)
    {
        using var fill = new LinearGradientBrush(r, Navy1, Navy2, 90f);
        using var pen = new Pen(White, Math.Max(1, r.Width * .07f));
        using var path = new GraphicsPath();
        path.AddLine(r.Left, r.Top + r.Height * .25f, r.Left + r.Width * .30f, r.Top + r.Height * .25f);
        path.AddLine(r.Left + r.Width * .37f, r.Top, r.Left + r.Width * .57f, r.Top);
        path.AddLine(r.Left + r.Width * .66f, r.Top + r.Height * .25f, r.Right, r.Top + r.Height * .25f);
        path.AddLine(r.Right, r.Bottom, r.Left, r.Bottom);
        path.CloseFigure();
        g.FillPath(fill, path);
        g.DrawPath(pen, path);
    }

    private static void DrawBasketballMini(Graphics g, RectangleF r)
    {
        using var p = new Pen(Ice2, Math.Max(1, r.Width * .10f));
        g.DrawEllipse(p, r);
        g.DrawLine(p, r.Left + r.Width / 2, r.Top, r.Left + r.Width / 2, r.Bottom);
        g.DrawArc(p, r, 90, 180);
        g.DrawArc(p, r, -90, 180);
    }

    private static void DrawPerson(Graphics g, float cx, float cy, float scale, Brush brush, Pen pen)
    {
        var head = new RectangleF(cx - scale * .32f, cy - scale * .58f, scale * .64f, scale * .64f);
        var body = new RectangleF(cx - scale * .52f, cy - scale * .02f, scale * 1.04f, scale * .74f);
        g.FillEllipse(brush, head);
        g.DrawEllipse(pen, head);
        g.FillPie(brush, body, 180, 180);
        g.DrawArc(pen, body, 180, 180);
    }

    private static GraphicsPath ShieldPath(RectangleF r)
    {
        var path = new GraphicsPath();
        path.AddPolygon(new[]
        {
            new PointF(r.Left, r.Top), new PointF(r.Right, r.Top), new PointF(r.Right, r.Top + r.Height * .62f),
            new PointF(r.Left + r.Width * .50f, r.Bottom), new PointF(r.Left, r.Top + r.Height * .62f)
        });
        return path;
    }

    private static void DrawStar(Graphics g, PointF center, float radius, Color color)
    {
        var points = new List<PointF>();
        for (var i = 0; i < 10; i++)
        {
            var angle = -Math.PI / 2 + i * Math.PI / 5;
            var r = i % 2 == 0 ? radius : radius * .42f;
            points.Add(new PointF(center.X + (float)Math.Cos(angle) * r, center.Y + (float)Math.Sin(angle) * r));
        }
        using var brush = new SolidBrush(color);
        g.FillPolygon(brush, points.ToArray());
    }

    private static void DrawGlow(Graphics g, RectangleF r)
    {
        using var pen = new Pen(Color.FromArgb(70, Ice), Math.Max(3, r.Width * .04f));
        g.DrawEllipse(pen, r);
    }

    private static void FillRound(Graphics g, RectangleF rect, float radius, Color top, Color bottom)
    {
        using var path = RoundRect(rect, radius);
        using var brush = new LinearGradientBrush(rect, top, bottom, 90f);
        g.FillPath(brush, path);
    }

    private static void StrokeRound(Graphics g, RectangleF rect, float radius, Color color, float width)
    {
        using var path = RoundRect(rect, radius);
        using var pen = new Pen(color, width);
        g.DrawPath(pen, path);
    }

    private static GraphicsPath RoundRect(RectangleF rect, float radius)
    {
        var path = new GraphicsPath();
        var d = radius * 2;
        if (d <= 0)
        {
            path.AddRectangle(rect);
            return path;
        }
        path.AddArc(rect.Left, rect.Top, d, d, 180, 90);
        path.AddArc(rect.Right - d, rect.Top, d, d, 270, 90);
        path.AddArc(rect.Right - d, rect.Bottom - d, d, d, 0, 90);
        path.AddArc(rect.Left, rect.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }

    private static RectangleF Rect(int s, float x, float y, float w, float h) => new(s * x, s * y, s * w, s * h);
    private static RectangleF Shrink(RectangleF r, float v) => new(r.X + v, r.Y + v, r.Width - v * 2, r.Height - v * 2);

    private static void DrawCenteredText(Graphics g, string text, RectangleF rect, Color color, string family, float size, FontStyle style)
    {
        using var font = new Font(family, Math.Max(6, size), style, GraphicsUnit.Pixel);
        using var brush = new SolidBrush(color);
        using var format = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
        g.DrawString(text, font, brush, rect, format);
    }
}
