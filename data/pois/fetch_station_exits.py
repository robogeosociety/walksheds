#!/usr/bin/env python3
"""Fetch Link light rail station exits/entrances as points (OSM → public/).

Two phases, mirroring fetch_pois.py:

1. Refresh (needs network to overpass-api.de):
   `python3 data/pois/fetch_station_exits.py --refresh`
   runs one Overpass query for every `railway=subway_entrance` /
   `railway=train_station_entrance` node inside the padded station bbox and
   writes the committed raw dump `data/pois/raw/station-exits.json.gz`.

2. Build (no network, default):
   `python3 data/pois/fetch_station_exits.py`
   reads the committed dump, assigns each entrance to its nearest Link station
   (within NEAREST_CUTOFF_M, dropping unrelated nodes), precomputes the bearing
   from the station to the exit, and writes `public/station-exits.geojson`.

Seattle has no other subway, so `subway_entrance` nodes are effectively all
Link; the nearest-station assignment also disambiguates the two stations that
share stopCode 54 (Stadium on Line 1, Judkins Park on Line 2). Shared stations
carry a single `{lines}-{stopCode}` key. Coverage is partial: the newest south
and east-end stations have no entrances mapped in OSM yet (the app shows
"Exits not yet mapped" for those — see INV-021/022 and CLAUDE.md).

Per-feature properties on the output GeoJSON: `id` (OSM node id), `stationKey`
(`{lines}-{stopCode}`), `stationName`, `name`, `bearingFromStation` (degrees,
0 = north), optional `accessible` (from `wheelchair=yes`), `source` ("osm").
"""
import argparse
import gzip
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from fetch_pois import (  # noqa: E402
    OVERPASS_TIMEOUT,
    compute_bbox,
    fetch_overpass,
    load_station_index,
)
from fetch_walksheds import station_key  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(HERE))
RAW_DUMP = os.path.join(ROOT, "data", "pois", "raw", "station-exits.json.gz")
OUTPUT = os.path.join(ROOT, "public", "station-exits.geojson")

# An entrance node beyond this distance from every Link station is treated as
# unrelated (a different transit stop caught by the padded bbox) and dropped.
NEAREST_CUTOFF_M = 400

# OSM railway values that denote a rail station entrance/exit point.
ENTRANCE_VALUES = ("subway_entrance", "train_station_entrance")

# 8-point compass labels for naming unnamed entrances by their bearing.
COMPASS_8 = ("N", "NE", "E", "SE", "S", "SW", "W", "NW")


def hav(a, b):
    """Haversine distance in meters between two [lng, lat] points."""
    r = 6371000
    p1, p2 = math.radians(a[1]), math.radians(b[1])
    dphi = math.radians(b[1] - a[1])
    dl = math.radians(b[0] - a[0])
    h = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def bearing(a, b):
    """Initial great-circle bearing from a to b in degrees (0 = north, 90 = east).

    Python twin of `bearing()` in src/routeGraph.js so build-time and runtime
    agree on exit orientation.
    """
    lng1, lat1 = math.radians(a[0]), math.radians(a[1])
    lng2, lat2 = math.radians(b[0]), math.radians(b[1])
    dl = lng2 - lng1
    y = math.sin(dl) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def compass_label(deg):
    """Nearest of the 8 cardinal/intercardinal labels for a bearing."""
    return COMPASS_8[round(deg / 45) % 8]


def build_query(bbox):
    """Overpass query for every entrance node inside the padded station bbox."""
    bbox_str = f"{bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]}"
    clauses = "\n".join(
        f'  node["railway"="{v}"]({bbox_str});' for v in ENTRANCE_VALUES
    )
    return (
        f"[out:json][timeout:{OVERPASS_TIMEOUT}];\n"
        f"(\n{clauses}\n);\n"
        f"out tags center;"
    )


