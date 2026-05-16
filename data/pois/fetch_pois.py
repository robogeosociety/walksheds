#!/usr/bin/env python3
"""Build per-category POI GeoJSONs from a committed OpenStreetMap dump.

Two phases:
  1. Refresh raw dump (network): one Overpass query pulls every named node/way
     tagged with any of {amenity, tourism, leisure, shop} inside the station
     bbox, saved gzipped to data/pois/raw/osm-seattle.json.gz.
  2. Build (no network, default): reads the committed raw dump and filters it
     into one GeoJSON per CATEGORIES entry under public/pois/.

Adding a new POI category only requires editing CATEGORIES below and re-running
the default build — no network needed, as long as the tag keys are already in
the raw dump (amenity/tourism/leisure/shop).

Usage:
  python3 data/pois/fetch_pois.py                          # build all from raw dump
  python3 data/pois/fetch_pois.py --category restaurants   # build single category
  python3 data/pois/fetch_pois.py --refresh                # refetch raw dump, then build
  python3 data/pois/fetch_pois.py --validate-only          # validate existing GeoJSONs
  python3 data/pois/fetch_pois.py --dry-run                # build + validate, don't write
  python3 data/pois/fetch_pois.py --sample-station "Judkins Park"
"""

import argparse
import gzip
import hashlib
import json
import math
import os
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
import urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
STATION_INDEX = os.path.join(ROOT, "data", "station-index.json")
OUTPUT_DIR = os.path.join(ROOT, "public", "pois")
RAW_DUMP = os.path.join(ROOT, "data", "pois", "raw", "osm-seattle.json.gz")
MAIN_CATEGORIES_JSON = os.path.join(ROOT, "src", "mainCategories.json")

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
OVERPASS_TIMEOUT = 180

# Padding around station bounding box in degrees (~1.5km ≈ 0.014°)
BBOX_PAD = 0.014

# OSM tag keys covered by the raw dump. Any category must use one of these.
RAW_KEYS = ("amenity", "tourism", "leisure", "shop")

# Category definitions: name → (osm_key, osm_values)
CATEGORIES = {
    "restaurants": ("amenity", ["restaurant", "cafe", "bar", "fast_food", "pub", "ice_cream", "bakery"]),
    "attractions": ("tourism", ["museum", "gallery", "attraction", "artwork", "viewpoint"]),
    "parks": ("leisure", ["park", "playground", "garden"]),
    "lodging": ("tourism", ["hotel", "hostel", "motel", "guest_house"]),
    "shops": ("shop", [
        "supermarket", "convenience", "cannabis", "alcohol", "tobacco", "wine",
        "deli", "department_store", "variety_store", "books", "gift", "clothes",
        "shoes", "hardware", "electronics", "florist", "jewelry", "sports",
        "toys", "music", "art", "pet", "mobile_phone", "cosmetics", "furniture",
        "doityourself", "outdoor", "bicycle",
    ]),
    "healthcare": ("amenity", ["pharmacy", "hospital", "clinic"]),
    "services": ("amenity", ["library", "bank", "post_office"]),
    "fitness": ("leisure", ["fitness_centre", "sports_centre", "swimming_pool"]),
}

# Valid categories for output features
VALID_CATEGORIES = set()
for _key, values in CATEGORIES.values():
    VALID_CATEGORIES.update(values)


# Closure filter. OSM frequently lags reality, so the build script drops
# elements that announce defunctness in any of three ways:
#   1. The OSM id is in DENY_OSM_IDS (manual override for businesses we know
#      are closed but OSM hasn't been updated).
#   2. name / note / fixme contains a phrase from CLOSURE_PATTERNS.
# Lifecycle-prefixed entries (disused:shop=*, abandoned:*) are already
# excluded by the Overpass query — it matches the unprefixed key only.

DENY_OSM_IDS = {
    6246048863,  # "Dispensary of Seattle Leafb" — defunct; name reads like a Leafly truncation
}

CLOSURE_PATTERNS = [
    r"\(.*\bclosed\b.*\)",                            # name like "Bent Burger (Permanently Closed)"
    r"\bpermanently closed\b",
    r"\bout of business\b",
    r"\bno longer (open|in business|operating)\b",
    r"\bhas this business closed\b",                  # fixme question
    r"\bclosed due to\b",                             # "Closed due to fire 2023-..."
    r"\bclosed according to\b",                       # "Closed according to their website"
    r"\bclosed (in|since|on) \d",                     # "closed in 2017"
    r"\bclosed (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)",  # "Closed April 2017"
]
CLOSURE_RE = re.compile("|".join(CLOSURE_PATTERNS), re.IGNORECASE)
CLOSURE_FIELDS = ("name", "note", "fixme")


