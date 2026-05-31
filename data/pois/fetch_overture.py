#!/usr/bin/env python3
"""Build POI GeoJSONs from the Overture Maps `places` theme (PROTOTYPE).

Drop-in alternative to the OSM/Overpass path in fetch_pois.py. Pulls Overture
places clipped to the station bbox via DuckDB-over-S3 (no full download), maps
Overture's category taxonomy onto the existing 8 Walksheds buckets + frontend
category vocabulary, and writes byte-compatible GeoJSON to public/pois/ plus
tag-categories.json.

Output keeps fetch_pois.py's core schema — id / name / category / tags[]
(+ optional address / website / phone) — and adds Overture-native fields
(email / socials[] / brand / confidence) plus a computed nearest-station
distance (nearest_station / station_m / station_walk_min). Overture has no
opening hours, so `hours` is omitted (see DATA_SOURCE_PROPOSAL.md §6).

Usage:
    python3 data/pois/fetch_overture.py            # build all buckets
    python3 data/pois/fetch_overture.py --dry-run  # build, don't write
    python3 data/pois/fetch_overture.py --min-confidence 0.6
"""
import argparse
import json
import math
import os

import duckdb

# Reuse the existing pipeline's tag plumbing so output stays byte-compatible.
from fetch_pois import (
    OUTPUT_DIR,
    TAG_ALIASES,
    _canonicalize,
    _normalize,
    build_tag_categories_manifest,
    build_tag_index,
    compute_bbox,
    load_main_category_ids,
    load_station_index,
)

RELEASE = "2026-04-15.0"
PLACES_GLOB = f"s3://overturemaps-us-west-2/release/{RELEASE}/theme=places/type=place/*"

# Which output file each frontend category lands in (mirrors POI_FILES + constants.js).
CATEGORY_TO_FILE = {
    "restaurant": "restaurants", "cafe": "restaurants", "bar": "restaurants",
    "fast_food": "restaurants", "pub": "restaurants", "bakery": "restaurants",
    "ice_cream": "restaurants",
    "museum": "attractions", "gallery": "attractions", "attraction": "attractions",
    "artwork": "attractions", "viewpoint": "attractions",
    "park": "parks", "playground": "parks", "garden": "parks",
    "hotel": "lodging", "hostel": "lodging", "motel": "lodging", "guest_house": "lodging",
    "supermarket": "shops", "convenience": "shops", "cannabis": "shops",
    "alcohol": "shops", "tobacco": "shops", "wine": "shops", "deli": "shops",
    "department_store": "shops", "variety_store": "shops", "books": "shops",
    "gift": "shops", "clothes": "shops", "shoes": "shops", "hardware": "shops",
    "electronics": "shops", "florist": "shops", "jewelry": "shops", "sports": "shops",
    "toys": "shops", "music": "shops", "art": "shops", "pet": "shops",
    "mobile_phone": "shops", "cosmetics": "shops", "furniture": "shops",
    "doityourself": "shops", "outdoor": "shops", "bicycle": "shops",
    "pharmacy": "healthcare", "hospital": "healthcare", "clinic": "healthcare",
    "library": "services", "bank": "services", "post_office": "services",
    "fitness_centre": "fitness", "sports_centre": "fitness", "swimming_pool": "fitness",
}