def refresh_raw_dump(bbox, out_path=RAW_DUMP, dry_run=False):
    """Fetch entrance nodes for the bbox and write them gzipped to out_path."""
    print("Refreshing station-exit dump from Overpass...")
    print(f"  Values: {', '.join(ENTRANCE_VALUES)}")
    print(f"  Bbox: {bbox}")
    result = fetch_overpass(build_query(bbox))
    elements = result.get("elements", [])
    print(f"  → {len(elements):,} entrance nodes")
    if dry_run:
        print("  [dry-run] Skipping write")
        return result
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    compact = json.dumps(result, separators=(",", ":")).encode("utf-8")
    with gzip.open(out_path, "wb", compresslevel=9) as f:
        f.write(compact)
    print(f"  Wrote {out_path} ({os.path.getsize(out_path):,} bytes gzipped)")
    return result


def load_raw_dump(path=RAW_DUMP):
    """Load the committed gzipped entrance dump."""
    if not os.path.exists(path):
        raise FileNotFoundError(
            f"Raw dump not found at {path}. Run "
            f"`python3 data/pois/fetch_station_exits.py --refresh` to fetch it."
        )
    with gzip.open(path, "rb") as f:
        return json.loads(f.read().decode("utf-8"))


def nearest_station(coord, stations):
    """Return (station, meters) for the Link station closest to coord."""
    best, best_m = None, math.inf
    for s in stations:
        m = hav(coord, (s["lng"], s["lat"]))
        if m < best_m:
            best, best_m = s, m
    return best, best_m


def exit_name(tags, deg):
    """Human label for an exit: OSM name, else 'Exit <ref>', else a compass label."""
    name = (tags.get("name") or "").strip()
    if name:
        return name
    ref = (tags.get("ref") or "").strip()
    if ref:
        return f"Exit {ref}"
    return f"{compass_label(deg)} entrance"


def build_exits(elements, stations):
    """Assign each entrance node to its nearest station and build GeoJSON features."""
    features = []
    dropped = 0
    for el in elements:
        lon, lat = el.get("lon"), el.get("lat")
        if lon is None or lat is None:  # ways carry a `center` instead
            center = el.get("center") or {}
            lon, lat = center.get("lon"), center.get("lat")
        if lon is None or lat is None:
            continue
        coord = [round(lon, 7), round(lat, 7)]
        station, meters = nearest_station(coord, stations)
        if station is None or meters > NEAREST_CUTOFF_M:
            dropped += 1
            continue
        tags = el.get("tags", {})
        deg = round(bearing((station["lng"], station["lat"]), coord), 1)
        props = {
            "id": el["id"],
            "stationKey": station_key(station),
            "stationName": station["name"],
            "name": exit_name(tags, deg),
            "bearingFromStation": deg,
            "source": "osm",
        }
        if tags.get("wheelchair") == "yes":
            props["accessible"] = True
        features.append({
            "type": "Feature",
            "properties": props,
            "geometry": {"type": "Point", "coordinates": coord},
        })
    # Deterministic order: by station key, then bearing, then id.
    features.sort(key=lambda f: (
        f["properties"]["stationKey"],
        f["properties"]["bearingFromStation"],
        f["properties"]["id"],
    ))
    return features, dropped


def main():
    ap = argparse.ArgumentParser(description="Build station-exit points from OSM")
    ap.add_argument("--refresh", action="store_true",
                    help="Refetch the entrance dump from Overpass before building")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    stations = load_station_index()
    bbox = compute_bbox(stations)

    if args.refresh:
        result = refresh_raw_dump(bbox, dry_run=args.dry_run)
    else:
        result = load_raw_dump()

    elements = result.get("elements", [])
    features, dropped = build_exits(elements, stations)

    covered = {f["properties"]["stationKey"] for f in features}
    print(f"Built {len(features):,} exits across {len(covered)}/{len(stations)} stations "
          f"({dropped:,} nodes dropped beyond {NEAREST_CUTOFF_M}m of any station)")

    if args.dry_run:
        print("[dry-run] no files written")
        return

    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    fc = {"type": "FeatureCollection", "features": features}
    with open(OUTPUT, "w") as f:
        json.dump(fc, f)
    print(f"Wrote {OUTPUT}")


if __name__ == "__main__":
    main()
