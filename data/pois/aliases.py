"""Loader for the curated tag-alias map (data/pois/tag-aliases.toml).

Single source of truth for {alias: canonical} mappings. Consumed by:
  - fetch_pois OSM ingestion (collapses raw OSM values to canonical tags
    before the manifest is built);
  - the published filter manifest (filter_schema.aliases), which the
    frontend URL parser and POI search box use at runtime.
"""

import os
import tomllib

ALIASES_TOML = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tag-aliases.toml")


def load_tag_aliases():
    """Return the {alias: canonical} dict from tag-aliases.toml."""
    with open(ALIASES_TOML, "rb") as f:
        data = tomllib.load(f)
    return dict(data.get("aliases", {}))
