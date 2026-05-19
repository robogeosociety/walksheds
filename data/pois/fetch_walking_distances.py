#!/usr/bin/env python3
"""Precompute walking distance from every station to every POI inside its 15-min walkshed.

Mirrors the fetch_pois.py --refresh philosophy: --refresh hits Mapbox Matrix,
default mode reads the committed dump and reports coverage.

Pipeline:
  1. Load walkshed dump (data/pois/raw/walksheds.json.gz) and per-category POI
     GeoJSONs (public/pois/*.geojson).
  2. For each POI, point-in-polygon against each station's 15-min ring; assign
     the smallest band (5/10/15) it lies inside.
  3. For each (station, POI) pair in any walkshed, fetch the walking distance
     and duration via Mapbox Matrix API. Cache responses keyed by
     `{stationKey}:{poiId}` plus the walkshed dump's sha1 version. Stale
     entries (different version) are dropped on read.

Output: data/pois/raw/walking-distances.json.gz with the schema
  {
    "version": "<walkshed-sha1>",
    "pairs": {"<lines>-<stopCode>:<poiId>": [meters, seconds, band], ...}
  }

Usage:
  python3 data/pois/fetch_walking_distances.py                # validate coverage
  python3 data/pois/fetch_walking_distances.py --refresh      # fetch missing pairs
  python3 data/pois/fetch_walking_distances.py --dry-run      # plan only
"""

import argparse
import gzip
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import fetch_pois
import fetch_walksheds

ROOT = fetch_pois.ROOT
OUTPUT_DIR = fetch_pois.OUTPUT_DIR
DUMP = os.path.join(ROOT, "data", "pois", "raw", "walking-distances.json.gz")

MATRIX_URL = "https://api.mapbox.com/directions-matrix/v1/mapbox/walking"
MATRIX_MAX_DESTS = 24  # Mapbox walking matrix caps at 25 coords; 1 source + 24 destinations.
REQUEST_TIMEOUT = 60
# Mapbox walking Matrix is 60 req/min on the standard tier. Sleep ~1.2s
# between calls (50/min) to stay clear of 429s with some headroom.
SLEEP_BETWEEN_REQUESTS = 1.2
# Match the Referer that the URL-restricted production token expects (see
# fetch_walksheds.REFERER for the rationale).
REFERER = "https://walksheds.xyz/"


# ── Geometry ──

def point_in_polygon(point, ring):
    """Ray-casting test. Matches src/poiUtils.js:13."""
    px, py = point
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if ((yi > py) != (yj > py)) and (px < (xj - xi) * (py - yi) / (yj - yi) + xi):
            inside = not inside
        j = i
    return inside


def first_ring(feature):
    """Return the outer ring of a Polygon (Mapbox isochrone always emits Polygons)."""
    geom = feature.get("geometry") or {}
    coords = geom.get("coordinates") or []
    if geom.get("type") == "Polygon" and coords:
        return coords[0]
    return None


def bands_from_walkshed(fc):
    """Return [(minutes, ring), ...] sorted ascending by minutes."""
    out = []
    for f in fc.get("features", []):
        minutes = int(f.get("properties", {}).get("contour", 0))
        ring = first_ring(f)
        if ring and minutes:
            out.append((minutes, ring))
    out.sort(key=lambda x: x[0])
    return out


# ── Loading ──

def load_pois():
    """Load every per-category POI FeatureCollection from public/pois/."""
    pois = {}
    for cat in fetch_pois.CATEGORIES:
        path = os.path.join(OUTPUT_DIR, f"{cat}.geojson")
        if not os.path.exists(path):
            raise FileNotFoundError(f"POI file missing: {path}. Run fetch_pois.py first.")
        with open(path) as f:
            pois[cat] = json.load(f)
    return pois


def load_dump(path=None):
    """Load the committed distance dump. Looks up DUMP at call time so tests can monkeypatch it."""
    if path is None:
        path = DUMP
    if not os.path.exists(path):
        return None
    with gzip.open(path, "rb") as f:
        return json.loads(f.read().decode("utf-8"))


# ── Membership ──

