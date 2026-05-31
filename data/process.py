"""Process SDOT raw data into app-ready GeoJSON and station icon sprites.

Reads:
  data/raw/light-rail-alignment.geojson
  data/raw/light-rail-stations.geojson

Writes:
  public/line1-alignment.geojson
  public/line2-alignment.geojson
  public/all-stations.geojson
  public/icons/stations.json       (1x sprite manifest)
  public/icons/stations.png        (1x sprite sheet)
  public/icons/stations@2x.json    (2x sprite manifest)
  public/icons/stations@2x.png     (2x sprite sheet)

Run from project root: python3 data/process.py
"""

import json
import math
import os
from io import BytesIO

import cairosvg
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ── Station name corrections (SDOT → Sound Transit current names) ──
NAME_MAP = {
    "NE 145th Station": "Shoreline South/148th Station",
    "University Street Station": "Symphony Station",
}

# ── Missing stations with approximate coordinates ──
MISSING_STATIONS = [
    ("Lynnwood City Center Station", -122.2948, 47.8156),
    ("Mountlake Terrace Station", -122.3148, 47.7850),
    ("Shoreline North/185th Station", -122.3229, 47.7641),
    ("Kent Des Moines Station", -122.2953, 47.4110),
    ("Star Lake Station", -122.2930, 47.3940),
    ("Federal Way Downtown Station", -122.3120, 47.3170),
    ("Marymoor Village Station", -122.1180, 47.6620),
    ("Downtown Redmond Station", -122.1248, 47.6732),
]

# ── Official station orders ──
LINE_1_ORDER = [
    "Lynnwood City Center Station",
    "Mountlake Terrace Station",
    "Shoreline North/185th Station",
    "Shoreline South/148th Station",
    "Northgate Station",
    "Roosevelt Station",
    "U District Station",
    "University of Washington Station",
    "Capitol Hill Station",
    "Westlake Station",
    "Symphony Station",
    "Pioneer Square Station",
    "International District Station",
    "Stadium Station",
    "SODO Station",
    "Beacon Hill Station",
    "Mount Baker Station",
    "Columbia City Station",
    "Othello Station",
    "Rainier Beach Station",
    "Tukwila International Blvd Station",
    "Airport / SeaTac Station",
    "Angle Lake Station",
    "Kent Des Moines Station",
    "Star Lake Station",
    "Federal Way Downtown Station",
]

LINE_2_ORDER = [
    "Lynnwood City Center Station",
    "Mountlake Terrace Station",
    "Shoreline North/185th Station",
    "Shoreline South/148th Station",
    "Northgate Station",
    "Roosevelt Station",
    "U District Station",
    "University of Washington Station",
    "Capitol Hill Station",
    "Westlake Station",
    "Symphony Station",
    "Pioneer Square Station",
    "International District Station",
    "Judkins Park Station",
    "Mercer Island Station",
    "South Bellevue Station",
    "East Main Station",
    "Bellevue Downtown Station",
    "Wilburton Station",
    "Spring District/120th Station",
    "Bel-Red/130th Station",
    "Overlake Village Station",
    "Redmond Technology Center Station",
    "Marymoor Village Station",
    "Downtown Redmond Station",
]

# Shared segment: first 13 stations (Lynnwood through Intl District)
SHARED_COUNT = 13
SHARED_NAMES = set(LINE_1_ORDER[:SHARED_COUNT])

TACOMA_KW = [
    "Commerce",
    "Theater District",
    "Convention Center",
    "Union Station",
    "Tacoma Dome",
    "South 25th",
]

