"""Home values and rents by Glendale ZIP code, monthly, from Zillow Research.

Usage:
    python3 scripts/fetch_property_values.py

- ZIP boundaries: City of Glendale GIS (Common/GlendaleZIPCodes). ZIPs are kept when at least a
  quarter of their area is inside the city, which includes the Montrose (91020) and La Crescenta
  (91214) ZIPs that Glendale shares with unincorporated LA County.
- Values: Zillow Home Value Index (ZHVI, typical value of homes in the middle third of the
  market, smoothed and seasonally adjusted) for all homes, single-family homes and condos, from
  January 2000. Rents: Zillow Observed Rent Index (ZORI, all rentals, smoothed) from 2015.
- Comparison series: Glendale city-wide and Los Angeles County.

The Zillow CSVs are national (up to about 125 MB each), so they are streamed and filtered.
"""

from __future__ import annotations

import csv
import io
import json
import subprocess
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from compute_exposure import Index, polygons  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
UA = "TheGlendaleGrid/0.1 (Jewel City Hacks 5 project)"
ZILLOW = "https://files.zillowstatic.com/research/public_csvs"
ZIPS_URL = ("https://gismap.glendaleca.gov/arcgis/rest/services/Common/GlendaleZIPCodes/FeatureServer/0/query"
            "?where=1%3D1&outFields=ZIPCODE&outSR=4326&maxAllowableOffset=0.00005&geometryPrecision=5&f=geojson")
MIN_SHARE_IN_CITY = 0.25
METRICS = {
    "value": ("zhvi", "zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month"),
    "value_sfr": ("zhvi", "zhvi_uc_sfr_tier_0.33_0.67_sm_sa_month"),
    "value_condo": ("zhvi", "zhvi_uc_condo_tier_0.33_0.67_sm_sa_month"),
    "rent": ("zori", "zori_uc_sfrcondomfr_sm_month"),
}
# Comparison series only for the headline metrics; the city-wide ZHVI file is about 94 MB.
COMPARE = {"value", "rent"}


def curl(url: str) -> bytes:
    for attempt in range(3):
        try:
            return subprocess.run(["curl", "-sfL", "--max-time", "120", "-A", UA, url],
                                  check=True, capture_output=True).stdout
        except subprocess.CalledProcessError as exc:
            last = exc
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"GET failed: {url}") from last


def stream_csv(url: str, keep) -> list:
    """Streams a Zillow CSV and returns the rows for which keep(row) is true."""
    proc = subprocess.Popen(["curl", "-sfL", "--max-time", "900", "-A", UA, url], stdout=subprocess.PIPE)
    rows = [r for r in csv.DictReader(io.TextIOWrapper(proc.stdout, encoding="utf-8")) if keep(r)]
    if proc.wait() != 0:
        raise RuntimeError(f"download failed: {url}")
    return rows


def series(row: dict, months: list) -> list:
    out = []
    for m in months:
        v = row.get(m)
        out.append(round(float(v)) if v not in (None, "") else None)
    return out


def share_inside(feature: dict, city: Index, n: int = 40) -> tuple:
    zi = Index([feature])
    pts = [p for poly in polygons(feature["geometry"]) for p in poly[0]]
    x0, x1 = min(p[0] for p in pts), max(p[0] for p in pts)
    y0, y1 = min(p[1] for p in pts), max(p[1] for p in pts)
    inside = total = 0
    samples = []
    for i in range(n):
        for j in range(n):
            x, y = x0 + (x1 - x0) * (i + 0.5) / n, y0 + (y1 - y0) * (j + 0.5) / n
            if zi.hits(x, y):
                total += 1
                if city.hits(x, y):
                    inside += 1
                    samples.append((x, y))
    return (inside / total if total else 0.0), samples


def fetch_zips() -> dict:
    fc = json.loads(curl(ZIPS_URL))
    city = Index(json.loads((ROOT / "data/glendale/city_boundary.geojson").read_text())["features"])
    hoods = Index(json.loads((ROOT / "data/glendale/neighborhood_zones.geojson").read_text())["features"])
    keep = []
    for f in fc["features"]:
        z = f["properties"]["ZIPCODE"]
        share, samples = share_inside(f, city)
        if share < MIN_SHARE_IN_CITY:
            continue
        names = Counter(h.get("NAME") for x, y in samples for h in hoods.hits(x, y) if h.get("NAME"))
        keep.append({"type": "Feature", "geometry": f["geometry"], "properties": {
            "zip": z, "share_in_city": round(share, 2),
            "neighborhoods": [n for n, _ in names.most_common(3)],
        }})
    print(f"  ZIPs: {len(keep)} of {len(fc['features'])} are at least {MIN_SHARE_IN_CITY:.0%} inside Glendale", file=sys.stderr)
    return {"type": "FeatureCollection", "features": keep}


def main() -> None:
    zips = fetch_zips()
    zipset = {f["properties"]["zip"] for f in zips["features"]}
    out = {}
    for key, (kind, stem) in METRICS.items():
        t = time.time()
        rows = stream_csv(f"{ZILLOW}/{kind}/Zip_{stem}.csv", lambda r: r["RegionName"] in zipset and r["State"] == "CA")
        months = [c for c in rows[0] if c[:2] in ("19", "20") and c[4] == "-"] if rows else []
        entry = {"months": [m[:7] for m in months], "zips": {r["RegionName"]: series(r, months) for r in rows}}
        if key in COMPARE:
            city = stream_csv(f"{ZILLOW}/{kind}/City_{stem}.csv",
                              lambda r: r["RegionName"] == "Glendale" and r["State"] == "CA" and r["CountyName"] == "Los Angeles County")
            county = stream_csv(f"{ZILLOW}/{kind}/County_{stem}.csv",
                                lambda r: r["RegionName"] == "Los Angeles County" and r["State"] == "CA")
            entry["glendale"] = series(city[0], months) if city else None
            entry["la_county"] = series(county[0], months) if county else None
        out[key] = entry
        print(f"  {key}: {len(rows)} ZIPs, {months[0][:7] if months else '-'} to {months[-1][:7] if months else '-'} ({time.time() - t:.0f}s)", file=sys.stderr)

    # ZIPs Zillow has no series for (PO-box and single-building ZIPs) aren't worth drawing.
    with_data = {z for m in out.values() for z in m["zips"]}
    zips["features"] = [f for f in zips["features"] if f["properties"]["zip"] in with_data]
    (ROOT / "data/glendale/zips.geojson").write_text(json.dumps(zips, separators=(",", ":")))
    (ROOT / "data/property").mkdir(exist_ok=True)
    (ROOT / "data/property/values.json").write_text(json.dumps({
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "Zillow Research: Zillow Home Value Index (ZHVI) and Zillow Observed Rent Index (ZORI)",
        "source_url": "https://www.zillow.com/research/data/",
        "notes": [
            "ZHVI is the typical value of homes in the middle third of the market (35th to 65th percentile), smoothed and seasonally adjusted. It is not a sale price or an assessed value.",
            "ZORI is the typical asking rent for all rental types, smoothed.",
            "ZIP codes don't follow city lines: 91020 (Montrose) and 91214 (La Crescenta) include unincorporated areas.",
            "Not adjusted for inflation.",
        ],
        "metrics": out,
    }, separators=(",", ":")))
    print("wrote data/glendale/zips.geojson and data/property/values.json", file=sys.stderr)


if __name__ == "__main__":
    main()
