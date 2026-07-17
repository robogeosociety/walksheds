"""Tests for detect_station_changes.py (monthly refresh new-station detection)."""
import os
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

# detect_station_changes imports process.py, which imports cairosvg at module
# level for sprite generation — skip where the cairo stack isn't installed
# (same convention as INV-014 in data/pois/test_invariants.py).
pytest.importorskip("cairosvg")
pytest.importorskip("PIL")

from detect_station_changes import diff_stations, sdot_station_names  # noqa: E402
from process import LINE_1_ORDER, MISSING_STATIONS  # noqa: E402


def _feat(name, status="Existing / Under Construction"):
    # Property order mirrors the SDOT feed: NAME is the third value,
    # which is how process.py (and the detector) reads it.
    return {"type": "Feature",
            "properties": {"OBJECTID_1": 1, "STATUS": status, "NAME": name},
            "geometry": {"type": "Point", "coordinates": [-122.3, 47.6]}}


def test_filter_mirrors_process():
    raw = {"features": [
        _feat("Northgate Station"),
        _feat("NE 130th Station", status="Future"),          # status-filtered
        _feat("Tacoma Dome Station"),                        # Tacoma-excluded
        _feat("NE 145th Station"),                           # NAME_MAP renamed
    ]}
    names = sdot_station_names(raw)
    assert names == {"Northgate Station", "Shoreline South/148th Station"}


def test_new_station_detected():
    committed = set(LINE_1_ORDER)
    sdot = committed | {"NE 130th St Station"}
    report = diff_stations(sdot, committed)
    assert report["new_stations"] == ["NE 130th St Station"]


def test_known_stations_not_flagged():
    committed = set(LINE_1_ORDER)
    report = diff_stations(set(committed), committed)
    assert report["new_stations"] == []
    assert report["removed_stations"] == []


def test_graduated_missing_and_removed():
    committed = set(LINE_1_ORDER)
    missing_name = MISSING_STATIONS[0][0]           # hardcoded-coords station
    assert missing_name in committed                 # sanity: it's on Line 1
    sdot = {"Northgate Station", missing_name}
    report = diff_stations(sdot, committed)
    assert missing_name in report["graduated_missing"]
    # Stations absent from the feed are flagged as removed, except the
    # MISSING_STATIONS set, which is expected to be absent.
    assert "Westlake Station" in report["removed_stations"]
    assert missing_name not in report["removed_stations"]
