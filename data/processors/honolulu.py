"""Honolulu — Skyline, from HART's public ArcGIS feeds.

Sources (Honolulu Open Geospatial Data, City & County of Honolulu):
  Rail Transit - Station Points        HART_Transit_Stations_PUBLIC/0
  Rail Transit - Guideway Alignment    HART_Guideway_Alignment_Line_PUBLIC/0

Both carry the *whole* 21-station project, not just what is open. `ID` on the
station layer is an authoritative west-to-east ordinal (1 = Kualakaʻi, 21 =
Kālia), so "the open system" is simply `ID <= OPEN_STATION_MAX_ID`. Segment 1
(1-9) opened 2023-06-30 and Segment 2 (10-13) on 2025-10-16; raising the cutoff
to 21 when the City Center segment opens is a one-line change plus a refresh.

Skyline is a single line, so there is no shared segment and no offset — the
guideway is emitted as one smoothed LineString, trimmed to the open extent.
"""

import json

from geometry import dist, get_coords, haversine_m, simplify_rdp

# Highest HART station ID in revenue service. Segment 3 (City Center, IDs
# 14-21) is under construction; see the module docstring before raising this.
OPEN_STATION_MAX_ID = 13

# The guideway layer is split into four named sections, each published as a
# "Center Alignment" plus separate east/westbound tracks. We stitch the centre
# lines; City Center belongs to the unopened Segment 3 and is excluded.
OPEN_SECTIONS = (
    "West Oahu/Farrington Highway Section",
    "Kamehameha Highway Section",
    "Airport Section",
)
CENTER_ALIGNMENT = "Center Alignment"

# Consecutive sections meet end-to-end, but the published endpoints are not
# bit-identical — allow a generous joint before declaring the chain broken.
JOINT_TOLERANCE_M = 400

# HART publishes the centre line as dense survey geometry (~6,000 vertices over
# 15 miles). It is already smooth, so it wants decimation rather than Seattle's
# Chaikin pass: 1 m of Douglas-Peucker tolerance is far finer than the guideway
# is wide and cuts the rendered line from ~500 KB to ~20 KB.
SIMPLIFY_TOLERANCE_M = 1.0

# HART's `station_name_FEIS` field carries the Environmental Impact Statement
# name, which predates several renamings. These are the stations whose current
# public name differs; everything else takes FEIS verbatim. Keyed by station ID
# so a rename upstream can't silently reattach to the wrong stop.
COMMON_NAME_OVERRIDES = {
    8: "Pearlridge",                                # FEIS: "Kalauao"
    9: "Aloha Stadium",                             # FEIS: "Hālawa"
    10: "Pearl Harbor / Hickam",                    # FEIS: "Pearl Harbor Naval Base"
    11: "Daniel K. Inouye International Airport",   # FEIS: "Honolulu International Airport"
}

LINE_ID = "1-line"
LINE_KEY = "1"

# U+02BB MODIFIER LETTER TURNED COMMA is the correct ʻokina. The two feeds
# disagree (STATION uses it, station_name_FEIS uses a right single quote), so
# normalise both to it rather than shipping mixed glyphs for the same name.
OKINA = "ʻ"
_OKINA_LOOKALIKES = ("‘", "’", "'", "`")


class HARTSchemaError(RuntimeError):
    """Raised when a HART feature is missing a field this script depends on —
    signals an upstream schema change rather than a bug in this script."""


def _normalize_okina(text):
    for ch in _OKINA_LOOKALIKES:
        text = text.replace(ch, OKINA)
    return text


def _require(props, field, what):
    if field not in props:
        raise HARTSchemaError(
            f"HART {what} feature is missing the {field!r} property — the "
            f"upstream schema may have changed. Got: {sorted(props.keys())}. "
            "Update data/processors/honolulu.py (and refresh.py's validators)."
        )
    return props[field]


def station_display_name(props):
    """'Kualakaʻi Station' — the official Hawaiian name, ʻokina normalised."""
    raw = _require(props, "STATION", "station")
    name = _normalize_okina(str(raw).strip())
    return name if name.endswith("Station") else f"{name} Station"


def station_common_name(props):
    """'East Kapolei' — the place descriptor riders navigate by.

    Empty when the descriptor merely repeats the Hawaiian name and no override
    supplies a current public name, so the frontend never renders a redundant
    'Kalauao (Kalauao)'.
    """
    sid = _require(props, "ID", "station")
    if sid in COMMON_NAME_OVERRIDES:
        return COMMON_NAME_OVERRIDES[sid]
    feis = _normalize_okina(str(props.get("station_name_FEIS") or "").strip())
    feis = feis[: -len(" Station")] if feis.endswith(" Station") else feis
    hawaiian = _normalize_okina(str(props.get("STATION") or "").strip())
    hawaiian = hawaiian[: -len(" Station")] if hawaiian.endswith(" Station") else hawaiian
    return "" if feis == hawaiian else feis