# Exact Overture leaf category → frontend category. Checked before the rules below.
EXACT_MAP = {
    # dining
    "coffee_shop": "cafe", "cafe": "cafe", "tea_room": "cafe", "coffee_roaster": "cafe",
    "internet_cafe": "cafe",
    "bar": "bar", "pub": "pub", "brewery": "bar", "brewpub": "bar", "beer_bar": "bar",
    "wine_bar": "bar", "sports_bar": "bar", "cocktail_bar": "bar", "dive_bar": "bar",
    "gay_bar": "bar", "hookah_bar": "bar", "beer_garden": "bar", "taproom": "bar",
    "bakery": "bakery", "patisserie": "bakery", "donut_shop": "bakery", "bagel_shop": "bakery",
    "ice_cream_parlor": "ice_cream", "frozen_yogurt_shop": "ice_cream", "gelato": "ice_cream",
    "fast_food_restaurant": "fast_food", "food_court": "fast_food", "food_stand": "fast_food",
    "food_truck": "fast_food", "restaurant": "restaurant", "juice_bar": "cafe",
    "smoothie_shop": "cafe", "tea_house": "cafe", "creperie": "restaurant",
    # attractions
    "art_gallery": "gallery", "museum": "museum", "art_museum": "museum",
    "history_museum": "museum", "science_museum": "museum", "childrens_museum": "museum",
    "landmark_and_historical_building": "attraction", "monument": "attraction",
    "tourist_attraction": "attraction", "tourist_information_center": "attraction",
    "public_art": "artwork", "sculpture": "artwork",
    "scenic_lookout_viewpoint": "viewpoint", "observation_deck": "viewpoint",
    # parks
    "park": "park", "national_park": "park", "state_park": "park", "dog_park": "park",
    "playground": "playground", "garden": "garden", "botanical_garden": "garden",
    "community_garden": "garden",
    # lodging
    "hotel": "hotel", "resort": "hotel", "boutique_hotel": "hotel",
    "hostel": "hostel", "motel": "motel", "bed_and_breakfast": "guest_house",
    "guest_house": "guest_house", "inn": "guest_house",
    # shops
    "grocery_store": "supermarket", "supermarket": "supermarket",
    "convenience_store": "convenience", "cannabis_store": "cannabis",
    "cannabis_dispensary": "cannabis", "cannabis_clinic": "cannabis",
    "liquor_store": "alcohol", "beer_wine_and_spirits_store": "alcohol",
    "tobacco_shop": "tobacco", "vape_shop": "tobacco", "wine_store": "wine",
    "winery": "wine", "deli": "deli", "delicatessen": "deli",
    "department_store": "department_store", "discount_store": "variety_store",
    "dollar_store": "variety_store", "bookstore": "books", "book_store": "books",
    "gift_shop": "gift", "souvenir_shop": "gift", "clothing_store": "clothes",
    "womens_clothing_store": "clothes", "mens_clothing_store": "clothes",
    "childrens_clothing_store": "clothes", "shoe_store": "shoes",
    "hardware_store": "hardware", "electronics_store": "electronics",
    "florist": "florist", "flower_shop": "florist", "jewelry_store": "jewelry",
    "sporting_goods_store": "sports", "toy_store": "toys", "music_store": "music",
    "record_store": "music", "art_supply_store": "art", "pet_store": "pet",
    "pet_supplies_store": "pet", "mobile_phone_store": "mobile_phone",
    "cell_phone_store": "mobile_phone", "cosmetics_store": "cosmetics",
    "beauty_supply_store": "cosmetics", "furniture_store": "furniture",
    "building_supply_store": "doityourself", "home_improvement_store": "doityourself",
    "outdoor_equipment_store": "outdoor", "bicycle_store": "bicycle", "bike_shop": "bicycle",
    # healthcare
    "pharmacy": "pharmacy", "drugstore": "pharmacy", "hospital": "hospital",
    "medical_center": "clinic", "clinic": "clinic", "urgent_care_center": "clinic",
    "walk_in_clinic": "clinic",
    # services
    "library": "library", "public_library": "library", "bank_credit_union": "bank",
    "bank": "bank", "post_office": "post_office",
    # fitness
    "gym": "fitness_centre", "fitness_center": "fitness_centre",
    "fitness_trainer": "fitness_centre", "yoga_studio": "fitness_centre",
    "pilates_studio": "fitness_centre", "martial_arts_school": "fitness_centre",
    "sports_club_and_league": "sports_centre", "recreation_center": "sports_centre",
    "swimming_pool": "swimming_pool",
}

