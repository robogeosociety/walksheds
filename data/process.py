"""Process each city's raw rail data into app-ready GeoJSON and icon sprites.

City-specific ingest lives in data/processors/<slug>.py; this module is the
driver that is the same for every city: run the processor, write its stations
and alignments under public/cities/<slug>/, derive the station index, and
render the station-pill sprite sheets.

Reads (per city, all committed — no network):
  data/cities/<slug>/raw/...

Writes:
  public/cities/<slug>/all-stations.geojson
  public/cities/<slug>/<line alignment>.geojson
  public/cities/<slug>/icons/stations{,@2x}.{json,png}
  data/cities/<slug>/station-index.json

Run from the project root:
  python3 data/process.py                 # every city
  python3 data/process.py --city seattle
"""

import argparse
import importlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import cities as city_registry  # noqa: E402
from sprites import generate_sprites  # noqa: E402

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


def load_processor(city):
    return importlib.import_module(f"processors.{city.slug}")


def process_city(city):
    print(f"\n── {city.name} ({city.system}) ──")
    processor = load_processor(city)
    stations_geojson, alignments = processor.build(city)

    count = len(stations_geojson["features"])
    if count != city.station_count:
        raise SystemExit(
            f"{city.slug}: produced {count} station features but the registry "
            f"declares station_count={city.station_count}. Update "
            "data/cities.py (and INV-012's expectation) if this is intended."
        )

    city.public_dir.mkdir(parents=True, exist_ok=True)

    for line in city.lines:
        alignment = alignments.get(line.id)
        if alignment is None:
            raise SystemExit(
                f"{city.slug}: processor returned no alignment for line "
                f"{line.id!r} (registry declares it)."
            )
        with open(city.alignment_path(line), "w") as f:
            json.dump(alignment, f)

    unknown = set(alignments) - {line.id for line in city.lines}
    if unknown:
        raise SystemExit(
            f"{city.slug}: processor returned alignments for lines not in the "
            f"registry: {', '.join(sorted(unknown))}."
        )

    with open(city.stations_geojson, "w") as f:
        json.dump(stations_geojson, f)

    station_index = build_station_index(stations_geojson)
    city.station_index.parent.mkdir(parents=True, exist_ok=True)
    with open(city.station_index, "w") as f:
        json.dump(station_index, f, indent=2, sort_keys=True)
        f.write("\n")
    print(f"Index: {len(station_index['stations'])} stations → {city.station_index.relative_to(city_registry.ROOT)}")

    generate_sprites(city, station_index, str(city.icons_dir))
    return station_index


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    city_registry.add_city_arg(parser, default="all")
    args = parser.parse_args(argv)

    for city in city_registry.resolve(args.city):
        process_city(city)

    # The frontend reads the same registry this pipeline does.
    city_registry.export()
    print(f"\nRegistry: {len(city_registry.CITIES)} cities → src/cityRegistry.json")


if __name__ == "__main__":
    main()
