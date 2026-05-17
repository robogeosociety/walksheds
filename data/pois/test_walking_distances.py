"""Tests for fetch_walksheds.py + fetch_walking_distances.py + attach_station_distances."""

import gzip
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import fetch_pois
import fetch_walksheds
import fetch_walking_distances as fwd


# ── Geometry helpers ──

# Diamond-shaped ring around (-122.30, 47.60), ~5km across diagonally
RING_LARGE = [
    [-122.35, 47.60],
    [-122.30, 47.65],
    [-122.25, 47.60],
    [-122.30, 47.55],
    [-122.35, 47.60],
]
RING_MEDIUM = [
    [-122.33, 47.60],
    [-122.30, 47.63],
    [-122.27, 47.60],
    [-122.30, 47.57],
    [-122.33, 47.60],
]
RING_SMALL = [
    [-122.31, 47.60],
    [-122.30, 47.61],
    [-122.29, 47.60],
    [-122.30, 47.59],
    [-122.31, 47.60],
]


def _walkshed_fc(rings_by_minutes):
    """rings_by_minutes: {5: ring, 10: ring, 15: ring}"""
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"contour": m},
                "geometry": {"type": "Polygon", "coordinates": [ring]},
            }
            for m, ring in sorted(rings_by_minutes.items())
        ],
    }


def _station(name="Westlake Station", lng=-122.30, lat=47.60, stopCode=50, lines="1,2"):
    return {"name": name, "lng": lng, "lat": lat, "stopCode": stopCode, "lines": lines}


def _poi(fid=1, lng=-122.30, lat=47.60, name="Test POI"):
    return {
        "type": "Feature",
        "properties": {"id": fid, "name": name, "category": "restaurant", "tags": ["restaurant"]},
        "geometry": {"type": "Point", "coordinates": [lng, lat]},
    }


# ── point_in_polygon ──


class TestPointInPolygon:
    def test_inside(self):
        assert fwd.point_in_polygon((-122.30, 47.60), RING_LARGE)

    def test_outside(self):
        assert not fwd.point_in_polygon((-122.40, 47.60), RING_LARGE)

    def test_just_inside_small(self):
        assert fwd.point_in_polygon((-122.30, 47.605), RING_SMALL)

    def test_outside_small_inside_large(self):
        # Point at (-122.30, 47.62) should be outside RING_SMALL but inside RING_LARGE/MEDIUM
        assert not fwd.point_in_polygon((-122.30, 47.62), RING_SMALL)
        assert fwd.point_in_polygon((-122.30, 47.62), RING_LARGE)
        assert fwd.point_in_polygon((-122.30, 47.62), RING_MEDIUM)


# ── bands_from_walkshed ──


class TestBandsFromWalkshed:
    def test_sorted_ascending(self):
        fc = _walkshed_fc({15: RING_LARGE, 5: RING_SMALL, 10: RING_MEDIUM})
        bands = fwd.bands_from_walkshed(fc)
        assert [m for m, _ in bands] == [5, 10, 15]

    def test_ignores_zero_contour(self):
        fc = _walkshed_fc({0: RING_SMALL})  # contour=0 falls back to int(0) -> skip
        bands = fwd.bands_from_walkshed(fc)
        # contour was 0 → not added (zero is falsy in our band filter)
        assert bands == []


# ── station_key ──


class TestStationKey:
    def test_combines_lines_and_stopcode(self):
        s = _station(lines="1,2", stopCode=50)
        assert fetch_walksheds.station_key(s) == "1,2-50"

    def test_disambiguates_shared_stopcodes(self):
        # Two stations both with stopCode=54: Line 1 Stadium and Line 2 Judkins Park.
        line1 = _station(name="Stadium", lines="1", stopCode=54)
        line2 = _station(name="Judkins Park", lines="2", stopCode=54)
        assert fetch_walksheds.station_key(line1) != fetch_walksheds.station_key(line2)


# ── compute_membership ──


