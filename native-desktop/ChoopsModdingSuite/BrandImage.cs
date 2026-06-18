using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Runtime.InteropServices;

namespace ChoopsModdingSuite;

internal static class BrandImage
{
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool DestroyIcon(IntPtr hIcon);

    private static readonly Lazy<Image> ImageLazy = new(() =>
    {
        var bytes = Convert.FromBase64String(PngBase64);
        using var ms = new MemoryStream(bytes);
        return Image.FromStream(ms);
    });

    public static Image Image => ImageLazy.Value;

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

        var padding = Math.Max(1, Math.Min(bounds.Width, bounds.Height) / 24);
        var maxW = bounds.Width - padding * 2;
        var maxH = bounds.Height - padding * 2;
        if (maxW <= 0 || maxH <= 0) return;

        var image = Image;
        var scale = Math.Min(maxW / (float)image.Width, maxH / (float)image.Height);
        var w = image.Width * scale;
        var h = image.Height * scale;
        var x = bounds.Left + (bounds.Width - w) / 2f;
        var y = bounds.Top + (bounds.Height - h) / 2f;
        g.DrawImage(image, x, y, w, h);
    }

    private const string PngBase64 = 
        "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";
}
