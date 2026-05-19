#!/usr/bin/env python3
"""Generate the iOS home-screen icon from UW Station's real walking isochrones.

The icon = the 5/10/15-minute Mapbox walking isochrones for University of
Washington station, stacked in the app's accent blue at the same opacities
WalkshedLayers.jsx uses on the live map, with the two-line shared-station
circles (Line 1 green + Line 2 blue) centered at the station's projected
coordinate. Light and dark variants use the actual Mapbox Standard basemap
land tones (sampled from walksheds.xyz) for the background.

Reads from the canonical walksheds dump at data/pois/raw/walksheds.json.gz
(maintained by data/pois/fetch_walksheds.py — refresh it there to pick up
new Mapbox data). This script is build-only; no network.

System requirement: cairosvg (and libcairo). Install via `pip install cairosvg`.

Usage:
  python3 data/icons/fetch_app_icon.py   # rebuild PNGs from the committed dump
"""

import argparse
import gzip
import json
import math
from pathlib import Path

import cairosvg

ROOT = Path(__file__).resolve().parents[2]
WALKSHEDS_DUMP = ROOT / "data" / "pois" / "raw" / "walksheds.json.gz"
OUT_DIR = ROOT / "public"

# University of Washington Station — shared station 48, intersection of Lines 1
# and 2. Key in walksheds.json.gz disambiguates the two stopCode 54 stations.
STATION_KEY = "1,2-48"
MINUTES = [5, 10, 15]

# Colors
ACCENT = "#0082C8"      # WALKSHED_ACCENT_LIGHT (matches src/constants.js)
LINE1_GREEN = "#4CAF50" # Line 1 — from data/process.py marker generation
LINE2_BLUE = "#0082C8"  # Line 2 — same accent as the walkshed

# Basemap land tones sampled from the live walksheds.xyz Mapbox Standard render
# at z~13, day and dusk lightPresets.
BG_LIGHT = "#f4f0ef"
BG_DARK = "#434860"

# Per-contour styling, mirroring WalkshedLayers.jsx (same accent everywhere;
# inner contours get heavier fill so the stack reads as a topographic gradient).
# Dark variant opacities are bumped because the darker land tone otherwise
# swallows the blue fill.
CONTOUR_STYLE = {
    15: {"fill_light": 0.10, "fill_dark": 0.18, "stroke_frac": 0.014},
    10: {"fill_light": 0.15, "fill_dark": 0.24, "stroke_frac": 0.016},
    5:  {"fill_light": 0.22, "fill_dark": 0.32, "stroke_frac": 0.020},
}

# SVG working canvas; PNGs are rasterized down from this.
CANVAS = 1024
PADDING_FRAC = 0.06           # 6% breathing room around the 15-min bbox
CIRCLE_R_FRAC = 0.110         # circle radius as fraction of canvas
CIRCLE_GAP_FRAC = 0.012       # gap between the two circles
CIRCLE_LABEL_FRAC = 0.165     # font-size for "1"/"2" labels as fraction of canvas
DARK_RING_W_FRAC = 0.008      # white separator ring around circles in dark variant

EXPORT_SIZES = [180, 512]     # iOS standard + high-DPI fallback


def load_station_and_contours():
    """Read UW's isochrones + station coords from the shared walksheds dump.

    Returns (lng, lat, {minutes: [ring, ring, ...]}) where each ring is a list
    of (lng, lat) tuples.
    """
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
    return station["lng"], station["lat"], contours


def project(points, lat0):
    """Equirectangular projection: lng/lat → meters (east, north)."""
    R = 6_371_000
    cos_lat0 = math.cos(math.radians(lat0))
    out = []
    for lng, lat in points:
        x = math.radians(lng) * R * cos_lat0
        y = math.radians(lat) * R
        out.append((x, y))
    return out


