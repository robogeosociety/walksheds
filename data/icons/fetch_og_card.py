#!/usr/bin/env python3
"""Generate the social-share (Open Graph) card from Westlake Station's real walkshed.

The card is a 1200x630 landscape image used for rich link previews when a
walksheds.xyz URL is pasted into Slack, iMessage, Discord, Twitter/X, etc.
Slack's crawler does not run JavaScript, so the preview is driven entirely by
the static `og:image` / `twitter:image` meta tags in index.html pointing at
the PNG this script writes to public/og-image.png.

The artwork mirrors the live default view: Westlake Station (the app's default
station, shared stop 50 on Lines 1 + 2) with its 5/10/15-minute Mapbox walking
isochrones stacked in the day-map accent blue at the same opacities
WalkshedLayers.jsx uses, the two-line station pill (Line 1 green + Line 2 blue,
stop code, name) centered on the station, and the Walksheds wordmark.

Reads from the canonical walksheds dump at data/pois/raw/walksheds.json.gz
(maintained by data/pois/fetch_walksheds.py). Build-only; no network.

System requirement: cairosvg (and libcairo). Install via `pip install cairosvg`.

Usage:
  python3 data/icons/fetch_og_card.py   # rebuild public/og-image.png from the dump
"""

import argparse
import gzip
import json
import math
from pathlib import Path

import cairosvg

ROOT = Path(__file__).resolve().parents[2]
WALKSHEDS_DUMP = ROOT / "data" / "pois" / "raw" / "walksheds.json.gz"
OUT_PATH = ROOT / "public" / "og-image.png"

# Westlake Station — the app's default station, shared stop 50 (Lines 1 + 2).
STATION_KEY = "1,2-50"
MINUTES = [5, 10, 15]

# Colors, mirroring src/constants.js.
ACCENT = "#00A0E0"       # WALKSHED_ACCENT_LIGHT (the day-map walkshed accent)
LINE_1_COLOR = "#38B030"  # LINE_COLORS['1-line']
LINE_2_COLOR = "#00A0E0"  # LINE_COLORS['2-line']

# Basemap land tone sampled from the live day render (matches fetch_app_icon.py).
BG = "#f4f0ef"

# Per-contour fill opacity, mirroring WALKSHED_STYLES in src/constants.js.
CONTOUR_STYLE = {
    15: {"fill": 0.10, "stroke_frac": 0.006},
    10: {"fill": 0.15, "stroke_frac": 0.007},
    5:  {"fill": 0.22, "stroke_frac": 0.009},
}

# Landscape OG canvas (the 1.91:1 ratio Slack / Facebook / Twitter expect).
CARD_W = 1200
CARD_H = 630
WALKSHED_FILL_FRAC = 0.82   # 15-min bbox fills this fraction of the card height


def load_station_and_contours():
    """Read Westlake's isochrones + station coords from the walksheds dump."""
    if not WALKSHEDS_DUMP.exists():
        raise SystemExit(
            f"Missing {WALKSHEDS_DUMP.relative_to(ROOT)}. "
            "Run `python3 data/pois/fetch_walksheds.py --refresh` first."
        )
    with gzip.open(WALKSHEDS_DUMP) as f:
        dump = json.load(f)
    entry = dump["walksheds"].get(STATION_KEY)
    if not entry:
        raise SystemExit(f"Station key {STATION_KEY!r} not found in walksheds dump.")
    station = entry["station"]
    contours: dict[int, list[list[tuple[float, float]]]] = {}
    for feat in entry["features"]:
        minutes = int(feat["properties"]["contour"])
        geom = feat["geometry"]
        if geom["type"] == "Polygon":
            rings = [[(c[0], c[1]) for c in ring] for ring in geom["coordinates"]]
        elif geom["type"] == "MultiPolygon":
            biggest = max(geom["coordinates"], key=lambda p: len(p[0]))
            rings = [[(c[0], c[1]) for c in ring] for ring in biggest]
        else:
            raise SystemExit(f"Unexpected geometry type: {geom['type']}")
        contours[minutes] = rings
    missing = [m for m in MINUTES if m not in contours]
    if missing:
        raise SystemExit(f"Walksheds dump for {STATION_KEY} is missing contours: {missing}")
    return station, contours


