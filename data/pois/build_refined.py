#!/usr/bin/env python3
"""Conflate OSM and Overture POIs into one refined best-of-both dataset.

Each source covers the other's weakness:
  - Overture: more coverage, near-complete website/phone/address.
  - OSM: opening hours, rich per-feature qualifier tags (diet, cuisine,
    service style), an explicit closure filter, denser hand-mapping in places.

POIs that are the same real-world place (same normalized name within
MATCH_RADIUS_M) are clustered across both sources and emitted as one merged
record, preferring each source's strength. Clustering also collapses each
source's internal duplicates.

Closure handling combines both signals: OSM features are already closure-filtered
by fetch_pois; Overture rows with operating_status='closed' are dropped here.

Output uses the mainline POI schema. Every in-walkshed POI gets a `stations`
array: membership + band come from point-in-polygon against the committed
walkshed dump (free, any POI), the distance/duration from the committed Mapbox
Matrix cache where the pair is present (matched / OSM POIs) and a straight-line
estimate otherwise (Overture-only POIs) — so none are left without stop icons.
tag-categories.json is rebuilt with the mainline writer.

Needs network (Overture S3 query); the OSM side reads the committed dump.

Usage:
    python3 data/pois/build_refined.py
    python3 data/pois/build_refined.py --min-confidence 0.6 --dry-run
"""
import argparse
import json
import math
import os
import re
from collections import defaultdict

import duckdb

import fetch_walksheds
from fetch_pois import (
    CATEGORIES,
    OUTPUT_DIR,
    build_category,
    compute_bbox,
    load_raw_dump,
    load_station_index,
    write_tag_categories_manifest,
    _normalize,
)
from fetch_overture import (
    CATEGORY_TO_FILE,
    PLACES_GLOB,
    classify,
    derive_tags,
)

MATCH_RADIUS_M = 80
BUCKETS = list(CATEGORIES.keys())
OSM_VALUE_TO_BUCKET = {v: b for b, (_k, vals) in CATEGORIES.items() for v in vals}


def hav(a, b):
    r = 6371000
    p1, p2 = math.radians(a[1]), math.radians(b[1])
    dphi = math.radians(b[1] - a[1])
    dl = math.radians(b[0] - a[0])
    h = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def norm_name(s):
    return re.sub(r"[^a-z0-9]", "", _normalize(s or ""))


def get_osm_records():
    """OSM features (closure-filtered, hours + rich tags), keyed by integer id."""
    elements = load_raw_dump().get("elements", [])
    recs = []
    for cat in BUCKETS:
        for f in build_category(elements, cat)["features"]:
            p = f["properties"]
            recs.append({
                "source": "osm",
                "id": p["id"],  # int OSM id — matches the walking-distance cache
                "name": p["name"],
                "nname": norm_name(p["name"]),
                "coord": f["geometry"]["coordinates"],
                "category": p["category"],
                "tags": p.get("tags", []),
                "hours": p.get("hours"),
                "website": p.get("website"),
                "phone": p.get("phone"),
                "address": p.get("address"),
            })
    return recs


def get_overture_records(bbox, min_confidence):
    """Overture features (dropping operating_status='closed'), keyed by GERS id."""
    south, west, north, east = bbox
    con = duckdb.connect()
    con.execute("INSTALL spatial; LOAD spatial; INSTALL httpfs; LOAD httpfs;")
    con.execute("SET s3_region='us-west-2';")
    rows = con.execute(f"""
        SELECT id, names.primary, categories.primary, categories.alternate,
               ROUND(bbox.xmin, 7), ROUND(bbox.ymin, 7),
               list_extract(websites, 1), list_extract(phones, 1), addresses[1].freeform,
               operating_status
        FROM read_parquet('{PLACES_GLOB}')
        WHERE bbox.xmin BETWEEN {west} AND {east}
          AND bbox.ymin BETWEEN {south} AND {north}
          AND names.primary IS NOT NULL
          AND confidence >= {min_confidence}
          AND (operating_status IS NULL OR operating_status <> 'closed')
    """).fetchall()
    recs = []
    for (oid, name, primary, alts, lon, lat, website, phone, address, _op) in rows:
        cat = classify(primary)
        if cat is None:
            continue
        recs.append({
            "source": "overture",
            "id": oid,  # GERS string id — not in the OSM-keyed distance cache
            "name": name.strip(),
            "nname": norm_name(name),
            "coord": [lon, lat],
            "category": cat,
            "tags": derive_tags(primary, alts, cat),
            "website": website,
            "phone": phone,
            "address": address,
            "hours": None,
        })
    return recs


