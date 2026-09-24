"""Tests for data processing — verify line alignment and station data integrity.

Seattle owns most of the assertions here because its processor carries the
hardcoded Sound Transit wiring (line orders, stop codes, the shared-trunk
offset). Honolulu's processor derives everything from HART's ID ordinal, so its
checks are correspondingly thinner — see data/pois/test_invariants.py for the
per-city invariants that both cities run.
"""

import json
import os
import subprocess
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "data"))

import cities as city_registry  # noqa: E402
import geometry  # noqa: E402
from processors import honolulu as honolulu_processor  # noqa: E402
from processors import seattle as seattle_processor  # noqa: E402

SEATTLE = city_registry.get_city("seattle")
HONOLULU = city_registry.get_city("honolulu")


@pytest.fixture(scope="session", autouse=True)
def generate_data():
    """Run the processing script for every city before tests."""
    subprocess.check_call([sys.executable, os.path.join(ROOT, "data", "process.py")])


def load(city, name):
    with open(city.public_dir / f"{name}.geojson") as f:
        return json.load(f)


class TestLineAlignment:
    """Verify Line 1 is west of Line 2 in the shared segment."""

    @pytest.mark.unit
    def test_line1_west_of_line2_in_shared_segment(self):
        line1 = load(SEATTLE, "line1-alignment")
        line2 = load(SEATTLE, "line2-alignment")

        line1_coords = line1["features"][0]["geometry"]["coordinates"]
        line2_coords = line2["features"][0]["geometry"]["coordinates"]

        # Compare the first 13 points (shared segment, Lynnwood to Intl District)
        # Line 1 should have smaller longitude (further west) than Line 2
        shared_count = 13
        for i in range(min(shared_count, len(line1_coords), len(line2_coords))):
            lng1 = line1_coords[i][0]
            lng2 = line2_coords[i][0]
            assert lng1 < lng2, (
                f"At shared station index {i}: Line 1 (lng={lng1:.6f}) should be "
                f"west of Line 2 (lng={lng2:.6f})"
            )

    @pytest.mark.unit
    def test_lines_diverge_after_junction(self):
        line1 = load(SEATTLE, "line1-alignment")
        line2 = load(SEATTLE, "line2-alignment")

        line1_coords = line1["features"][0]["geometry"]["coordinates"]
        line2_coords = line2["features"][0]["geometry"]["coordinates"]

        # After the shared segment (index 13+), lines should diverge
        # Line 1 continues south, Line 2 goes east
        # Line 2's 14th point (Judkins Park) should be east of Line 1's 14th (Stadium)
        assert line2_coords[13][0] > line1_coords[13][0], (
            "After junction, Line 2 should be east of Line 1"
        )


class TestStationData:
    @pytest.mark.unit
    def test_no_duplicate_stations(self):
        stations = load(SEATTLE, "all-stations")
        names = [f["properties"]["name"] for f in stations["features"]]
        assert len(names) == len(set(names)), f"Duplicate stations found: {[n for n in names if names.count(n) > 1]}"

    @pytest.mark.unit
    def test_shared_stations_have_both_lines(self):
        stations = load(SEATTLE, "all-stations")
        shared = [f for f in stations["features"] if f["properties"]["shared"]]
        for feat in shared:
            assert feat["properties"]["lines"] == "1,2", (
                f"{feat['properties']['name']} should have lines='1,2'"
            )

    @pytest.mark.unit
    def test_all_stations_have_stop_codes(self):
        stations = load(SEATTLE, "all-stations")
        for feat in stations["features"]:
            code = feat["properties"]["stopCode"]
            assert code is not None, f"{feat['properties']['name']} missing stopCode"
            assert isinstance(code, int), f"{feat['properties']['name']} stopCode should be int"

    @pytest.mark.unit
    def test_station_counts(self):
        stations = load(SEATTLE, "all-stations")
        total = len(stations["features"])
        shared = sum(1 for f in stations["features"] if f["properties"]["shared"])
        line1_only = sum(1 for f in stations["features"] if f["properties"]["lines"] == "1")
        line2_only = sum(1 for f in stations["features"] if f["properties"]["lines"] == "2")
        assert total == SEATTLE.station_count, f"Expected {SEATTLE.station_count} stations, got {total}"
        assert shared == 13, f"Expected 13 shared stations, got {shared}"
        assert line1_only == 13, f"Expected 13 Line 1 only stations, got {line1_only}"
        assert line2_only == 12, f"Expected 12 Line 2 only stations, got {line2_only}"

    @pytest.mark.unit
    def test_stop_codes_unique_per_line(self):
        """Each (line, stopCode) pair must be unique."""
        stations = load(SEATTLE, "all-stations")
        seen = {}
        for feat in stations["features"]:
            props = feat["properties"]
            for line_num in props["lines"].split(","):
                key = (line_num.strip(), props["stopCode"])
                assert key not in seen, (
                    f"Duplicate stop code {props['stopCode']} on line {line_num}: "
                    f"{seen[key]} and {props['name']}"
                )
                seen[key] = props["name"]

    @pytest.mark.unit
    def test_known_stop_codes(self):
        """Verify specific codes match Sound Transit reference."""
        stations = load(SEATTLE, "all-stations")
        by_name = {f["properties"]["name"]: f["properties"]["stopCode"] for f in stations["features"]}
        assert by_name["Westlake Station"] == 50
        assert by_name["U District Station"] == 47
        assert by_name["International District Station"] == 53
        assert by_name["Lynnwood City Center Station"] == 40
        assert by_name["Federal Way Downtown Station"] == 68
        assert by_name["Downtown Redmond Station"] == 65


