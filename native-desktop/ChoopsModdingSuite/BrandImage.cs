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
        "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"+
        "+R9g5GZ2AAAAAElFTkSuQmCC";
}
