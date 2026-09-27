# Постобработка кадров, которые 2026-09-27 выдал Cursor GenerateImage.
# Имя модели инструмент не сообщает. Промты — в CREDITS.md.
# Скрипт не генерирует картинки заново: он уменьшает уже готовые кадры и вырезает розовый фон.
# Запуск: powershell -File scripts/pack-sprites.ps1 -Src <папка с исходниками sf-*.png>
param(
  [Parameter(Mandatory = $true)]
  [string]$Src
)

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class PackSprites {
  static bool IsKey(byte r, byte g, byte b) {
    return g < 48 && r > 165 && b > 80 && (r + b) > 280 && r > g + 120;
  }

  static void Key(Bitmap bmp) {
    var rect = new Rectangle(0, 0, bmp.Width, bmp.Height);
    var data = bmp.LockBits(rect, ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
    int n = Math.Abs(data.Stride) * bmp.Height;
    byte[] buf = new byte[n];
    Marshal.Copy(data.Scan0, buf, 0, n);
    for (int i = 0; i < buf.Length; i += 4) {
      if (IsKey(buf[i + 2], buf[i + 1], buf[i])) buf[i + 3] = 0;
    }
    Marshal.Copy(buf, 0, data.Scan0, n);
    bmp.UnlockBits(data);
  }

  public static void Save(string src, string dst, int w, int h, bool key) {
    using (var raw = new Bitmap(src))
    using (var work = new Bitmap(raw.Width, raw.Height, PixelFormat.Format32bppArgb)) {
      using (var g0 = Graphics.FromImage(work)) g0.DrawImage(raw, 0, 0, raw.Width, raw.Height);
      if (key) Key(work);
      using (var dstBmp = new Bitmap(w, h, PixelFormat.Format32bppArgb)) {
        using (var g = Graphics.FromImage(dstBmp)) {
          g.Clear(Color.Transparent);
          g.InterpolationMode = InterpolationMode.HighQualityBicubic;
          g.PixelOffsetMode = PixelOffsetMode.HighQuality;
          g.DrawImage(work, new Rectangle(0, 0, w, h));
        }
        dstBmp.Save(dst, ImageFormat.Png);
      }
    }
  }

  public static void SaveSolar(string src, string dst) {
    using (var img = new Bitmap(src)) {
      int w = img.Width;
      int h = img.Height;
      int cropH = Math.Min(h, w / 2);
      int y = Math.Max(0, (h - cropH) / 2);
      using (var dstBmp = new Bitmap(256, 128, PixelFormat.Format32bppArgb)) {
        using (var g = Graphics.FromImage(dstBmp)) {
          g.InterpolationMode = InterpolationMode.HighQualityBicubic;
          g.DrawImage(img, new Rectangle(0, 0, 256, 128), new Rectangle(0, y, w, cropH), GraphicsUnit.Pixel);
        }
        dstBmp.Save(dst, ImageFormat.Png);
      }
    }
  }
}
"@

$root = Join-Path $PSScriptRoot "..\packages\client\public"
$opaque = @(
  @("sf-floor.png", "tiles\floor.png"),
  @("sf-wall.png", "tiles\wall.png"),
  @("sf-door.png", "tiles\door.png"),
  @("sf-corridor.png", "tiles\floor_corridor.png"),
  @("sf-stock.png", "tiles\floor_stockpile.png"),
  @("sf-vent.png", "sprites\vent.png")
)
foreach ($pair in $opaque) {
  [PackSprites]::Save((Join-Path $Src $pair[0]), (Join-Path $root $pair[1]), 128, 128, $false)
}
[PackSprites]::SaveSolar((Join-Path $Src "sf-solar.png"), (Join-Path $root "sprites\solar_panel.png"))
$keyed = @(
  @("sf-pawn-a.png", "sprites\pawns\0.png"),
  @("sf-pawn-b.png", "sprites\pawns\1.png"),
  @("sf-pawn-c.png", "sprites\pawns\2.png"),
  @("sf-robot.png", "sprites\pawns\robot.png"),
  @("sf-item-metal.png", "sprites\items\metal.png"),
  @("sf-item-ice.png", "sprites\items\ice.png"),
  @("sf-item-water.png", "sprites\items\water.png"),
  @("sf-item-crystals.png", "sprites\items\crystals.png"),
  @("sf-item-biomass.png", "sprites\items\biomass.png"),
  @("sf-item-food.png", "sprites\items\food.png"),
  @("sf-bridge.png", "sprites\bridge.png"),
  @("sf-reactor.png", "sprites\reactor.png"),
  @("sf-battery.png", "sprites\battery.png"),
  @("sf-engine.png", "sprites\engine.png"),
  @("sf-o2gen.png", "sprites\o2gen.png"),
  @("sf-water.png", "sprites\water_recycler.png"),
  @("sf-hydro.png", "sprites\hydroponics.png"),
  @("sf-bed.png", "sprites\bed.png"),
  @("sf-medbay.png", "sprites\medbay.png"),
  @("sf-shield.png", "sprites\shield_gen.png"),
  @("sf-laser.png", "sprites\laser.png"),
  @("sf-missile.png", "sprites\missile.png"),
  @("sf-radar.png", "sprites\radar.png"),
  @("sf-mining.png", "sprites\mining_laser.png"),
  @("sf-lamp.png", "sprites\lamp.png"),
  @("sf-cryo.png", "sprites\cryopod.png"),
  @("sf-heater.png", "sprites\heater.png"),
  @("sf-cooler.png", "sprites\cooler.png")
)
foreach ($pair in $keyed) {
  [PackSprites]::Save((Join-Path $Src $pair[0]), (Join-Path $root $pair[1]), 128, 128, $true)
}
Write-Output "packed"