def cluster(records):
    """Group records that are the same place: same name key, within MATCH_RADIUS_M."""
    by_name = defaultdict(list)
    for r in records:
        by_name[r["nname"]].append(r)
    clusters = []
    for nname, recs in by_name.items():
        if not nname:
            clusters.extend([r] for r in recs)
            continue
        groups = []
        for r in recs:
            for g in groups:
                if any(hav(r["coord"], c) <= MATCH_RADIUS_M for c in g["coords"]):
                    g["members"].append(r)
                    g["coords"].append(r["coord"])
                    break
            else:
                groups.append({"members": [r], "coords": [r["coord"]]})
        clusters.extend(g["members"] for g in groups)
    return clusters


# Urban detour factor + walking speed for estimating distances to stations when
# a POI is not in the committed Mapbox Matrix cache (Overture-only POIs).
DETOUR_FACTOR = 1.3
WALK_MPS = 1.34  # ~4.8 km/h


def attach_stations(all_fcs, stations):
    """Attach a sorted `stations` array to every in-walkshed POI.

    Walkshed membership + band come from point-in-polygon against the committed
    walkshed dump (free, works for any POI). Walking distance/duration uses the
    committed Mapbox Matrix cache when the (station, POI) pair is present
    (matched / OSM POIs, keyed by integer id) and a straight-line estimate
    (haversine x detour factor) otherwise (Overture-only POIs) — so no POI is
    left without nearby-station stop icons, with zero API spend.
    """
    import fetch_walksheds as fws
    import fetch_walking_distances as fwd

    walkshed_payload = fws.load_dump()
    if not walkshed_payload:
        print("  No walkshed dump committed; skipping station attach.")
        return set()
    cached_pairs = (fwd.load_dump() or {}).get("pairs", {})
    station_meta = {fws.station_key(s): s for s in stations}

    pairs = fwd.compute_membership(stations, walkshed_payload, all_fcs)
    by_poi = {}
    estimated = real = 0
    for skey, poi_id, band, _station, poi in pairs:
        meta = station_meta.get(skey)
        if not meta:
            continue
        cached = cached_pairs.get(f"{skey}:{poi_id}")
        if cached:
            meters, seconds = round(cached[0]), round(cached[1])
            real += 1
        else:
            straight = hav(poi["geometry"]["coordinates"], (meta["lng"], meta["lat"]))
            meters = round(straight * DETOUR_FACTOR)
            seconds = round(meters / WALK_MPS)
            estimated += 1
        by_poi.setdefault(poi_id, []).append({
            "stopCode": meta["stopCode"],
            "lines": meta["lines"],
            "name": meta["name"],
            "walkingMeters": meters,
            "walkingSeconds": seconds,
            "band": band,
        })

    attached = 0
    for fc in all_fcs.values():
        for feat in fc["features"]:
            entries = by_poi.get(feat["properties"]["id"])
            if not entries:
                continue
            entries.sort(key=lambda s: (s["walkingSeconds"], s["walkingMeters"]))
            feat["properties"]["stations"] = entries
            attached += 1
    print(f"  Attached stations to {attached:,} POIs "
          f"({real:,} cached Matrix pairs, {estimated:,} straight-line estimates)")
    return set(by_poi)  # poi ids that are inside at least one walkshed


def verify_walkshed_invariant(all_fcs, members):
    """Core invariant INV-001: every POI inside a 15-min walkshed lists >=1 station.

    `members` is the set of POI ids that fall inside some station's walkshed
    (from attach_stations). Any such POI with an empty/absent `stations` array
    is a violation. Raises SystemExit so a regression fails the build loudly.
    """
    violations = []
    for fc in all_fcs.values():
        for feat in fc["features"]:
            p = feat["properties"]
            if p["id"] in members and not p.get("stations"):
                violations.append(p.get("name", p["id"]))
    if violations:
        raise SystemExit(
            f"INVARIANT VIOLATED: {len(violations):,} in-walkshed POIs list no "
            f"station (e.g. {violations[:5]}). Every POI inside a walkshed must "
            f"list >=1 nearby station."
        )
    print(f"  Invariant OK: all {len(members):,} in-walkshed POIs list >=1 station")


