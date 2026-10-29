#!/usr/bin/env python3
"""Draw the Career Mission Control icon with PIL.

Writes career-mission-control.png (512), -256.png, -128.png next to this
file, a 64 px favicon into ../static/favicon.png, and copies the 512 px
version to ~/.local/share/icons/career-mission-control.png.
"""

import math
import os
import shutil

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
NAVY = (14, 21, 33, 255)        # #0E1521
AMBER = (255, 180, 46, 255)     # #FFB42E
AMBER_DIM = (255, 180, 46, 110)
AMBER_FAINT = (255, 180, 46, 45)
FONTS = [
    "/usr/share/fonts/truetype/inter-zorin-os/Inter-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]


def font(size):
    for path in FONTS:
        if os.path.isfile(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def draw_icon(size=512, scale=4):
    s = size * scale
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # rounded navy square
    radius = int(s * 0.22)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=radius, fill=NAVY)

    cx, cy = s / 2, s * 0.46
    r_max = s * 0.33
    line = max(2, int(s * 0.012))

    # sweep wedge (semi-transparent amber), 70 degrees wide
    wedge = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    wd = ImageDraw.Draw(wedge)
    start, end = -90, -20
    wd.pieslice([cx - r_max, cy - r_max, cx + r_max, cy + r_max], start, end, fill=AMBER_FAINT)
    # brighter leading edge of the sweep
    steps = 14
    for i in range(steps):
        a0 = end - (i + 1) * 2.0
        a1 = end - i * 2.0
        alpha = int(90 * (1 - i / steps)) + 20
        wd.pieslice([cx - r_max, cy - r_max, cx + r_max, cy + r_max], a0, a1,
                    fill=(AMBER[0], AMBER[1], AMBER[2], alpha))
    img = Image.alpha_composite(img, wedge)
    d = ImageDraw.Draw(img)

    # concentric rings
    for frac in (1.0, 0.66, 0.33):
        r = r_max * frac
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=AMBER_DIM if frac < 1 else AMBER, width=line)

    # crosshair
    gap = s * 0.035
    d.line([cx - r_max - s * 0.02, cy, cx - gap, cy], fill=AMBER, width=line)
    d.line([cx + gap, cy, cx + r_max + s * 0.02, cy], fill=AMBER, width=line)
    d.line([cx, cy - r_max - s * 0.02, cx, cy - gap], fill=AMBER, width=line)
    d.line([cx, cy + gap, cx, cy + r_max + s * 0.02], fill=AMBER, width=line)

    # sweep line at the leading edge
    ang = math.radians(end)
    d.line([cx, cy, cx + r_max * math.cos(ang), cy + r_max * math.sin(ang)], fill=AMBER, width=line + scale)

    # bright contact dot with a soft halo
    dot_ang = math.radians(-50)
    dr = r_max * 0.55
    dx, dy = cx + dr * math.cos(dot_ang), cy + dr * math.sin(dot_ang)
    halo = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    hd = ImageDraw.Draw(halo)
    for i, (rr, al) in enumerate(((s * 0.05, 40), (s * 0.035, 90), (s * 0.022, 255))):
        hd.ellipse([dx - rr, dy - rr, dx + rr, dy + rr], fill=(AMBER[0], AMBER[1], AMBER[2], al))
    img = Image.alpha_composite(img, halo)
    d = ImageDraw.Draw(img)

    # CMC label
    f = font(int(s * 0.13))
    text = "CMC"
    bbox = d.textbbox((0, 0), text, font=f)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    tx = cx - tw / 2 - bbox[0]
    ty = s * 0.845 - th / 2 - bbox[1]
    d.text((tx, ty), text, font=f, fill=AMBER)

    return img.resize((size, size), Image.LANCZOS)


def main():
    base = draw_icon(512)
    out512 = os.path.join(HERE, "career-mission-control.png")
    base.save(out512)
    base.resize((256, 256), Image.LANCZOS).save(os.path.join(HERE, "career-mission-control-256.png"))
    base.resize((128, 128), Image.LANCZOS).save(os.path.join(HERE, "career-mission-control-128.png"))
    static = os.path.join(os.path.dirname(HERE), "static")
    os.makedirs(static, exist_ok=True)
    base.resize((64, 64), Image.LANCZOS).save(os.path.join(static, "favicon.png"))
    icons = os.path.expanduser("~/.local/share/icons")
    os.makedirs(icons, exist_ok=True)
    shutil.copyfile(out512, os.path.join(icons, "career-mission-control.png"))
    print("wrote", out512, "and 256/128/favicon versions; copied to", icons)


if __name__ == "__main__":
    main()