def is_closed_or_denied(element):
    """Return True if the element is on the deny list or matches a closure phrase.

    Checked fields are name / note / fixme — opening_hours is intentionally
    skipped because weekly schedules like 'Su closed' are almost always
    legitimate businesses.
    """
    if element.get("id") in DENY_OSM_IDS:
        return True
    tags = element.get("tags", {})
    for field in CLOSURE_FIELDS:
        value = tags.get(field, "")
        if value and CLOSURE_RE.search(value):
            return True
    return False


def load_station_index():
    """Load station index and return list of {name, lng, lat}."""
    with open(STATION_INDEX) as f:
        data = json.load(f)
    return data["stations"]


def compute_bbox(stations):
    """Compute bounding box [south, west, north, east] from stations, padded."""
    lats = [s["lat"] for s in stations]
    lngs = [s["lng"] for s in stations]
    return [
        min(lats) - BBOX_PAD,
        min(lngs) - BBOX_PAD,
        max(lats) + BBOX_PAD,
        max(lngs) + BBOX_PAD,
    ]


def build_raw_query(bbox, keys=RAW_KEYS):
    """Build a single Overpass query covering every named node/way with any of the given tag keys."""
    bbox_str = f"{bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]}"
    clauses = []
    for key in keys:
        clauses.append(f'  node["{key}"]["name"~"."]({bbox_str});')
        clauses.append(f'  way["{key}"]["name"~"."]({bbox_str});')
    return (
        f"[out:json][timeout:{OVERPASS_TIMEOUT}];\n"
        f"(\n" + "\n".join(clauses) + "\n);\n"
        f"out center tags;"
    )


def fetch_overpass(query):
    """Send a query to the Overpass API and return the JSON response."""
    data = urllib.parse.urlencode({"data": query}).encode("utf-8")
    req = urllib.request.Request(OVERPASS_URL, data=data, method="POST")
    req.add_header("User-Agent", "walksheds-poi-fetcher/1.0")

    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=OVERPASS_TIMEOUT + 30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
            if attempt < 2:
                wait = 2 ** (attempt + 1)
                print(f"  Retry in {wait}s after error: {e}")
                time.sleep(wait)
            else:
                raise


def refresh_raw_dump(bbox, out_path=RAW_DUMP, dry_run=False):
    """Fetch the Overpass superset for the bbox and write it gzipped to out_path."""
    query = build_raw_query(bbox)
    print("Refreshing raw OSM dump from Overpass...")
    print(f"  Keys: {', '.join(RAW_KEYS)}")
    print(f"  Bbox: {bbox}")

    result = fetch_overpass(query)
    elements = result.get("elements", [])
    print(f"  → {len(elements):,} elements")

    if dry_run:
        print("  [dry-run] Skipping write")
        return result

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    compact = json.dumps(result, separators=(",", ":")).encode("utf-8")
    with gzip.open(out_path, "wb", compresslevel=9) as f:
        f.write(compact)
    print(f"  Wrote {out_path} ({os.path.getsize(out_path):,} bytes gzipped)")
    return result


def load_raw_dump(path=RAW_DUMP):
    """Load the committed gzipped raw Overpass dump."""
    if not os.path.exists(path):
        raise FileNotFoundError(
            f"Raw dump not found at {path}. "
            f"Run `python3 data/pois/fetch_pois.py --refresh` to fetch it from Overpass."
        )
    with gzip.open(path, "rb") as f:
        return json.loads(f.read().decode("utf-8"))


def filter_elements(elements, osm_key, osm_values):
    """Filter raw Overpass elements to those matching osm_key in osm_values."""
    wanted = set(osm_values)
    return [el for el in elements if el.get("tags", {}).get(osm_key) in wanted]


