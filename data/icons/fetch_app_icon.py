#!/usr/bin/env python3
"""Generate the iOS home-screen icon from Westlake's real walking isochrone.

The icon = the 15-minute Mapbox walking isochrone outline for Westlake station,
filled and stroked in the app's accent blue, with the two-line shared-station
circles (Line 1 green + Line 2 blue) centered at the station's projected
coordinate. Light and dark variants use the actual Mapbox Standard basemap
land tones (sampled from walksheds.xyz) for the background, matching the
in-app day/dusk presets.

Two phases, mirroring data/pois/fetch_pois.py:

  1. Refresh (network): --refresh hits the Mapbox Isochrone API and writes
     data/icons/raw/westlake-walkshed-15min.geojson.
  2. Build (no network, default): reads the committed raw GeoJSON, renders
     two SVG variants, rasterizes to PNGs under public/.

System requirement: cairosvg (and libcairo). Install via `pip install cairosvg`.
The token for --refresh is read from VITE_MAPBOX_ACCESS_TOKEN in .env, or from
the MAPBOX_TOKEN environment variable.

Usage:
  python3 data/icons/fetch_app_icon.py            # build from committed GeoJSON
  python3 data/icons/fetch_app_icon.py --refresh  # refetch isochrone, then build
"""

import argparse
import json
import math
import os
import sys
import urllib.parse
import urllib.request
from pathlib import Path

import cairosvg

ROOT = Path(__file__).resolve().parents[2]
RAW_PATH = ROOT / "data" / "icons" / "raw" / "westlake-walkshed-15min.geojson"
OUT_DIR = ROOT / "public"

# Westlake Station — shared station 50, intersection of Lines 1 and 2.
# Coordinates match public/all-stations.geojson.
STATION_LNG = -122.336719986395
STATION_LAT = 47.6115721588528
MINUTES = 15

# Colors
ACCENT = "#0082C8"      # WALKSHED_ACCENT_LIGHT (matches src/constants.js)
LINE1_GREEN = "#4CAF50" # Line 1 — from data/process.py marker generation
LINE2_BLUE = "#0082C8"  # Line 2 — same accent as the walkshed

# Basemap land tones sampled from the live walksheds.xyz Mapbox Standard render
# at z~13 over Westlake, day and dusk lightPresets.
BG_LIGHT = "#f4f0ef"
BG_DARK = "#434860"

# SVG working canvas; export sizes are rasterized down from this.
CANVAS = 1024
PADDING_FRAC = 0.06              # 6% breathing room around the polygon bbox
CIRCLE_R_FRAC = 0.135            # circle radius as fraction of canvas
CIRCLE_GAP_FRAC = 0.012          # gap between the two circles
STROKE_W_FRAC = 0.022            # walkshed stroke width
DARK_RING_W_FRAC = 0.008         # white ring around circles in dark variant

EXPORT_SIZES = [180, 512]        # iOS standard + high-DPI fallback