# Generic tokens stripped when deriving cuisine/descriptor tags from a leaf name.
TAG_STOPWORDS = {
    "restaurant", "store", "shop", "parlor", "center", "centre", "and", "the",
    "of", "place", "services", "service",
}


def classify(primary):
    """Map an Overture primary category to a frontend category, or None to drop."""
    if not primary:
        return None
    if primary in EXACT_MAP:
        return EXACT_MAP[primary]
    # Suffix rule: every "<cuisine>_restaurant" is a sit-down restaurant.
    if primary.endswith("_restaurant"):
        return "restaurant"
    # A few descriptive food leaves Overture uses that aren't "_restaurant".
    if primary in {"diner", "steakhouse", "sandwich_shop", "buffet", "bistro",
                   "gastropub", "noodle_house", "ramen_restaurant"}:
        return "restaurant"
    return None


def derive_tags(primary, alternates, frontend_category):
    """Build the normalized tag list for a feature (cuisine, descriptor, type)."""
    raw = [frontend_category]
    # Cuisine prefix from "<cuisine>_restaurant".
    if primary.endswith("_restaurant"):
        raw.append(primary[: -len("_restaurant")])
    # Descriptive tokens from the primary leaf (e.g. coffee_shop → coffee).
    for tok in primary.split("_"):
        if tok and tok not in TAG_STOPWORDS:
            raw.append(tok)
    # Leaf tokens from alternate categories add breadth (e.g. vegan_restaurant).
    for alt in alternates or []:
        leaf = alt.split(".")[-1] if isinstance(alt, str) else ""
        if leaf.endswith("_restaurant"):
            raw.append(leaf[: -len("_restaurant")])

    out, seen = [], set()
    for value in raw:
        tag = _canonicalize(_normalize(value), TAG_ALIASES)
        if tag and tag not in seen:
            seen.add(tag)
            out.append(tag)
    return out or [frontend_category]


def fetch_rows(bbox, min_confidence):
    """Query Overture places within bbox. bbox is [south, west, north, east]."""
    south, west, north, east = bbox
    con = duckdb.connect()
    con.execute("INSTALL spatial; LOAD spatial; INSTALL httpfs; LOAD httpfs;")
    con.execute("SET s3_region='us-west-2';")
    print(f"Querying Overture {RELEASE} (confidence >= {min_confidence}) ...")
    return con.execute(f"""
        SELECT
            id,
            names.primary                  AS name,
            categories.primary             AS primary_cat,
            categories.alternate           AS alt_cats,
            confidence,
            ROUND(bbox.xmin, 7)            AS lon,
            ROUND(bbox.ymin, 7)            AS lat,
            list_extract(websites, 1)      AS website,
            list_extract(phones, 1)        AS phone,
            addresses[1].freeform          AS address,
            list_extract(emails, 1)        AS email,
            socials                        AS socials,
            brand.names.primary            AS brand
        FROM read_parquet('{PLACES_GLOB}')
        WHERE bbox.xmin BETWEEN {west} AND {east}
          AND bbox.ymin BETWEEN {south} AND {north}
          AND names.primary IS NOT NULL
          AND confidence >= {min_confidence}
    """).fetchall()


def haversine_m(lon1, lat1, lon2, lat2):
    """Great-circle distance in meters between two lon/lat points."""
    r = 6371000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dlmb/2)**2
    return 2 * r * math.asin(math.sqrt(a))


def nearest_station(lon, lat, stations):
    """Return (station_name, straight-line meters) for the closest station."""
    best_name, best_m = None, float("inf")
    for s in stations:
        d = haversine_m(lon, lat, s["lng"], s["lat"])
        if d < best_m:
            best_name, best_m = s["name"], d
    return best_name, round(best_m)