def project(points, lat0):
    """Equirectangular projection: lng/lat -> meters (east, north)."""
    R = 6_371_000
    cos_lat0 = math.cos(math.radians(lat0))
    out = []
    for lng, lat in points:
        x = math.radians(lng) * R * cos_lat0
        y = math.radians(lat) * R
        out.append((x, y))
    return out


def build_svg() -> str:
    station, contours = load_station_and_contours()
    station_lat = station["lat"]

    # Fit the outermost (15-min) bbox to a fraction of the card height, then
    # center the whole walkshed in the card. The station is drawn at its true
    # projected position within that framing (which is ~the bbox center).
    outer_flat = [pt for ring in contours[max(MINUTES)] for pt in ring]
    projected_outer = project(outer_flat, station_lat)
    xs = [p[0] for p in projected_outer]
    ys = [p[1] for p in projected_outer]
    bbox_w = max(xs) - min(xs)
    bbox_h = max(ys) - min(ys)
    scale = (CARD_H * WALKSHED_FILL_FRAC) / max(bbox_w, bbox_h)
    bx_c = (min(xs) + max(xs)) / 2
    by_c = (min(ys) + max(ys)) / 2

    def to_canvas(p):
        x = (p[0] - bx_c) * scale + CARD_W / 2
        y = -(p[1] - by_c) * scale + CARD_H / 2  # SVG y is down
        return x, y

    def project_rings_to_path(rings):
        flat = [pt for ring in rings for pt in ring]
        projected = project(flat, station_lat)
        parts = []
        idx = 0
        for ring in rings:
            canvas_ring = [to_canvas(projected[idx + i]) for i in range(len(ring))]
            idx += len(ring)
            parts.append("M " + " L ".join(f"{x:.1f},{y:.1f}" for x, y in canvas_ring) + " Z")
        return " ".join(parts)

    # Render outer -> inner so inner fills paint on top and read as a gradient.
    contour_paths = []
    for minutes in sorted(MINUTES, reverse=True):
        style = CONTOUR_STYLE[minutes]
        d = project_rings_to_path(contours[minutes])
        stroke_w = style["stroke_frac"] * CARD_H
        contour_paths.append(
            f'  <path d="{d}" fill="{ACCENT}" fill-opacity="{style["fill"]}" fill-rule="evenodd" '
            f'stroke="{ACCENT}" stroke-width="{stroke_w:.1f}" stroke-linejoin="round" stroke-linecap="round"/>'
        )
    contour_block = "\n".join(contour_paths)

    # Station pill centered on the station's projected coordinate, echoing
    # StationPill.jsx: [1][2] roundels + stop-code chip + name.
    sx, sy = to_canvas(project([(station["lng"], station["lat"])], station_lat)[0])
    pill = build_pill_svg(sx, sy, station)

    # Wordmark + tagline over a soft bottom scrim for legibility on the fill.
    wordmark = build_wordmark_svg()

    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{CARD_W}" height="{CARD_H}" viewBox="0 0 {CARD_W} {CARD_H}">
  <defs>
    <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="{BG}" stop-opacity="0"/>
      <stop offset="1" stop-color="{BG}" stop-opacity="0.92"/>
    </linearGradient>
  </defs>
  <rect width="{CARD_W}" height="{CARD_H}" fill="{BG}"/>
{contour_block}
  <rect x="0" y="{CARD_H - 210}" width="{CARD_W}" height="210" fill="url(#scrim)"/>
{pill}
{wordmark}
</svg>
'''


def build_pill_svg(cx: float, cy: float, station) -> str:
    """A station pill drawn as SVG, centered at (cx, cy). Mirrors StationPill.jsx."""
    name = station["name"].replace(" Station", "")
    stop_code = str(station["stopCode"])
    lines = [n.strip() for n in station["lines"].split(",")]

    # Geometry (px). Scaled up from the on-map pill so it reads in a small card.
    circle_d = 52
    circle_gap = 6
    chip_w = 58
    chip_h = 52
    name_font = 46
    code_font = 30
    circle_font = 30
    gap = 14
    pad_x = 22
    pad_y = 16
    font_family = "DejaVu Sans, Helvetica, Arial, sans-serif"

    lines_w = len(lines) * circle_d + (len(lines) - 1) * circle_gap
    # Approximate name width (DejaVu Sans bold ~0.60 em average advance).
    name_w = len(name) * name_font * 0.60
    inner_w = lines_w + gap + chip_w + gap + name_w
    pill_w = inner_w + 2 * pad_x
    pill_h = max(circle_d, chip_h) + 2 * pad_y
    x0 = cx - pill_w / 2
    y0 = cy - pill_h / 2

    parts = [
        f'  <g>',
        f'    <rect x="{x0:.1f}" y="{y0:.1f}" width="{pill_w:.1f}" height="{pill_h:.1f}" '
        f'rx="{pill_h/2:.1f}" fill="#ffffff" stroke="#333333" stroke-width="4"/>',
    ]

    x = x0 + pad_x
    line_colors = {"1": LINE_1_COLOR, "2": LINE_2_COLOR}
    for n in lines:
        ccx = x + circle_d / 2
        ccy = cy
        parts.append(
            f'    <circle cx="{ccx:.1f}" cy="{ccy:.1f}" r="{circle_d/2:.1f}" fill="{line_colors.get(n, "#999999")}"/>'
        )
        parts.append(
            f'    <text x="{ccx:.1f}" y="{ccy + circle_font*0.35:.1f}" font-family="{font_family}" '
            f'font-weight="700" font-size="{circle_font}" text-anchor="middle" fill="#ffffff">{n}</text>'
        )
        x += circle_d + circle_gap

    x += gap - circle_gap
    chip_x = x
    chip_y = cy - chip_h / 2
    parts.append(
        f'    <rect x="{chip_x:.1f}" y="{chip_y:.1f}" width="{chip_w}" height="{chip_h}" '
        f'rx="8" fill="#e8e8e8"/>'
    )
    parts.append(
        f'    <text x="{chip_x + chip_w/2:.1f}" y="{cy + code_font*0.35:.1f}" font-family="{font_family}" '
        f'font-weight="700" font-size="{code_font}" text-anchor="middle" fill="#333333">{stop_code}</text>'
    )
    x += chip_w + gap

    parts.append(
        f'    <text x="{x:.1f}" y="{cy + name_font*0.35:.1f}" font-family="{font_family}" '
        f'font-weight="700" font-size="{name_font}" text-anchor="start" fill="#333333">{name}</text>'
    )
    parts.append('  </g>')
    return "\n".join(parts)


def build_wordmark_svg() -> str:
    font_family = "DejaVu Sans, Helvetica, Arial, sans-serif"
    x = 64
    return "\n".join([
        f'  <text x="{x}" y="{CARD_H - 92}" font-family="{font_family}" font-weight="700" '
        f'font-size="72" letter-spacing="1" fill="#1a1a1a">Walksheds</text>',
        f'  <text x="{x}" y="{CARD_H - 48}" font-family="{font_family}" font-weight="400" '
        f'font-size="30" fill="#555555">Seattle Link Light Rail walkshed explorer</text>',
    ])


def build() -> None:
    svg = build_svg()
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    cairosvg.svg2png(
        bytestring=svg.encode("utf-8"),
        output_width=CARD_W,
        output_height=CARD_H,
        write_to=str(OUT_PATH),
    )
    print(f"wrote {OUT_PATH.relative_to(ROOT)} ({CARD_W}x{CARD_H})")


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.parse_args()
    build()


if __name__ == "__main__":
    main()