# Boolean fields whose presence (with one of the accepted values) emits a tag.
# Tag name is the published string; multiple OSM fields can map to the same tag
# (e.g. drink:wine and wine both → "wine").
BOOL_TAG_FIELDS = {
    # Service style
    "outdoor_seating":  ("outdoor-seating",       {"yes"}),
    "indoor_seating":   ("indoor-seating",        {"yes"}),
    "takeaway":         ("takeaway",              {"yes", "only"}),
    "delivery":         ("delivery",              {"yes"}),
    "drive_through":    ("drive-through",         {"yes"}),
    "self_service":     ("self-service",          {"yes"}),
    "reservation":      ("reservations",          {"yes", "required", "recommended"}),

    # Accessibility
    "wheelchair":       ("wheelchair-accessible", {"yes"}),

    # Diet
    "diet:vegetarian":  ("vegetarian",   {"yes", "only"}),
    "diet:vegan":       ("vegan",        {"yes", "only"}),
    "diet:gluten_free": ("gluten-free",  {"yes", "only"}),
    "diet:halal":       ("halal",        {"yes", "only"}),
    "diet:kosher":      ("kosher",       {"yes", "only"}),
    "diet:dairy_free":  ("dairy-free",   {"yes", "only"}),

    # Family / pets
    "kids_area":        ("child-friendly", {"yes"}),
    "highchair":        ("child-friendly", {"yes", "available"}),
    "dog":              ("dog-friendly",   {"yes", "leashed", "unleashed", "outside"}),
    "dogs":             ("dog-friendly",   {"yes", "leashed", "unleashed", "outside"}),

    # Drinks
    "bar":              ("has-bar",   {"yes"}),
    "wine":             ("wine",      {"yes"}),
    "beer":             ("beer",      {"yes"}),
    "cocktails":        ("cocktails", {"yes"}),
    "coffee":           ("coffee",    {"yes"}),
    "tea":              ("tea",       {"yes"}),
    "drink:wine":       ("wine",      {"yes"}),
    "drink:beer":       ("beer",      {"yes"}),
    "drink:cocktail":   ("cocktails", {"yes"}),
    "drink:cocktails":  ("cocktails", {"yes"}),
    "drink:coffee":     ("coffee",    {"yes"}),
    "drink:tea":        ("tea",       {"yes"}),
    "microbrewery":     ("microbrew", {"yes"}),
    "brewery":          ("brewery",   {"yes"}),

    # Meal periods
    "breakfast":        ("breakfast", {"yes"}),
    "brunch":           ("brunch",    {"yes"}),
    "lunch":            ("lunch",     {"yes"}),
    "dinner":           ("dinner",    {"yes"}),

    # Vibes
    "live_music":       ("live-music",      {"yes"}),
    "karaoke":          ("karaoke",         {"yes"}),
    "smoking":          ("smoking",         {"yes", "outside", "separated", "dedicated", "isolated"}),
    "air_conditioning": ("air-conditioned", {"yes"}),
    "internet_access":  ("wifi",            {"yes", "wlan", "wifi"}),

    # Shopping
    "organic":          ("organic",     {"yes", "only"}),
    "second_hand":      ("second-hand", {"yes", "only"}),

    # Healthcare
    "emergency":        ("emergency", {"yes"}),

    # Lodging amenities
    "swimming_pool":    ("pool", {"yes"}),
    "spa":              ("spa",  {"yes"}),
    "gym":              ("gym",  {"yes"}),
}

# Semicolon-delimited fields where each value becomes its own normalized tag.
MULTI_VALUE_FIELDS = ("cuisine", "sport")

# Fields whose value itself becomes a normalized tag (e.g. craft=brewery → "brewery").
VALUE_AS_TAG_FIELDS = ("craft",)

# Synonyms / typos / romanization variants → canonical tag.
# Applied AFTER _normalize, so keys must already be in lowercase-hyphen form.
# Set normalize=False at extraction time to skip this step.
TAG_ALIASES = {
    # Singular ↔ plural — keep the dominant variant
    "noodle":         "noodles",
    "dumpling":       "dumplings",
    "cookie":         "cookies",
    "gyro":           "gyros",
    "chicken-wings":  "wings",

    # Romanization / variant spellings
    "kabob":          "kebab",
    "szechuan":       "sichuan",
    "dimsum":         "dim-sum",
    "bengalurean":    "bangalorean",
    "hot-pot":        "hotpot",
    "boba":           "bubble-tea",
    "boba-tea":       "bubble-tea",

    # Compound → general (improves filter usefulness)
    "sushi-restaurant": "sushi",
    "italian-pizza":    "pizza",

    # Region grouping (conservative — only obvious overlaps)
    "arab":            "arabic",
    "latin":           "latin-american",
    "latino":          "latin-american",
    "oriental":        "asian",

    # Typos
    "marshal-arts":  "martial-arts",
    "guros":         "gyros",
    "desert":        "dessert",
}