def build_svg(variant: str) -> str:
    station_lng, station_lat, contours = load_station_and_contours()

    # Fit everything to the outermost (15-min) bbox so it defines the icon framing.
    outer_flat = [pt for ring in contours[max(MINUTES)] for pt in ring]
    projected_outer = project(outer_flat, station_lat)
    xs = [p[0] for p in projected_outer]
    ys = [p[1] for p in projected_outer]
    bbox_w = max(xs) - min(xs)
    bbox_h = max(ys) - min(ys)
    target = CANVAS * (1 - 2 * PADDING_FRAC)
    scale = target / max(bbox_w, bbox_h)
    bx_c = (min(xs) + max(xs)) / 2
    by_c = (min(ys) + max(ys)) / 2

    def to_canvas(p):
        x = (p[0] - bx_c) * scale + CANVAS / 2
        y = -(p[1] - by_c) * scale + CANVAS / 2  # SVG y is down
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

    # Render outer → inner so inner fills paint on top and read as a gradient.
    contour_paths = []
    for minutes in sorted(MINUTES, reverse=True):
        style = CONTOUR_STYLE[minutes]
        d = project_rings_to_path(contours[minutes])
        opacity = style["fill_light"] if variant == "light" else style["fill_dark"]
        stroke_w = style["stroke_frac"] * CANVAS
        contour_paths.append(
            f'  <path d="{d}" fill="{ACCENT}" fill-opacity="{opacity}" fill-rule="evenodd" '
            f'stroke="{ACCENT}" stroke-width="{stroke_w:.1f}" stroke-linejoin="round" stroke-linecap="round"/>'
        )

    # Two circles centered at the actual station coordinate (not bbox center —
    # walking-network asymmetry means the station isn't centered in its walkshed).
    station_canvas = to_canvas(project([(station_lng, station_lat)], station_lat)[0])
    sx, sy = station_canvas
    r = CIRCLE_R_FRAC * CANVAS
    gap = CIRCLE_GAP_FRAC * CANVAS
    left_cx = sx - (r + gap / 2)
    right_cx = sx + (r + gap / 2)

    bg = BG_LIGHT if variant == "light" else BG_DARK
    ring_w = DARK_RING_W_FRAC * CANVAS if variant == "dark" else 0
    ring_attrs = (
        f' stroke="#ffffff" stroke-width="{ring_w:.1f}"' if variant == "dark" else ""
    )

    contour_block = "\n".join(contour_paths)

    font_size = CIRCLE_LABEL_FRAC * CANVAS
    # Cairo aligns dominant-baseline="central" off the cap line, so nudge labels
    # down a few percent of font size to sit visually centered in the circles.
    label_y = sy + font_size * 0.06
    label_attrs = (
        f'font-family="DejaVu Sans, Helvetica, Arial, sans-serif" '
        f'font-weight="700" font-size="{font_size:.1f}" '
        f'text-anchor="middle" dominant-baseline="central" fill="#ffffff"'
    )

    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{CANVAS}" height="{CANVAS}" viewBox="0 0 {CANVAS} {CANVAS}">
  <rect width="{CANVAS}" height="{CANVAS}" fill="{bg}"/>
{contour_block}
  <circle cx="{left_cx:.1f}" cy="{sy:.1f}" r="{r:.1f}" fill="{LINE1_GREEN}"{ring_attrs}/>
  <circle cx="{right_cx:.1f}" cy="{sy:.1f}" r="{r:.1f}" fill="{LINE2_BLUE}"{ring_attrs}/>
  <text x="{left_cx:.1f}" y="{label_y:.1f}" {label_attrs}>1</text>
  <text x="{right_cx:.1f}" y="{label_y:.1f}" {label_attrs}>2</text>
</svg>
'''


def rasterize(svg: str, size: int, out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    cairosvg.svg2png(
        bytestring=svg.encode("utf-8"),
        output_width=size,
        output_height=size,
        write_to=str(out_path),
    )


def build() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for variant in ("light", "dark"):
        svg = build_svg(variant)
        suffix = "" if variant == "light" else "-dark"
        for size in EXPORT_SIZES:
            name = (
                f"apple-touch-icon{suffix}.png"
                if size == 180
                else f"apple-touch-icon{suffix}-{size}.png"
            )
            out = OUT_DIR / name
            rasterize(svg, size, out)
            print(f"wrote {out.relative_to(ROOT)} ({size}x{size})")


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.parse_args()
    build()


if __name__ == "__main__":
    main()
