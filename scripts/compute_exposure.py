"""Estimate how much of each zoning group lies in each mapped hazard, and in past burn areas.

Usage:
    python3 scripts/compute_exposure.py   # after prepare_glendale.py and fetch_history.py

Method: sample points on a 50 m grid inside the city boundary; each point stands for one
50 m x 50 m cell. For each point, record its zoning group, hazard zones and how many mapped
fires have burned it. Shares are cell counts, so results are approximate (roughly +/- 1
percentage point for groups larger than 1 km2). Pure standard library, no GIS dependencies.
"""

from __future__ import annotations

import json
import math
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GLEN = ROOT / "data" / "glendale"
HIST = ROOT / "data" / "history"
GRID_M = 50.0
BUCKET_DEG = 0.005


def load(path: Path) -> list:
    return json.loads(path.read_text())["features"]


def polygons(geom: dict) -> list:
    if geom["type"] == "Polygon":
        return [geom["coordinates"]]
    if geom["type"] == "MultiPolygon":
        return geom["coordinates"]
    return []


def in_ring(x: float, y: float, ring: list) -> bool:
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def in_polygon(x: float, y: float, poly: list) -> bool:
    return in_ring(x, y, poly[0]) and not any(in_ring(x, y, hole) for hole in poly[1:])


class Index:
    """Grid bucket index over polygon parts; each entry keeps its feature's properties."""

    def __init__(self, features: list):
        self.buckets: dict = defaultdict(list)
        for f in features:
            if not f.get("geometry"):
                continue
            for poly in polygons(f["geometry"]):
                xs = [p[0] for p in poly[0]]
                ys = [p[1] for p in poly[0]]
                bbox = (min(xs), min(ys), max(xs), max(ys))
                entry = (bbox, poly, f["properties"])
                for bx in range(int(bbox[0] // BUCKET_DEG), int(bbox[2] // BUCKET_DEG) + 1):
                    for by in range(int(bbox[1] // BUCKET_DEG), int(bbox[3] // BUCKET_DEG) + 1):
                        self.buckets[(bx, by)].append(entry)

    def hits(self, x: float, y: float) -> list:
        out = []
        for bbox, poly, props in self.buckets.get((int(x // BUCKET_DEG), int(y // BUCKET_DEG)), ()):
            if bbox[0] <= x <= bbox[2] and bbox[1] <= y <= bbox[3] and in_polygon(x, y, poly):
                out.append(props)
        return out


def main() -> None:
    boundary = Index(load(GLEN / "city_boundary.geojson"))
    zoning = Index(load(GLEN / "zoning.geojson"))
    fhsz = Index(load(GLEN / "calfire_fhsz_lra.geojson"))
    flood = Index(load(GLEN / "fema_flood_zones.geojson"))
    dam = Index(load(GLEN / "dwr_dam_inundation.geojson"))
    liq = Index(load(GLEN / "cgs_liquefaction_zones.geojson"))
    slide = Index(load(GLEN / "cgs_landslide_zones.geojson"))
    fault = Index(load(GLEN / "cgs_fault_zones.geojson"))
    fires = Index(load(HIST / "fire_perimeters.geojson"))

    b = load(GLEN / "city_boundary.geojson")[0]["geometry"]
    pts = [p for poly in polygons(b) for p in poly[0]]
    xmin, xmax = min(p[0] for p in pts), max(p[0] for p in pts)
    ymin, ymax = min(p[1] for p in pts), max(p[1] for p in pts)
    lat0 = (ymin + ymax) / 2
    dy = GRID_M / 111_320
    dx = GRID_M / (111_320 * math.cos(math.radians(lat0)))

    metrics = ("very_high_fire", "high_or_very_high_fire", "fema_special_flood", "dam_inundation",
               "liquefaction", "landslide", "fault_rupture", "burned_since_1950",
               "burned_2plus_since_1950", "burned_ever")
    counts: dict = defaultdict(lambda: defaultdict(int))
    total = 0
    y = ymin + dy / 2
    while y < ymax:
        x = xmin + dx / 2
        while x < xmax:
            if boundary.hits(x, y):
                total += 1
                z = zoning.hits(x, y)
                group = z[0]["zone_group"] if z else "streets_unzoned"
                fire_class = {p["FHSZ_Description"] for p in fhsz.hits(x, y)}
                burns = [p["year"] for p in fires.hits(x, y)]
                since50 = [yr for yr in burns if yr >= 1950]
                flags = {
                    "very_high_fire": "Very High" in fire_class,
                    "high_or_very_high_fire": bool(fire_class & {"High", "Very High"}),
                    "fema_special_flood": any(p["SFHA_TF"] == "T" for p in flood.hits(x, y)),
                    "dam_inundation": bool(dam.hits(x, y)),
                    "liquefaction": bool(liq.hits(x, y)),
                    "landslide": bool(slide.hits(x, y)),
                    "fault_rupture": bool(fault.hits(x, y)),
                    "burned_since_1950": bool(since50),
                    "burned_2plus_since_1950": len(set(since50)) >= 2,
                    "burned_ever": bool(burns),
                }
                for key in (group, "all"):
                    counts[key]["cells"] += 1
                    for m, v in flags.items():
                        if v:
                            counts[key][m] += 1
            x += dx
        y += dy

    cell_km2 = (GRID_M * GRID_M) / 1e6
    out_groups = {}
    for g, c in counts.items():
        n = c["cells"]
        out_groups[g] = {
            "area_km2": round(n * cell_km2, 2),
            "share_of_city": round(n / total, 4),
            "pct": {m: round(c[m] / n, 4) for m in metrics},
        }
    result = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "method": f"{GRID_M:.0f} m sample grid inside the city boundary ({total} cells)",
        "city_area_km2": round(total * cell_km2, 1),
        "groups": out_groups,
        "notes": [
            "Approximate: shares are counts of 50 m cells.",
            "Zoning shows what is allowed, not what is built. 'streets_unzoned' is street right-of-way and gaps between zoning polygons.",
            "Fire hazard: CAL FIRE 2025 LRA zones. NonWildland (unzoned) is not safe from wildfire.",
            "FEMA special flood area = SFHA_TF 'T' (A, AE, AO zones). Zone D (not studied) is not counted and is not safe.",
            "Dam inundation shows consequences if a dam failed, not likelihood.",
            "Burn history: NIFC perimeter archive, incomplete before 1950.",
        ],
    }
    path = GLEN / "exposure.json"
    path.write_text(json.dumps(result, indent=1))
    print(result["method"], "| city", result["city_area_km2"], "km2")
    for g, v in sorted(out_groups.items(), key=lambda kv: -kv[1]["area_km2"]):
        p = v["pct"]
        print(f"  {g:16s} {v['area_km2']:6.2f} km2  VH fire {p['very_high_fire']:5.0%}  "
              f"flood {p['fema_special_flood']:4.0%}  dam {p['dam_inundation']:4.0%}  "
              f"liq {p['liquefaction']:4.0%}  slide {p['landslide']:4.0%}  "
              f"burned50+ {p['burned_since_1950']:4.0%}")


if __name__ == "__main__":
    main()
