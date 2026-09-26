"""Glendale housing permits: approvals, construction starts and completions, one point per project.

Usage:
    python3 scripts/fetch_permits.py

Source: California HCD, Housing Element Annual Progress Report (APR) Table A2, "Annual Building
Activity Report Summary", on data.ca.gov (reporting years 2018 onward). Each yearly report
repeats every project that is still open, so rows are merged by the city's tracking ID:
- approved: the entitlement approval date (planning approval).
- started:  the building permit issue date, the point where construction can begin.
- done:     the certificate of occupancy (or other readiness) date.

Table A2 only covers projects that add housing units (ADUs, single-family, 2-4 and 5+ units).
Commercial, remodel, solar and demolition permits are not in it.

Each project is tagged with its zoning group and hazard zones from the local snapshot.
"""

from __future__ import annotations

import json
import math
import subprocess
import sys
import time
import urllib.parse
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from compute_exposure import Index  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
GLEN = ROOT / "data/glendale"
UA = "TheGlendaleGrid/0.1 (Jewel City Hacks 5 project)"
RESOURCE = "fe505d9b-8c36-42ba-ba30-08bc4f34e022"
SQL = "https://data.ca.gov/api/3/action/datastore_search_sql"
DATASET = "https://data.ca.gov/dataset/housing-element-annual-progress-report-apr-data-by-jurisdiction-and-year"
COLUMNS = {
    "JURS_TRACKING_ID": "id", "YEAR": "year", "STREET_ADDRESS": "addr", "PROJECT_NAME": "name",
    "UNIT_CAT": "cat", "LATITUDE": "lat", "LONGITUDE": "lon",
    "ENT_APPROVE_DT1": "approved", "BP_ISSUE_DT1": "started", "CO_ISSUE_DT1": "done",
    "NO_ENTITLEMENTS": "units_approved", "NO_BUILDING_PERMITS": "units_started",
    "NO_OTHER_FORMS_OF_READINESS": "units_done",
}
CATEGORY = {"ADU": "ADU", "SFD": "Single-family home", "SFA": "Townhome", "2 to 4": "2–4 units", "5+": "5+ units"}


def curl(url: str) -> bytes:
    for attempt in range(3):
        try:
            return subprocess.run(["curl", "-sfL", "--max-time", "120", "-A", UA, url],
                                  check=True, capture_output=True).stdout
        except subprocess.CalledProcessError as exc:
            last = exc
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"GET failed: {url}") from last


def fetch_rows() -> list:
    cols = ",".join(f'"{c}"' for c in COLUMNS)
    sql = (f'SELECT {cols} FROM "{RESOURCE}" '
           "WHERE \"JURIS_NAME\" = 'GLENDALE' AND \"CNTY_NAME\" = 'Los Angeles'")
    res = json.loads(curl(SQL + "?" + urllib.parse.urlencode({"sql": sql})))
    if not res.get("success"):
        raise RuntimeError(f"data.ca.gov query failed: {res.get('error')}")
    return [{COLUMNS[k]: v for k, v in r.items() if k in COLUMNS} for r in res["result"]["records"]]


def clean(v):
    if v is None:
        return None
    v = str(v).replace("\xa0", " ").strip()
    return v or None


def num(v) -> int:
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return 0


def merge(rows: list) -> list:
    by_id = defaultdict(list)
    for r in rows:
        key = clean(r["id"]) or clean(r["addr"])
        if key:
            by_id[key].append(r)
    projects = []
    for key, rs in by_id.items():
        rs.sort(key=lambda r: r["year"])
        first_date = lambda f: min((d for d in (clean(r[f]) for r in rs) if d), default=None)  # noqa: E731
        located = [r for r in rs if clean(r["lat"]) and clean(r["lon"])]
        if not located:
            continue
        last = located[-1]
        projects.append({
            "id": key,
            "addr": (clean(last["addr"]) or "").title(),
            "name": clean(last["name"]),
            "cat": CATEGORY.get(clean(last["cat"]) or "", clean(last["cat"]) or "Housing"),
            "approved": first_date("approved"),
            "started": first_date("started"),
            "done": first_date("done"),
            "units": max(max(num(r["units_approved"]), num(r["units_started"]), num(r["units_done"])) for r in rs) or 1,
            "reported": sorted({r["year"] for r in rs}),
            "lon": float(last["lon"]), "lat": float(last["lat"]),
        })
    return projects