# Tag → category bucket assignment, with a color per category. Categories drive
# the legend chip coloring and the small color key shown in the legend.
# Anything not enumerated below falls through to DEFAULT_TAG_CATEGORY ("cuisine").
EXPLICIT_TAG_CATEGORIES = {
    "type": {
        "label": "Type",
        "color": "#7F8C8D",
        "tags": [
            "restaurant", "cafe", "bar", "fast-food", "pub", "bakery", "ice-cream",
            "museum", "gallery", "attraction", "artwork", "viewpoint",
            "park", "playground", "garden",
            "hotel", "hostel", "motel", "guest-house",
            "supermarket", "convenience", "cannabis", "alcohol", "tobacco",
            "deli", "department-store", "variety-store", "books", "gift",
            "clothes", "shoes", "hardware", "electronics", "florist", "jewelry",
            "sports", "toys", "music", "art", "pet", "mobile-phone", "cosmetics",
            "furniture", "doityourself", "outdoor", "bicycle",
            "pharmacy", "hospital", "clinic",
            "library", "bank", "post-office",
            "fitness-centre", "sports-centre", "swimming-pool",
        ],
    },
    "service": {
        "label": "Service",
        "color": "#3498DB",
        "tags": [
            "takeaway", "delivery", "drive-through", "self-service",
            "reservations", "indoor-seating", "outdoor-seating",
        ],
    },
    "diet": {
        "label": "Diet",
        "color": "#27AE60",
        "tags": [
            "vegetarian", "vegan", "gluten-free", "halal", "kosher",
            "dairy-free", "organic",
        ],
    },
    "drinks": {
        "label": "Drinks",
        "color": "#9B59B6",
        "tags": [
            "coffee", "coffee-shop", "tea", "bubble-tea", "wine", "beer",
            "cocktails", "has-bar", "microbrew", "brewery", "winery",
            "distillery", "juice", "smoothie", "chai", "milkshake",
            "cider", "drinks", "seltzer", "craft-beer",
        ],
    },
    "meal": {
        "label": "Meal",
        "color": "#F39C12",
        "tags": [
            "breakfast", "brunch", "lunch", "dinner",
            "dessert", "snack", "appetizers",
        ],
    },
    "accessibility": {
        "label": "Access",
        "color": "#16A085",
        "tags": ["wheelchair-accessible"],
    },
    "family": {
        "label": "Family",
        "color": "#E91E63",
        "tags": ["child-friendly", "dog-friendly"],
    },
    "vibe": {
        "label": "Vibe",
        "color": "#34495E",
        "tags": ["wifi", "live-music", "karaoke", "smoking", "air-conditioned"],
    },
    "lodging": {
        "label": "Lodging",
        "color": "#2980B9",
        "tags": [
            "pool", "spa", "gym",
            "1-star", "2-star", "3-star", "4-star", "5-star",
        ],
    },
    "healthcare": {
        "label": "Healthcare",
        "color": "#E74C3C",
        "tags": ["emergency"],
    },
    "sport": {
        "label": "Sport",
        "color": "#2ECC71",
        "tags": [
            "swimming", "tennis", "basketball", "soccer", "yoga", "pilates",
            "barre", "boxing", "climbing", "cycling", "weightlifting",
            "crossfit", "pickleball", "volleyball", "beachvolleyball",
            "gymnastics", "martial-arts", "taekwondo", "table-tennis",
            "american-football", "football", "baseball", "golf", "rowing",
            "indoor-rowing", "indoor-skydiving", "ice-hockey", "ice-skating",
            "axe-throwing", "cheer", "exercise", "kickboxing", "krav-maga",
            "racquet", "motor", "kart", "karting", "horse-racing",
            "laser-tag", "bootcamp", "trx", "hiit",
            "high-intensity-interval-training", "total-resistance-exercises",
            "olympic-weightlifting", "strength-training", "athletics",
            "track", "fitness", "multi", "all", "virtual",
            "photographic-laboratory", "darts", "billiards", "archery",
            "shooting", "skateboard", "wading", "cricket", "boules", "petanque",
        ],
    },
    "shop": {
        "label": "Shop",
        "color": "#1ABC9C",
        "tags": ["second-hand"],
    },
}

DEFAULT_TAG_CATEGORY = "cuisine"
DEFAULT_CATEGORY_DEF = {"label": "Cuisine", "color": "#E67E22"}


def build_tag_index():
    """Build the tag → category lookup. Errors if a tag is in two explicit buckets."""
    index = {}
    for cat_id, cat in EXPLICIT_TAG_CATEGORIES.items():
        for tag in cat["tags"]:
            if tag in index:
                raise ValueError(
                    f"Tag '{tag}' assigned to both '{index[tag]}' and '{cat_id}'"
                )
            index[tag] = cat_id
    return index


def categorize_tag(tag, tag_index):
    """Return the category id for a tag, defaulting when unmapped."""
    return tag_index.get(tag, DEFAULT_TAG_CATEGORY)


def load_main_category_ids():
    """Read the canonical ordered list of main POI category ids shared with the frontend."""
    with open(MAIN_CATEGORIES_JSON) as f:
        return list(json.load(f))


