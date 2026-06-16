"""Tests for the project's core data invariants.

IDs are append-only and stable (INV-NNN, never reused) — see CLAUDE.md,
"Core Invariants". These check the COMMITTED data + dumps (no network, no
regeneration), so they run anywhere pytest does. INV-016 (spotlight pill
references) lives in the JS suite since the definitions are in src/constants.js.
"""
import json
import math
import os
import sys
from collections import defaultdict

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import fetch_pois  # noqa: E402
import fetch_walksheds  # noqa: E402
import fetch_walking_distances  # noqa: E402
import fetch_station_exits  # noqa: E402

PUBLIC = os.path.dirname(fetch_pois.OUTPUT_DIR)
ICONS = os.path.join(PUBLIC, "icons")
TAG_CATEGORIES = os.path.join(fetch_pois.OUTPUT_DIR, "tag-categories.json")
ALL_STATIONS = os.path.join(PUBLIC, "all-stations.geojson")
STATION_EXITS = os.path.join(PUBLIC, "station-exits.geojson")


def _load_json(path):
    with open(path) as f:
        return json.load(f)


@pytest.fixture(scope="module")
def features():
    """All POIs, read from the committed spatial tiles (the sole POI artifact)."""
    tiles_dir = os.path.join(fetch_pois.OUTPUT_DIR, "tiles")
    index = _load_json(os.path.join(tiles_dir, "index.json"))
    feats = []
    for key in index["tiles"]:
        feats.extend(_load_json(os.path.join(tiles_dir, f"{key}.geojson"))["features"])
    return feats


@pytest.fixture(scope="module")
def membership(features):
    """{poi_id -> set((stopCode, band))} from point-in-polygon over committed walksheds."""
    stations = fetch_pois.load_station_index()
    walkshed_payload = fetch_walksheds.load_dump()
    pois = {"all": {"features": features}}
    pairs = fetch_walking_distances.compute_membership(stations, walkshed_payload, pois)
    by_poi = defaultdict(set)
    for _skey, poi_id, band, station, _feat in pairs:
        by_poi[poi_id].add((station["stopCode"], band))
    return by_poi


@pytest.fixture(scope="module")
def tag_categories():
    return _load_json(TAG_CATEGORIES)


@pytest.fixture(scope="module")
def registry():
    return _load_json(fetch_pois.FILTER_REGISTRY_JSON)


# ── INV-001 — walkshed-listing: in-walkshed POI lists >=1 station ──
def test_inv_001_walkshed_listing(features, membership):
    bad = [f["properties"]["name"] for f in features
           if f["properties"]["id"] in membership and not f["properties"].get("stations")]
    assert not bad, f"{len(bad)} in-walkshed POIs list no station, e.g. {bad[:5]}"


# ── INV-019 — tile-coverage: the spatial tiles exactly reproduce the full set ──
def test_inv_019_tile_coverage(features):
    """The runtime streams POIs from public/pois/tiles/ instead of loading the
    full per-category files. The union of all tiles must equal the full POI set
    (no POI lost or duplicated), each populated tile must be listed in
    index.json, and every feature must sit in its declared tile cell."""
    import math
    tiles_dir = os.path.join(fetch_pois.OUTPUT_DIR, "tiles")
    index = _load_json(os.path.join(tiles_dir, "index.json"))
    deg = index["tile_deg"]

    tile_ids, tile_keys = set(), set()
    for key in index["tiles"]:
        fc = _load_json(os.path.join(tiles_dir, f"{key}.geojson"))
        for f in fc["features"]:
            lon, lat = f["geometry"]["coordinates"]
            cell = f"{math.floor(lon / deg)}_{math.floor(lat / deg)}"
            assert cell == key, f"feature {f['properties']['id']} in tile {key} but cell is {cell}"
            assert f["properties"]["id"] not in tile_ids, f"duplicate {f['properties']['id']} across tiles"
            tile_ids.add(f["properties"]["id"])
        tile_keys.add(key)

    full_ids = {f["properties"]["id"] for f in features}
    assert tile_ids == full_ids, (
        f"tiles cover {len(tile_ids)} POIs but full set has {len(full_ids)}; "
        f"missing {len(full_ids - tile_ids)}, extra {len(tile_ids - full_ids)}")
    assert index["count"] == len(full_ids), "index count != full POI count"
    # No empty tiles listed, no populated tile unlisted.
    on_disk = {n[:-len(".geojson")] for n in os.listdir(tiles_dir) if n.endswith(".geojson")}
    assert on_disk == tile_keys, f"index/files mismatch: {on_disk ^ tile_keys}"