class TestComputeMembership:
    def _walkshed_payload(self, stations, rings_by_minutes):
        walksheds = {}
        for s in stations:
            walksheds[fetch_walksheds.station_key(s)] = _walkshed_fc(rings_by_minutes)
        return {"version": "test", "walksheds": walksheds}

    def test_assigns_smallest_band(self):
        stations = [_station()]
        walkshed_payload = self._walkshed_payload(stations, {5: RING_SMALL, 10: RING_MEDIUM, 15: RING_LARGE})
        pois = {"restaurants": {"type": "FeatureCollection", "features": [
            _poi(fid=1, lng=-122.30, lat=47.60),   # at station: band 5
            _poi(fid=2, lng=-122.30, lat=47.62),   # outside small: band 10
            _poi(fid=3, lng=-122.30, lat=47.645),  # outside medium: band 15
        ]}}
        pairs = fwd.compute_membership(stations, walkshed_payload, pois)
        by_id = {poi_id: band for _, poi_id, band, _, _ in pairs}
        assert by_id == {1: 5, 2: 10, 3: 15}

    def test_excludes_outside_15min(self):
        stations = [_station()]
        walkshed_payload = self._walkshed_payload(stations, {5: RING_SMALL, 10: RING_MEDIUM, 15: RING_LARGE})
        pois = {"restaurants": {"type": "FeatureCollection", "features": [
            _poi(fid=99, lng=-100.00, lat=47.60),  # far outside everything
        ]}}
        pairs = fwd.compute_membership(stations, walkshed_payload, pois)
        assert pairs == []

    def test_multiple_stations_same_poi(self):
        s1 = _station(name="Westlake", lng=-122.30, lat=47.60, stopCode=50, lines="1,2")
        s2 = _station(name="Capitol Hill", lng=-122.32, lat=47.60, stopCode=49, lines="1,2")
        stations = [s1, s2]
        walkshed_payload = self._walkshed_payload(stations, {5: RING_SMALL, 10: RING_MEDIUM, 15: RING_LARGE})
        # The rings in this test wrap around BOTH stations' coords, so a single POI lands in both walksheds.
        pois = {"restaurants": {"type": "FeatureCollection", "features": [
            _poi(fid=42, lng=-122.30, lat=47.60),
        ]}}
        pairs = fwd.compute_membership(stations, walkshed_payload, pois)
        station_keys = sorted(p[0] for p in pairs)
        assert station_keys == sorted([fetch_walksheds.station_key(s1), fetch_walksheds.station_key(s2)])


# ── attach_station_distances ──


@pytest.fixture
def isolated_dumps(tmp_path, monkeypatch):
    """Redirect every dump path so attach_station_distances reads tmp files."""
    walkshed_path = tmp_path / "walksheds.json.gz"
    distance_path = tmp_path / "walking-distances.json.gz"
    monkeypatch.setattr(fetch_walksheds, "RAW_DUMP", str(walkshed_path))
    monkeypatch.setattr(fwd, "DUMP", str(distance_path))
    return walkshed_path, distance_path


def _write_gz(path, payload):
    with gzip.open(path, "wb") as f:
        f.write(json.dumps(payload).encode("utf-8"))


def _write_station_index(tmp_path, stations, monkeypatch):
    p = tmp_path / "station-index.json"
    with open(p, "w") as f:
        json.dump({"stations": stations}, f)
    monkeypatch.setattr(fetch_pois, "STATION_INDEX", str(p))