def build_filter_schema(main_category_ids, sorted_tags):
    """Build the filter_schema block: an ordered fingerprint of POI filter dimensions.

    The 8-char hash lets the frontend detect URLs generated against a different
    schema (e.g. tags added/removed by --refresh). Decoding stays best-effort by
    name, so the hash is a signal — not a decoder key.
    """
    main_list = list(main_category_ids)
    tag_list = list(sorted_tags)
    payload = {"v": 1, "main": main_list, "tags": tag_list}
    blob = json.dumps(payload, separators=(",", ":"))
    digest = hashlib.sha256(blob.encode("utf-8")).hexdigest()[:8]
    return {"hash": digest, "main_categories": main_list, "tags": tag_list}


def build_tag_categories_manifest(all_tags, tag_index, main_category_ids=None):
    """Build the public/pois/tag-categories.json payload for the given tag set."""
    used = set()
    tag_to_category = {}
    for tag in all_tags:
        cat_id = categorize_tag(tag, tag_index)
        tag_to_category[tag] = cat_id
        used.add(cat_id)

    categories = {}
    for cat_id in sorted(used):
        if cat_id == DEFAULT_TAG_CATEGORY:
            categories[cat_id] = dict(DEFAULT_CATEGORY_DEF)
        else:
            cat = EXPLICIT_TAG_CATEGORIES[cat_id]
            categories[cat_id] = {"label": cat["label"], "color": cat["color"]}

    sorted_tag_to_category = dict(sorted(tag_to_category.items()))
    manifest = {
        "filter_schema": build_filter_schema(
            main_category_ids if main_category_ids is not None else load_main_category_ids(),
            sorted_tag_to_category.keys(),
        ),
        "categories": categories,
        "tag_to_category": sorted_tag_to_category,
    }
    return manifest


def _normalize(value):
    """Lowercase, ASCII-fold (drop diacritics), and convert spaces/underscores to hyphens."""
    if not value:
        return ""
    s = value.strip().lower()
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return s.replace("_", "-").replace(" ", "-")


def _canonicalize(tag, aliases=None):
    """Resolve a tag through the alias map (one hop). Returns the input if not aliased."""
    if aliases is None:
        return tag
    return aliases.get(tag, tag)


def extract_tags(osm_tags, osm_key, normalize=True):
    """Extract searchable tags from an OSM tag dict.

    Tag sources:
      - Primary category value (e.g. amenity=restaurant → "restaurant")
      - Multi-value fields (cuisine, sport) split on ';'
      - Value-as-tag fields (craft)
      - Boolean fields in BOOL_TAG_FIELDS with accepted values
      - Star rating (1-5)

    When normalize=True (default), every tag is lowercased + ASCII-folded +
    space/underscore-hyphenated, then resolved through TAG_ALIASES.
    Pass normalize=False to emit raw tags (debugging / regression checks).
    """
    aliases = TAG_ALIASES if normalize else None

    raw = []

    primary = osm_tags.get(osm_key, "")
    if primary:
        raw.append(_normalize(primary) if normalize else primary)

    for field in MULTI_VALUE_FIELDS:
        for piece in osm_tags.get(field, "").split(";"):
            value = _normalize(piece) if normalize else piece.strip()
            if value:
                raw.append(value)

    for field in VALUE_AS_TAG_FIELDS:
        value = osm_tags.get(field, "")
        value = _normalize(value) if normalize else value.strip()
        if value:
            raw.append(value)

    for field, (tag_name, accepted) in BOOL_TAG_FIELDS.items():
        if osm_tags.get(field) in accepted:
            raw.append(tag_name)

    stars = osm_tags.get("stars", "")
    if stars in ("1", "2", "3", "4", "5"):
        raw.append(f"{stars}-star")

    seen = set()
    unique = []
    for t in raw:
        canonical = _canonicalize(t, aliases) if normalize else t
        if canonical and canonical not in seen:
            seen.add(canonical)
            unique.append(canonical)

    return unique


def format_address(osm_tags):
    """Build a single-line street address from addr:* tags, or return None."""
    house = osm_tags.get("addr:housenumber", "").strip()
    street = osm_tags.get("addr:street", "").strip()
    if house and street:
        return f"{house} {street}"
    if street:
        return street
    return None