# ── INV-020 — station-tile-lookup is a correct superset of walkshed membership ──
def test_inv_020_station_tile_lookup(features):
    """index.json's precomputed station_tiles (station key -> tile keys) must,
    for each station, include the tile of every POI inside that station's
    walkshed — so loading those tiles then clipping reproduces the membership.
    Every listed tile must also be a real populated tile."""
    import math
    tiles_dir = os.path.join(fetch_pois.OUTPUT_DIR, "tiles")
    index = _load_json(os.path.join(tiles_dir, "index.json"))
    deg = index["tile_deg"]
    populated = set(index["tiles"])
    station_tiles = index["station_tiles"]
    assert station_tiles, "index.json missing station_tiles lookup"

    id_to_tile = {}
    for f in features:
        lon, lat = f["geometry"]["coordinates"]
        id_to_tile[f["properties"]["id"]] = f"{math.floor(lon / deg)}_{math.floor(lat / deg)}"

    # Membership keyed by full station key (disambiguates shared stopCode 54).
    stations = fetch_pois.load_station_index()
    walkshed_payload = fetch_walksheds.load_dump()
    pairs = fetch_walking_distances.compute_membership(
        stations, walkshed_payload, {"all": {"features": features}})
    by_station = defaultdict(set)
    for skey, poi_id, _band, _station, _feat in pairs:
        by_station[skey].add(poi_id)

    for skey, listed in station_tiles.items():
        listed_set = set(listed)
        assert listed_set <= populated, f"{skey} lists non-populated tiles: {listed_set - populated}"
        needed = {id_to_tile[i] for i in by_station.get(skey, set()) if i in id_to_tile}
        assert needed <= listed_set, f"{skey}: walkshed POIs in tiles {needed - listed_set} not in lookup"


# ── INV-006 — no-orphan-tags: every tag is categorized ──
def test_inv_006_no_orphan_tags(features, tag_categories):
    known = set(tag_categories["tag_to_category"])
    orphans = sorted({t for f in features for t in f["properties"]["tags"] if t not in known})
    assert not orphans, f"tags not in tag_to_category: {orphans[:10]}"


# ── INV-007 — stations-sorted: stations[] ascending by walking time ──
def test_inv_007_stations_sorted(features):
    for f in features:
        st = f["properties"].get("stations")
        if st:
            secs = [s["walkingSeconds"] for s in st]
            assert secs == sorted(secs), f"{f['properties']['name']} stations not sorted"


# ── INV-008 — provenance: every POI has sources[] in {osm, overture} ──
def test_inv_008_provenance_sources(features):
    for f in features:
        src = f["properties"].get("sources")
        assert src and set(src) <= {"osm", "overture"}, f"bad sources on {f['properties']['name']}"


# ── INV-010 — band-matches-geometry: stations[] == walkshed membership exactly ──
def test_inv_010_band_matches_geometry(features, membership):
    for f in features:
        p = f["properties"]
        listed = {(s["stopCode"], s["band"]) for s in p.get("stations", [])}
        assert listed == membership.get(p["id"], set()), \
            f"{p['name']}: listed {listed} != membership {membership.get(p['id'], set())}"


# ── INV-011 — distances-sane: non-negative, finite, band in {5,10,15} ──
def test_inv_011_distances_sane(features):
    for f in features:
        for s in f["properties"].get("stations", []):
            assert math.isfinite(s["walkingMeters"]) and s["walkingMeters"] >= 0
            assert math.isfinite(s["walkingSeconds"]) and s["walkingSeconds"] >= 0
            assert s["band"] in (5, 10, 15)


# ── INV-012 — station-data: 38 stations, valid stopCode + lines ──
def test_inv_012_station_data():
    feats = _load_json(ALL_STATIONS)["features"]
    assert len(feats) == 38, f"expected 38 stations, got {len(feats)}"
    for f in feats:
        p = f["properties"]
        assert isinstance(p["stopCode"], int)
        assert p["lines"] in ("1", "2", "1,2"), f"bad lines {p['lines']} on {p.get('name')}"