class TestAttachStationDistances:
    def test_attaches_sorted_array(self, isolated_dumps, tmp_path, monkeypatch):
        walkshed_path, distance_path = isolated_dumps
        s1 = _station(name="Westlake Station", lng=-122.30, lat=47.60, stopCode=50, lines="1,2")
        s2 = _station(name="Capitol Hill Station", lng=-122.32, lat=47.60, stopCode=49, lines="1,2")
        _write_station_index(tmp_path, [s1, s2], monkeypatch)
        _write_gz(walkshed_path, {
            "version": "v1",
            "contours": [5, 10, 15],
            "walksheds": {
                fetch_walksheds.station_key(s1): _walkshed_fc({5: RING_SMALL, 10: RING_MEDIUM, 15: RING_LARGE}),
                fetch_walksheds.station_key(s2): _walkshed_fc({5: RING_SMALL, 10: RING_MEDIUM, 15: RING_LARGE}),
            },
        })
        _write_gz(distance_path, {
            "version": "v1",
            "pairs": {
                f"{fetch_walksheds.station_key(s1)}:42": [400.0, 290.0, 5],
                f"{fetch_walksheds.station_key(s2)}:42": [800.0, 580.0, 10],
            },
        })
        all_fcs = {"restaurants": {"type": "FeatureCollection", "features": [_poi(fid=42)]}}
        fetch_pois.attach_station_distances(all_fcs)
        stations_prop = all_fcs["restaurants"]["features"][0]["properties"]["stations"]
        assert len(stations_prop) == 2
        # Sorted by walkingSeconds ascending: Westlake (290) first.
        assert stations_prop[0]["name"] == "Westlake Station"
        assert stations_prop[0]["walkingMeters"] == 400
        assert stations_prop[0]["walkingSeconds"] == 290
        assert stations_prop[0]["band"] == 5
        assert stations_prop[1]["name"] == "Capitol Hill Station"

    def test_no_stations_prop_when_no_pairs(self, isolated_dumps, tmp_path, monkeypatch):
        walkshed_path, distance_path = isolated_dumps
        s1 = _station()
        _write_station_index(tmp_path, [s1], monkeypatch)
        _write_gz(walkshed_path, {"version": "v1", "contours": [5, 10, 15], "walksheds": {}})
        _write_gz(distance_path, {"version": "v1", "pairs": {}})
        all_fcs = {"restaurants": {"type": "FeatureCollection", "features": [_poi(fid=99)]}}
        fetch_pois.attach_station_distances(all_fcs)
        # Feature without any membership keeps its original props, no 'stations' key.
        assert "stations" not in all_fcs["restaurants"]["features"][0]["properties"]

    def test_version_mismatch_skips_quietly(self, isolated_dumps, tmp_path, monkeypatch, capsys):
        walkshed_path, distance_path = isolated_dumps
        s1 = _station()
        _write_station_index(tmp_path, [s1], monkeypatch)
        _write_gz(walkshed_path, {"version": "vNEW", "contours": [5, 10, 15], "walksheds": {}})
        _write_gz(distance_path, {"version": "vOLD", "pairs": {
            f"{fetch_walksheds.station_key(s1)}:42": [400.0, 290.0, 5],
        }})
        all_fcs = {"restaurants": {"type": "FeatureCollection", "features": [_poi(fid=42)]}}
        fetch_pois.attach_station_distances(all_fcs)
        out = capsys.readouterr().out
        assert "version" in out.lower() and "vold" in out.lower() and "vnew" in out.lower()
        assert "stations" not in all_fcs["restaurants"]["features"][0]["properties"]


# ── validate_geojson covers new stations array ──


class TestValidateStationsArray:
    BBOX = [47.30, -122.40, 47.70, -122.10]

    def _fc_with_stations(self, stations_value):
        feat = {
            "type": "Feature",
            "properties": {
                "id": 1,
                "name": "Test",
                "category": "restaurant",
                "tags": ["restaurant"],
                "stations": stations_value,
            },
            "geometry": {"type": "Point", "coordinates": [-122.30, 47.60]},
        }
        # Need 10+ features to pass the size check.
        return {"type": "FeatureCollection", "features": [feat] * 10}

    def test_valid_stations(self):
        valid = [{"stopCode": 50, "lines": "1,2", "name": "Westlake Station",
                  "walkingMeters": 412, "walkingSeconds": 297, "band": 5}]
        fc = self._fc_with_stations(valid)
        errors = fetch_pois.validate_geojson(fc, "restaurants", self.BBOX)
        # All errors should be about duplicate ids (from repeating the same feature) — not about stations.
        assert all("stations" not in e for e in errors)

    def test_invalid_shape(self):
        fc = self._fc_with_stations("not-a-list")
        errors = fetch_pois.validate_geojson(fc, "restaurants", self.BBOX)
        assert any("stations" in e and "not a list" in e for e in errors)

    def test_missing_required_field(self):
        invalid = [{"stopCode": 50, "lines": "1,2", "name": "Westlake"}]  # missing walking* + band
        fc = self._fc_with_stations(invalid)
        errors = fetch_pois.validate_geojson(fc, "restaurants", self.BBOX)
        assert any("walkingMeters" in e for e in errors)
        assert any("walkingSeconds" in e for e in errors)
        assert any("band" in e for e in errors)