def normalize_element(element, osm_key, normalize=True):
    """Convert an Overpass element to a GeoJSON Feature."""
    tags = element.get("tags", {})
    name = tags.get("name", "").strip()
    if not name:
        return None

    # Get coordinates — for ways, use center point
    if element["type"] == "node":
        lng, lat = element["lon"], element["lat"]
    elif "center" in element:
        lng, lat = element["center"]["lon"], element["center"]["lat"]
    else:
        return None

    category = tags.get(osm_key, "")
    extracted_tags = extract_tags(tags, osm_key, normalize=normalize)
    if not extracted_tags:
        extracted_tags = [category] if category else ["other"]

    props = {
        "id": element["id"],
        "name": name,
        "category": category,
        "tags": extracted_tags,
    }

    # Optional metadata
    if tags.get("website"):
        props["website"] = tags["website"]
    elif tags.get("contact:website"):
        props["website"] = tags["contact:website"]
    if tags.get("phone"):
        props["phone"] = tags["phone"]
    elif tags.get("contact:phone"):
        props["phone"] = tags["contact:phone"]
    if tags.get("opening_hours"):
        props["hours"] = tags["opening_hours"]
    address = format_address(tags)
    if address:
        props["address"] = address

    return {
        "type": "Feature",
        "properties": props,
        "geometry": {"type": "Point", "coordinates": [round(lng, 7), round(lat, 7)]},
    }


def build_category(elements, category_name, normalize=True):
    """Build a GeoJSON FeatureCollection for a category from raw Overpass elements."""
    osm_key, osm_values = CATEGORIES[category_name]
    if osm_key not in RAW_KEYS:
        raise ValueError(
            f"Category {category_name} uses osm_key '{osm_key}' which is not in the raw dump "
            f"(keys: {RAW_KEYS}). Add it to RAW_KEYS and re-run with --refresh."
        )

    matched = filter_elements(elements, osm_key, osm_values)
    print(f"  {category_name}: {len(matched)} raw elements match {osm_key} in {osm_values}")

    kept = [el for el in matched if not is_closed_or_denied(el)]
    dropped = len(matched) - len(kept)
    if dropped:
        print(f"    dropped {dropped} via closure filter / deny list")

    features = []
    seen_ids = set()
    for el in kept:
        feat = normalize_element(el, osm_key, normalize=normalize)
        if feat and feat["properties"]["id"] not in seen_ids:
            seen_ids.add(feat["properties"]["id"])
            features.append(feat)

    print(f"  → {len(features)} named features after normalization")
    return {"type": "FeatureCollection", "features": features}


def collect_tag_provenance(elements, normalize=True):
    """For every (raw OSM tag value → canonical tag) mapping seen in the elements,
    return canonical → set of raw forms that collapsed into it.

    Used by the compression report to surface which canonical tags absorbed
    multiple raw variants. Only user-input fields participate (primary,
    cuisine, sport, craft) — boolean/star tags are deterministic.
    """
    provenance = {}

    def record(raw_value):
        raw_value = (raw_value or "").strip()
        if not raw_value:
            return
        canonical = (
            _canonicalize(_normalize(raw_value), TAG_ALIASES) if normalize
            else raw_value
        )
        if not canonical:
            return
        provenance.setdefault(canonical, set()).add(raw_value)

    user_input_categories = {osm_key for osm_key, _ in CATEGORIES.values()}
    for el in elements:
        tags = el.get("tags", {})
        for osm_key in user_input_categories:
            if osm_key in tags:
                record(tags[osm_key])
        for field in MULTI_VALUE_FIELDS:
            for piece in tags.get(field, "").split(";"):
                record(piece)
        for field in VALUE_AS_TAG_FIELDS:
            record(tags.get(field, ""))

    return provenance


def validate_geojson(fc, category_name, bbox):
    """Validate a POI FeatureCollection. Returns list of error strings."""
    errors = []
    if fc.get("type") != "FeatureCollection":
        errors.append(f"{category_name}: not a FeatureCollection")
        return errors

    features = fc.get("features", [])
    if len(features) < 10:
        errors.append(f"{category_name}: only {len(features)} features (expected >= 10)")

    ids = set()
    for i, f in enumerate(features):
        props = f.get("properties", {})
        coords = f.get("geometry", {}).get("coordinates")

        if not props.get("name"):
            errors.append(f"{category_name}[{i}]: missing name")
        if props.get("category") not in VALID_CATEGORIES:
            errors.append(f"{category_name}[{i}]: invalid category '{props.get('category')}'")
        if not isinstance(props.get("tags"), list) or len(props.get("tags", [])) == 0:
            errors.append(f"{category_name}[{i}]: missing or empty tags")

        if coords:
            lng, lat = coords
            if not (bbox[1] - 0.01 <= lng <= bbox[3] + 0.01 and bbox[0] - 0.01 <= lat <= bbox[2] + 0.01):
                errors.append(f"{category_name}[{i}]: coordinates ({lng}, {lat}) outside bbox")

        eid = props.get("id")
        if eid in ids:
            errors.append(f"{category_name}[{i}]: duplicate id {eid}")
        ids.add(eid)

    return errors


