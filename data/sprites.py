"""Station-pill sprite sheets, generated per city.

Extracted from data/process.py when the pipeline went multi-city. The roundel
glyph and fill now come from the city's line definitions (`City.glyphs` /
`City.sprite_colors`) instead of a hardcoded Seattle map; for Seattle those
resolve to the same values as before, so the committed sheets regenerate
byte-for-byte (INV-014).
"""

import json
import os
from io import BytesIO

import cairosvg
from PIL import Image

ICON_THEMES = {
    "light": {
        "pillBg": "#ffffff",
        "pillBorder": "#333333",
        "codeBg": "#e8e8e8",
        "codeText": "#333333",
    },
    "dark": {
        "pillBg": "#2a2a3a",
        "pillBorder": "rgba(255,255,255,0.35)",
        "codeBg": "rgba(255,255,255,0.12)",
        "codeText": "#dddddd",
    },
}

CIRCLE_R = 10
LINE_TEXT_COLOR = "#ffffff"


def create_pill_svg(lines_str, stop_code, mode="light", *, glyphs=None, colors=None):
    """Generate an SVG pill icon — mirrors createPillSVG in stationIcons.js.

    `glyphs` / `colors` map a line key (the token in the station's `lines`
    property) to the character printed in its roundel and that roundel's fill.
    """
    glyphs = glyphs or {}
    colors = colors or {}
    t = ICON_THEMES[mode]
    line_arr = lines_str.split(",")
    has_code = stop_code is not None

    circle_width = len(line_arr) * (CIRCLE_R * 2 + 2)
    code_width = 28 if has_code else 0
    padding = 5
    gap = 2 if has_code else 0
    total_width = padding + circle_width + gap + code_width + padding
    height = CIRCLE_R * 2 + padding * 2

    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{total_width}" height="{height}">',
        f'<rect x="0.5" y="0.5" width="{total_width - 1}" height="{height - 1}" '
        f'rx="{height / 2}" ry="{height / 2}" fill="{t["pillBg"]}" '
        f'stroke="{t["pillBorder"]}" stroke-width="2"/>',
    ]

    cx = padding + CIRCLE_R
    for line in line_arr:
        color = colors.get(line, "#999")
        glyph = glyphs.get(line, line)
        parts.append(
            f'<circle cx="{cx}" cy="{height / 2}" r="{CIRCLE_R}" fill="{color}"/>'
        )
        parts.append(
            f'<text x="{cx}" y="{height / 2 + 4}" text-anchor="middle" '
            f'fill="{LINE_TEXT_COLOR}" '
            f'font-family="-apple-system,BlinkMacSystemFont,sans-serif" '
            f'font-size="12" font-weight="bold">{glyph}</text>'
        )
        cx += CIRCLE_R * 2 + 2

    if has_code:
        box_x = padding + circle_width + gap
        box_h = height - padding * 2
        box_y = padding
        parts.append(
            f'<rect x="{box_x}" y="{box_y}" width="{code_width}" '
            f'height="{box_h}" rx="4" ry="4" fill="{t["codeBg"]}"/>'
        )
        parts.append(
            f'<text x="{box_x + code_width / 2}" y="{box_y + box_h / 2 + 4}" '
            f'text-anchor="middle" fill="{t["codeText"]}" '
            f'font-family="-apple-system,BlinkMacSystemFont,sans-serif" '
            f'font-size="10" font-weight="bold">{stop_code}</text>'
        )

    parts.append("</svg>")
    return "".join(parts), total_width, height


def svg_to_png(svg_str, scale=1):
    """Convert an SVG string to a PIL Image at the given scale."""
    png_bytes = cairosvg.svg2png(bytestring=svg_str.encode(), scale=scale)
    return Image.open(BytesIO(png_bytes))


# ── Brand "w" mark (embossed) ──

# The letter is drawn in the SAME color as the plate, then a light highlight is
# offset up-left and a dark shadow down-right so the glyph reads as raised from
# the surface — the classic emboss. Tuned per theme.
EMBOSS_THEMES = {
    "light": {
        "plate": "#e8e8e8",
        "border": "rgba(51,51,51,0.30)",
        "highlight": "rgba(255,255,255,0.95)",
        "shadow": "rgba(0,0,0,0.35)",
    },
    "dark": {
        "plate": "#2a2a3a",
        "border": "rgba(255,255,255,0.25)",
        "highlight": "rgba(255,255,255,0.22)",
        "shadow": "rgba(0,0,0,0.55)",
    },
}

W_ICON_SENTINEL = "__brand_w__"


def create_w_emboss_svg(mode="light"):
    """Generate a square embossed 'w' brand icon for the sprite sheet."""
    e = EMBOSS_THEMES[mode]
    size = 30
    cx = size / 2
    baseline = size / 2 + 7  # vertically centers a ~20px glyph
    font = "-apple-system,BlinkMacSystemFont,sans-serif"

    def glyph(fill, dx, dy):
        return (
            f'<text x="{cx + dx}" y="{baseline + dy}" text-anchor="middle" '
            f'fill="{fill}" font-family="{font}" font-size="20" '
            f'font-weight="800">w</text>'
        )

    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}">',
        f'<rect x="1" y="1" width="{size - 2}" height="{size - 2}" rx="7" ry="7" '
        f'fill="{e["plate"]}" stroke="{e["border"]}" stroke-width="1.5"/>',
        glyph(e["shadow"], 1.1, 1.1),     # shadow peeks bottom-right
        glyph(e["highlight"], -1, -1),    # highlight peeks top-left
        glyph(e["plate"], 0, 0),          # main glyph blends into the plate
        "</svg>",
    ]
    return "".join(parts), size, size


def generate_sprites(city, station_index, output_dir):
    """Generate Mapbox-compatible sprite sheets (1x and 2x) for one city."""
    glyphs = city.glyphs
    colors = city.sprite_colors

    icons = {}
    for station in station_index["stations"]:
        lines = station["lines"]
        code = station["stopCode"]
        base_key = f"{lines}-{code}"
        for mode in ("light", "dark"):
            key = f"station-{mode}-{base_key}"
            icons[key] = (lines, code, mode)

    # Brand "w" mark, one per theme.
    for mode in ("light", "dark"):
        icons[f"brand-w-{mode}"] = (W_ICON_SENTINEL, None, mode)

    # Render all icons at both scales
    for scale, suffix in [(1, ""), (2, "@2x")]:
        rendered = {}
        for key, (lines, code, mode) in icons.items():
            if lines == W_ICON_SENTINEL:
                svg, w, h = create_w_emboss_svg(mode)
            else:
                svg, w, h = create_pill_svg(
                    lines, code, mode, glyphs=glyphs, colors=colors
                )
            img = svg_to_png(svg, scale=scale)
            rendered[key] = img

        # Pack into a horizontal sprite sheet
        total_w = sum(img.width for img in rendered.values())
        max_h = max(img.height for img in rendered.values())
        sheet = Image.new("RGBA", (total_w, max_h), (0, 0, 0, 0))
        manifest = {}
        x = 0
        for key, img in rendered.items():
            sheet.paste(img, (x, 0))
            manifest[key] = {
                "width": img.width // scale,
                "height": img.height // scale,
                "x": x,
                "y": 0,
                "pixelRatio": scale,
            }
            x += img.width

        os.makedirs(output_dir, exist_ok=True)
        sheet.save(os.path.join(output_dir, f"stations{suffix}.png"))
        with open(os.path.join(output_dir, f"stations{suffix}.json"), "w") as f:
            json.dump(manifest, f)

    print(f"Sprites: {len(icons)} icons → {city.slug}/icons/stations.png + @2x")
