"""Seattle — Link light rail, from the SDOT Transportation Plan feed.

The city-specific half of the old single-city data/process.py: SDOT station
filtering, the hardcoded Sound Transit line orders and stop codes, and the
shared-segment offset that draws 1 Line west of 2 Line downtown. Shared
geometry lives in data/geometry.py; data/process.py drives this via build().

Because Sound Transit's station wiring is hardcoded here (LINE_1_ORDER /
LINE_2_ORDER, STOP_CODES, MISSING_STATIONS, SHARED_COUNT), a new station needs
human-judged edits to this file — data/detect_station_changes.py only reports.
"""

import json
import math

from geometry import chaikin, dist, get_coords, offset_polyline


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


class SDOTSchemaError(RuntimeError):
    """Raised when a downloaded SDOT GeoJSON feature is missing a field this
    script depends on — signals an upstream schema change rather than a bug
    in this script."""


def station_name(feat):
    """Extract a station feature's NAME, failing clearly if SDOT's schema changed.

    Reads by key rather than by position: the station layer's field order
    (OBJECTID_1, STATUS, NAME, STATION, ...) is not guaranteed to be stable,
    so indexing into properties.values() would silently pick the wrong field
    (or throw an opaque IndexError) if SDOT ever reorders or renames columns.
    """
    props = feat["properties"]
    if "NAME" not in props:
        raise SDOTSchemaError(
            "SDOT station feature is missing the 'NAME' property — the "
            f"upstream schema may have changed. Got properties: {sorted(props.keys())}. "
            "Update data/process.py (and refresh.py's validate_stations) to match."
        )
    return props["NAME"]

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


def build(city):
    """Process the committed SDOT feed into Seattle's stations + alignments.

    Returns (stations_geojson, {line id: alignment FeatureCollection}).
    """
    # Load raw SDOT data
    with open(city.raw_dir / "light-rail-stations.geojson") as f:
        raw_stations = json.load(f)
    with open(city.raw_dir / "light-rail-alignment.geojson") as f:
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
        and not any(kw in station_name(feat) for kw in TACOMA_KW)
    ]

    station_coords = {}
    for feat in existing:
        raw_name = station_name(feat)
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

    unique = set(feat["properties"]["name"] for feat in features)
    print(f"Stations: {len(features)} features ({len(unique)} unique)")
    print(f"Line 1: {len(line1_full)} points")
    print(f"Line 2: {len(line2_full)} points")
    print(f"Shared offset: {OFFSET_METERS}m (Line 1 west, Line 2 east)")

    return stations_geojson, {"1-line": line1_geojson, "2-line": line2_geojson}