def haversine_dist(lng1, lat1, lng2, lat2):
    """Distance in meters between two points."""
    R = 6371000
    rlat1, rlat2 = math.radians(lat1), math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(rlat1) * math.cos(rlat2) * math.sin(dlng / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def sample_near_station(all_fcs, station_name, stations, radius=1200):
    """Print POI features within radius meters of a station."""
    station = None
    for s in stations:
        if station_name.lower() in s["name"].lower():
            station = s
            break

    if not station:
        print(f"\nStation '{station_name}' not found.")
        return

    print(f"\n{'=' * 60}")
    print(f"Sample: {station['name']} (lng={station['lng']}, lat={station['lat']})")
    print(f"Radius: {radius}m")
    print(f"{'=' * 60}")

    total = 0
    for cat_name, fc in all_fcs.items():
        nearby = []
        for f in fc["features"]:
            lng, lat = f["geometry"]["coordinates"]
            d = haversine_dist(station["lng"], station["lat"], lng, lat)
            if d <= radius:
                nearby.append((d, f))
        nearby.sort(key=lambda x: x[0])

        print(f"\n  {cat_name}: {len(nearby)} features within {radius}m")
        for dist, f in nearby:
            p = f["properties"]
            tags_str = ", ".join(p["tags"])
            extra = []
            if p.get("website"):
                extra.append(f"web: {p['website']}")
            if p.get("hours"):
                extra.append(f"hours: {p['hours']}")
            extra_str = f"  [{'; '.join(extra)}]" if extra else ""
            print(f"    {dist:6.0f}m  {p['name']:<40s}  [{tags_str}]{extra_str}")
        total += len(nearby)

    # Tag distribution
    all_tags = {}
    for fc in all_fcs.values():
        for f in fc["features"]:
            lng, lat = f["geometry"]["coordinates"]
            if haversine_dist(station["lng"], station["lat"], lng, lat) <= radius:
                for t in f["properties"].get("tags", []):
                    all_tags[t] = all_tags.get(t, 0) + 1

    print(f"\n  Tag distribution ({len(all_tags)} unique tags):")
    for tag, count in sorted(all_tags.items(), key=lambda x: -x[1])[:20]:
        print(f"    {tag:<30s}  {count}")

    print(f"\n  Total nearby: {total}")


def write_tag_categories_manifest(all_fcs, dry_run=False):
    """Build and write the tag-categories.json manifest from the published GeoJSONs."""
    tag_index = build_tag_index()
    all_tags = set()
    for fc in all_fcs.values():
        for feature in fc["features"]:
            for tag in feature["properties"].get("tags", []):
                all_tags.add(tag)

    manifest = build_tag_categories_manifest(all_tags, tag_index)
    path = os.path.join(OUTPUT_DIR, "tag-categories.json")
    schema = manifest["filter_schema"]
    if dry_run:
        print(f"  [dry-run] Would write {path}")
    else:
        with open(path, "w") as f:
            json.dump(manifest, f, indent=2, ensure_ascii=False)
        print(f"  Wrote {path}")
    print(f"  filter_schema hash: {schema['hash']} ({len(schema['main_categories'])} main + {len(schema['tags'])} tags)")

    by_category = {}
    for tag, cat_id in manifest["tag_to_category"].items():
        by_category.setdefault(cat_id, []).append(tag)
    print(f"\n  Tag categories: {len(manifest['categories'])} buckets, {len(all_tags)} canonical tags")
    for cat_id in sorted(by_category):
        members = by_category[cat_id]
        sample = ", ".join(members[:6])
        suffix = f" ... +{len(members)-6} more" if len(members) > 6 else ""
        print(f"    {cat_id:<14s} {len(members):>3d} tags  ({sample}{suffix})")


def print_compression_report(elements, normalize):
    """Show how normalization compressed the published tag vocabulary.

    Walks only the elements that survive a CATEGORIES filter (the ones that
    actually become features in the published geojsons), then compares the
    unique tag set with normalization on vs off.
    """
    if not normalize:
        print("\nNormalization: DISABLED — skipping compression report")
        return

    matched_set = set()
    for category_name in CATEGORIES:
        osm_key, osm_values = CATEGORIES[category_name]
        for el in filter_elements(elements, osm_key, osm_values):
            matched_set.add((el["type"], el["id"], osm_key))
    by_id = {(el["type"], el["id"]): el for el in elements}

    raw_published = set()
    canon_published = set()
    for (etype, eid, osm_key) in matched_set:
        el = by_id.get((etype, eid))
        if not el:
            continue
        tags = el.get("tags", {})
        for t in extract_tags(tags, osm_key, normalize=False):
            raw_published.add(t)
        for t in extract_tags(tags, osm_key, normalize=True):
            canon_published.add(t)

    matched_elements = [by_id[(t, i)] for (t, i, _) in matched_set if (t, i) in by_id]
    canon_provenance = collect_tag_provenance(matched_elements, normalize=True)

    raw_count = len(raw_published)
    canon_count = len(canon_published)
    collapsed = raw_count - canon_count
    pct = 100 * collapsed / max(raw_count, 1)

    print("\nCompression report (normalization=on, published tags only):")
    print(f"  Distinct tags BEFORE normalization:  {raw_count}")
    print(f"  Distinct tags AFTER normalization:   {canon_count}")
    print(f"  Collapsed:                           {collapsed} ({pct:.1f}%)")

    multis = [(c, raws) for c, raws in canon_provenance.items() if len(raws) > 1]
    multis.sort(key=lambda kv: (-len(kv[1]), kv[0]))
    if multis:
        print(f"\n  Canonical tags absorbing 2+ raw variants ({len(multis)}):")
        for canon, raws in multis[:20]:
            shown = ", ".join(sorted(raws))
            print(f"    {canon:<22s} ← {shown}")
        if len(multis) > 20:
            print(f"    ... +{len(multis) - 20} more")


def main():
    parser = argparse.ArgumentParser(description="Build POI GeoJSONs from committed OSM dump")
    parser.add_argument("--category", choices=list(CATEGORIES.keys()), help="Build single category")
    parser.add_argument("--refresh", action="store_true",
                        help="Refetch raw OSM dump from Overpass before building")
    parser.add_argument("--validate-only", action="store_true", help="Validate existing files only")
    parser.add_argument("--dry-run", action="store_true", help="Build + validate, don't write")
    parser.add_argument("--sample-station", type=str, help="Print sample around a station")
    parser.add_argument("--no-normalize", action="store_true",
                        help="Skip the optional tag normalization step (lowercase + ASCII-fold + alias resolution)")
    args = parser.parse_args()
    normalize = not args.no_normalize

    stations = load_station_index()
    bbox = compute_bbox(stations)
    print(f"Bounding box: {bbox}")
    print(f"Stations: {len(stations)}")

    categories_to_build = [args.category] if args.category else list(CATEGORIES.keys())
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    all_fcs = {}

    if args.validate_only:
        print("\nValidating existing files...")
        all_errors = []
        for cat in categories_to_build:
            path = os.path.join(OUTPUT_DIR, f"{cat}.geojson")
            if not os.path.exists(path):
                all_errors.append(f"{cat}: file not found at {path}")
                continue
            with open(path) as f:
                fc = json.load(f)
            all_fcs[cat] = fc
            errors = validate_geojson(fc, cat, bbox)
            all_errors.extend(errors)
            print(f"  {cat}: {len(fc['features'])} features, {len(errors)} errors")

        if all_errors:
            print(f"\nValidation failed with {len(all_errors)} error(s):")
            for e in all_errors:
                print(f"  - {e}")
            sys.exit(1)
        else:
            print("\nAll files valid.")
    else:
        if args.refresh:
            refresh_raw_dump(bbox, dry_run=args.dry_run)

        print("\nLoading raw dump...")
        raw = load_raw_dump()
        elements = raw.get("elements", [])
        print(f"  {len(elements):,} elements in dump")

        print(f"\nBuilding categories... (normalize={'on' if normalize else 'off'})")
        all_errors = []
        for cat in categories_to_build:
            fc = build_category(elements, cat, normalize=normalize)
            all_fcs[cat] = fc
            errors = validate_geojson(fc, cat, bbox)
            all_errors.extend(errors)

            if errors:
                print(f"  Validation warnings for {cat}:")
                for e in errors:
                    print(f"    - {e}")

            if not args.dry_run:
                path = os.path.join(OUTPUT_DIR, f"{cat}.geojson")
                with open(path, "w") as f:
                    json.dump(fc, f)
                print(f"  Wrote {path} ({len(fc['features'])} features)")
            else:
                print(f"  [dry-run] Would write {cat}.geojson ({len(fc['features'])} features)")

        if all_errors:
            print(f"\n{len(all_errors)} validation warning(s) (see above)")

        write_tag_categories_manifest(all_fcs, dry_run=args.dry_run)
        print_compression_report(elements, normalize)

    # Summary
    print("\nSummary:")
    for cat, fc in all_fcs.items():
        print(f"  {cat}: {len(fc['features'])} features")

    # Sample station output
    if args.sample_station:
        sample_near_station(all_fcs, args.sample_station, stations)


if __name__ == "__main__":
    main()
