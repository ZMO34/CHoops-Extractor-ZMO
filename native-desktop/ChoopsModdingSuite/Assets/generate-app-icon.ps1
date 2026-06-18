param(
    [string]$OutputPath = "$PSScriptRoot\app.ico"
)

Add-Type -AssemblyName System.Drawing

function New-RoundRectPath([System.Drawing.RectangleF]$Rect, [float]$Radius) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $Radius * 2
    if ($d -le 0) { $path.AddRectangle($Rect); return $path }
    $path.AddArc($Rect.Left, $Rect.Top, $d, $d, 180, 90)
    $path.AddArc($Rect.Right - $d, $Rect.Top, $d, $d, 270, 90)
    $path.AddArc($Rect.Right - $d, $Rect.Bottom - $d, $d, $d, 0, 90)
    $path.AddArc($Rect.Left, $Rect.Bottom - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    return $path
}

function Draw-CenteredText($Graphics, [string]$Text, [System.Drawing.RectangleF]$Rect, [System.Drawing.Color]$Color, [float]$Size, [string]$Family = "Segoe UI Black") {
    $font = New-Object System.Drawing.Font $Family, $Size, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
    $brush = New-Object System.Drawing.SolidBrush $Color
    $format = New-Object System.Drawing.StringFormat
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $format.LineAlignment = [System.Drawing.StringAlignment]::Center
    $Graphics.DrawString($Text, $font, $brush, $Rect, $format)
    $format.Dispose(); $brush.Dispose(); $font.Dispose()
}

function New-IconPngBytes([int]$Size) {
    $bitmap = New-Object System.Drawing.Bitmap $Size, $Size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $graphics.Clear([System.Drawing.Color]::Transparent)

    $navyTop = [System.Drawing.Color]::FromArgb(255, 3, 21, 38)
    $navyBottom = [System.Drawing.Color]::FromArgb(255, 4, 62, 103)
    $ice = [System.Drawing.Color]::FromArgb(255, 115, 219, 255)
    $white = [System.Drawing.Color]::FromArgb(255, 248, 253, 255)
    $gold = [System.Drawing.Color]::FromArgb(255, 225, 169, 42)
    $goldDark = [System.Drawing.Color]::FromArgb(255, 148, 92, 8)
    $ball = [System.Drawing.Color]::FromArgb(255, 160, 85, 16)
    $ballDark = [System.Drawing.Color]::FromArgb(255, 84, 37, 8)

    $outer = [System.Drawing.RectangleF]::new($Size * 0.055, $Size * 0.055, $Size * 0.89, $Size * 0.89)
    $outerPath = New-RoundRectPath $outer ($Size * 0.18)
    $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $outer, $navyTop, $navyBottom, 90
    $graphics.FillPath($bgBrush, $outerPath)

    $goldPen = New-Object System.Drawing.Pen $gold, ([Math]::Max(2, [int]($Size * 0.045)))
    $icePen = New-Object System.Drawing.Pen $ice, ([Math]::Max(1, [int]($Size * 0.022)))
    $graphics.DrawPath($goldPen, $outerPath)

    $inner = [System.Drawing.RectangleF]::new($Size * 0.135, $Size * 0.135, $Size * 0.73, $Size * 0.73)
    $innerPath = New-RoundRectPath $inner ($Size * 0.13)
    $graphics.DrawPath($icePen, $innerPath)

    # Big centered basketball mark. This stays legible in the Windows taskbar.
    $ballRect = [System.Drawing.RectangleF]::new($Size * 0.20, $Size * 0.18, $Size * 0.60, $Size * 0.44)
    $ballBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $ballRect, $ball, $ballDark, 90
    $graphics.FillEllipse($ballBrush, $ballRect)
    $seamPen = New-Object System.Drawing.Pen $gold, ([Math]::Max(1, [int]($Size * 0.028)))
    $graphics.DrawEllipse($seamPen, $ballRect)
    $graphics.DrawArc($seamPen, $ballRect, 205, 130)
    $graphics.DrawArc($seamPen, $ballRect, 25, 130)
    $graphics.DrawLine($seamPen, [int]($Size*.50), [int]($Size*.19), [int]($Size*.50), [int]($Size*.61))

    # Strong simple lettering: CH is what must read at small size. Reborn appears only large.
    $lettersRect = [System.Drawing.RectangleF]::new($Size * 0.13, $Size * 0.51, $Size * 0.74, $Size * 0.27)
    if ($Size -lt 32) {
        Draw-CenteredText $graphics "CH" $lettersRect $white ($Size * 0.36)
    } elseif ($Size -lt 96) {
        Draw-CenteredText $graphics "CH" $lettersRect $white ($Size * 0.34)
        Draw-CenteredText $graphics "2K" ([System.Drawing.RectangleF]::new($Size*.61,$Size*.55,$Size*.22,$Size*.16)) $gold ($Size * 0.13)
    } else {
        Draw-CenteredText $graphics "CH" ([System.Drawing.RectangleF]::new($Size*.13,$Size*.49,$Size*.43,$Size*.24)) $white ($Size * 0.26)
        Draw-CenteredText $graphics "2K" ([System.Drawing.RectangleF]::new($Size*.54,$Size*.50,$Size*.31,$Size*.23)) $gold ($Size * 0.23)
        Draw-CenteredText $graphics "REBORN" ([System.Drawing.RectangleF]::new($Size*.18,$Size*.75,$Size*.64,$Size*.095)) $ice ($Size * 0.075) "Segoe UI"
    }

    $stream = New-Object System.IO.MemoryStream
    $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    $bytes = $stream.ToArray()

    $seamPen.Dispose(); $ballBrush.Dispose(); $icePen.Dispose(); $goldPen.Dispose(); $bgBrush.Dispose()
    $innerPath.Dispose(); $outerPath.Dispose()
    $graphics.Dispose(); $bitmap.Dispose(); $stream.Dispose()
    return $bytes
}

$sizes = @(16, 20, 24, 32, 40, 48, 64, 128, 256)
$images = @()
foreach ($size in $sizes) {
    $images += [PSCustomObject]@{ Size = $size; Bytes = (New-IconPngBytes $size) }
}

$directory = Split-Path -Parent $OutputPath
if ($directory -and -not (Test-Path $directory)) { New-Item -ItemType Directory -Force -Path $directory | Out-Null }

$fs = [System.IO.File]::Open($OutputPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
$writer = New-Object System.IO.BinaryWriter $fs
try {
    $writer.Write([UInt16]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]$images.Count)
    $offset = 6 + (16 * $images.Count)
    foreach ($image in $images) {
        $width = if ($image.Size -ge 256) { 0 } else { [byte]$image.Size }
        $height = if ($image.Size -ge 256) { 0 } else { [byte]$image.Size }
        $writer.Write([byte]$width)
        $writer.Write([byte]$height)
        $writer.Write([byte]0)
        $writer.Write([byte]0)
        $writer.Write([UInt16]1)
        $writer.Write([UInt16]32)
        $writer.Write([UInt32]$image.Bytes.Length)
        $writer.Write([UInt32]$offset)
        $offset += $image.Bytes.Length
    }
    foreach ($image in $images) { $writer.Write([byte[]]$image.Bytes) }
}
finally {
    $writer.Dispose()
    $fs.Dispose()
}

Write-Host "[ICON] Wrote clean CHoops Reborn taskbar icon to $OutputPath"
