"""Tests for the project's core data invariants.

IDs are append-only and stable (INV-NNN, never reused) — see CLAUDE.md,
"Core Invariants". These check the COMMITTED data + dumps (no network, no
regeneration), so they run anywhere pytest does. INV-016 (spotlight pill
references) lives in the JS suite since the definitions are in src/constants.js.

Every data invariant runs once per city, and is gated on what that city's
dataset actually claims to contain (`City.capabilities` in data/cities.py):
a city without walkshed isochrones has no POI tiles to check, so the
POI invariants parametrize over POI-capable cities only rather than failing on
data that was never meant to exist. Test ids carry the city slug, so a failure
names the city it came from.
"""
import json
import math
import os
import sys
from collections import defaultdict

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))  # data/ — cities, sprites, process

import cities as city_registry  # noqa: E402
import fetch_pois  # noqa: E402
import fetch_walksheds  # noqa: E402
import fetch_walking_distances  # noqa: E402
import fetch_station_exits  # noqa: E402

ALL_CITIES = [city_registry.CITIES[s] for s in sorted(city_registry.CITIES)]
POI_CITIES = [c for c in ALL_CITIES if c.has(city_registry.CAP_POIS)]
EXIT_CITIES = [c for c in ALL_CITIES if c.has(city_registry.CAP_EXITS)]
WALKSHED_CITIES = [c for c in ALL_CITIES if c.has(city_registry.CAP_WALKSHEDS)]

def _slug(c):
    return c.slug


def _load_json(path):
    with open(path) as f:
        return json.load(f)


def _activate(city):
    """Point the data modules at `city` for the duration of one test.

    fetch_pois holds the active city as module state (so the whole POI pipeline
    moves together), so this runs per test rather than per module — otherwise a
    module-scoped fixture for one city could be observed while another city is
    active.
    """
    fetch_pois.set_city(city)
    return city


@pytest.fixture(params=ALL_CITIES, ids=_slug)
def city(request):
    return _activate(request.param)


@pytest.fixture(params=POI_CITIES, ids=_slug)
def poi_city(request):
    return _activate(request.param)


@pytest.fixture(params=EXIT_CITIES, ids=_slug)
def exit_city(request):
    return _activate(request.param)


# Heavy artifacts are loaded once per city and reused — the fixtures above are
# function-scoped for correctness, not because the data is cheap to re-read.
_features_cache = {}
_membership_cache = {}


def load_features(city):
    """All POIs, read from the committed spatial tiles (the sole POI artifact)."""
    if city.slug not in _features_cache:
        index = _load_json(city.tile_index)
        feats = []
        for key in index["tiles"]:
            feats.extend(_load_json(city.tiles_dir / f"{key}.geojson")["features"])
        _features_cache[city.slug] = feats
    return _features_cache[city.slug]


def load_membership(city):
    """{poi_id -> set((stopCode, band))} by point-in-polygon over committed walksheds."""
    if city.slug not in _membership_cache:
        stations = fetch_pois.load_station_index()
        walkshed_payload = fetch_walksheds.load_dump()
        pois = {"all": {"features": load_features(city)}}
        pairs = fetch_walking_distances.compute_membership(stations, walkshed_payload, pois)
        by_poi = defaultdict(set)
        for _skey, poi_id, band, station, _feat in pairs:
            by_poi[poi_id].add((station["stopCode"], band))
        _membership_cache[city.slug] = by_poi
    return _membership_cache[city.slug]


@pytest.fixture
def features(poi_city):
    return load_features(poi_city)


@pytest.fixture
def membership(poi_city, features):
    return load_membership(poi_city)


@pytest.fixture
def tag_categories(poi_city):
    return _load_json(poi_city.pois_dir / "tag-categories.json")


@pytest.fixture
def registry():
    return _load_json(fetch_pois.FILTER_REGISTRY_JSON)


# ── INV-001 — walkshed-listing: in-walkshed POI lists >=1 station ──
def test_inv_001_walkshed_listing(features, membership):
    bad = [f["properties"]["name"] for f in features
           if f["properties"]["id"] in membership and not f["properties"].get("stations")]
    assert not bad, f"{len(bad)} in-walkshed POIs list no station, e.g. {bad[:5]}"


# ── INV-019 — tile-coverage: the spatial tiles exactly reproduce the full set ──
def test_inv_019_tile_coverage(poi_city, features):
    """The runtime streams POIs from public/cities/<slug>/pois/tiles/ instead of
    loading the full per-category files. The union of all tiles must equal the
    full POI set (no POI lost or duplicated), each populated tile must be listed
    in index.json, and every feature must sit in its declared tile cell."""
    tiles_dir = poi_city.tiles_dir
    index = _load_json(poi_city.tile_index)
    deg = index["tile_deg"]

    tile_ids, tile_keys = set(), set()
    for key in index["tiles"]:
        fc = _load_json(tiles_dir / f"{key}.geojson")
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
def test_inv_020_station_tile_lookup(poi_city, features):
    """index.json's precomputed station_tiles (station key -> tile keys) must,
    for each station, include the tile of every POI inside that station's
    walkshed — so loading those tiles then clipping reproduces the membership.
    Every listed tile must also be a real populated tile."""
    index = _load_json(poi_city.tile_index)
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