def build(rows, stations):
    """Group rows into per-file FeatureCollections. Returns (fcs, unmapped_counts)."""
    fcs = {}
    seen_ids = set()
    unmapped = {}
    for (oid, name, primary, alts, conf, lon, lat, website, phone, address,
         email, socials, brand) in rows:
        category = classify(primary)
        if category is None:
            unmapped[primary] = unmapped.get(primary, 0) + 1
            continue
        if oid in seen_ids:
            continue
        seen_ids.add(oid)

        props = {
            "id": oid,
            "name": name.strip(),
            "category": category,
            "tags": derive_tags(primary, alts, category),
        }
        if website:
            props["website"] = website
        if phone:
            props["phone"] = phone
        if address:
            props["address"] = address
        # Additional Overture-native fields.
        if email:
            props["email"] = email
        if socials:
            props["socials"] = list(socials)
        if brand:
            props["brand"] = brand
        if conf is not None:
            props["confidence"] = round(float(conf), 3)
        # Computed nearest-station distance ("distance data pipeline").
        st_name, st_m = nearest_station(lon, lat, stations)
        props["nearest_station"] = st_name
        props["station_m"] = st_m
        props["station_walk_min"] = max(1, round(st_m / 80))  # ~80 m/min walking

        feat = {
            "type": "Feature",
            "properties": props,
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
        }
        bucket = CATEGORY_TO_FILE[category]
        fcs.setdefault(bucket, {"type": "FeatureCollection", "features": []})
        fcs[bucket]["features"].append(feat)
    return fcs, unmapped


def write_outputs(fcs, dry_run):
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    for bucket, fc in sorted(fcs.items()):
        path = os.path.join(OUTPUT_DIR, f"{bucket}.geojson")
        if dry_run:
            print(f"  [dry-run] {bucket}.geojson ({len(fc['features'])} features)")
        else:
            with open(path, "w") as f:
                json.dump(fc, f)
            print(f"  Wrote {path} ({len(fc['features'])} features)")

    # tag-categories.json
    tag_index = build_tag_index()
    all_tags = set()
    for fc in fcs.values():
        for feat in fc["features"]:
            all_tags.update(feat["properties"]["tags"])
    manifest = build_tag_categories_manifest(
        all_tags, tag_index, load_main_category_ids()
    )
    path = os.path.join(OUTPUT_DIR, "tag-categories.json")
    if dry_run:
        print(f"  [dry-run] tag-categories.json ({len(all_tags)} tags)")
    else:
        with open(path, "w") as f:
            json.dump(manifest, f, indent=2, ensure_ascii=False)
        print(f"  Wrote {path}")
    print(f"  filter_schema hash: {manifest['filter_schema']['hash']} "
          f"({len(all_tags)} canonical tags)")


def main():
    ap = argparse.ArgumentParser(description="Build POI GeoJSONs from Overture Maps")
    ap.add_argument("--min-confidence", type=float, default=0.5)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    stations = load_station_index()
    bbox = compute_bbox(stations)
    print(f"Bounding box: {bbox}")

    rows = fetch_rows(bbox, args.min_confidence)
    print(f"  {len(rows):,} Overture places in bbox")

    fcs, unmapped = build(rows, stations)
    total = sum(len(fc["features"]) for fc in fcs.values())
    print(f"\nBuilt {total:,} features across {len(fcs)} buckets:")
    for bucket, fc in sorted(fcs.items()):
        print(f"  {bucket:14s} {len(fc['features']):>6}")

    dropped = sorted(unmapped.items(), key=lambda kv: -kv[1])
    print(f"\nDropped {sum(unmapped.values()):,} places in {len(unmapped)} "
          f"unmapped categories. Top 25 (refine EXACT_MAP/classify to capture):")
    for cat, n in dropped[:25]:
        print(f"  {n:>6}  {cat}")

    write_outputs(fcs, args.dry_run)


if __name__ == "__main__":
    main()