# ── Stop codes (from Sound Transit website) ──
# Shared stations use the same code for both lines
# Line-specific stations use line-prefixed codes (1xx for Line 1, 2xx for Line 2)
STOP_CODES = {
    # Shared — Westlake=50 center, decreasing north, increasing south
    # Reference: soundtransit.org/blog/platform/understanding-sound-transits-new-three-digit-station-codes
    "Lynnwood City Center Station": 40,
    "Mountlake Terrace Station": 41,
    "Shoreline North/185th Station": 42,
    "Shoreline South/148th Station": 43,
    # 44 reserved for future NE 130th St Station
    "Northgate Station": 45,
    "Roosevelt Station": 46,
    "U District Station": 47,
    "University of Washington Station": 48,
    "Capitol Hill Station": 49,
    "Westlake Station": 50,
    "Symphony Station": 51,
    "Pioneer Square Station": 52,
    "International District Station": 53,
}

LINE_1_CODES = {
    "Stadium Station": 54,
    "SODO Station": 55,
    "Beacon Hill Station": 56,
    "Mount Baker Station": 57,
    "Columbia City Station": 58,
    "Othello Station": 60,
    "Rainier Beach Station": 61,
    "Tukwila International Blvd Station": 63,
    "Airport / SeaTac Station": 64,
    "Angle Lake Station": 65,
    "Kent Des Moines Station": 66,
    "Star Lake Station": 67,
    "Federal Way Downtown Station": 68,
}

LINE_2_CODES = {
    "Judkins Park Station": 54,
    "Mercer Island Station": 55,
    "South Bellevue Station": 56,
    "East Main Station": 57,
    "Bellevue Downtown Station": 58,
    "Wilburton Station": 59,
    "Spring District/120th Station": 60,
    "Bel-Red/130th Station": 61,
    "Overlake Village Station": 62,
    "Redmond Technology Center Station": 63,
    "Marymoor Village Station": 64,
    "Downtown Redmond Station": 65,
}

# Offset distance for parallel lines in shared segment
OFFSET_METERS = 30

# SDOT alignment descriptions for each line
LINE1_DESCS = {"Central Link", "University Link", "North Link", "Airport Link", "Angle Lake"}


def dist(a, b):
    return math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2)


def get_coords(feat):
    """Extract coordinates from a GeoJSON geometry."""
    g = feat["geometry"]
    if g["type"] == "LineString":
        return list(g["coordinates"])
    elif g["type"] == "MultiLineString":
        return [c for part in g["coordinates"] for c in part]
    return []


def find_sdot_points_between(sdot_points, station_a, station_b, max_deviation=0.005):
    """Find SDOT alignment points that lie between two stations.

    Collects points whose latitude falls between the two stations (with some
    tolerance) and that don't deviate too far from the straight line between them.
    Returns the points sorted by distance along the A→B vector.
    """
    lng_a, lat_a = station_a
    lng_b, lat_b = station_b

    lat_min = min(lat_a, lat_b)
    lat_max = max(lat_a, lat_b)
    lng_min = min(lng_a, lng_b)
    lng_max = max(lng_a, lng_b)

    # Expand bounding box slightly to catch points near stations
    pad = 0.002
    lat_min -= pad
    lat_max += pad
    lng_min -= pad
    lng_max += pad

    # Direction vector A→B
    dx = lng_b - lng_a
    dy = lat_b - lat_a
    seg_len = math.sqrt(dx * dx + dy * dy)
    if seg_len == 0:
        return []

    candidates = []
    for pt in sdot_points:
        # Bounding box filter
        if not (lat_min <= pt[1] <= lat_max and lng_min <= pt[0] <= lng_max):
            continue

        # Project point onto A→B line
        t = ((pt[0] - lng_a) * dx + (pt[1] - lat_a) * dy) / (seg_len * seg_len)
        if t < 0.05 or t > 0.95:  # skip points too close to endpoints
            continue

        # Perpendicular distance from A→B line
        proj_lng = lng_a + t * dx
        proj_lat = lat_a + t * dy
        perp_dist = math.sqrt((pt[0] - proj_lng) ** 2 + (pt[1] - proj_lat) ** 2)

        if perp_dist < max_deviation:
            candidates.append((t, pt))

    # Sort by position along segment and deduplicate close points
    candidates.sort(key=lambda x: x[0])
    result = []
    for t, pt in candidates:
        if not result or dist(result[-1], pt) > 0.0005:
            result.append(pt)

    return result


