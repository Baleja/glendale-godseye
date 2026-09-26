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
}


def _round_ring(ring: list, decimals: int) -> list:
    out: list = []
    for x, y, *_ in ring:
        pt = [round(x, decimals), round(y, decimals)]
        if not out or out[-1] != pt:
            out.append(pt)
    return out


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
    for layer_id, (keep, decimals) in LAYERS.items():
        data = json.loads((src / f"{layer_id}.geojson").read_text())
        features = []
        for f in data["features"]:
            geom = _simplify(f["geometry"], decimals) if f.get("geometry") else None
            if geom is None:
                continue
            props = {k: f["properties"].get(k) for k in keep}
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