def _first(seq, key):
    for m in seq:
        if m.get(key):
            return m[key]
    return None


def merge_cluster(members):
    """Collapse a cluster into one best-of-both feature. Returns (bucket, feature)."""
    osm = [m for m in members if m["source"] == "osm"]
    ovt = [m for m in members if m["source"] == "overture"]
    primary = osm[0] if osm else ovt[0]

    coord = primary["coord"]
    category = primary["category"]
    bucket = (OSM_VALUE_TO_BUCKET.get(osm[0]["category"]) if osm else None) \
        or (CATEGORY_TO_FILE.get(ovt[0]["category"]) if ovt else None) \
        or OSM_VALUE_TO_BUCKET.get(category) or BUCKETS[0]

    tags, seen = [], set()
    for m in members:
        for t in m.get("tags") or []:
            if t not in seen:
                seen.add(t)
                tags.append(t)

    props = {
        # Prefer the OSM integer id so the distance cache attaches stations.
        "id": osm[0]["id"] if osm else ovt[0]["id"],
        "name": primary["name"],
        "category": category,
        "tags": tags or [category],
        "sources": sorted({m["source"] for m in members}),
    }
    for key, val in (
        ("website", _first(ovt, "website") or _first(osm, "website")),
        ("phone", _first(ovt, "phone") or _first(osm, "phone")),
        ("address", _first(ovt, "address") or _first(osm, "address")),
        ("hours", _first(osm, "hours")),  # only OSM has hours
    ):
        if val:
            props[key] = val

    feature = {
        "type": "Feature",
        "properties": props,
        "geometry": {"type": "Point", "coordinates": [round(coord[0], 7), round(coord[1], 7)]},
    }
    return bucket, feature


# Spatial tile grid for runtime streaming. ~0.01 deg ≈ 1.1 km lat / ~0.75 km lon
# at 47.6N — small enough that a 15-min walkshed (~1.2 km radius) touches only a
# handful of tiles, so the app fetches a few small files instead of the whole set.
TILE_DEG = 0.01


def tile_key(lon, lat):
    """Grid cell (col,row) for a coordinate, as integer floor of lon/lat / TILE_DEG."""
    return (math.floor(lon / TILE_DEG), math.floor(lat / TILE_DEG))


def station_tile_keys(walkshed_fc, populated):
    """Tile keys a station's walkshed overlaps — its bbox cells, populated only.

    Precomputed per station so the runtime skips the bbox math; it still clips
    against the live isochrone, so this only needs to be a superset (the bbox of
    the committed walkshed). Uses the outermost (15-min) contour's extent.
    """
    lons, lats = [], []
    for f in walkshed_fc.get("features", []):
        for lon, lat in f["geometry"]["coordinates"][0]:
            lons.append(lon)
            lats.append(lat)
    if not lons:
        return []
    c0, c1 = math.floor(min(lons) / TILE_DEG), math.floor(max(lons) / TILE_DEG)
    r0, r1 = math.floor(min(lats) / TILE_DEG), math.floor(max(lats) / TILE_DEG)
    keys = [f"{c}_{r}" for c in range(c0, c1 + 1) for r in range(r0, r1 + 1)]
    return sorted(k for k in keys if k in populated)