def fetch_mapbox_isochrone(token: str) -> dict:
    """Call the Mapbox Isochrone API (same URL as src/mapbox.js:11)."""
    url = (
        "https://api.mapbox.com/isochrone/v1/mapbox/walking/"
        f"{STATION_LNG},{STATION_LAT}"
        f"?contours_minutes={MINUTES}&polygons=true"
        f"&access_token={urllib.parse.quote(token, safe='')}"
    )
    # The shared public token is URL-restricted; send the production Referer so
    # the request matches the deployed app's calling context.
    req = urllib.request.Request(url, headers={"Referer": "https://walksheds.xyz/"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        if resp.status != 200:
            raise SystemExit(f"Mapbox returned HTTP {resp.status}")
        return json.loads(resp.read())


def read_token() -> str:
    tok = os.environ.get("MAPBOX_TOKEN") or os.environ.get("VITE_MAPBOX_ACCESS_TOKEN")
    if tok:
        return tok
    env_path = ROOT / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line.startswith("VITE_MAPBOX_ACCESS_TOKEN"):
                _, _, val = line.partition("=")
                return val.strip().strip('"').strip("'")
    raise SystemExit(
        "No Mapbox token found. Set MAPBOX_TOKEN env var, or put "
        "VITE_MAPBOX_ACCESS_TOKEN=... in .env at the repo root."
    )


def refresh() -> None:
    token = read_token()
    geojson = fetch_mapbox_isochrone(token)
    # Strip Mapbox's default styling props; keep only what identifies the contour.
    for f in geojson.get("features", []):
        props = f.get("properties") or {}
        f["properties"] = {k: props[k] for k in ("contour", "metric") if k in props}
    RAW_PATH.parent.mkdir(parents=True, exist_ok=True)
    RAW_PATH.write_text(json.dumps(geojson, separators=(",", ":")))
    print(f"wrote {RAW_PATH.relative_to(ROOT)} ({RAW_PATH.stat().st_size} bytes)")


def load_polygon() -> list[list[tuple[float, float]]]:
    """Return list of rings (each a list of (lng, lat) tuples) for the isochrone."""
    if not RAW_PATH.exists():
        raise SystemExit(
            f"Missing {RAW_PATH.relative_to(ROOT)}. Run with --refresh first."
        )
    data = json.loads(RAW_PATH.read_text())
    feat = data["features"][0]
    geom = feat["geometry"]
    if geom["type"] == "Polygon":
        return [[(c[0], c[1]) for c in ring] for ring in geom["coordinates"]]
    if geom["type"] == "MultiPolygon":
        # Pick the polygon with the largest outer ring (longest perimeter proxy).
        polys = geom["coordinates"]
        biggest = max(polys, key=lambda p: len(p[0]))
        return [[(c[0], c[1]) for c in ring] for ring in biggest]
    raise SystemExit(f"Unexpected geometry type: {geom['type']}")


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
    rings_lnglat = load_polygon()
    flat = [pt for ring in rings_lnglat for pt in ring]
    projected_flat = project(flat, STATION_LAT)
    station_x_m, station_y_m = project([(STATION_LNG, STATION_LAT)], STATION_LAT)[0]

    xs = [p[0] for p in projected_flat]
    ys = [p[1] for p in projected_flat]
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

    # Build SVG path covering all rings (outer + holes); use evenodd fill-rule.
    path_parts = []
    idx = 0
    for ring in rings_lnglat:
        canvas_ring = [to_canvas(projected_flat[idx + i]) for i in range(len(ring))]
        idx += len(ring)
        d = "M " + " L ".join(f"{x:.1f},{y:.1f}" for x, y in canvas_ring) + " Z"
        path_parts.append(d)
    path_d = " ".join(path_parts)

    station_canvas = to_canvas((station_x_m, station_y_m))
    sx, sy = station_canvas
    r = CIRCLE_R_FRAC * CANVAS
    gap = CIRCLE_GAP_FRAC * CANVAS
    left_cx = sx - (r + gap / 2)
    right_cx = sx + (r + gap / 2)

    bg = BG_LIGHT if variant == "light" else BG_DARK
    fill_opacity = 0.18 if variant == "light" else 0.30
    stroke_w = STROKE_W_FRAC * CANVAS
    ring_w = DARK_RING_W_FRAC * CANVAS if variant == "dark" else 0

    ring_attrs = (
        f' stroke="#ffffff" stroke-width="{ring_w:.1f}"' if variant == "dark" else ""
    )

    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{CANVAS}" height="{CANVAS}" viewBox="0 0 {CANVAS} {CANVAS}">
  <rect width="{CANVAS}" height="{CANVAS}" fill="{bg}"/>
  <path d="{path_d}" fill="{ACCENT}" fill-opacity="{fill_opacity}" fill-rule="evenodd" stroke="{ACCENT}" stroke-width="{stroke_w:.1f}" stroke-linejoin="round" stroke-linecap="round"/>
  <circle cx="{left_cx:.1f}" cy="{sy:.1f}" r="{r:.1f}" fill="{LINE1_GREEN}"{ring_attrs}/>
  <circle cx="{right_cx:.1f}" cy="{sy:.1f}" r="{r:.1f}" fill="{LINE2_BLUE}"{ring_attrs}/>
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
            name = f"apple-touch-icon{suffix}.png" if size == 180 else f"apple-touch-icon{suffix}-{size}.png"
            out = OUT_DIR / name
            rasterize(svg, size, out)
            print(f"wrote {out.relative_to(ROOT)} ({size}x{size})")


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--refresh", action="store_true",
                    help="Refetch the isochrone from Mapbox before building.")
    args = ap.parse_args()
    if args.refresh:
        refresh()
    build()


if __name__ == "__main__":
    main()