def compute_membership(stations, walkshed_payload, pois):
    """Build the (station_key, poi_id, band, station, poi) work list.

    A POI is a member if it lies inside a station's 15-min (outermost) ring.
    Band is the smallest contour minutes it lies inside.
    """
    walksheds = walkshed_payload["walksheds"]
    station_bands = {}  # station_key -> [(minutes, ring), ...]
    for s in stations:
        key = fetch_walksheds.station_key(s)
        fc = walksheds.get(key)
        if not fc:
            continue
        station_bands[key] = bands_from_walkshed(fc)

    pairs = []  # (station_key, poi_id, band, station, poi_feature)
    station_by_key = {fetch_walksheds.station_key(s): s for s in stations}

    for cat, fc in pois.items():
        for feat in fc.get("features", []):
            poi_id = feat["properties"]["id"]
            coords = feat["geometry"]["coordinates"]
            pt = (coords[0], coords[1])
            for key, bands in station_bands.items():
                # Largest ring is bands[-1] (15-min); fast-reject first.
                if not bands:
                    continue
                if not point_in_polygon(pt, bands[-1][1]):
                    continue
                # Find smallest band containing the point.
                band = bands[-1][0]
                for minutes, ring in bands:
                    if point_in_polygon(pt, ring):
                        band = minutes
                        break
                pairs.append((key, poi_id, band, station_by_key[key], feat))
    return pairs


# ── Mapbox Matrix ──

def fetch_matrix(source, destinations, token):
    """One Matrix call: 1 source + up to 24 destinations. Returns the full Mapbox response.

    Uses `sources=0` (no `destinations` param) so Mapbox returns a 1×N row.
    Setting `destinations=1,2,...` alongside `sources=0` trips up Mapbox's
    request validator with a misleading "minimum matrix elements is 2" 422
    even when the math is clearly satisfied (1 × 24 = 24). The first column
    of the response is source→source (always 0) — callers must skip it.
    """
    coords = [source] + destinations
    coord_str = ";".join(f"{lng},{lat}" for lng, lat in coords)
    query = urllib.parse.urlencode({
        "sources": "0",
        "annotations": "distance,duration",
        "access_token": token,
    })
    url = f"{MATRIX_URL}/{coord_str}?{query}"
    req = urllib.request.Request(url, headers={
        "User-Agent": "walksheds-distance-fetcher/1.0",
        "Referer": REFERER,
    })
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
            if attempt < 4:
                # 429 needs a long cool-off; other errors use shorter exponential backoff.
                is_429 = isinstance(e, urllib.error.HTTPError) and e.code == 429
                wait = (10, 30, 60, 90)[attempt] if is_429 else 2 ** (attempt + 1)
                print(f"    Retry in {wait}s after error: {e}")
                time.sleep(wait)
            else:
                raise


def pair_key(station_key, poi_id):
    return f"{station_key}:{poi_id}"


def refresh_pairs(pairs, walkshed_version, token, existing=None, dry_run=False):
    """Fetch missing (station, POI) distances and merge with existing cache."""
    by_station = {}
    for key, poi_id, band, station, feat in pairs:
        by_station.setdefault(key, []).append((poi_id, band, station, feat))

    cache = {}
    if existing and existing.get("version") == walkshed_version:
        cache = dict(existing.get("pairs", {}))
        print(f"  Existing cache: {len(cache)} entries at version {walkshed_version}")
    elif existing:
        print(f"  Cache version mismatch ({existing.get('version')} vs {walkshed_version}); rebuilding all entries")

    total_needed = sum(len(items) for items in by_station.values())
    have = sum(1 for key, items in by_station.items() for poi_id, _, _, _ in items if pair_key(key, poi_id) in cache)
    missing_total = total_needed - have
    print(f"  Pairs: {total_needed:,} total, {have:,} cached, {missing_total:,} to fetch")

    if dry_run:
        print(f"  [dry-run] Would fetch {missing_total:,} Matrix entries")
        return cache

    fetched = 0
    call_count = 0
    for key in sorted(by_station):
        items = by_station[key]
        missing = [(poi_id, band, feat) for (poi_id, band, _, feat) in items if pair_key(key, poi_id) not in cache]
        if not missing:
            continue
        station = items[0][2]
        source = (station["lng"], station["lat"])
        print(f"  {key} ({station['name']}): {len(missing)} to fetch")
        for chunk_start in range(0, len(missing), MATRIX_MAX_DESTS):
            chunk = missing[chunk_start:chunk_start + MATRIX_MAX_DESTS]
            destinations = [(f["geometry"]["coordinates"][0], f["geometry"]["coordinates"][1]) for _, _, f in chunk]
            response = fetch_matrix(source, destinations, token)
            # Response row layout: [source→source, source→dest_1, ..., source→dest_N]. Skip index 0.
            distances = (response.get("distances") or [[None] * (len(chunk) + 1)])[0][1:]
            durations = (response.get("durations") or [[None] * (len(chunk) + 1)])[0][1:]
            for (poi_id, band, _), meters, seconds in zip(chunk, distances, durations):
                if meters is None or seconds is None:
                    # POI is in the polygon but Matrix couldn't route to it (off-network).
                    # Skip — the popup will simply omit this station for this POI.
                    continue
                cache[pair_key(key, poi_id)] = [round(meters, 1), round(seconds, 1), band]
            call_count += 1
            fetched += len(chunk)
            time.sleep(SLEEP_BETWEEN_REQUESTS)
        # Persist after each station so a mid-refresh crash doesn't wipe progress.
        # Subsequent re-runs skip already-cached pairs.
        write_dump(cache, walkshed_version)
    print(f"  Fetched {fetched:,} entries across {call_count} Matrix calls")
    return cache