# ── INV-012 — station-data: declared station count, valid stopCode + lines ──
def test_inv_012_station_data(city):
    """The station count and the `lines` vocabulary both come from the city's
    registry entry, so adding a city (or a station) is a registry edit rather
    than an edit to this assertion."""
    feats = _load_json(city.stations_geojson)["features"]
    assert len(feats) == city.station_count, \
        f"{city.slug}: expected {city.station_count} stations, got {len(feats)}"

    keys = [line.key for line in city.lines]
    valid_lines = {",".join(keys[i:j])
                   for i in range(len(keys)) for j in range(i + 1, len(keys) + 1)}
    for f in feats:
        p = f["properties"]
        assert isinstance(p["stopCode"], int)
        assert p["lines"] in valid_lines, \
            f"{city.slug}: bad lines {p['lines']!r} on {p.get('name')} (valid: {sorted(valid_lines)})"


# ── INV-013 — sprite-per-station: light + dark sprite for every station ──
def test_inv_013_sprite_per_station(city):
    manifest = _load_json(city.icons_dir / "stations.json")
    for f in _load_json(city.stations_geojson)["features"]:
        p = f["properties"]
        base = f"{p['lines']}-{p['stopCode']}"
        for mode in ("light", "dark"):
            assert f"station-{mode}-{base}" in manifest, \
                f"{city.slug}: missing sprite for {base} ({mode})"


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
@pytest.fixture
def station_exits(exit_city):
    return _load_json(exit_city.station_exits_geojson)["features"]


def test_inv_021_station_exits_wellformed(exit_city, station_exits):
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
def test_inv_022_exit_nearest_station(exit_city, station_exits):
    """Each exit's stationKey is the nearest station to its coordinates, and
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


# ── INV-023 — stats-current: committed stats.json matches a regeneration ──
def test_inv_023_stats_current(poi_city):
    """stats.json (the legend's Statistics section) stays in sync with the
    artifacts it summarizes — regenerating from the committed tile index,
    stations, and raw dumps reproduces the committed file exactly."""
    import build_stats  # noqa: E402

    committed = _load_json(poi_city.stats_json)
    assert committed == build_stats.build_stats(poi_city), \
        f"stats.json is stale — re-run: python3 data/pois/build_stats.py --city {poi_city.slug}"


# ── INV-009 — cache-version-match: distance cache version == walkshed version ──
def test_inv_009_cache_version_match(city):
    """The Matrix cache is keyed to the walkshed dump it was built against; a
    mismatch means POI `stations[]` was attached from stale routing."""
    if not city.has(city_registry.CAP_WALKSHEDS):
        pytest.skip(f"{city.slug} has no walkshed dump yet")
    walksheds = fetch_walksheds.load_dump()
    distances = fetch_walking_distances.load_dump()
    assert distances.get("version") == walksheds.get("version"), (
        f"{city.slug}: distance cache version {distances.get('version')} != "
        f"walkshed version {walksheds.get('version')} — re-run "
        f"fetch_walking_distances.py --city {city.slug} --refresh")


# ── INV-024 — city-registry-sync: src/cityRegistry.json matches data/cities.py ──
def test_inv_024_city_registry_sync():
    """The frontend and the data pipeline read one registry. data/cities.py is
    the source; src/cityRegistry.json is its generated, committed projection."""
    committed = _load_json(city_registry.REGISTRY_JSON)
    assert committed == city_registry.registry_payload(), \
        "src/cityRegistry.json is stale — re-run: python3 data/cities.py"


# ── INV-025 — city-data-complete: every declared capability has its artifacts ──
def test_inv_025_city_data_complete(city):
    """A city's declared capabilities must match what is actually committed, in
    both directions: the app gates its chrome on these flags, so a city claiming
    `pois` without tiles renders an empty filter UI, and a city with tiles it
    does not declare silently hides real data."""
    assert city.stations_geojson.exists(), f"{city.slug}: no all-stations.geojson"
    for line in city.lines:
        assert city.alignment_path(line).exists(), \
            f"{city.slug}: no alignment for line {line.id}"

    checks = [
        (city_registry.CAP_WALKSHEDS, city.walksheds_dump),
        (city_registry.CAP_POIS, city.tile_index),
        (city_registry.CAP_EXITS, city.station_exits_geojson),
    ]
    for cap, path in checks:
        if city.has(cap):
            assert path.exists(), \
                f"{city.slug} declares capability {cap!r} but {path} is missing"
        else:
            assert not path.exists(), (
                f"{city.slug} does not declare capability {cap!r} but {path} "
                "exists — add the capability in data/cities.py so the UI shows it")

    # POI membership is defined by the isochrones, so pois without walksheds is
    # never a coherent state.
    if city.has(city_registry.CAP_POIS):
        assert city.has(city_registry.CAP_WALKSHEDS), \
            f"{city.slug} declares 'pois' without 'walksheds'"


# ── INV-014 — deterministic-build: sprite manifest reproducible (local; needs cairosvg) ──
def test_inv_014_deterministic_build(city, tmp_path):
    pytest.importorskip("cairosvg")
    pytest.importorskip("PIL")
    import sprites  # noqa: E402

    station_index = _load_json(city.station_index)
    sprites.generate_sprites(city, station_index, str(tmp_path))
    regenerated = _load_json(os.path.join(str(tmp_path), "stations.json"))
    committed = _load_json(city.icons_dir / "stations.json")
    assert regenerated == committed, \
        f"{city.slug}: sprite manifest differs from committed (non-deterministic build)"
