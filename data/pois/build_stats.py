#!/usr/bin/env python3
"""Build public/cities/<slug>/pois/stats.json — the dataset summary behind the legend's
expandable Statistics section (POI/station counts, data sources, freshness).

Reads only committed artifacts (no network): the spatial tile index,
all-stations.geojson, the raw OSM dumps (for their as-of timestamps), and the
Overture release pinned in fetch_overture.py. Deterministic — INV-023 checks
the committed file matches a regeneration. Re-run after any data rebuild:

    python3 data/pois/build_stats.py [--city seattle]
"""
import argparse
import gzip
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "data"))

import cities as city_registry  # noqa: E402


def overture_release():
    """The pinned Overture release, read textually so importing fetch_overture
    (and its heavier deps) isn't needed just to build a summary."""
    with open(os.path.join(HERE, "fetch_overture.py")) as f:
        return re.search(r'^RELEASE = "([^"]+)"', f.read(), re.M).group(1)


def osm_as_of(city):
    """The Overpass dump's data timestamp (osm3s.timestamp_osm_base), as a date."""
    with gzip.open(city.osm_dump, "rt") as f:
        return json.load(f)["osm3s"]["timestamp_osm_base"][:10]


def agency_refreshed(city):
    """When data/refresh.py last pulled this city's rail station/alignment feed."""
    with open(city.refreshed_marker) as f:
        return json.load(f)["refreshedAt"]


def build_stats(city):
    with open(city.tile_index) as f:
        index = json.load(f)
    with open(city.stations_geojson) as f:
        stations = json.load(f)
    return {
        "pois": index["count"],
        "stations": len(stations["features"]),
        "sources": [
            {"id": "osm", "label": "OpenStreetMap", "asOf": osm_as_of(city)},
            {"id": "overture", "label": "Overture Places", "asOf": overture_release()[:10]},
            {"id": city.agency_source_id, "label": city.source_note,
             "asOf": agency_refreshed(city)},
            # Walkshed polygons are drawn by the browser straight from the
            # Mapbox Isochrone API on every station select — always current.
            {"id": "mapbox", "label": "Mapbox walksheds", "live": True},
        ],
    }


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    city_registry.add_city_arg(ap, default="all")
    args = ap.parse_args(argv)

    for city in city_registry.resolve(args.city):
        # stats.json summarises the POI dataset; a city without POI tiles has
        # nothing to summarise and the legend hides the section entirely.
        if not city.has(city_registry.CAP_POIS):
            print(f"{city.slug}: no POI dataset — skipping stats.json")
            continue
        stats = build_stats(city)
        with open(city.stats_json, "w") as f:
            json.dump(stats, f, indent=2)
            f.write("\n")
        print(f"Wrote {city.stats_json.relative_to(city_registry.ROOT)}: "
              f"{stats['pois']:,} POIs, {stats['stations']} stations")


if __name__ == "__main__":
    main()
