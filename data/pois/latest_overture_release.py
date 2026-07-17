#!/usr/bin/env python3
"""Discover the newest Overture Maps release and (optionally) pin it.

The Overture release pin is the RELEASE constant in fetch_overture.py —
build_refined.py derives PLACES_GLOB from it and build_stats.py reads it
textually — so rewriting that single constant propagates everywhere.

Discovery lists the public overturemaps-us-west-2 bucket anonymously
(S3 ListObjectsV2 with a delimiter, stdlib urllib — the same no-credential
access path the DuckDB build query uses). A candidate release is accepted
only if its places theme actually has objects on S3, so a just-announced
but not-yet-replicated release can never be pinned. On any discovery
failure the current pin is kept and the script exits 0 with bump=false —
the monthly refresh workflow degrades on the Overture side, never aborts.

Usage:
  python3 data/pois/latest_overture_release.py               # report only
  python3 data/pois/latest_overture_release.py --current     # print the pin
  python3 data/pois/latest_overture_release.py --apply       # rewrite RELEASE
  ... --github-output "$GITHUB_OUTPUT"   # write current/latest/bump outputs
"""
import argparse
import os
import re
import sys
import xml.etree.ElementTree as ET
from urllib.parse import quote
from urllib.request import urlopen

HERE = os.path.dirname(os.path.abspath(__file__))
FETCH_OVERTURE = os.path.join(HERE, "fetch_overture.py")

S3_ENDPOINT = "https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com"
S3_NS = {"s3": "http://s3.amazonaws.com/doc/2006-03-01/"}
TIMEOUT = 30

RELEASE_ID_RE = re.compile(r"^\d{4}-\d{2}-\d{2}\.\d+$")
# Same pin regex build_stats.py uses — keep the two in sync.
PIN_RE = re.compile(r'^RELEASE = "([^"]+)"', re.M)


def current_release():
    with open(FETCH_OVERTURE) as f:
        return PIN_RE.search(f.read()).group(1)


def _s3_list(prefix, delimiter="/", max_keys=1000):
    """One anonymous ListObjectsV2 page. Returns (common_prefixes, keys)."""
    url = (f"{S3_ENDPOINT}/?list-type=2&max-keys={max_keys}"
           f"&prefix={quote(prefix)}&delimiter={quote(delimiter)}")
    with urlopen(url, timeout=TIMEOUT) as resp:
        tree = ET.fromstring(resp.read())
    prefixes = [e.text for e in tree.findall("s3:CommonPrefixes/s3:Prefix", S3_NS)]
    keys = [e.text for e in tree.findall("s3:Contents/s3:Key", S3_NS)]
    return prefixes, keys


def _release_sort_key(release_id):
    date, _, patch = release_id.partition(".")
    return (date, int(patch))


def list_releases():
    """All release ids on the bucket, oldest to newest. One page suffices —
    Overture ships monthly, so the release count stays far under 1000."""
    prefixes, _ = _s3_list("release/")
    ids = [p[len("release/"):].rstrip("/") for p in prefixes]
    return sorted((r for r in ids if RELEASE_ID_RE.match(r)), key=_release_sort_key)


def places_theme_exists(release_id):
    """True if the release's places theme has at least one object on S3."""
    _, keys = _s3_list(f"release/{release_id}/theme=places/type=place/",
                       delimiter="", max_keys=1)
    return bool(keys)


def apply_release(release_id):
    with open(FETCH_OVERTURE) as f:
        src = f.read()
    updated = PIN_RE.sub(f'RELEASE = "{release_id}"', src, count=1)
    with open(FETCH_OVERTURE, "w") as f:
        f.write(updated)


def main():
    ap = argparse.ArgumentParser(description="Discover/pin the latest Overture release")
    ap.add_argument("--current", action="store_true", help="print the pinned release and exit")
    ap.add_argument("--apply", action="store_true", help="rewrite RELEASE in fetch_overture.py")
    ap.add_argument("--github-output", help="path to append GitHub Actions step outputs to")
    args = ap.parse_args()

    current = current_release()
    if args.current:
        print(current)
        return

    latest, note = None, ""
    try:
        releases = list_releases()
        # Newest release whose places theme is actually queryable.
        for candidate in reversed(releases):
            if _release_sort_key(candidate) <= _release_sort_key(current):
                break
            if places_theme_exists(candidate):
                latest = candidate
                break
            note = f"(newest listed release {candidate} has no places theme yet)"
    except Exception as e:  # degrade: keep the pin, never fail the refresh
        note = f"(discovery failed: {e})"

    bump = latest is not None
    if bump and args.apply:
        apply_release(latest)

    print(f"current={current} latest={latest or current} bump={str(bump).lower()} {note}".rstrip())
    if args.github_output:
        with open(args.github_output, "a") as f:
            f.write(f"current={current}\nlatest={latest or current}\nbump={str(bump).lower()}\n")


if __name__ == "__main__":
    sys.exit(main())
