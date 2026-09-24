"""Shared polyline geometry helpers used by every city's processor.

Extracted from data/process.py when the pipeline went multi-city; the maths is
unchanged, so existing outputs regenerate byte-for-byte.
"""

import math


def dist(a, b):
    return math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2)


def get_coords(feat):
    """Flatten a GeoJSON line feature's geometry to a list of positions."""
    g = feat["geometry"]
    if g["type"] == "LineString":
        return list(g["coordinates"])
    elif g["type"] == "MultiLineString":
        return [c for part in g["coordinates"] for c in part]
    return []


def chaikin(coords, iterations=3):
    """Chaikin curve smoothing — subdivides segments for smooth curves.

    Keeps first and last points fixed (station positions).
    """
    pts = list(coords)
    for _ in range(iterations):
        out = [pts[0]]
        for i in range(len(pts) - 1):
            p0, p1 = pts[i], pts[i + 1]
            out.append([0.75 * p0[0] + 0.25 * p1[0], 0.75 * p0[1] + 0.25 * p1[1]])
            out.append([0.25 * p0[0] + 0.75 * p1[0], 0.25 * p0[1] + 0.75 * p1[1]])
        out.append(pts[-1])
        pts = out
    return pts


def offset_polyline(coords, meters, side="left"):
    """Offset a polyline perpendicular to its travel direction.

    'left' = left of travel direction (west for a south-bound line).
    'right' = right of travel direction (east for a south-bound line).
    """
    sign = -1 if side == "left" else 1
    result = []
    n = len(coords)

    for i in range(n):
        if i == 0:
            dx = coords[1][0] - coords[0][0]
            dy = coords[1][1] - coords[0][1]
        elif i == n - 1:
            dx = coords[-1][0] - coords[-2][0]
            dy = coords[-1][1] - coords[-2][1]
        else:
            dx = coords[i + 1][0] - coords[i - 1][0]
            dy = coords[i + 1][1] - coords[i - 1][1]

        length = math.sqrt(dx * dx + dy * dy)
        if length == 0:
            result.append(list(coords[i]))
            continue

        # Perpendicular vector (90° clockwise for 'right')
        px = sign * dy / length
        py = sign * (-dx) / length

        lng, lat = coords[i]
        lat_rad = math.radians(lat)
        m_per_deg_lng = 111320 * math.cos(lat_rad)
        m_per_deg_lat = 110540

        result.append([
            lng + px * meters / m_per_deg_lng,
            lat + py * meters / m_per_deg_lat,
        ])
    return result


def haversine_m(a, b):
    """Great-circle distance in metres between two [lng, lat] positions."""
    lng1, lat1 = a
    lng2, lat2 = b
    r = 6371008.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lng2 - lng1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def simplify_rdp(coords, tolerance_m, *, lat0=None):
    """Ramer-Douglas-Peucker simplification with a metre tolerance.

    Works on a local equirectangular projection (longitude scaled by
    cos(lat0)), which is accurate to well under a metre over a single city.
    Iterative rather than recursive so a dense survey polyline can't blow the
    stack. Endpoints are always kept.
    """
    if len(coords) < 3:
        return [list(c) for c in coords]

    if lat0 is None:
        lat0 = sum(c[1] for c in coords) / len(coords)
    kx = 111320 * math.cos(math.radians(lat0))
    ky = 110540
    pts = [(c[0] * kx, c[1] * ky) for c in coords]

    keep = [False] * len(coords)
    keep[0] = keep[-1] = True
    stack = [(0, len(coords) - 1)]

    while stack:
        lo, hi = stack.pop()
        if hi <= lo + 1:
            continue
        ax, ay = pts[lo]
        bx, by = pts[hi]
        dx, dy = bx - ax, by - ay
        seg2 = dx * dx + dy * dy

        far_i, far_d = -1, -1.0
        for i in range(lo + 1, hi):
            px, py = pts[i]
            if seg2 == 0:
                d = math.hypot(px - ax, py - ay)
            else:
                t = ((px - ax) * dx + (py - ay) * dy) / seg2
                t = 0.0 if t < 0 else (1.0 if t > 1 else t)
                d = math.hypot(px - (ax + t * dx), py - (ay + t * dy))
            if d > far_d:
                far_i, far_d = i, d

        if far_d > tolerance_m:
            keep[far_i] = True
            stack.append((lo, far_i))
            stack.append((far_i, hi))

    return [list(coords[i]) for i, k in enumerate(keep) if k]