def enrich_with_sdot(station_coords_list, sdot_points):
    """Insert SDOT intermediate points between station pairs to add curvature."""
    enriched = [station_coords_list[0]]
    for i in range(len(station_coords_list) - 1):
        a = station_coords_list[i]
        b = station_coords_list[i + 1]
        intermediates = find_sdot_points_between(sdot_points, a, b)
        enriched.extend(intermediates)
        enriched.append(b)
    return enriched


def chaikin(coords, iterations=3):
    """Chaikin curve smoothing — subdivides segments for smooth curves.

    Keeps first and last points fixed (station positions).
    """
    pts = list(coords)
    for _ in range(iterations):
        out = [pts[0]]
        for i in range(len(pts) - 1):
            p0, p1 = pts[i], pts[i + 1]
            out.append([0.75 * p0[0] + 0.25 * p1[0], 0.75 * p0[1] + 0.25 * p1[1]])
            out.append([0.25 * p0[0] + 0.75 * p1[0], 0.25 * p0[1] + 0.75 * p1[1]])
        out.append(pts[-1])
        pts = out
    return pts


def offset_polyline(coords, meters, side="left"):
    """Offset a polyline perpendicular to its travel direction.
    'left' = left of travel direction (west for a south-bound line).
    'right' = right of travel direction (east for a south-bound line).
    Line 1 is always left/west, Line 2 is always right/east.
    """
    sign = -1 if side == "left" else 1
    result = []
    n = len(coords)

    for i in range(n):
        if i == 0:
            dx = coords[1][0] - coords[0][0]
            dy = coords[1][1] - coords[0][1]
        elif i == n - 1:
            dx = coords[-1][0] - coords[-2][0]
            dy = coords[-1][1] - coords[-2][1]
        else:
            dx = coords[i + 1][0] - coords[i - 1][0]
            dy = coords[i + 1][1] - coords[i - 1][1]

        length = math.sqrt(dx * dx + dy * dy)
        if length == 0:
            result.append(list(coords[i]))
            continue

        # Perpendicular vector (90° clockwise for 'right')
        px = sign * dy / length
        py = sign * (-dx) / length

        lng, lat = coords[i]
        lat_rad = math.radians(lat)
        m_per_deg_lng = 111320 * math.cos(lat_rad)
        m_per_deg_lat = 110540

        result.append([
            lng + px * meters / m_per_deg_lng,
            lat + py * meters / m_per_deg_lat,
        ])
    return result


