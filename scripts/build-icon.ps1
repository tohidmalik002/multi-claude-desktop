# Builds assets/icon.ico and assets/icon.png.
#
# Design: two rounded window frames overlapping diagonally on a dark tile.
# The warm-white frame sits behind (upper left), the coral frame in front
# (lower right). Both frames are hollow, so the white frame shows through the
# coral one. A tile-coloured gap around the coral frame's outer edge keeps the
# two apart where they cross.
#
# Geometry is defined on a 256-unit canvas. A 1024 px master is drawn once and
# scaled down to every icon size, so small sizes stay smooth.
#
# Run:
#   npm run icon
#   (or: powershell -ExecutionPolicy Bypass -File scripts\build-icon.ps1)

Add-Type -AssemblyName System.Drawing

$appRoot = Split-Path -Parent $PSScriptRoot
$icoPath = Join-Path $appRoot 'assets\icon.ico'
$pngPath = Join-Path $appRoot 'assets\icon.png'

$sizes = 16, 24, 32, 48, 64, 128, 256
$master = 1024
$scale = $master / 256

$tileColor = [System.Drawing.Color]::FromArgb(255, 31, 30, 29)
$whiteColor = [System.Drawing.Color]::FromArgb(255, 245, 244, 239)
$coralColor = [System.Drawing.Color]::FromArgb(255, 217, 119, 87)

# Frame geometry in 256 units: width, height, corner radius, line thickness,
# and the gap kept clear around the front frame.
$frameW = 140
$frameH = 100.8
$frameR = 12.6
$frameLine = 8.4
$gap = 12

function New-RoundedRectPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = [Math]::Min($r * 2, [Math]::Min($w, $h))
  $path.AddArc($x, $y, $d, $d, 180, 90)
  $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

# Fills the ring between an outer and an inner rounded rectangle (256 units).
# Each rectangle is @(x, y, w, h, radius); pass $null as inner for a solid fill.
function Fill-Ring($canvas, $brush, $outer, $inner) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.FillMode = [System.Drawing.Drawing2D.FillMode]::Alternate
  foreach ($rect in @($outer, $inner)) {
    if ($null -eq $rect) { continue }
    $part = New-RoundedRectPath ($rect[0] * $scale) ($rect[1] * $scale) ($rect[2] * $scale) ($rect[3] * $scale) ($rect[4] * $scale)
    $path.AddPath($part, $false)
    $part.Dispose()
  }
  $canvas.FillPath($brush, $path)
  $path.Dispose()
}

# A hollow frame with its top-left corner at ($x, $y).
function Draw-Frame($canvas, [float]$x, [float]$y, $brush) {
  $outer = @($x, $y, $frameW, $frameH, $frameR)
  $inner = @(($x + $frameLine), ($y + $frameLine), ($frameW - 2 * $frameLine), ($frameH - 2 * $frameLine), ($frameR * 0.55))
  Fill-Ring $canvas $brush $outer $inner
}

# Master image.
$masterBitmap = New-Object System.Drawing.Bitmap $master, $master, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$canvas = [System.Drawing.Graphics]::FromImage($masterBitmap)
$canvas.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$canvas.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$canvas.Clear([System.Drawing.Color]::Transparent)

$tileBrush = New-Object System.Drawing.SolidBrush $tileColor
$whiteBrush = New-Object System.Drawing.SolidBrush $whiteColor
$coralBrush = New-Object System.Drawing.SolidBrush $coralColor

$backX = 34
$backY = 58
$frontX = 82
$frontY = 98

Fill-Ring $canvas $tileBrush @(0, 0, 256, 256, 56) $null
Draw-Frame $canvas $backX $backY $whiteBrush

# Clear a gap around the coral frame's outer edge only, so the white frame
# still shows through the coral frame's open middle.
$gapOuter = @(($frontX - $gap), ($frontY - $gap), ($frameW + 2 * $gap), ($frameH + 2 * $gap), ($frameR + $gap))
$gapInner = @($frontX, $frontY, $frameW, $frameH, $frameR)
Fill-Ring $canvas $tileBrush $gapOuter $gapInner

Draw-Frame $canvas $frontX $frontY $coralBrush

$canvas.Dispose()
$tileBrush.Dispose()
$whiteBrush.Dispose()
$coralBrush.Dispose()

# Scale the master down to every icon size.
$images = @()

foreach ($size in $sizes) {
  $bitmap = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bitmap)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.DrawImage($masterBitmap, 0, 0, $size, $size)
  $g.Dispose()

  $stream = New-Object System.IO.MemoryStream
  $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  $images += ,$stream.ToArray()
  $stream.Dispose()

  if ($size -eq 256) {
    $bitmap.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
  }

  $bitmap.Dispose()
}

$masterBitmap.Dispose()

# ICO container with PNG-compressed entries (Windows Vista and newer).
$output = New-Object System.IO.MemoryStream
$writer = New-Object System.IO.BinaryWriter $output

$writer.Write([UInt16]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]$sizes.Count)

$offset = 6 + (16 * $sizes.Count)

for ($index = 0; $index -lt $sizes.Count; $index++) {
  $dimension = $sizes[$index]
  $writer.Write([Byte]($dimension % 256))
  $writer.Write([Byte]($dimension % 256))
  $writer.Write([Byte]0)
  $writer.Write([Byte]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]32)
  $writer.Write([UInt32]$images[$index].Length)
  $writer.Write([UInt32]$offset)
  $offset += $images[$index].Length
}

foreach ($image in $images) {
  $writer.Write($image)
}

$writer.Flush()
[System.IO.File]::WriteAllBytes($icoPath, $output.ToArray())

$writer.Dispose()
$output.Dispose()

Write-Output "wrote $icoPath"
Write-Output "wrote $pngPath"
