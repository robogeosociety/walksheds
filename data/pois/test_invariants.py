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

PUBLIC = os.path.dirname(fetch_pois.OUTPUT_DIR)
ICONS = os.path.join(PUBLIC, "icons")
TAG_CATEGORIES = os.path.join(fetch_pois.OUTPUT_DIR, "tag-categories.json")
ALL_STATIONS = os.path.join(PUBLIC, "all-stations.geojson")


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
