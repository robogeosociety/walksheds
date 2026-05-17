#!/usr/bin/env python3
"""Fetch Mapbox walking isochrones for every station, persist as committed dump.

Two phases (mirrors fetch_pois.py):
  1. Refresh (network): one Mapbox Isochrone call per station with
     contours_minutes=5,10,15 returns the three nested polygons in one shot.
     Saved gzipped to data/pois/raw/walksheds.json.gz with a sha1 version stamp.
  2. Build/read (default, offline): the dump is consumed by
     fetch_walking_distances.py and fetch_pois.py.

Usage:
  python3 data/pois/fetch_walksheds.py                 # validate existing dump
  python3 data/pois/fetch_walksheds.py --refresh       # refetch from Mapbox
  python3 data/pois/fetch_walksheds.py --dry-run       # refresh without writing
"""

import argparse
import gzip
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
STATION_INDEX = os.path.join(ROOT, "data", "station-index.json")
RAW_DUMP = os.path.join(ROOT, "data", "pois", "raw", "walksheds.json.gz")

ISOCHRONE_URL = "https://api.mapbox.com/isochrone/v1/mapbox/walking"
CONTOURS = (5, 10, 15)
REQUEST_TIMEOUT = 30
SLEEP_BETWEEN_REQUESTS = 0.2  # ~300 req/min ceiling on Mapbox free tier


def station_key(station):
    """Stable key disambiguating shared stopCodes across lines (e.g. 54 = Stadium AND Judkins Park)."""
    return f"{station['lines']}-{station['stopCode']}"


def load_station_index():
    with open(STATION_INDEX) as f:
        return json.load(f)["stations"]


def fetch_one(station, token):
    """Call Mapbox Isochrone with contours=5,10,15; return the FeatureCollection."""
    query = urllib.parse.urlencode({
        "contours_minutes": ",".join(str(c) for c in CONTOURS),
        "polygons": "true",
        "denoise": "1",
        "access_token": token,
    })
    url = f"{ISOCHRONE_URL}/{station['lng']},{station['lat']}?{query}"
    req = urllib.request.Request(url, headers={"User-Agent": "walksheds-walkshed-fetcher/1.0"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
            if attempt < 2:
                wait = 2 ** (attempt + 1)
                print(f"  Retry in {wait}s after error: {e}")
                time.sleep(wait)
            else:
                raise


def refresh_dump(stations, token, out_path=RAW_DUMP, dry_run=False):
    """Fetch isochrones for every station and write the keyed dump."""
    print(f"Refreshing walksheds from Mapbox Isochrone (contours={CONTOURS})...")
    by_station = {}
    for i, station in enumerate(stations, 1):
        key = station_key(station)
        print(f"  [{i:2d}/{len(stations)}] {station['name']:<40s} ({key})")
        fc = fetch_one(station, token)
        # Order features by ascending contour minutes so the smallest band is index 0.
        feats = sorted(
            fc.get("features", []),
            key=lambda f: int(f.get("properties", {}).get("contour", 0)),
        )
        by_station[key] = {
            "type": "FeatureCollection",
            "features": feats,
            "station": {
                "name": station["name"],
                "lng": station["lng"],
                "lat": station["lat"],
                "lines": station["lines"],
                "stopCode": station["stopCode"],
            },
        }
        time.sleep(SLEEP_BETWEEN_REQUESTS)

    # Stable serialization for a deterministic hash across refreshes.
    serialized = json.dumps(by_station, separators=(",", ":"), sort_keys=True).encode("utf-8")
    version = hashlib.sha1(serialized).hexdigest()[:12]
    payload = {
        "version": version,
        "contours": list(CONTOURS),
        "walksheds": by_station,
    }
    final = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")

    if dry_run:
        print(f"  [dry-run] Would write {out_path} (version={version}, {len(final):,} bytes)")
        return payload

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with gzip.open(out_path, "wb", compresslevel=9) as f:
        f.write(final)
    print(f"  Wrote {out_path} (version={version}, {os.path.getsize(out_path):,} bytes gzipped)")
    return payload


def load_dump(path=None):
    """Load the committed walkshed dump. Looks up RAW_DUMP at call time so tests can monkeypatch it."""
    if path is None:
        path = RAW_DUMP
    if not os.path.exists(path):
        raise FileNotFoundError(
            f"Walkshed dump not found at {path}. "
            f"Run `python3 data/pois/fetch_walksheds.py --refresh` to fetch from Mapbox."
        )
    with gzip.open(path, "rb") as f:
        return json.loads(f.read().decode("utf-8"))


def main():
    parser = argparse.ArgumentParser(description="Fetch walkshed polygons from Mapbox Isochrone")
    parser.add_argument("--refresh", action="store_true", help="Refetch from Mapbox (requires MAPBOX_SECRET_TOKEN)")
    parser.add_argument("--dry-run", action="store_true", help="Print plan, don't write")
    args = parser.parse_args()

    stations = load_station_index()
    print(f"Stations: {len(stations)}")

    if args.refresh:
        token = os.environ.get("MAPBOX_SECRET_TOKEN") or os.environ.get("MAPBOX_ACCESS_TOKEN")
        if not token:
            print("ERROR: --refresh requires MAPBOX_SECRET_TOKEN (or MAPBOX_ACCESS_TOKEN) env var.", file=sys.stderr)
            print("  Use a token scoped to the Isochrone API.", file=sys.stderr)
            sys.exit(1)
        refresh_dump(stations, token, dry_run=args.dry_run)
        return

    # Default mode: validate the committed dump.
    payload = load_dump()
    version = payload.get("version", "?")
    contours = payload.get("contours", [])
    walksheds = payload.get("walksheds", {})
    expected = {station_key(s) for s in stations}
    actual = set(walksheds)
    missing = expected - actual
    extra = actual - expected
    print(f"Dump: version={version} contours={contours} stations={len(walksheds)}")
    if missing:
        print(f"  MISSING: {sorted(missing)}", file=sys.stderr)
    if extra:
        print(f"  EXTRA (probably outdated): {sorted(extra)}", file=sys.stderr)
    if missing:
        sys.exit(1)


if __name__ == "__main__":
    main()
