#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["httpx"]
# ///
"""Refresh SDOT light rail data from Seattle ArcGIS and reprocess.

Downloads the latest GeoJSON for light rail stations and alignment,
validates the responses, then runs data/process.py to regenerate
the processed files in public/.

Usage: uv run data/refresh.py [--dry-run]
"""

import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"

# Seattle Transportation Plan Transit Element — ArcGIS FeatureServer
_BASE = (
    "https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services"
    "/Seattle_Transportation_Plan_Transit_Element/FeatureServer"
)
STATIONS_URL = f"{_BASE}/14/query?where=1%3D1&outFields=*&f=geojson"
ALIGNMENT_URL = f"{_BASE}/18/query?where=1%3D1&outFields=*&f=geojson"

TIMEOUT = 30  # seconds


def fetch_geojson(url: str) -> dict:
    """Fetch and validate a GeoJSON FeatureCollection from a URL."""
    resp = httpx.get(url, timeout=TIMEOUT, follow_redirects=True)
    resp.raise_for_status()
    data = resp.json()
    if data.get("type") != "FeatureCollection" or "features" not in data:
        raise ValueError(f"Expected GeoJSON FeatureCollection, got: {list(data.keys())}")
    return data


def validate_stations(data: dict) -> None:
    """Check that downloaded stations contain expected fields and features."""
    features = data["features"]
    if len(features) < 30:
        raise ValueError(f"Expected at least 30 station features, got {len(features)}")
    sample = features[0]["properties"]
    for field in ("NAME", "STATUS"):
        if field not in sample:
            raise ValueError(f"Station features missing expected field: {field}")


def validate_alignment(data: dict) -> None:
    """Check that downloaded alignment contains expected fields and features."""
    features = data["features"]
    if len(features) < 10:
        raise ValueError(f"Expected at least 10 alignment features, got {len(features)}")
    sample = features[0]["properties"]
    if "DESCRIPTIO" not in sample and "STATUS" not in sample:
        raise ValueError(f"Alignment features missing expected fields: {list(sample.keys())}")


def download(dry_run: bool = False) -> tuple[dict, dict]:
    """Download and validate both datasets. Returns (stations, alignment)."""
    print("Downloading light rail stations...")
    stations = fetch_geojson(STATIONS_URL)
    validate_stations(stations)
    print(f"  → {len(stations['features'])} features")

    print("Downloading light rail alignment...")
    alignment = fetch_geojson(ALIGNMENT_URL)
    validate_alignment(alignment)
    print(f"  → {len(alignment['features'])} features")

    if dry_run:
        print("\nDry run — skipping file writes and processing.")
        return stations, alignment

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    (RAW_DIR / "light-rail-stations.geojson").write_text(json.dumps(stations))
    (RAW_DIR / "light-rail-alignment.geojson").write_text(json.dumps(alignment))
    # Stamp the refresh date — surfaced as the station-data freshness in the
    # legend's Data Statistics section (via data/pois/build_stats.py).
    (RAW_DIR / "refreshed.json").write_text(
        json.dumps({"refreshedAt": datetime.now(timezone.utc).date().isoformat()}, indent=2) + "\n"
    )

    print("\nProcessing...")
    subprocess.check_call([sys.executable, str(ROOT / "data" / "process.py")])

    print("\nDone. Review changes with: git diff public/")
    return stations, alignment


def main():
    dry_run = "--dry-run" in sys.argv
    download(dry_run=dry_run)


if __name__ == "__main__":
    main()