def write_dump(cache, walkshed_version, path=DUMP, dry_run=False):
    payload = {"version": walkshed_version, "pairs": cache}
    serialized = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    if dry_run:
        print(f"  [dry-run] Would write {path} ({len(cache):,} pairs, {len(serialized):,} bytes uncompressed)")
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with gzip.open(path, "wb", compresslevel=9) as f:
        f.write(serialized)
    print(f"  Wrote {path} ({len(cache):,} pairs, {os.path.getsize(path):,} bytes gzipped)")


def main():
    parser = argparse.ArgumentParser(description="Precompute walking distances POI ↔ station")
    parser.add_argument("--refresh", action="store_true",
                        help="Fetch missing pairs from Mapbox Matrix (needs MAPBOX_TOKEN)")
    parser.add_argument("--dry-run", action="store_true", help="Plan only, don't write")
    args = parser.parse_args()

    stations = fetch_pois.load_station_index()
    walkshed_payload = fetch_walksheds.load_dump()
    walkshed_version = walkshed_payload["version"]
    pois = load_pois()

    print(f"Walksheds: version={walkshed_version}, {len(walkshed_payload['walksheds'])} stations")
    total_pois = sum(len(fc["features"]) for fc in pois.values())
    print(f"POIs: {total_pois:,} across {len(pois)} categories")

    pairs = compute_membership(stations, walkshed_payload, pois)
    print(f"Memberships: {len(pairs):,} (station, POI) pairs inside a 15-min walkshed")

    existing = load_dump()

    if args.refresh:
        token = os.environ.get("MAPBOX_TOKEN") or os.environ.get("MAPBOX_ACCESS_TOKEN")
        if not token:
            print("ERROR: --refresh requires MAPBOX_TOKEN (or MAPBOX_ACCESS_TOKEN) env var.", file=sys.stderr)
            print("  Any token with Matrix scope works (pk. or sk. — same capability).", file=sys.stderr)
            sys.exit(1)
        cache = refresh_pairs(pairs, walkshed_version, token, existing=existing, dry_run=args.dry_run)
        write_dump(cache, walkshed_version, dry_run=args.dry_run)
        return

    # Default: validate coverage against the committed dump.
    if not existing:
        print("ERROR: no distance dump found. Run with --refresh first.", file=sys.stderr)
        sys.exit(1)
    if existing.get("version") != walkshed_version:
        print(f"ERROR: distance cache version {existing.get('version')} != walkshed version {walkshed_version}.",
              file=sys.stderr)
        print("  Re-run with --refresh after `fetch_walksheds.py --refresh`.", file=sys.stderr)
        sys.exit(1)
    cache = existing.get("pairs", {})
    missing = []
    for key, poi_id, _, _, _ in pairs:
        if pair_key(key, poi_id) not in cache:
            missing.append(pair_key(key, poi_id))
    print(f"Cached pairs: {len(cache):,}; missing: {len(missing):,}")
    if missing:
        print("ERROR: cache is incomplete. Re-run with --refresh.", file=sys.stderr)
        for m in missing[:10]:
            print(f"  missing {m}", file=sys.stderr)
        if len(missing) > 10:
            print(f"  ... +{len(missing) - 10} more", file=sys.stderr)
        sys.exit(1)
    print("Coverage OK.")


if __name__ == "__main__":
    main()