class TestSDOTSchemaGuard:
    """station_name() reads the SDOT NAME field by key, not by position, and
    fails with a clear, actionable error rather than an opaque IndexError (or
    silently picking the wrong field) if SDOT ever reorders or renames its
    station properties. Guards the fix for the 2026-07-26 monthly-refresh
    failure mode (a missing dependency crashed process.py; this hardens the
    related-but-distinct risk of an actual upstream schema change)."""

    @pytest.mark.unit
    def test_missing_name_raises_clear_schema_error(self):
        feat = {"properties": {"STATUS": "Existing / Under Construction", "STATION": "X"}}
        with pytest.raises(seattle_processor.SDOTSchemaError, match="NAME"):
            seattle_processor.station_name(feat)

    @pytest.mark.unit
    def test_name_read_by_key_not_by_column_position(self):
        # Property order deliberately does NOT match SDOT's usual
        # OBJECTID_1, STATUS, NAME, ... layout, to prove this reads by key.
        feat = {"properties": {"NAME": "Westlake Station", "STATUS": "Existing / Under Construction"}}
        assert seattle_processor.station_name(feat) == "Westlake Station"


class TestHonoluluStations:
    """HART publishes the whole 21-station project; only the open segments ship."""

    @pytest.mark.unit
    def test_only_open_segments_are_emitted(self):
        stations = load(HONOLULU, "all-stations")
        codes = sorted(f["properties"]["stopCode"] for f in stations["features"])
        assert codes == list(range(1, honolulu_processor.OPEN_STATION_MAX_ID + 1)), (
            "expected a contiguous run of open HART station IDs"
        )

    @pytest.mark.unit
    def test_termini_are_the_open_extent(self):
        by_code = {
            f["properties"]["stopCode"]: f["properties"]["name"]
            for f in load(HONOLULU, "all-stations")["features"]
        }
        assert by_code[1] == "Kualakaʻi Station"
        assert by_code[honolulu_processor.OPEN_STATION_MAX_ID] == "Kahauiki Station"

    @pytest.mark.unit
    def test_single_line_has_no_shared_stations(self):
        for feat in load(HONOLULU, "all-stations")["features"]:
            assert feat["properties"]["shared"] is False
            assert feat["properties"]["lines"] == "1"

    @pytest.mark.unit
    def test_okina_is_normalized(self):
        """The two HART fields disagree on the ʻokina glyph; output uses U+02BB
        throughout so a name never ships with mixed apostrophes."""
        for feat in load(HONOLULU, "all-stations")["features"]:
            for value in (feat["properties"]["name"], feat["properties"].get("altName", "")):
                for lookalike in ("‘", "’", "'"):
                    assert lookalike not in value, f"{value!r} carries {lookalike!r}"

    @pytest.mark.unit
    def test_alt_name_never_repeats_the_hawaiian_name(self):
        """Stations whose FEIS descriptor is just the Hawaiian name carry a
        current public name instead, or no altName at all — never a redundant
        'Kalauao (Kalauao)'."""
        for feat in load(HONOLULU, "all-stations")["features"]:
            props = feat["properties"]
            alt = props.get("altName")
            if alt:
                assert alt != props["name"].removesuffix(" Station")

    @pytest.mark.unit
    def test_renamed_stations_use_current_public_names(self):
        by_code = {
            f["properties"]["stopCode"]: f["properties"].get("altName")
            for f in load(HONOLULU, "all-stations")["features"]
        }
        assert by_code[8] == "Pearlridge"
        assert by_code[9] == "Aloha Stadium"
        assert by_code[11] == "Daniel K. Inouye International Airport"


class TestHonoluluAlignment:
    @pytest.mark.unit
    def test_alignment_runs_west_to_east(self):
        coords = load(HONOLULU, "line1-alignment")["features"][0]["geometry"]["coordinates"]
        assert coords[0][0] < coords[-1][0], "guideway should start at the west terminus"

    @pytest.mark.unit
    def test_alignment_spans_the_open_stations(self):
        """The stitched guideway is trimmed to the open extent: its endpoints sit
        at the first and last open station, not out in the unopened City Center
        segment (whose section is excluded from OPEN_SECTIONS)."""
        coords = load(HONOLULU, "line1-alignment")["features"][0]["geometry"]["coordinates"]
        stations = {
            f["properties"]["stopCode"]: f["geometry"]["coordinates"]
            for f in load(HONOLULU, "all-stations")["features"]
        }
        first, last = stations[1], stations[honolulu_processor.OPEN_STATION_MAX_ID]
        assert geometry.haversine_m(coords[0], first) < 500
        assert geometry.haversine_m(coords[-1], last) < 500

    @pytest.mark.unit
    def test_stitching_leaves_no_section_sized_gap(self):
        """Sections are chained end-to-end; a mis-ordered or un-reversed section
        would leave a multi-kilometre jump between consecutive vertices."""
        coords = load(HONOLULU, "line1-alignment")["features"][0]["geometry"]["coordinates"]
        gaps = [geometry.haversine_m(coords[i], coords[i + 1]) for i in range(len(coords) - 1)]
        assert max(gaps) < 1500, f"largest vertex gap {max(gaps):.0f} m suggests a broken joint"

    @pytest.mark.unit
    def test_simplification_keeps_the_line_compact(self):
        """Douglas-Peucker at 1 m keeps the rendered line in the same size class
        as Seattle's, instead of shipping HART's ~6,000-vertex survey geometry."""
        coords = load(HONOLULU, "line1-alignment")["features"][0]["geometry"]["coordinates"]
        assert 100 < len(coords) < 800, f"{len(coords)} vertices is outside the expected range"
