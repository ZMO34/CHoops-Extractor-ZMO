param(
    [string]$OutputPath = "$PSScriptRoot\app.ico"
)

Add-Type -AssemblyName System.Drawing

function New-IconPngBytes([int]$Size) {
    $bitmap = New-Object System.Drawing.Bitmap $Size, $Size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $graphics.Clear([System.Drawing.Color]::Transparent)

    $outer = [System.Drawing.RectangleF]::new($Size * 0.04, $Size * 0.04, $Size * 0.92, $Size * 0.92)
    $inner = [System.Drawing.RectangleF]::new($Size * 0.16, $Size * 0.16, $Size * 0.68, $Size * 0.68)

    $navyBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $outer, ([System.Drawing.Color]::FromArgb(255, 3, 22, 39)), ([System.Drawing.Color]::FromArgb(255, 0, 75, 120)), 90
    $icePen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 105, 218, 255)), ([Math]::Max(1, [int]($Size / 24)))
    $graphics.FillEllipse($navyBrush, $outer)
    $graphics.DrawEllipse($icePen, $outer)

    $ballBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $inner, ([System.Drawing.Color]::FromArgb(255, 255, 178, 55)), ([System.Drawing.Color]::FromArgb(255, 224, 75, 25)), 90
    $seamPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 70, 32, 20)), ([Math]::Max(1, [int]($Size / 34)))
    $graphics.FillEllipse($ballBrush, $inner)
    $graphics.DrawEllipse($seamPen, $inner)
    $graphics.DrawLine($seamPen, [int]($Size * 0.50), [int]($Size * 0.20), [int]($Size * 0.50), [int]($Size * 0.80))
    $graphics.DrawLine($seamPen, [int]($Size * 0.20), [int]($Size * 0.50), [int]($Size * 0.80), [int]($Size * 0.50))
    $graphics.DrawArc($seamPen, [System.Drawing.Rectangle]::new([int]($Size * 0.24), [int]($Size * 0.16), [int]($Size * 0.52), [int]($Size * 0.68)), 90, 180)
    $graphics.DrawArc($seamPen, [System.Drawing.Rectangle]::new([int]($Size * 0.24), [int]($Size * 0.16), [int]($Size * 0.52), [int]($Size * 0.68)), -90, 180)

    if ($Size -ge 48) {
        $badgeRect = [System.Drawing.RectangleF]::new($Size * 0.22, $Size * 0.58, $Size * 0.56, $Size * 0.20)
        $badgeBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(220, 2, 12, 24))
        $badgePen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(235, 245, 252, 255)), ([Math]::Max(1, [int]($Size / 90)))
        $graphics.FillRectangle($badgeBrush, $badgeRect)
        $graphics.DrawRectangle($badgePen, [int]$badgeRect.X, [int]$badgeRect.Y, [int]$badgeRect.Width, [int]$badgeRect.Height)

        $fontSize = [Math]::Max(8, [int]($Size * 0.20))
        $font = New-Object System.Drawing.Font "Segoe UI", $fontSize, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
        $textBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
        $format = New-Object System.Drawing.StringFormat
        $format.Alignment = [System.Drawing.StringAlignment]::Center
        $format.LineAlignment = [System.Drawing.StringAlignment]::Center
        $graphics.DrawString("CH", $font, $textBrush, $badgeRect, $format)

        if ($Size -ge 128) {
            $font2 = New-Object System.Drawing.Font "Segoe UI", ([int]($Size * 0.13)), ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
            $redBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 255, 80, 80))
            $graphics.DrawString("2K8", $font2, $redBrush, [System.Drawing.RectangleF]::new($Size * 0.22, $Size * 0.77, $Size * 0.56, $Size * 0.13), $format)
            $font2.Dispose()
            $redBrush.Dispose()
        }

        $font.Dispose()
        $format.Dispose()
        $textBrush.Dispose()
        $badgeBrush.Dispose()
        $badgePen.Dispose()
    }

    $stream = New-Object System.IO.MemoryStream
    $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    $bytes = $stream.ToArray()

    $graphics.Dispose()
    $bitmap.Dispose()
    $navyBrush.Dispose()
    $icePen.Dispose()
    $ballBrush.Dispose()
    $seamPen.Dispose()
    $stream.Dispose()

    return $bytes
}

$sizes = @(16, 24, 32, 48, 64, 128, 256)
$images = @()
foreach ($size in $sizes) {
    $images += [PSCustomObject]@{ Size = $size; Bytes = (New-IconPngBytes $size) }
}

$directory = Split-Path -Parent $OutputPath
if ($directory -and -not (Test-Path $directory)) {
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
}

$fs = [System.IO.File]::Open($OutputPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
$writer = New-Object System.IO.BinaryWriter $fs
try {
    $writer.Write([UInt16]0) # reserved
    $writer.Write([UInt16]1) # icon type
    $writer.Write([UInt16]$images.Count)

    $offset = 6 + (16 * $images.Count)
    foreach ($image in $images) {
        $width = if ($image.Size -ge 256) { 0 } else { [byte]$image.Size }
        $height = if ($image.Size -ge 256) { 0 } else { [byte]$image.Size }
        $writer.Write([byte]$width)
        $writer.Write([byte]$height)
        $writer.Write([byte]0) # color count
        $writer.Write([byte]0) # reserved
        $writer.Write([UInt16]1) # planes
        $writer.Write([UInt16]32) # bit count
        $writer.Write([UInt32]$image.Bytes.Length)
        $writer.Write([UInt32]$offset)
        $offset += $image.Bytes.Length
    }

    foreach ($image in $images) {
        $writer.Write([byte[]]$image.Bytes)
    }
}
finally {
    $writer.Dispose()
    $fs.Dispose()
}

Write-Host "[ICON] Wrote $OutputPath"