def write_tiles(all_fcs, stations=None, walkshed_payload=None, dry_run=False):
    """Emit one combined GeoJSON per populated tile + a tiles/index.json.

    The app fetches only the tiles overlapping the active walkshed. index.json
    holds the grid params, the populated tile keys, and a precomputed
    `station_tiles` lookup (station key -> tile keys) so the runtime can map a
    station straight to its tiles without bbox math (it still clips against the
    live isochrone). `station_tiles` is omitted if the walkshed dump is absent.
    """
    tiles = {}
    for fc in all_fcs.values():
        for feat in fc["features"]:
            lon, lat = feat["geometry"]["coordinates"]
            tiles.setdefault(tile_key(lon, lat), []).append(feat)

    tiles_dir = os.path.join(OUTPUT_DIR, "tiles")
    populated = {f"{c}_{r}" for (c, r) in tiles}
    index = {
        "tile_deg": TILE_DEG,
        "count": sum(len(v) for v in tiles.values()),
        "tiles": sorted(populated),
    }
    if stations and walkshed_payload:
        walksheds = walkshed_payload["walksheds"]
        station_tiles = {}
        for s in stations:
            key = fetch_walksheds.station_key(s)
            fc = walksheds.get(key)
            if fc:
                station_tiles[key] = station_tile_keys(fc, populated)
        index["station_tiles"] = station_tiles
        print(f"  Station->tile lookup: {len(station_tiles)} stations, "
              f"avg {sum(len(v) for v in station_tiles.values()) / max(1, len(station_tiles)):.1f} tiles/station")
    total = index["count"]
    print(f"  Tiles: {len(tiles)} populated cells, {total:,} features "
          f"(avg {total / max(1, len(tiles)):.0f}/tile)")
    if dry_run:
        print("  [dry-run] tiles not written")
        return index

    os.makedirs(tiles_dir, exist_ok=True)
    for fname in os.listdir(tiles_dir):  # clear stale tiles from a prior grid
        if fname.endswith(".geojson"):
            os.remove(os.path.join(tiles_dir, fname))
    for (c, r), feats in tiles.items():
        with open(os.path.join(tiles_dir, f"{c}_{r}.geojson"), "w") as f:
            json.dump({"type": "FeatureCollection", "features": feats}, f)
    with open(os.path.join(tiles_dir, "index.json"), "w") as f:
        json.dump(index, f)
    print(f"  Wrote {len(tiles)} tiles + index.json to {tiles_dir}")
    return index


def main():
    ap = argparse.ArgumentParser(description="Conflate OSM + Overture into a refined dataset")
    ap.add_argument("--min-confidence", type=float, default=0.5)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    stations = load_station_index()
    bbox = compute_bbox(stations)

    print("Loading OSM records (committed dump)...")
    osm = get_osm_records()
    print(f"  {len(osm):,} OSM features")
    print(f"Querying Overture (confidence >= {args.min_confidence}, dropping closed)...")
    ovt = get_overture_records(bbox, args.min_confidence)
    print(f"  {len(ovt):,} Overture features")

    clusters = cluster(osm + ovt)
    all_fcs = {b: {"type": "FeatureCollection", "features": []} for b in BUCKETS}
    both = osm_only = ovt_only = 0
    for members in clusters:
        srcs = {m["source"] for m in members}
        both += srcs == {"osm", "overture"}
        osm_only += srcs == {"osm"}
        ovt_only += srcs == {"overture"}
        bucket, feat = merge_cluster(members)
        all_fcs[bucket]["features"].append(feat)

    total = sum(len(fc["features"]) for fc in all_fcs.values())
    collapsed = len(osm) + len(ovt) - len(clusters)
    print(f"\nRefined: {total:,} POIs (matched {both:,} | OSM-only {osm_only:,} | "
          f"Overture-only {ovt_only:,} | {collapsed:,} duplicates collapsed)")

    # Attach nearby-station stop info to every in-walkshed POI (cached Matrix
    # distance where available, straight-line estimate otherwise), then enforce
    # the core invariant: in-walkshed POI => lists >=1 station.
    members = attach_stations(all_fcs, stations)
    verify_walkshed_invariant(all_fcs, members)

    with_hours = sum(1 for fc in all_fcs.values() for f in fc["features"] if f["properties"].get("hours"))
    with_st = sum(1 for fc in all_fcs.values() for f in fc["features"] if f["properties"].get("stations"))
    print(f"  with hours: {with_hours:,} | with stations (cache hit): {with_st:,}")
    for b in BUCKETS:
        print(f"    {b:12} {len(all_fcs[b]['features']):>6}")

    write_tiles(all_fcs, stations=stations,
                walkshed_payload=fetch_walksheds.load_dump(), dry_run=args.dry_run)

    if args.dry_run:
        print("\n[dry-run] no files written")
        return

    # Tiles are the sole POI artifact; the app streams them per-walkshed. Remove
    # any legacy per-category files so they don't ship as dead weight.
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    for b in BUCKETS:
        legacy = os.path.join(OUTPUT_DIR, f"{b}.geojson")
        if os.path.exists(legacy):
            os.remove(legacy)
    write_tag_categories_manifest(all_fcs)
    print(f"\nWrote tiles/ + tag-categories.json to {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
