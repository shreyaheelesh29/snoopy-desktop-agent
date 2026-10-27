$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $root 'public\character\snoopy.png'
$outputDirectory = Join-Path $root 'build-resources'
$iconPath = Join-Path $outputDirectory 'snoopy.ico'
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
$source = [System.Drawing.Image]::FromFile($sourcePath)
$sizes = @(16, 32, 48, 256)
$frames = [System.Collections.Generic.List[byte[]]]::new()

try {
  foreach ($size in $sizes) {
    $bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.Clear([System.Drawing.Color]::Transparent)
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $scale = [Math]::Min($size / $source.Width, $size / $source.Height)
      $width = [int][Math]::Round($source.Width * $scale)
      $height = [int][Math]::Round($source.Height * $scale)
      $x = [int][Math]::Floor(($size - $width) / 2)
      $y = [int][Math]::Floor(($size - $height) / 2)
      $graphics.DrawImage($source, $x, $y, $width, $height)
      $stream = [System.IO.MemoryStream]::new()
      try {
        $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
        $frames.Add($stream.ToArray())
      } finally { $stream.Dispose() }
    } finally { $graphics.Dispose(); $bitmap.Dispose() }
  }
} finally { $source.Dispose() }

$iconStream = [System.IO.File]::Create($iconPath)
$writer = [System.IO.BinaryWriter]::new($iconStream)
try {
  $writer.Write([UInt16]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]$sizes.Count)
  $offset = 6 + (16 * $sizes.Count)
  for ($i = 0; $i -lt $sizes.Count; $i++) {
    $size = $sizes[$i]
    $writer.Write([byte]$(if ($size -eq 256) { 0 } else { $size }))
    $writer.Write([byte]$(if ($size -eq 256) { 0 } else { $size }))
    $writer.Write([byte]0)
    $writer.Write([byte]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]32)
    $writer.Write([UInt32]$frames[$i].Length)
    $writer.Write([UInt32]$offset)
    $offset += $frames[$i].Length
  }
  foreach ($frame in $frames) { $writer.Write($frame) }
} finally { $writer.Dispose(); $iconStream.Dispose() }

Write-Output "Created $iconPath"
