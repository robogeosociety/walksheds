#!/usr/bin/env python3
"""Build public/pois/stats.json — the dataset summary behind the legend's
expandable Statistics section (POI/station counts, data sources, freshness).

Reads only committed artifacts (no network): the spatial tile index,
all-stations.geojson, the raw OSM dumps (for their as-of timestamps), and the
Overture release pinned in fetch_overture.py. Deterministic — INV-023 checks
the committed file matches a regeneration. Re-run after any data rebuild:

    python3 data/pois/build_stats.py
"""
import gzip
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.normpath(os.path.join(HERE, "..", "..", "public"))
TILE_INDEX = os.path.join(PUBLIC, "pois", "tiles", "index.json")
ALL_STATIONS = os.path.join(PUBLIC, "all-stations.geojson")
OSM_DUMP = os.path.join(HERE, "raw", "osm-seattle.json.gz")
SDOT_REFRESHED = os.path.join(os.path.dirname(HERE), "raw", "refreshed.json")
STATS_JSON = os.path.join(PUBLIC, "pois", "stats.json")


def overture_release():
    """The pinned Overture release, read textually so importing fetch_overture
    (and its heavier deps) isn't needed just to build a summary."""
    with open(os.path.join(HERE, "fetch_overture.py")) as f:
        return re.search(r'^RELEASE = "([^"]+)"', f.read(), re.M).group(1)


def osm_as_of():
    """The Overpass dump's data timestamp (osm3s.timestamp_osm_base), as a date."""
    with gzip.open(OSM_DUMP, "rt") as f:
        return json.load(f)["osm3s"]["timestamp_osm_base"][:10]


def sdot_refreshed():
    """When data/refresh.py last pulled the SDOT station/alignment GeoJSON."""
    with open(SDOT_REFRESHED) as f:
        return json.load(f)["refreshedAt"]


def build_stats():
    with open(TILE_INDEX) as f:
        index = json.load(f)
    with open(ALL_STATIONS) as f:
        stations = json.load(f)
    return {
        "pois": index["count"],
        "stations": len(stations["features"]),
        "sources": [
            {"id": "osm", "label": "OpenStreetMap", "asOf": osm_as_of()},
            {"id": "overture", "label": "Overture Places", "asOf": overture_release()[:10]},
            {"id": "sdot", "label": "SDOT / Sound Transit", "asOf": sdot_refreshed()},
            # Walkshed polygons are drawn by the browser straight from the
            # Mapbox Isochrone API on every station select — always current.
            {"id": "mapbox", "label": "Mapbox walksheds", "live": True},
        ],
    }


def main():
    stats = build_stats()
    with open(STATS_JSON, "w") as f:
        json.dump(stats, f, indent=2)
        f.write("\n")
    print(f"Wrote {os.path.relpath(STATS_JSON, os.getcwd())}: "
          f"{stats['pois']:,} POIs, {stats['stations']} stations")


if __name__ == "__main__":
    main()
