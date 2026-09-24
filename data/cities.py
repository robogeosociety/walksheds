"""City registry — the single source of truth for every city Walksheds covers.

Every data script reads its paths, its rail lines and its map framing from here
rather than hardcoding Seattle. The frontend reads the same registry: `export()`
below writes `src/cityRegistry.json`, which `src/cities.js` imports, and
INV-024 checks the committed JSON still matches this module.

Adding a city:
  1. Append a `City(...)` to `CITIES` with its lines, framing and capabilities.
  2. Add a processor module `data/processors/<slug>.py` exposing `build(city)`.
  3. Run `python3 data/process.py --city <slug>` and `python3 data/cities.py`.

Layout each city owns:
  data/cities/<slug>/raw/            raw upstream dumps (committed)
  data/cities/<slug>/raw/pois/       OSM / Mapbox dumps (committed, gzipped)
  data/cities/<slug>/station-index.json
  public/cities/<slug>/              everything the browser fetches
"""

import json
from dataclasses import dataclass, field, replace
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Capabilities a city's dataset can have. The frontend hides the chrome for any
# capability a city lacks, so a city can ship rail-only and gain walksheds later
# without the UI promising data that isn't there.
CAP_WALKSHEDS = "walksheds"  # Mapbox Isochrone polygons per station
CAP_POIS = "pois"            # POI tile grid (requires walksheds — membership is
                             # defined by the isochrones)
CAP_EXITS = "exits"          # OSM station entrance/exit points

ALL_CAPABILITIES = (CAP_WALKSHEDS, CAP_POIS, CAP_EXITS)


@dataclass(frozen=True)
class Line:
    """One rail line within a city."""

    id: str        # stable layer/route id, e.g. '1-line'
    key: str       # the token that appears in a station's `lines` property, e.g. '1'
    label: str     # human name, e.g. '1 Line', 'Skyline'
    glyph: str     # what the station roundel prints, e.g. '1', 'S'
    color: str     # line color in light mode
    color_dark: str  # line color in dark mode (often identical)
    alignment: str   # output filename stem under public/cities/<slug>/
    # Roundel fill baked into the station-pill sprite sheet. Kept separate from
    # `color` because the sprites predate the map palette and INV-014 pins the
    # committed PNGs byte-for-byte — changing this regenerates every sprite.
    sprite_color: str = ""

    def __post_init__(self):
        if not self.sprite_color:
            object.__setattr__(self, "sprite_color", self.color)

    def to_json(self):
        return {
            "id": self.id,
            "key": self.key,
            "label": self.label,
            "glyph": self.glyph,
            "color": self.color,
            "colorDark": self.color_dark,
            "alignment": f"{self.alignment}.geojson",
        }


@dataclass(frozen=True)
class City:
    slug: str
    name: str            # 'Seattle'
    system: str          # 'Link Light Rail'
    agency: str          # 'Sound Transit'
    center: tuple        # [lng, lat] initial map center
    zoom: float
    lines: tuple
    walkshed_accent_light: str
    walkshed_accent_dark: str
    default_station: tuple   # (lines key, stopCode) focused on first load
    station_count: int       # INV-012: exact expected station feature count
    capabilities: frozenset
    source_note: str         # provenance line shown in the legend's Statistics
    agency_source_id: str    # stats.json `sources[].id` for the rail feed

    # ── Paths ───────────────────────────────────────────────────────────────
    @property
    def raw_dir(self) -> Path:
        return ROOT / "data" / "cities" / self.slug / "raw"

    @property
    def raw_pois_dir(self) -> Path:
        return self.raw_dir / "pois"

    @property
    def public_dir(self) -> Path:
        return ROOT / "public" / "cities" / self.slug

    @property
    def station_index(self) -> Path:
        return ROOT / "data" / "cities" / self.slug / "station-index.json"

    @property
    def stations_geojson(self) -> Path:
        return self.public_dir / "all-stations.geojson"

    @property
    def station_exits_geojson(self) -> Path:
        return self.public_dir / "station-exits.geojson"

    @property
    def pois_dir(self) -> Path:
        return self.public_dir / "pois"

    @property
    def tiles_dir(self) -> Path:
        return self.pois_dir / "tiles"

    @property
    def icons_dir(self) -> Path:
        return self.public_dir / "icons"

    @property
    def osm_dump(self) -> Path:
        return self.raw_pois_dir / "osm-pois.json.gz"

    @property
    def exits_dump(self) -> Path:
        return self.raw_pois_dir / "station-exits.json.gz"

    @property
    def walksheds_dump(self) -> Path:
        return self.raw_pois_dir / "walksheds.json.gz"

    @property
    def distances_dump(self) -> Path:
        return self.raw_pois_dir / "walking-distances.json.gz"

    @property
    def refreshed_marker(self) -> Path:
        """When data/refresh.py last pulled this city's rail feed."""
        return self.raw_dir / "refreshed.json"

    @property
    def tile_index(self) -> Path:
        return self.tiles_dir / "index.json"

    @property
    def stats_json(self) -> Path:
        return self.pois_dir / "stats.json"

    def alignment_path(self, line: Line) -> Path:
        return self.public_dir / f"{line.alignment}.geojson"

    # ── Helpers ─────────────────────────────────────────────────────────────
    def has(self, capability: str) -> bool:
        return capability in self.capabilities

    def line_by_key(self, key: str) -> Line:
        for line in self.lines:
            if line.key == key:
                return line
        raise KeyError(f"{self.slug}: no line with key {key!r}")

    @property
    def glyphs(self) -> dict:
        """{line key: roundel glyph} — used by the sprite generator."""
        return {line.key: line.glyph for line in self.lines}

    @property
    def sprite_colors(self) -> dict:
        """{line key: roundel fill} — used by the sprite generator."""
        return {line.key: line.sprite_color for line in self.lines}

    def to_json(self):
        return {
            "slug": self.slug,
            "name": self.name,
            "system": self.system,
            "agency": self.agency,
            "center": list(self.center),
            "zoom": self.zoom,
            "lines": [line.to_json() for line in self.lines],
            "walkshedAccent": {
                "light": self.walkshed_accent_light,
                "dark": self.walkshed_accent_dark,
            },
            "defaultStation": {
                "lines": self.default_station[0],
                "stopCode": self.default_station[1],
            },
            "stationCount": self.station_count,
            "capabilities": sorted(self.capabilities),
            "sourceNote": self.source_note,
        }


