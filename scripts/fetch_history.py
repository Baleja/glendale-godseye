"""Download the long-term fire record around Glendale into data/history/.

Usage:
    python3 scripts/fetch_history.py

- NIFC Interagency Fire Perimeter History (1878-2019) plus WFIGS perimeters (2020 onward):
  every mapped fire perimeter that intersects the area around Glendale. Incomplete for older
  fires.
- USGS post-fire debris-flow hazard assessments: assessment points (2013 onward) and basin
  hazard polygons (2020 onward only) in the same area.

Geometry is generalized by the server (about 30 m) to keep files small.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import time
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "history"
UA = "GlendaleGodsEye/0.1 (Jewel City Hacks 5 project)"

# Glendale plus the foothills and neighbors that burn into it (Eaton, La Tuna, Station...).
ENVELOPE = {"xmin": -118.45, "ymin": 34.05, "xmax": -118.05, "ymax": 34.35,
            "spatialReference": {"wkid": 4326}}

NIFC = ("https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/"
        "InterAgencyFirePerimeterHistory_All_Years_View/FeatureServer/0/query")
WFIGS = ("https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/"
         "WFIGS_Interagency_Perimeters/FeatureServer/0/query")
PWFDF = "https://earthquake.usgs.gov/arcgis/rest/services/ls/pwfdf/MapServer"


def get(url: str, params: dict) -> dict:
    full = url + "?" + urllib.parse.urlencode(params)
    for attempt in range(3):
        try:
            out = subprocess.run(["curl", "-sfL", "--max-time", "120", "-A", UA, full],
                                 check=True, capture_output=True).stdout
            data = json.loads(out)
            if "error" in data:
                raise RuntimeError(data["error"])
            return data
        except (subprocess.CalledProcessError, json.JSONDecodeError, RuntimeError) as exc:
            last = exc
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"GET failed: {full}") from last


def query_all(url: str, fields: str, where: str = "1=1", offset_deg: float = 0.0003) -> list:
    """Envelope query with resultOffset paging until the server stops flagging truncation."""
    feats, offset = [], 0
    while True:
        d = get(url, {
            "where": where, "geometry": json.dumps(ENVELOPE),
            "geometryType": "esriGeometryEnvelope", "inSR": 4326,
            "spatialRel": "esriSpatialRelIntersects", "outFields": fields, "outSR": 4326,
            "maxAllowableOffset": offset_deg, "geometryPrecision": 4, "f": "geojson",
            "resultOffset": offset, "resultRecordCount": 500, "orderByFields": "OBJECTID",
        })
        batch = d.get("features", [])
        feats += batch
        truncated = d.get("exceededTransferLimit") or d.get("properties", {}).get("exceededTransferLimit")
        if not batch or (not truncated and len(batch) < 500):
            return feats
        offset += len(batch)


def _clean_name(name: str | None) -> str:
    n = re.sub(r"/\s*usfs$", "", (name or "").strip(), flags=re.I)
    n = re.sub(r"\s+fire$", "", n, flags=re.I)
    n = re.sub(r"\s+", " ", n).strip().title()
    return "Unnamed" if n.upper() in ("", "UNKNOWN", "UNNAMED", "NONAME") else n


def _add(best: dict, geometry: dict, name: str | None, year: int, acres: float, agency, oid) -> None:
    name = _clean_name(name)
    # The archives hold duplicate records of the same fire from different agencies; merge by
    # name and year, except unnamed fires, which are distinct.
    key = (year, name.upper()) if name != "Unnamed" else (year, f"#{oid}")
    if key not in best or acres > best[key]["properties"]["acres"]:
        best[key] = {"type": "Feature", "geometry": geometry, "properties": {
            "name": name, "year": year, "acres": round(acres), "agency": agency,
        }}


def _drop_same_footprint(features: list) -> list:
    """Records with the same year and acreage are the same fire under different names."""
    seen, out = set(), []
    for f in sorted(features, key=lambda f: f["properties"]["name"] == "Unnamed"):
        p = f["properties"]
        key = (p["year"], round(p["acres"] / 5)) if p["acres"] >= 10 else None
        if key and key in seen:
            continue
        if key:
            seen.add(key)
        out.append(f)
    return out


def fire_perimeters() -> list:
    best: dict = {}
    for i, f in enumerate(query_all(NIFC, "INCIDENT,FIRE_YEAR,GIS_ACRES,AGENCY")):
        p = f["properties"]
        year = str(p.get("FIRE_YEAR") or "").strip()
        if f.get("geometry") and year.isdigit():
            _add(best, f["geometry"], p.get("INCIDENT"), int(year), p.get("GIS_ACRES") or 0,
                 p.get("AGENCY"), i)
    # The history view stops in 2019; WFIGS covers 2020 onward.
    for i, f in enumerate(query_all(WFIGS, "poly_IncidentName,poly_GISAcres,attr_FireDiscoveryDateTime")):
        p = f["properties"]
        t, acres = p.get("attr_FireDiscoveryDateTime"), p.get("poly_GISAcres") or 0
        if f.get("geometry") and t and acres >= 1:
            year = datetime.fromtimestamp(t / 1000, tz=timezone.utc).year
            _add(best, f["geometry"], p.get("poly_IncidentName"), year, acres, "WFIGS", f"w{i}")
    feats = _drop_same_footprint(list(best.values()))
    return sorted(feats, key=lambda f: (f["properties"]["year"], -f["properties"]["acres"]))


def debris_flow() -> tuple[list, list]:
    points = []
    for f in query_all(f"{PWFDF}/0/query", "*", offset_deg=0):
        p = {k.lower(): v for k, v in f["properties"].items()}
        points.append({"type": "Feature", "geometry": f["geometry"], "properties": {
            "fire": p.get("fire"), "fire_id": p.get("fire_id"), "start_date": p.get("start_date"),
            "assessment_date": p.get("assessment_date"), "url": p.get("sciencebaseurl"),
        }})
    basins = []
    for f in query_all(f"{PWFDF}/4/query", "*", offset_deg=0.0001):
        p = {k.lower(): v for k, v in f["properties"].items()}
        basins.append({"type": "Feature", "geometry": f["geometry"], "properties": {
            "fire_id": p.get("fire_id"),
            "hazard": (p.get("bch_legend") or "").strip() or None,
            "likelihood": (p.get("bp_legend") or "").replace(" ", "") or None,
            "volume_m3": (p.get("bv_legend") or "").replace(" ", "") or None,
        }})
    return points, basins


def write(name: str, features: list, meta: dict) -> None:
    path = OUT / f"{name}.geojson"
    path.write_text(json.dumps({"type": "FeatureCollection", "metadata": meta,
                                "features": features}, separators=(",", ":")))
    print(f"  {name:22s} {len(features):5d} features  {path.stat().st_size / 1e6:5.2f} MB")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    perims = fire_perimeters()
    write("fire_perimeters", perims, {
        "source": NIFC.rsplit("/query", 1)[0], "fetched_at": now,
        "note": "Historical perimeters, incomplete especially before 1950. Generalized ~30 m.",
    })
    points, basins = debris_flow()
    write("debris_flow_points", points, {"source": f"{PWFDF}/0", "fetched_at": now})
    write("debris_flow_basins", basins, {
        "source": f"{PWFDF}/4", "fetched_at": now,
        "note": "Basins exist only for assessments since 2020-08. Conditions right after the fire.",
    })
    years = [f["properties"]["year"] for f in perims]
    print(f"  fire years {min(years)}-{max(years)}")


if __name__ == "__main__":
    sys.exit(main())