def main():
    # Load raw SDOT data
    with open(os.path.join(ROOT, "data/raw/light-rail-stations.geojson")) as f:
        raw_stations = json.load(f)
    with open(os.path.join(ROOT, "data/raw/light-rail-alignment.geojson")) as f:
        raw_alignment = json.load(f)

    # ── Collect all SDOT alignment points for route enrichment ──
    sdot_existing = [
        f for f in raw_alignment["features"]
        if f["properties"].get("STATUS") == "Existing / Under Construction"
    ]
    line1_sdot_pts = []
    east_sdot_pts = []
    for f in sdot_existing:
        desc = f["properties"].get("DESCRIPTIO", "")
        pts = get_coords(f)
        if desc in LINE1_DESCS:
            line1_sdot_pts.extend(pts)
        elif desc == "East Link":
            east_sdot_pts.extend(pts)

    print(f"SDOT points: {len(line1_sdot_pts)} Line 1, {len(east_sdot_pts)} East Link")

    # ── Build station coordinate index ──
    existing = [
        feat
        for feat in raw_stations["features"]
        if feat["properties"].get("STATUS") == "Existing / Under Construction"
        and not any(kw in list(feat["properties"].values())[2] for kw in TACOMA_KW)
    ]

    station_coords = {}
    for feat in existing:
        raw_name = list(feat["properties"].values())[2]
        name = NAME_MAP.get(raw_name, raw_name)
        station_coords[name] = feat["geometry"]["coordinates"]

    for name, lng, lat in MISSING_STATIONS:
        if name not in station_coords:
            station_coords[name] = [lng, lat]

    # ── Build enriched line geometries ──
    # Start with station-to-station coordinates, then insert SDOT intermediate
    # points for curvature, then apply Chaikin smoothing.
    shared_stations = [station_coords[n] for n in LINE_1_ORDER[:SHARED_COUNT] if n in station_coords]
    line1_south_stations = [station_coords[n] for n in LINE_1_ORDER[SHARED_COUNT - 1 :] if n in station_coords]
    line2_east_stations = [station_coords[n] for n in LINE_2_ORDER[SHARED_COUNT - 1 :] if n in station_coords]

    # Enrich with SDOT intermediate points
    shared_enriched = enrich_with_sdot(shared_stations, line1_sdot_pts)
    south_enriched = enrich_with_sdot(line1_south_stations, line1_sdot_pts)
    east_enriched = enrich_with_sdot(line2_east_stations, east_sdot_pts)

    # Apply Chaikin smoothing
    shared_smooth = chaikin(shared_enriched, iterations=2)
    south_smooth = chaikin(south_enriched, iterations=2)
    east_smooth = chaikin(east_enriched, iterations=2)

    print(f"Enriched: shared {len(shared_stations)}→{len(shared_enriched)}→{len(shared_smooth)} pts, "
          f"south {len(line1_south_stations)}→{len(south_enriched)}→{len(south_smooth)} pts, "
          f"east {len(line2_east_stations)}→{len(east_enriched)}→{len(east_smooth)} pts")

    # Offset shared segment: Line 1 west, Line 2 east
    line1_shared = offset_polyline(shared_smooth, OFFSET_METERS, side="right")  # west
    line2_shared = offset_polyline(shared_smooth, OFFSET_METERS, side="left")   # east

    # Full line coordinates
    line1_full = line1_shared + south_smooth[1:]
    line2_full = line2_shared + east_smooth[1:]

    line1_geojson = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"line": "1-line"},
                "geometry": {"type": "LineString", "coordinates": line1_full},
            }
        ],
    }

    line2_geojson = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"line": "2-line"},
                "geometry": {"type": "LineString", "coordinates": line2_full},
            }
        ],
    }

    # ── Build station GeoJSON ──
    # Shared stations get a SINGLE marker centered between the two offset lines.
    # Exclusive stations use their actual coordinates.
    features = []

    def get_stop_code(name, line_id):
        if name in STOP_CODES:
            return STOP_CODES[name]
        if line_id == "1-line" and name in LINE_1_CODES:
            return LINE_1_CODES[name]
        if line_id == "2-line" and name in LINE_2_CODES:
            return LINE_2_CODES[name]
        return None

    # Shared stations: single centered marker
    for name in LINE_1_ORDER[:SHARED_COUNT]:
        if name not in station_coords:
            print(f"WARNING: Missing coords for {name}")
            continue
        # Center between the two offset positions
        coords = station_coords[name]  # original centerline position
        code = get_stop_code(name, "1-line")
        features.append({
            "type": "Feature",
            "properties": {
                "name": name,
                "line": "1-line",
                "stopCode": code,
                "shared": True,
                "lines": "1,2",
            },
            "geometry": {"type": "Point", "coordinates": coords},
        })

    # Line 1 exclusive stations (south of junction)
    for name in LINE_1_ORDER[SHARED_COUNT:]:
        if name not in station_coords:
            print(f"WARNING: Missing coords for {name}")
            continue
        code = get_stop_code(name, "1-line")
        features.append({
            "type": "Feature",
            "properties": {
                "name": name,
                "line": "1-line",
                "stopCode": code,
                "shared": False,
                "lines": "1",
            },
            "geometry": {"type": "Point", "coordinates": station_coords[name]},
        })

    # Line 2 exclusive stations (east of junction)
    for name in LINE_2_ORDER[SHARED_COUNT:]:
        if name not in station_coords:
            print(f"WARNING: Missing coords for {name}")
            continue
        code = get_stop_code(name, "2-line")
        features.append({
            "type": "Feature",
            "properties": {
                "name": name,
                "line": "2-line",
                "stopCode": code,
                "shared": False,
                "lines": "2",
            },
            "geometry": {"type": "Point", "coordinates": station_coords[name]},
        })

    stations_geojson = {"type": "FeatureCollection", "features": features}

    # ── Write output ──
    public = os.path.join(ROOT, "public")
    os.makedirs(public, exist_ok=True)

    for name, data in [
        ("line1-alignment", line1_geojson),
        ("line2-alignment", line2_geojson),
        ("all-stations", stations_geojson),
    ]:
        path = os.path.join(public, f"{name}.geojson")
        with open(path, "w") as f:
            json.dump(data, f)

    unique = set(feat["properties"]["name"] for feat in features)
    print(f"Stations: {len(features)} features ({len(unique)} unique)")
    print(f"Line 1: {len(line1_full)} points")
    print(f"Line 2: {len(line2_full)} points")
    print(f"Shared offset: {OFFSET_METERS}m (Line 1 west, Line 2 east)")

    # ── Build station index ──
    station_index = build_station_index(stations_geojson)
    index_path = os.path.join(ROOT, "data", "station-index.json")
    with open(index_path, "w") as f:
        json.dump(station_index, f, indent=2, sort_keys=True)
        f.write("\n")
    print(f"Index: {len(station_index['stations'])} stations → {index_path}")

    # ── Generate station icon sprites ──
    icons_dir = os.path.join(public, "icons")
    generate_sprites(station_index, icons_dir)