def open_stations(raw_stations):
    """Open stations as (id, name, common name, [lng, lat]), west to east."""
    out = []
    for feat in raw_stations["features"]:
        props = feat["properties"]
        sid = _require(props, "ID", "station")
        if sid is None or int(sid) > OPEN_STATION_MAX_ID:
            continue
        out.append((
            int(sid),
            station_display_name(props),
            station_common_name(props),
            list(feat["geometry"]["coordinates"]),
        ))
    out.sort(key=lambda s: s[0])
    return out


def stitch_sections(raw_guideway):
    """Chain the open centre-line sections into one west-to-east polyline.

    The sections are published in arbitrary order and arbitrary direction, so
    walk them greedily: start from the section containing the westernmost
    point, then repeatedly attach whichever unused section has an endpoint at
    the current tail, reversing it if it is the far end that matches.
    """
    sections = []
    for feat in raw_guideway["features"]:
        props = feat["properties"]
        name = _require(props, "feature_name", "guideway")
        if name not in OPEN_SECTIONS:
            continue
        if _require(props, "feature_desc", "guideway") != CENTER_ALIGNMENT:
            continue
        coords = get_coords(feat)
        if coords:
            sections.append((name, coords))

    missing = set(OPEN_SECTIONS) - {n for n, _ in sections}
    if missing:
        raise HARTSchemaError(
            f"Guideway feed is missing the {CENTER_ALIGNMENT} for: "
            f"{', '.join(sorted(missing))}. Cannot build the open alignment."
        )

    # Seed with the section holding the westernmost vertex, oriented eastward.
    start_idx = min(
        range(len(sections)), key=lambda i: min(c[0] for c in sections[i][1])
    )
    name, coords = sections[start_idx]
    if coords[0][0] > coords[-1][0]:
        coords = coords[::-1]
    chain = list(coords)
    used = {start_idx}

    while len(used) < len(sections):
        tail = chain[-1]
        best = None
        for i, (_n, c) in enumerate(sections):
            if i in used:
                continue
            for reverse, endpoint in ((False, c[0]), (True, c[-1])):
                d = haversine_m(tail, endpoint)
                if best is None or d < best[0]:
                    best = (d, i, reverse)
        d, i, reverse = best
        if d > JOINT_TOLERANCE_M:
            raise HARTSchemaError(
                f"Guideway sections do not meet: nearest unused section "
                f"({sections[i][0]}) starts {d:.0f} m from the current end, "
                f"over the {JOINT_TOLERANCE_M} m tolerance. The upstream "
                "alignment may have been re-cut."
            )
        c = sections[i][1]
        chain.extend(reversed(c) if reverse else c)
        used.add(i)

    # Drop duplicate vertices at the joints.
    deduped = [chain[0]]
    for pt in chain[1:]:
        if dist(deduped[-1], pt) > 1e-9:
            deduped.append(list(pt))
    return deduped


def _nearest_index(polyline, point):
    return min(
        range(len(polyline)), key=lambda i: haversine_m(polyline[i], point)
    )


def trim_to_stations(polyline, stations):
    """Clip the stitched guideway to the span between the first and last open
    station, so the line doesn't dangle into the unopened segment."""
    first = _nearest_index(polyline, stations[0][3])
    last = _nearest_index(polyline, stations[-1][3])
    lo, hi = (first, last) if first <= last else (last, first)
    trimmed = polyline[lo : hi + 1]
    return trimmed if first <= last else trimmed[::-1]


def build(city):
    """Process the committed HART feeds into Honolulu's stations + alignment.

    Returns (stations_geojson, {line id: alignment FeatureCollection}).
    """
    with open(city.raw_dir / "rail-stations.geojson") as f:
        raw_stations = json.load(f)
    with open(city.raw_dir / "rail-guideway.geojson") as f:
        raw_guideway = json.load(f)

    stations = open_stations(raw_stations)
    if not stations:
        raise HARTSchemaError(
            "No open stations found in the HART station feed — expected IDs "
            f"1..{OPEN_STATION_MAX_ID}."
        )

    stitched = stitch_sections(raw_guideway)
    trimmed = trim_to_stations(stitched, stations)
    smooth = simplify_rdp(trimmed, SIMPLIFY_TOLERANCE_M)

    alignment = {
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "properties": {"line": LINE_ID},
            "geometry": {"type": "LineString", "coordinates": smooth},
        }],
    }

    features = []
    for sid, name, common, coords in stations:
        props = {
            "name": name,
            "line": LINE_ID,
            "stopCode": sid,
            "shared": False,
            "lines": LINE_KEY,
        }
        if common:
            props["altName"] = common
        features.append({
            "type": "Feature",
            "properties": props,
            "geometry": {"type": "Point", "coordinates": coords},
        })

    stations_geojson = {"type": "FeatureCollection", "features": features}

    print(f"Stations: {len(features)} open of {OPEN_STATION_MAX_ID} (IDs 1..{OPEN_STATION_MAX_ID})")
    print(f"Guideway: {len(stitched)} stitched → {len(trimmed)} trimmed → "
          f"{len(smooth)} points (Douglas-Peucker {SIMPLIFY_TOLERANCE_M} m)")

    return stations_geojson, {LINE_ID: alignment}
