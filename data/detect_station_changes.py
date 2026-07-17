#!/usr/bin/env python3
"""Detect Sound Transit station changes in the freshly downloaded SDOT feed.

Run right after data/refresh.py in the monthly data-refresh workflow. Applies
the same filter process.py uses (STATUS == "Existing / Under Construction",
Tacoma streetcar excluded, NAME_MAP renames) to the fresh raw feed, then diffs
against the committed baseline: station names in HEAD's all-stations.geojson
union process.py's hardcoded line orders. Diffing against HEAD (not the
previous raw dump) makes the check self-healing across skipped months.

Because process.py's station wiring is hardcoded (LINE_1_ORDER / LINE_2_ORDER,
STOP_CODES, MISSING_STATIONS, SHARED_COUNT, the 38-count assertions), a new
station needs human-judged code edits — this script only DETECTS and reports;
it never edits process.py. Its output feeds the refresh PR body and, when
non-empty, an escalation issue for the @claude responder.

Usage:
  python3 data/detect_station_changes.py \
      [--raw data/raw/light-rail-stations.geojson] \
      [--github-output "$GITHUB_OUTPUT"] [--issue-body PATH]
"""
import argparse
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

from process import LINE_1_ORDER, LINE_2_ORDER, MISSING_STATIONS, NAME_MAP, TACOMA_KW  # noqa: E402

DEFAULT_RAW = os.path.join(HERE, "raw", "light-rail-stations.geojson")
MISSING_NAMES = {name for name, _lng, _lat in MISSING_STATIONS}


def sdot_station_names(raw):
    """Station names in the feed after process.py's exact filter.

    Mirrors process.py main(): STATUS gate, Tacoma keyword exclusion on the
    NAME property (positionally the third value, as process.py reads it),
    NAME_MAP renames.
    """
    names = set()
    for feat in raw["features"]:
        props = feat["properties"]
        if props.get("STATUS") != "Existing / Under Construction":
            continue
        raw_name = list(props.values())[2]
        if any(kw in raw_name for kw in TACOMA_KW):
            continue
        names.add(NAME_MAP.get(raw_name, raw_name))
    return names


def committed_station_names():
    """Station names in all-stations.geojson at HEAD (pre-refresh baseline)."""
    out = subprocess.run(
        ["git", "show", "HEAD:public/all-stations.geojson"],
        capture_output=True, text=True, check=True, cwd=ROOT,
    ).stdout
    return {f["properties"]["name"] for f in json.loads(out)["features"]}


def diff_stations(sdot_names, committed_names):
    """The change report. Baseline = committed stations union the hardcoded
    orders, so a station already wired into process.py is never re-flagged."""
    baseline = committed_names | set(LINE_1_ORDER) | set(LINE_2_ORDER)
    return {
        # In the feed as Existing, unknown to the app: a station opening.
        "new_stations": sorted(sdot_names - baseline),
        # Hardcoded-coordinate stations that now appear in the feed: they
        # should graduate out of MISSING_STATIONS (real SDOT coordinates).
        "graduated_missing": sorted(MISSING_NAMES & sdot_names),
        # Committed stations gone from the feed, excluding the ones we
        # expect to be absent (MISSING_STATIONS). Flag only, never auto-remove.
        "removed_stations": sorted((committed_names - sdot_names) - MISSING_NAMES),
    }


def render_issue_body(report):
    new = ", ".join(report["new_stations"]) or "none"
    lines = [
        "@claude The monthly data refresh detected Sound Transit station changes",
        "in the SDOT feed that need hardcoded wiring in data/process.py. The",
        "refresh PR intentionally does not make these code edits.",
        "",
        f"New stations (Existing / Under Construction, not in the app): {new}",
    ]
    if report["graduated_missing"]:
        lines.append(
            "Now in the SDOT feed (remove from MISSING_STATIONS, use real "
            "coordinates): " + ", ".join(report["graduated_missing"]))
    if report["removed_stations"]:
        lines.append(
            "Missing from the SDOT feed (investigate before removing anything): "
            + ", ".join(report["removed_stations"]))
    lines += [
        "",
        "Touch points for wiring a new station (open as a follow-up PR, do not",
        "piggyback on the refresh PR):",
        "- data/process.py: LINE_1_ORDER / LINE_2_ORDER insertion point,",
        "  STOP_CODES entry (three-digit code reference in CLAUDE.md, Station",
        "  Codes section), MISSING_STATIONS removal if applicable, SHARED_COUNT",
        "  only if the shared trunk changes.",
        "- data/test_process.py: the 38 / 13 shared / 13 line-1 / 12 line-2",
        "  count assertions.",
        "- data/pois/test_invariants.py + CLAUDE.md: INV-012's station count.",
        "- Sprites: rerun data/process.py (INV-013 / INV-014).",
        "- Downstream, in order: fetch_walksheds.py --refresh (new coordinates;",
        "  bumps the walkshed version and correctly invalidates the whole",
        "  Matrix cache), fetch_pois.py, fetch_walking_distances.py --refresh,",
        "  build_refined.py, build_stats.py.",
        "",
        "This issue was opened by the data-refresh workflow with the default",
        "Actions token, which does not trigger the @claude responder — comment",
        "'@claude proceed' to start.",
    ]
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser(description="Detect SDOT station changes")
    ap.add_argument("--raw", default=DEFAULT_RAW, help="fresh raw SDOT stations GeoJSON")
    ap.add_argument("--github-output", help="path to append GitHub Actions step outputs to")
    ap.add_argument("--issue-body", help="write an escalation issue body here when changes exist")
    args = ap.parse_args()

    with open(args.raw) as f:
        raw = json.load(f)
    report = diff_stations(sdot_station_names(raw), committed_station_names())
    changed = any(report.values())

    print(json.dumps(report, indent=2))
    if args.github_output:
        with open(args.github_output, "a") as f:
            f.write(f"new_stations={json.dumps(report['new_stations'])}\n")
            f.write(f"station_changes={str(changed).lower()}\n")
    if args.issue_body and changed:
        with open(args.issue_body, "w") as f:
            f.write(render_issue_body(report) + "\n")


if __name__ == "__main__":
    main()