# ── Station index ──

INDEX_VERSION = 1


def build_station_index(stations_geojson):
    """Derive a canonical, diff-friendly station index from the GeoJSON.

    Sorted by (lines, stopCode) so the JSON file diffs cleanly.
    """
    stations = []
    for feat in stations_geojson["features"]:
        props = feat["properties"]
        lng, lat = feat["geometry"]["coordinates"]
        stations.append({
            "name": props["name"],
            "lines": props["lines"],
            "stopCode": props["stopCode"],
            "lng": lng,
            "lat": lat,
        })
    stations.sort(key=lambda s: (s["lines"], s["stopCode"]))
    return {"version": INDEX_VERSION, "stations": stations}


# ── Station icon sprite generation ──

LINE_COLORS_HEX = {"1": "#4CAF50", "2": "#0082C8"}

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


def create_pill_svg(lines_str, stop_code, mode="light"):
    """Generate an SVG pill icon — mirrors createPillSVG in stationIcons.js."""
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
        color = LINE_COLORS_HEX.get(line, "#999")
        parts.append(
            f'<circle cx="{cx}" cy="{height / 2}" r="{CIRCLE_R}" fill="{color}"/>'
        )
        parts.append(
            f'<text x="{cx}" y="{height / 2 + 4}" text-anchor="middle" '
            f'fill="{LINE_TEXT_COLOR}" '
            f'font-family="-apple-system,BlinkMacSystemFont,sans-serif" '
            f'font-size="12" font-weight="bold">{line}</text>'
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


def generate_sprites(station_index, output_dir):
    """Generate Mapbox-compatible sprite sheets (1x and 2x) from the station index."""
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
                svg, w, h = create_pill_svg(lines, code, mode)
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

    print(f"Sprites: {len(icons)} icons → stations.png + stations@2x.png")


if __name__ == "__main__":
    main()
