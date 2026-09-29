#!/usr/bin/env -S uv run --script
# cairosvg and pillow are process.py's dependencies, not this script's, but
# download() runs process.py with sys.executable — the isolated interpreter uv
# builds from the metadata below — so they have to be declared here too.
# cairosvg also needs the system cairo library (libcairo2 on Ubuntu).
# /// script
# requires-python = ">=3.10"
# dependencies = ["cairosvg", "httpx", "pillow"]
# ///
"""Refresh a city's rail feed from its agency's ArcGIS server and reprocess.

Downloads the latest GeoJSON for that city's stations and alignment, validates
the responses, then runs data/process.py to regenerate the processed files under
public/cities/<slug>/.

Each city's upstream endpoints and response validators live in FEEDS below —
they are agency-specific (SDOT publishes STATUS/NAME/DESCRIPTIO, HART publishes
ID/STATION/feature_name), so there is one entry per city rather than a shared
schema.

Usage: uv run data/refresh.py [--city seattle|honolulu|all] [--dry-run]
"""

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "data"))

import cities as city_registry  # noqa: E402

# Overrides the destination directory; normally None (follows the city). Tests
# point it at a tmp tree.
RAW_DIR = None

TIMEOUT = 30  # seconds


def fetch_geojson(url: str) -> dict:
    """Fetch and validate a GeoJSON FeatureCollection from a URL."""
    resp = httpx.get(url, timeout=TIMEOUT, follow_redirects=True)
    resp.raise_for_status()
    data = resp.json()
    if data.get("type") != "FeatureCollection" or "features" not in data:
        raise ValueError(f"Expected GeoJSON FeatureCollection, got: {list(data.keys())}")
    return data


def _require_fields(features, fields, what, minimum):
    if len(features) < minimum:
        raise ValueError(f"Expected at least {minimum} {what} features, got {len(features)}")
    sample = features[0]["properties"]
    for field in fields:
        if field not in sample:
            raise ValueError(f"{what.capitalize()} features missing expected field: {field}")


# ── Seattle (SDOT) ──────────────────────────────────────────────────────────

# Seattle Transportation Plan Transit Element — ArcGIS FeatureServer
_SDOT_BASE = (
    "https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services"
    "/Seattle_Transportation_Plan_Transit_Element/FeatureServer"
)
STATIONS_URL = f"{_SDOT_BASE}/14/query?where=1%3D1&outFields=*&f=geojson"
ALIGNMENT_URL = f"{_SDOT_BASE}/18/query?where=1%3D1&outFields=*&f=geojson"


def validate_stations(data: dict) -> None:
    """Check that downloaded stations contain expected fields and features."""
    _require_fields(data["features"], ("NAME", "STATUS"), "station", 30)


def validate_alignment(data: dict) -> None:
    """Check that downloaded alignment contains expected fields and features."""
    features = data["features"]
    if len(features) < 10:
        raise ValueError(f"Expected at least 10 alignment features, got {len(features)}")
    sample = features[0]["properties"]
    if "DESCRIPTIO" not in sample and "STATUS" not in sample:
        raise ValueError(f"Alignment features missing expected fields: {list(sample.keys())}")


# ── Honolulu (HART) ─────────────────────────────────────────────────────────

# HART public layers on Honolulu Open Geospatial Data. Both carry the full
# 21-station project; data/processors/honolulu.py trims to the open segments.
_HART_BASE = "https://services6.arcgis.com/2cZSk3EXXiOHcbOl/arcgis/rest/services"
HART_STATIONS_URL = (
    f"{_HART_BASE}/HART_Transit_Stations_PUBLIC/FeatureServer/0"
    "/query?where=1%3D1&outFields=*&outSR=4326&f=geojson"
)
HART_GUIDEWAY_URL = (
    f"{_HART_BASE}/HART_Guideway_Alignment_Line_PUBLIC/FeatureServer/0"
    "/query?where=1%3D1&outFields=*&outSR=4326&f=geojson"
)


def validate_hart_stations(data: dict) -> None:
    """HART's station points must carry the ID ordinal and the Hawaiian name."""
    _require_fields(data["features"], ("ID", "STATION"), "station", 13)


def validate_hart_guideway(data: dict) -> None:
    """HART's guideway must carry the section name and the alignment role."""
    _require_fields(
        data["features"], ("feature_name", "feature_desc"), "guideway", 3
    )


# ── Per-city feed specs ─────────────────────────────────────────────────────

FEEDS = {
    "seattle": [
        ("light-rail-stations.geojson", STATIONS_URL, validate_stations, "stations"),
        ("light-rail-alignment.geojson", ALIGNMENT_URL, validate_alignment, "alignment"),
    ],
    "honolulu": [
        ("rail-stations.geojson", HART_STATIONS_URL, validate_hart_stations, "stations"),
        ("rail-guideway.geojson", HART_GUIDEWAY_URL, validate_hart_guideway, "guideway"),
    ],
}


def download(dry_run: bool = False, city=None) -> tuple[dict, ...]:
    """Download and validate a city's feeds, write them, and reprocess.

    Returns the parsed payloads in FEEDS order (stations, alignment) so the
    caller can inspect them.
    """
    city = city or city_registry.get_city(city_registry.DEFAULT_CITY)
    spec = FEEDS[city.slug]
    raw_dir = Path(RAW_DIR) if RAW_DIR else city.raw_dir

    payloads = []
    for _filename, url, validate, label in spec:
        print(f"Downloading {city.name} {label}...")
        data = fetch_geojson(url)
        validate(data)
        print(f"  → {len(data['features'])} features")
        payloads.append(data)

    if dry_run:
        print("\nDry run — skipping file writes and processing.")
        return tuple(payloads)

    raw_dir.mkdir(parents=True, exist_ok=True)
    for (filename, _url, _validate, _label), data in zip(spec, payloads):
        (raw_dir / filename).write_text(json.dumps(data))
    # Stamp the refresh date — surfaced as the station-data freshness in the
    # legend's Data Statistics section (via data/pois/build_stats.py).
    (raw_dir / "refreshed.json").write_text(
        json.dumps({"refreshedAt": datetime.now(timezone.utc).date().isoformat()}, indent=2) + "\n"
    )

    print("\nProcessing...")
    try:
        subprocess.check_call(
            [sys.executable, str(ROOT / "data" / "process.py"), "--city", city.slug]
        )
    except subprocess.CalledProcessError as exc:
        # The child's own traceback already printed above (stdio is inherited,
        # not captured) — but CI failure summaries and bots often surface only
        # this exception's message, not the full log. Make that message useful
        # on its own instead of the bare "Command [...] returned non-zero exit
        # status 1" — the actual cause is almost always either a missing
        # dependency (declare it in this file's `# /// script` metadata — see
        # the comment at the top) or an unexpected upstream schema change (see
        # the processor's SDOTSchemaError / HARTSchemaError and the validators
        # above).
        raise RuntimeError(
            f"data/process.py failed reprocessing the freshly-downloaded {city.name} "
            f"data (exit code {exc.returncode}). Scroll up for its traceback — the "
            "most likely causes are a dependency missing from this script's inline "
            "metadata, or the agency having changed the shape of its GeoJSON."
        ) from exc

    print(f"\nDone. Review changes with: git diff public/cities/{city.slug}/")
    return tuple(payloads)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    city_registry.add_city_arg(ap, default="all")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)

    for city in city_registry.resolve(args.city):
        download(dry_run=args.dry_run, city=city)


if __name__ == "__main__":
    main()
