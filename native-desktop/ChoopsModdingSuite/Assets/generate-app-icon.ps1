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

function Draw-CenteredText($Graphics, [string]$Text, [System.Drawing.RectangleF]$Rect, [System.Drawing.Color]$Color, [float]$Size, [string]$Family = "Segoe UI") {
    $font = New-Object System.Drawing.Font $Family, $Size, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
    $brush = New-Object System.Drawing.SolidBrush $Color
    $format = New-Object System.Drawing.StringFormat
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $format.LineAlignment = [System.Drawing.StringAlignment]::Center
    $Graphics.DrawString($Text, $font, $brush, $Rect, $format)
    $format.Dispose(); $brush.Dispose(); $font.Dispose()
}

function Draw-Star($Graphics, [float]$Cx, [float]$Cy, [float]$Radius, [System.Drawing.Color]$Color) {
    $points = New-Object 'System.Collections.Generic.List[System.Drawing.PointF]'
    for ($i = 0; $i -lt 10; $i++) {
        $angle = -[Math]::PI / 2 + $i * [Math]::PI / 5
        $r = if ($i % 2 -eq 0) { $Radius } else { $Radius * 0.42 }
        $points.Add([System.Drawing.PointF]::new($Cx + [Math]::Cos($angle) * $r, $Cy + [Math]::Sin($angle) * $r))
    }
    $brush = New-Object System.Drawing.SolidBrush $Color
    $Graphics.FillPolygon($brush, $points.ToArray())
    $brush.Dispose()
}

function New-IconPngBytes([int]$Size) {
    $bitmap = New-Object System.Drawing.Bitmap $Size, $Size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $graphics.Clear([System.Drawing.Color]::Transparent)

    $outer = [System.Drawing.RectangleF]::new($Size * 0.06, $Size * 0.06, $Size * 0.88, $Size * 0.88)
    $inner = [System.Drawing.RectangleF]::new($Size * 0.13, $Size * 0.13, $Size * 0.74, $Size * 0.74)
    $band = [System.Drawing.RectangleF]::new($Size * 0.12, $Size * 0.45, $Size * 0.76, $Size * 0.24)

    $navyTop = [System.Drawing.Color]::FromArgb(255, 6, 27, 47)
    $navyBottom = [System.Drawing.Color]::FromArgb(255, 8, 56, 94)
    $ice = [System.Drawing.Color]::FromArgb(255, 96, 210, 255)
    $ice2 = [System.Drawing.Color]::FromArgb(255, 210, 240, 255)
    $white = [System.Drawing.Color]::FromArgb(255, 248, 253, 255)
    $gold = [System.Drawing.Color]::FromArgb(255, 221, 163, 36)
    $darkBand = [System.Drawing.Color]::FromArgb(238, 3, 18, 31)

    $outerPath = New-RoundRectPath $outer ($Size * 0.14)
    $innerPath = New-RoundRectPath $inner ($Size * 0.10)
    $bandPath = New-RoundRectPath $band ($Size * 0.06)

    $navyBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $outer, $navyTop, $navyBottom, 90
    $graphics.FillPath($navyBrush, $outerPath)
    $goldPen = New-Object System.Drawing.Pen $gold, ([Math]::Max(2, [int]($Size * 0.035)))
    $graphics.DrawPath($goldPen, $outerPath)
    $icePen = New-Object System.Drawing.Pen $ice, ([Math]::Max(2, [int]($Size * 0.022)))
    $graphics.DrawPath($icePen, $innerPath)

    $seamPen = New-Object System.Drawing.Pen $ice2, ([Math]::Max(1, [int]($Size * 0.027)))
    $ball = [System.Drawing.RectangleF]::new($Size * 0.18, $Size * 0.13, $Size * 0.64, $Size * 0.46)
    $graphics.DrawArc($seamPen, $ball, 190, 160)
    $graphics.DrawArc($seamPen, $ball, -10, 160)
    $graphics.DrawBezier($seamPen, [System.Drawing.PointF]::new($Size*.26,$Size*.20), [System.Drawing.PointF]::new($Size*.38,$Size*.42), [System.Drawing.PointF]::new($Size*.57,$Size*.40), [System.Drawing.PointF]::new($Size*.74,$Size*.20))

    $bandBrush = New-Object System.Drawing.SolidBrush $darkBand
    $graphics.FillPath($bandBrush, $bandPath)
    $graphics.DrawPath($icePen, $bandPath)

    if ($Size -lt 32) {
        Draw-CenteredText $graphics "CH" $band $white ($Size * 0.30) "Segoe UI"
    } else {
        Draw-CenteredText $graphics "CHRB" ([System.Drawing.RectangleF]::new($Size*.16,$Size*.47,$Size*.48,$Size*.16)) $white ($Size * 0.17) "Segoe UI Black"
        Draw-CenteredText $graphics "2K" ([System.Drawing.RectangleF]::new($Size*.61,$Size*.47,$Size*.24,$Size*.16)) $gold ($Size * 0.17) "Segoe UI Black"
        if ($Size -ge 64) { Draw-CenteredText $graphics "REBORN" ([System.Drawing.RectangleF]::new($Size*.18,$Size*.67,$Size*.64,$Size*.11)) $ice2 ($Size * 0.075) "Segoe UI" }
        if ($Size -ge 96) {
            Draw-Star $graphics ($Size*.50) ($Size*.84) ($Size*.055) $ice2
            Draw-Star $graphics ($Size*.37) ($Size*.84) ($Size*.032) $ice
            Draw-Star $graphics ($Size*.63) ($Size*.84) ($Size*.032) $ice
        }
    }

    $stream = New-Object System.IO.MemoryStream
    $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    $bytes = $stream.ToArray()

    $seamPen.Dispose(); $bandBrush.Dispose(); $icePen.Dispose(); $goldPen.Dispose(); $navyBrush.Dispose()
    $bandPath.Dispose(); $innerPath.Dispose(); $outerPath.Dispose()
    $graphics.Dispose(); $bitmap.Dispose(); $stream.Dispose()
    return $bytes
}

$sizes = @(16, 24, 32, 48, 64, 128, 256)
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

Write-Host "[ICON] Wrote CHoops Reborn app icon to $OutputPath"