# ── INV-013 — sprite-per-station: light + dark sprite for every station ──
def test_inv_013_sprite_per_station():
    manifest = _load_json(os.path.join(ICONS, "stations.json"))
    for f in _load_json(ALL_STATIONS)["features"]:
        p = f["properties"]
        base = f"{p['lines']}-{p['stopCode']}"
        for mode in ("light", "dark"):
            assert f"station-{mode}-{base}" in manifest, f"missing sprite for {base} ({mode})"


# ── INV-015 — registry-append-only: stable, unique IDs ──
def test_inv_015_registry_append_only():
    reg = _load_json(fetch_pois.FILTER_REGISTRY_JSON)
    for k in ("cat", "tag"):
        assert len(reg[k]) == len(set(reg[k])), f"duplicate entries in registry '{k}' (IDs must be stable)"


# ── INV-017 — schema-registry-consistency: schema IDs match registry + cover live tags ──
def test_inv_017_schema_registry_consistency(tag_categories, registry):
    schema = tag_categories["filter_schema"]
    missing = [t for t in tag_categories["tag_to_category"] if t not in registry["tag"]]
    assert not missing, f"tags missing a registry ID: {missing[:10]}"
    for name, idx in schema["tag"].items():
        assert registry["tag"][idx] == name, f"tag id {idx} -> {name} != registry"
    for name, idx in schema["cat"].items():
        assert registry["cat"][idx] == name, f"cat id {idx} -> {name} != registry"


# ── INV-021 — station-exits-wellformed ──
@pytest.fixture(scope="module")
def station_exits():
    return _load_json(STATION_EXITS)["features"]


def test_inv_021_station_exits_wellformed(station_exits):
    """Every station-exits.geojson feature has a unique id, a stationKey resolving
    to a real station, a non-empty name, a finite bearing in [0,360), sources in
    {osm}, and coordinates inside the padded station bbox."""
    stations = fetch_pois.load_station_index()
    keys = {fetch_walksheds.station_key(s) for s in stations}
    south, west, north, east = fetch_pois.compute_bbox(stations)

    seen = set()
    for f in station_exits:
        p = f["properties"]
        assert p["id"] not in seen, f"duplicate exit id {p['id']}"
        seen.add(p["id"])
        assert p["stationKey"] in keys, f"exit {p['id']} references unknown station {p['stationKey']}"
        assert p.get("name"), f"exit {p['id']} has no name"
        b = p["bearingFromStation"]
        assert math.isfinite(b) and 0 <= b < 360, f"exit {p['id']} bad bearing {b}"
        assert p.get("source") in ("osm",), f"exit {p['id']} bad source {p.get('source')}"
        lon, lat = f["geometry"]["coordinates"]
        assert west <= lon <= east and south <= lat <= north, \
            f"exit {p['id']} ({lon},{lat}) outside station bbox"


# ── INV-022 — exit-nearest-station: each exit is assigned to its nearest station ──
def test_inv_022_exit_nearest_station(station_exits):
    """Each exit's stationKey is the nearest Link station to its coordinates, and
    within the build cutoff — so the panel never lists an exit under a station a
    closer station should own."""
    stations = fetch_pois.load_station_index()
    for f in station_exits:
        p = f["properties"]
        coord = f["geometry"]["coordinates"]
        nearest, meters = fetch_station_exits.nearest_station(coord, stations)
        assert meters <= fetch_station_exits.NEAREST_CUTOFF_M, \
            f"exit {p['id']} is {meters:.0f}m from nearest station (> cutoff)"
        assert fetch_walksheds.station_key(nearest) == p["stationKey"], \
            f"exit {p['id']} assigned {p['stationKey']} but nearest is {fetch_walksheds.station_key(nearest)}"


# ── INV-014 — deterministic-build: sprite manifest reproducible (local; needs cairosvg) ──
def test_inv_014_deterministic_build(tmp_path):
    pytest.importorskip("cairosvg")
    pytest.importorskip("PIL")
    sys.path.insert(0, os.path.dirname(HERE))  # data/ for process.py
    import process  # noqa: E402

    station_index = _load_json(os.path.join(os.path.dirname(HERE), "station-index.json"))
    process.generate_sprites(station_index, str(tmp_path))
    regenerated = _load_json(os.path.join(str(tmp_path), "stations.json"))
    committed = _load_json(os.path.join(ICONS, "stations.json"))
    assert regenerated == committed, "sprite manifest differs from committed (non-deterministic build)"
