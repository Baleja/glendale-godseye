"""Copy the Glendale GIS snapshot layers the map uses into data/glendale, lightly simplified.

Usage:
    python3 scripts/prepare_glendale.py /path/to/unzipped/snapshot

The snapshot comes from https://github.com/HackerFund/GlendaleGisMcp (release
snapshot-20260926). Coordinates are rounded to 5 decimals (about 1 m) and repeated points
dropped, which is plenty for a city-scale map and keeps the dam inundation layer loadable in a
browser. Properties are trimmed to the fields the app displays.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "data" / "glendale"

# layer id -> (properties to keep, coordinate decimals)
LAYERS: dict[str, tuple[tuple[str, ...], int]] = {
    "city_boundary": (("CITYNAME",), 5),
    "calfire_fhsz_lra": (("FHSZ", "FHSZ_Description"), 5),
    "fema_flood_zones": (("FLD_ZONE", "ZONE_SUBTY", "SFHA_TF"), 5),
    "cgs_fault_zones": (("QUAD_NAME",), 5),
    "cgs_liquefaction_zones": (("QUAD_NAME",), 5),
    "cgs_landslide_zones": (("QUAD_NAME",), 4),
    "dwr_dam_inundation": (("DamName", "Scenario", "HazardCl", "LoadingScn"), 4),
    "fire_stations": (("NAME", "ADDRESS", "sta_no"), 6),
    "hospitals": (("NAME", "ST_NUM", "ST_DIR", "ST_NAME", "ST_TYPE"), 6),
    "schools": (("SCHOOL", "ADDRESS", "School_typ"), 6),
    "neighborhood_zones": (("NAME",), 5),
    "zoning": (("ZONE_DISTR", "ZONE_DESC", "GPLANDESC"), 5),
    "fire_station_districts": (("Fire_Distr",), 5),
    "parks": (("NAME_ALF", "NAMEA_ALF"), 5),
}


def zone_group(district: str | None) -> str:
    """Broad group from ZONE_DISTR (the Type field is unreliable; see GlendaleGisMcp city-sources)."""
    d = (district or "").strip().upper()
    first = d.split(" ")[0]
    if first in ("ROS", "R1R", "R1"):
        return "single_family"
    if first == "R":
        return "multifamily"
    if d.startswith(("DSP", "TOD", "SFMU", "IMU R")):
        return "mixed_use"
    if first in ("IND", "IMU", "T"):
        return "industrial"
    if first == "SR":
        return "recreation"
    if first == "CEM":
        return "cemetery"
    if first.startswith("C") or first == "MS":
        return "commercial"
    return "other"


# Douglas-Peucker tolerance in degrees (about 3 m), for layers that trace parcel lines.
SIMPLIFY = {"zoning": 2.5e-5}
_tolerance = 0.0


def _rdp(points: list, tol: float) -> list:
    if len(points) < 5 or tol <= 0:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        (x1, y1), (x2, y2) = points[a], points[b]
        dx, dy = x2 - x1, y2 - y1
        norm = (dx * dx + dy * dy) ** 0.5 or 1e-12
        best, idx = 0.0, -1
        for i in range(a + 1, b):
            x, y = points[i]
            d = abs(dy * x - dx * y + x2 * y1 - y2 * x1) / norm
            if d > best:
                best, idx = d, i
        if best > tol:
            keep[idx] = True
            stack += [(a, idx), (idx, b)]
    return [p for p, k in zip(points, keep) if k]


def _round_ring(ring: list, decimals: int) -> list:
    out: list = []
    for x, y, *_ in ring:
        pt = [round(x, decimals), round(y, decimals)]
        if not out or out[-1] != pt:
            out.append(pt)
    if _tolerance <= 0 or len(out) < 8:
        return out
    # Closed ring: first == last, so simplify two open halves and rejoin them.
    mid = len(out) // 2
    return _rdp(out[: mid + 1], _tolerance) + _rdp(out[mid:], _tolerance)[1:]


def _simplify(geom: dict, decimals: int) -> dict | None:
    kind = geom["type"]
    coords = geom["coordinates"]
    if kind == "Point":
        return {"type": kind, "coordinates": [round(c, decimals) for c in coords[:2]]}
    if kind == "Polygon":
        rings = [r for r in (_round_ring(r, decimals) for r in coords) if len(r) >= 4]
        return {"type": kind, "coordinates": rings} if rings else None
    if kind == "MultiPolygon":
        polys = []
        for poly in coords:
            rings = [r for r in (_round_ring(r, decimals) for r in poly) if len(r) >= 4]
            if rings:
                polys.append(rings)
        return {"type": kind, "coordinates": polys} if polys else None
    if kind in ("LineString", "MultiPoint"):
        return {"type": kind, "coordinates": _round_ring(coords, decimals)}
    return geom


def main(src: Path) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((src / "manifest.json").read_text())
    sources = {}
    global _tolerance
    for layer_id, (keep, decimals) in LAYERS.items():
        _tolerance = SIMPLIFY.get(layer_id, 0.0)
        data = json.loads((src / f"{layer_id}.geojson").read_text())
        features = []
        for f in data["features"]:
            geom = _simplify(f["geometry"], decimals) if f.get("geometry") else None
            if geom is None:
                continue
            props = {k: f["properties"].get(k) for k in keep}
            if layer_id == "zoning":
                props["zone_group"] = zone_group(props["ZONE_DISTR"])
            features.append({"type": "Feature", "geometry": geom, "properties": props})
        path = OUT / f"{layer_id}.geojson"
        path.write_text(json.dumps({"type": "FeatureCollection", "features": features},
                                   separators=(",", ":")))
        entry = manifest["layers"][layer_id]
        sources[layer_id] = {
            "title": entry["title"],
            "agency": entry["source_agency"],
            "layer_url": entry["layer_url"],
            "fetched_at": entry["fetched_at"],
        }
        print(f"{layer_id:24s} {len(features):5d} features  {path.stat().st_size / 1e6:6.2f} MB")
    (OUT / "sources.json").write_text(json.dumps(
        {"snapshot_built_at": manifest["built_at"], "layers": sources}, indent=2))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(Path(sys.argv[1]))
