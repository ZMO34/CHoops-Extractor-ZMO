using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;

namespace ChoopsModdingSuite;

internal static class BrandImage
{
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool DestroyIcon(IntPtr hIcon);

    public static Icon CreateIcon(int size = 256)
    {
        using var bitmap = new Bitmap(size, size, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(bitmap))
        {
            g.SmoothingMode = SmoothingMode.HighQuality;
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.Clear(Color.Transparent);
            DrawCentered(g, new Rectangle(0, 0, size, size));
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

    public static void DrawCentered(Graphics g, Rectangle bounds)
    {
        g.SmoothingMode = SmoothingMode.HighQuality;
        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
        g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;

        var size = Math.Min(bounds.Width, bounds.Height);
        var x = bounds.Left + (bounds.Width - size) / 2;
        var y = bounds.Top + (bounds.Height - size) / 2;
        var pad = Math.Max(4, size / 18);
        var rect = new Rectangle(x + pad, y + pad, size - pad * 2, size - pad * 2);

        using var shadow = new SolidBrush(Color.FromArgb(75, 0, 0, 0));
        g.FillEllipse(shadow, new Rectangle(rect.Left + rect.Width / 12, rect.Bottom - rect.Height / 8, rect.Width - rect.Width / 6, rect.Height / 9));

        using var outer = Drawing.RoundRect(rect, size / 8f);
        using var bg = new LinearGradientBrush(rect, Color.FromArgb(7, 18, 36), Color.FromArgb(3, 43, 76), 90f);
        g.FillPath(bg, outer);

        using var glowBlue = new Pen(Color.FromArgb(70, 95, 210, 255), Math.Max(7, size / 28f));
        using var edgeBlue = new Pen(Color.FromArgb(245, 105, 220, 255), Math.Max(3, size / 54f));
        using var innerBlue = new Pen(Color.FromArgb(245, 34, 151, 244), Math.Max(2, size / 80f));
        g.DrawPath(glowBlue, outer);
        g.DrawPath(edgeBlue, outer);

        var innerRect = Rectangle.Inflate(rect, -rect.Width / 12, -rect.Height / 12);
        using var innerPath = Drawing.RoundRect(innerRect, size / 10f);
        g.DrawPath(innerBlue, innerPath);

        using var gold = new Pen(Color.FromArgb(255, 246, 178, 48), Math.Max(5, size / 40f)) { StartCap = LineCap.Round, EndCap = LineCap.Round };
        g.DrawArc(gold, innerRect.Left + innerRect.Width / 18, innerRect.Top + innerRect.Height / 18, innerRect.Width - innerRect.Width / 9, innerRect.Height / 2, 205, 132);
        g.DrawArc(gold, innerRect.Left + innerRect.Width / 18, innerRect.Top + innerRect.Height / 2 - innerRect.Height / 18, innerRect.Width - innerRect.Width / 9, innerRect.Height / 2, 23, 132);

        var dividerX = innerRect.Left + innerRect.Width * 0.49f;
        using var whiteGlow = new Pen(Color.FromArgb(95, 80, 200, 255), Math.Max(8, size / 30f)) { StartCap = LineCap.Round, EndCap = LineCap.Round };
        using var white = new Pen(Color.FromArgb(255, 245, 252, 255), Math.Max(3, size / 70f)) { StartCap = LineCap.Round, EndCap = LineCap.Round };
        g.DrawLine(whiteGlow, dividerX, innerRect.Top + innerRect.Height * .18f, dividerX, innerRect.Bottom - innerRect.Height * .14f);
        g.DrawLine(white, dividerX, innerRect.Top + innerRect.Height * .18f, dividerX, innerRect.Bottom - innerRect.Height * .14f);

        var ball = new RectangleF(innerRect.Left + innerRect.Width * .08f, innerRect.Top + innerRect.Height * .22f, innerRect.Width * .43f, innerRect.Height * .50f);
        using var ballPen = new Pen(Color.FromArgb(255, 238, 248, 255), Math.Max(3, size / 60f)) { StartCap = LineCap.Round, EndCap = LineCap.Round };
        using var ballGlow = new Pen(Color.FromArgb(85, 85, 200, 255), Math.Max(9, size / 24f)) { StartCap = LineCap.Round, EndCap = LineCap.Round };
        g.DrawArc(ballGlow, ball, 80, 235);
        g.DrawArc(ballPen, ball, 80, 235);
        g.DrawArc(ballPen, ball.Left + ball.Width * .05f, ball.Top + ball.Height * .04f, ball.Width * .62f, ball.Height * .92f, 100, 142);
        g.DrawArc(ballPen, ball.Left + ball.Width * .13f, ball.Top + ball.Height * .10f, ball.Width * .84f, ball.Height * .80f, 230, 94);
        g.DrawLine(ballPen, ball.Left + ball.Width * .06f, ball.Top + ball.Height * .64f, dividerX - size / 95f, ball.Top + ball.Height * .64f);

        var clip = new RectangleF(innerRect.Left + innerRect.Width * .56f, innerRect.Top + innerRect.Height * .24f, innerRect.Width * .33f, innerRect.Height * .47f);
        using var clipGlow = new Pen(Color.FromArgb(90, 45, 180, 255), Math.Max(8, size / 28f)) { StartCap = LineCap.Round, EndCap = LineCap.Round };
        using var clipPen = new Pen(Color.FromArgb(255, 105, 220, 255), Math.Max(3, size / 65f)) { StartCap = LineCap.Round, EndCap = LineCap.Round };
        using var clipPath = Drawing.RoundRect(clip, size / 18f);
        g.DrawPath(clipGlow, clipPath);
        g.DrawPath(clipPen, clipPath);
        var hook = new RectangleF(clip.Left + clip.Width * .22f, clip.Top - clip.Height * .12f, clip.Width * .46f, clip.Height * .19f);
        using var hookPath = Drawing.RoundRect(hook, size / 28f);
        g.DrawPath(clipPen, hookPath);

        for (var i = 0; i < 4; i++)
        {
            var cy = clip.Top + clip.Height * (.22f + i * .18f);
            var dotColor = i == 3 ? Color.FromArgb(255, 247, 174, 38) : Color.FromArgb(255, 244, 250, 255);
            using var dotBrush = new SolidBrush(dotColor);
            using var linePen = new Pen(Color.FromArgb(255, 240, 248, 255), Math.Max(3, size / 80f)) { StartCap = LineCap.Round, EndCap = LineCap.Round };
            g.FillEllipse(dotBrush, clip.Left + clip.Width * .13f, cy - size / 48f, size / 24f, size / 24f);
            g.DrawLine(linePen, clip.Left + clip.Width * .34f, cy, clip.Right - clip.Width * .12f, cy);
        }

        DrawStar(g, new PointF(innerRect.Left + innerRect.Width / 2f, innerRect.Bottom - innerRect.Height * .08f), Math.Max(8, size / 12f), Color.FromArgb(255, 246, 178, 48));
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
        using var brush = new LinearGradientBrush(new RectangleF(center.X - radius, center.Y - radius, radius * 2, radius * 2), Color.White, color, 90f);
        using var pen = new Pen(Color.FromArgb(255, 255, 230, 120), Math.Max(1, radius / 12f));
        g.FillPolygon(brush, points);
        g.DrawPolygon(pen, points);
    }
}