def nearest_zone(zoning: Index, x: float, y: float):
    """HCD geocodes many addresses onto the street, which zoning polygons leave out, so look
    outward in rings (about 10, 20, 35 and 50 m) for the closest zoned lot."""
    for r in (0, 0.0001, 0.0002, 0.00035, 0.0005):
        steps = 1 if r == 0 else 8
        for i in range(steps):
            a = i * math.pi / 4
            hit = next((z.get("zone_group") for z in zoning.hits(x + r * math.cos(a) * 1.2, y + r * math.sin(a))), None)
            if hit:
                return hit
    return None


def main() -> None:
    load = lambda name: json.loads((GLEN / f"{name}.geojson").read_text())["features"]  # noqa: E731
    city = Index(load("city_boundary"))
    zoning = Index(load("zoning"))
    fhsz = Index(load("calfire_fhsz_lra"))
    hoods = Index(load("neighborhood_zones"))
    hazards = {k: Index(load(f)) for k, f in [
        ("liquefaction", "cgs_liquefaction_zones"), ("landslide", "cgs_landslide_zones"),
        ("fault", "cgs_fault_zones"), ("dam", "dwr_dam_inundation")]}

    rows = fetch_rows()
    projects = merge(rows)
    features, outside = [], 0
    for p in projects:
        x, y = p.pop("lon"), p.pop("lat")
        if not city.hits(x, y):
            outside += 1
            continue
        zone = nearest_zone(zoning, x, y)
        fire = next((z.get("FHSZ_Description") for z in fhsz.hits(x, y)), None)
        fire = None if fire == "NonWildland" else fire
        p.update({
            "zone_group": zone,
            "hood": next((h.get("NAME") for h in hoods.hits(x, y)), None),
            "fire": fire,
            **{k: bool(idx.hits(x, y)) for k, idx in hazards.items()},
            "approved_year": int(p["approved"][:4]) if p["approved"] else None,
            "started_year": int(p["started"][:4]) if p["started"] else None,
            "done_year": int(p["done"][:4]) if p["done"] else None,
            "status": "done" if p["done"] else "started" if p["started"] else "approved",
        })
        del p["reported"]
        p = {k: v for k, v in p.items() if v not in (None, False)}
        features.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(x, 6), round(y, 6)]}, "properties": p})

    out = {
        "type": "FeatureCollection",
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "California HCD, Housing Element Annual Progress Report Table A2 (data.ca.gov)",
        "source_url": DATASET,
        "notes": [
            "Only projects that add homes (ADUs, single-family, 2–4 and 5+ units). Commercial, remodel, solar and demolition permits are not included.",
            "Approved = entitlement approval date. Construction started = building permit issued. Completed = certificate of occupancy.",
            "Yearly reports repeat open projects; they are merged by the city's tracking ID. Locations are geocoded by HCD.",
        ],
        "features": features,
    }
    (GLEN / "permits.geojson").write_text(json.dumps(out, separators=(",", ":")))
    status = defaultdict(int)
    for f in features:
        status[f["properties"]["status"]] += 1
    print(f"  {len(rows)} report rows -> {len(projects)} projects, {outside} outside the city", file=sys.stderr)
    print(f"  status: {dict(status)}", file=sys.stderr)
    print("wrote data/glendale/permits.geojson", file=sys.stderr)


if __name__ == "__main__":
    main()