# ── The registry ────────────────────────────────────────────────────────────

SEATTLE = City(
    slug="seattle",
    name="Seattle",
    system="Link Light Rail",
    agency="Sound Transit",
    center=(-122.33, 47.60),
    zoom=11.5,
    lines=(
        Line(
            id="1-line", key="1", label="1 Line", glyph="1",
            color="#38B030", color_dark="#38B030", alignment="line1-alignment",
            sprite_color="#4CAF50",
        ),
        Line(
            id="2-line", key="2", label="2 Line", glyph="2",
            color="#00A0E0", color_dark="#00A0E0", alignment="line2-alignment",
            sprite_color="#0082C8",
        ),
    ),
    walkshed_accent_light="#00A0E0",
    # Matches the light accent: WalkshedLayers has always drawn Seattle's
    # walksheds in the light accent regardless of mode, and this keeps that.
    walkshed_accent_dark="#00A0E0",
    default_station=("1,2", 50),  # Westlake
    station_count=38,
    capabilities=frozenset(ALL_CAPABILITIES),
    source_note="SDOT / Sound Transit",
    agency_source_id="sdot",
)

# Honolulu's Skyline is a single automated line. Only the segments in revenue
# service are modelled: HART's feed carries all 21 planned stations (ID 1-21,
# ordered west to east), of which 1-13 (Kualaka'i through Kahauiki / Middle
# Street) are open. `OPEN_STATION_MAX_ID` in the processor is the cutoff, so
# adding Segment 3 later is a one-number change plus a refresh.
#
# The line color is the route color registered for Skyline on Wikipedia
# (#134574); HART publishes no publicly documented brand hex. It is very dark,
# so dark mode uses a lightened tint to stay legible over the dusk basemap.
HONOLULU = City(
    slug="honolulu",
    name="Honolulu",
    system="Skyline",
    agency="HART",
    center=(-157.970, 21.365),
    zoom=12.0,
    lines=(
        Line(
            id="1-line", key="1", label="Skyline", glyph="S",
            color="#134574", color_dark="#4A90C2", alignment="line1-alignment",
        ),
    ),
    walkshed_accent_light="#134574",
    walkshed_accent_dark="#4A90C2",
    default_station=("1", 8),  # Kalauao (Pearlridge) — the densest open walkshed
    station_count=13,
    # No Mapbox isochrones have been built for Honolulu yet, and POI membership
    # is defined by those isochrones, so both capabilities stay off until
    # `fetch_walksheds.py --city honolulu --refresh` runs with a MAPBOX_TOKEN.
    # See docs/adding-a-city.md.
    capabilities=frozenset({CAP_EXITS}),
    source_note="HART / Honolulu Open Geospatial Data",
    agency_source_id="hart",
)

CITIES = {c.slug: c for c in (SEATTLE, HONOLULU)}

DEFAULT_CITY = "seattle"

REGISTRY_JSON = ROOT / "src" / "cityRegistry.json"


def get_city(slug: str) -> City:
    try:
        return CITIES[slug]
    except KeyError:
        raise SystemExit(
            f"Unknown city {slug!r}. Known cities: {', '.join(sorted(CITIES))}"
        ) from None


def resolve(slug: str | None):
    """Resolve a --city argument to a list of cities ('all' → every city)."""
    if slug in (None, "all"):
        return [CITIES[s] for s in sorted(CITIES)]
    return [get_city(slug)]


def add_city_arg(parser, *, default=DEFAULT_CITY, allow_all=True):
    """Attach the standard --city flag to an argparse parser."""
    choices = sorted(CITIES) + (["all"] if allow_all else [])
    parser.add_argument(
        "--city",
        default=default,
        choices=choices,
        help=f"city to operate on (default: {default})",
    )
    return parser


def registry_payload():
    return {
        "defaultCity": DEFAULT_CITY,
        "cities": [CITIES[s].to_json() for s in sorted(CITIES)],
    }


def export(path: Path = None) -> str:
    """Write src/cityRegistry.json from this module. Returns the JSON text."""
    text = json.dumps(registry_payload(), indent=2, sort_keys=False) + "\n"
    (path or REGISTRY_JSON).write_text(text)
    return text


def main(argv=None):
    import argparse

    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--list",
        metavar="CAPABILITY",
        nargs="?",
        const="",
        help="print city slugs (optionally only those with CAPABILITY) and exit; "
             "lets CI drive its per-city loops from the registry instead of a "
             "hardcoded list",
    )
    args = ap.parse_args(argv)

    if args.list is not None:
        cap = args.list
        for slug in sorted(CITIES):
            if not cap or CITIES[slug].has(cap):
                print(slug)
        return

    export()
    print(f"Wrote {REGISTRY_JSON.relative_to(ROOT)} ({len(CITIES)} cities)")


if __name__ == "__main__":
    main()
