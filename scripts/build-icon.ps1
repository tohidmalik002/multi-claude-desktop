# Builds assets/icon.ico and assets/icon.png.
#
# Design: two laptops on an ink tile. The left body is cream, the right body is
# coral, and both screens are ink so the icon reads at 16 px without clutter.
#
# Run:
#   powershell -ExecutionPolicy Bypass -File tools\build-icon.ps1

Add-Type -AssemblyName System.Drawing

$appRoot = Split-Path -Parent $PSScriptRoot
$icoPath = Join-Path $appRoot 'assets\icon.ico'
$pngPath = Join-Path $appRoot 'assets\icon.png'

$sizes = 16, 24, 32, 48, 64, 128, 256
$coral = [System.Drawing.Color]::FromArgb(255, 217, 119, 87)
$ink = [System.Drawing.Color]::FromArgb(255, 31, 30, 29)
$screen = [System.Drawing.Color]::FromArgb(255, 12, 11, 10)
$cream = [System.Drawing.Color]::FromArgb(255, 245, 244, 239)

function New-RoundedRectPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $path.AddArc($x, $y, $d, $d, 180, 90)
  $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-LaptopParts([float]$centerX, [float]$size) {
  $bodyWidth = $size * 0.34
  $screenHeight = $size * 0.37
  $baseWidth = $size * 0.42
  $baseHeight = [Math]::Max($size * 0.055, 1.0)
  $totalHeight = $screenHeight + $baseHeight

  $left = $centerX - ($bodyWidth / 2)
  $top = ($size - $totalHeight) / 2

  $lid = New-RoundedRectPath $left $top $bodyWidth $screenHeight ($size * 0.045)
  $bezel = [Math]::Max($size * 0.040, 1.0)
  $glass = New-RoundedRectPath ($left + $bezel) ($top + $bezel) ($bodyWidth - (2 * $bezel)) ($screenHeight - (2 * $bezel)) ([Math]::Max($size * 0.02, 0.5))
  $base = New-RoundedRectPath ($centerX - ($baseWidth / 2)) ($top + $screenHeight) $baseWidth $baseHeight ([Math]::Max($size * 0.025, 0.5))

  return @($lid, $glass, $base)
}

$images = @()

foreach ($size in $sizes) {
  $bitmap = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $canvas = [System.Drawing.Graphics]::FromImage($bitmap)
  $canvas.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $canvas.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $canvas.Clear([System.Drawing.Color]::Transparent)

  $inkBrush = New-Object System.Drawing.SolidBrush $ink
  $coralBrush = New-Object System.Drawing.SolidBrush $coral
  $creamBrush = New-Object System.Drawing.SolidBrush $cream
  $screenBrush = New-Object System.Drawing.SolidBrush $screen

  $tile = New-RoundedRectPath 0 0 $size $size ($size * 0.22)
  $canvas.FillPath($inkBrush, $tile)

  $leftParts = New-LaptopParts ([float]($size * 0.275)) ([float]$size)
  $rightParts = New-LaptopParts ([float]($size * 0.725)) ([float]$size)

  $canvas.FillPath($creamBrush, $leftParts[0])
  $canvas.FillPath($screenBrush, $leftParts[1])
  $canvas.FillPath($creamBrush, $leftParts[2])

  $canvas.FillPath($coralBrush, $rightParts[0])
  $canvas.FillPath($screenBrush, $rightParts[1])
  $canvas.FillPath($coralBrush, $rightParts[2])

  $canvas.Dispose()
  $inkBrush.Dispose()
  $coralBrush.Dispose()
  $creamBrush.Dispose()
  $screenBrush.Dispose()
  $tile.Dispose()
  foreach ($part in ($leftParts + $rightParts)) {
    $part.Dispose()
  }

  $stream = New-Object System.IO.MemoryStream
  $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  $images += ,$stream.ToArray()
  $stream.Dispose()

  if ($size -eq 256) {
    $bitmap.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
  }

  $bitmap.Dispose()
}

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
