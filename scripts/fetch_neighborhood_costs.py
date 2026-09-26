"""Household utility costs by census tract across Glendale, one layer per ACS 5-year release.

Usage:
    python3 scripts/fetch_neighborhood_costs.py

- Tract boundaries: Census TIGERweb, 2020 census tracts whose internal point is inside the
  city boundary.
- Costs: American Community Survey 5-year table-based summary files (no API key needed):
  B25132 monthly electricity cost, B25133 monthly gas cost, B25134 annual water and sewer
  cost, B19013 median household income. Releases 2021-2024 all use 2020 tracts.
- Estimated electricity use: each tract's median electric bill relative to the city-wide
  average, scaled to GWP's actual average residential kWh per customer over the same five
  years (EIA-861, from data/utility/electric_prices.json). This is an estimate: there is no
  public meter data by neighborhood.

Bills are self-reported by households in bands; medians are interpolated within bands, and
households whose utilities are included in rent are excluded from the cost medians.
"""

from __future__ import annotations

import json
import subprocess
import sys
import time
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from compute_exposure import Index  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
UA = "GlendaleGodsEyeView/0.1 (Jewel City Hacks 5 project)"
YEARS = [2021, 2022, 2023, 2024]
TIGER = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/10/query"
ACS_SF = "https://www2.census.gov/programs-surveys/acs/summary_file/{y}/table-based-SF/data/5YRData/acsdt5y{y}-{t}.dat"
ENVELOPE = "-118.33,34.09,-118.17,34.28"

# (lower bound, upper bound) of each band after the "charged" total; the top band is open, so
# its upper bound is an assumption used only if the median lands there.
BANDS = {
    "b25132": [(0, 50), (50, 100), (100, 150), (150, 200), (200, 250), (250, 350)],
    "b25133": [(0, 25), (25, 50), (50, 75), (75, 100), (100, 150), (150, 250)],
    "b25134": [(0, 125), (125, 250), (250, 500), (500, 750), (750, 1000), (1000, 1500)],
}


def curl(url: str) -> bytes:
    for attempt in range(3):
        try:
            return subprocess.run(["curl", "-sfL", "--max-time", "300", "-A", UA, url],
                                  check=True, capture_output=True).stdout
        except subprocess.CalledProcessError as exc:
            last = exc
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"GET failed: {url}") from last


def fetch_tracts() -> dict:
    params = {
        "where": "1=1", "geometry": ENVELOPE, "geometryType": "esriGeometryEnvelope",
        "inSR": 4326, "outSR": 4326, "spatialRel": "esriSpatialRelIntersects",
        "outFields": "GEOID,NAME,INTPTLAT,INTPTLON", "maxAllowableOffset": 0.00005,
        "geometryPrecision": 5, "f": "geojson",
    }
    fc = json.loads(curl(TIGER + "?" + urllib.parse.urlencode(params)))
    city = Index(json.loads((ROOT / "data/glendale/city_boundary.geojson").read_text())["features"])
    hoods = Index(json.loads((ROOT / "data/glendale/neighborhood_zones.geojson").read_text())["features"])
    keep = []
    for f in fc["features"]:
        p = f["properties"]
        x, y = float(p["INTPTLON"]), float(p["INTPTLAT"])
        if city.hits(x, y):
            hood = next((h.get("NAME") for h in hoods.hits(x, y)), None)
            keep.append({"type": "Feature", "geometry": f["geometry"],
                         "properties": {"geoid": p["GEOID"], "name": p["NAME"], "neighborhood": hood}})
    print(f"  tracts: {len(keep)} of {len(fc['features'])} in the envelope", file=sys.stderr)
    return {"type": "FeatureCollection", "features": keep}


def fetch_table(year: int, table: str, geoids: set) -> dict:
    """Streams one national summary file and keeps rows for our tracts."""
    proc = subprocess.Popen(["curl", "-sfL", "--max-time", "600", "-A", UA,
                             ACS_SF.format(y=year, t=table)], stdout=subprocess.PIPE, text=True)
    header, rows = None, {}
    for line in proc.stdout:
        if header is None:
            header = line.rstrip("\n").split("|")
            continue
        if not line.startswith("1400000US06037"):
            continue
        parts = line.rstrip("\n").split("|")
        geoid = parts[0].replace("1400000US", "")
        if geoid in geoids:
            rows[geoid] = dict(zip(header, parts))
    if proc.wait() != 0:
        raise RuntimeError(f"download failed: {year} {table}")
    return rows


def num(s):
    try:
        v = float(s)
        return v if v >= 0 else None
    except (TypeError, ValueError):
        return None


def banded_median(row: dict, table: str):
    code = table.upper()
    counts = [num(row.get(f"{code}_E{i:03d}")) or 0 for i in range(4, 10)]
    total = sum(counts)
    if total < 10:
        return None
    half, run = total / 2, 0.0
    for (lo, hi), n in zip(BANDS[table], counts):
        if run + n >= half and n > 0:
            return round(lo + (half - run) / n * (hi - lo), 1)
        run += n
    return None


def main() -> None:
    tracts = fetch_tracts()
    geoids = {f["properties"]["geoid"] for f in tracts["features"]}
    prices = json.loads((ROOT / "data/utility/electric_prices.json").read_text())["rows"]
    gwp = {r["year"]: r["res_cents_per_kwh"] for r in prices if r["utility_id"] == "7294"}
    gwp_kwh = {r["year"]: r["res_kwh_per_month"] for r in prices if r["utility_id"] == "7294"}

    years = {}
    for y in YEARS:
        tables = {t: fetch_table(y, t, geoids) for t in ("b25132", "b25133", "b25134", "b19013")}
        window = [gwp[k] for k in range(y - 4, y + 1) if k in gwp]
        cents = sum(window) / len(window) if window else None
        kwh_window = [gwp_kwh[k] for k in range(y - 4, y + 1) if k in gwp_kwh]
        city_kwh = sum(kwh_window) / len(kwh_window) if kwh_window else None
        out = {}
        for g in geoids:
            e, gas, w, inc = (tables[t].get(g, {}) for t in ("b25132", "b25133", "b25134", "b19013"))
            elec = banded_median(e, "b25132")
            gasm = banded_median(gas, "b25133")
            water_yr = banded_median(w, "b25134")
            income = num(inc.get("B19013_E001"))
            homes = num(e.get("B25132_E001"))
            charged = num(e.get("B25132_E003"))
            burden = None
            if income and elec is not None:
                yearly = elec * 12 + (gasm or 0) * 12 + (water_yr or 0)
                burden = round(yearly / income * 100, 2)
            out[g] = {
                "elec_bill": elec,
                "gas_bill": gasm,
                "water_bill": round(water_yr / 12, 1) if water_yr is not None else None,
                "burden_pct": burden,
                "income": income,
                "households": int(homes) if homes else None,
                "pays_own_electric_pct": round(charged / homes * 100) if homes and charged is not None else None,
            }
        # Self-reported bills run well above utility averages, so scale usage to match GWP's
        # actual average kWh per residential customer over the same years.
        weighted = [(v["elec_bill"], v["households"]) for v in out.values() if v["elec_bill"] is not None and v["households"]]
        mean_bill = sum(b * h for b, h in weighted) / sum(h for _, h in weighted)
        for v in out.values():
            v["est_kwh"] = round(city_kwh * v["elec_bill"] / mean_bill) if v["elec_bill"] is not None and city_kwh else None
        years[str(y)] = {"span": f"{y - 4}–{y}", "gwp_cents_per_kwh": round(cents, 2) if cents else None,
                         "gwp_kwh_per_month": round(city_kwh, 1) if city_kwh else None, "tracts": out}
        print(f"  ACS {y - 4}-{y}: {sum(1 for v in out.values() if v['elec_bill'] is not None)} tracts with data", file=sys.stderr)

    (ROOT / "data/glendale/tracts.geojson").write_text(json.dumps(tracts, separators=(",", ":")))
    (ROOT / "data/utility/tract_costs.json").write_text(json.dumps({
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "U.S. Census Bureau, American Community Survey 5-year estimates (tables B25132, B25133, B25134, B19013)",
        "source_url": "https://www.census.gov/programs-surveys/acs/data/summary-file.html",
        "notes": [
            "Each release averages five years of survey responses, so neighboring years overlap.",
            "Bills are self-reported in dollar bands; medians are interpolated. Households with utilities included in rent are excluded.",
            "Estimated kWh: each tract's median electric bill relative to the city average, scaled to GWP's actual average residential kWh per customer over the same years (EIA-861). No public meter data exists by neighborhood.",
            "Energy + water burden = (electric + gas + water/sewer bills) ÷ median household income.",
        ],
        "years": years,
    }, separators=(",", ":")))
    print("wrote data/glendale/tracts.geojson and data/utility/tract_costs.json", file=sys.stderr)


if __name__ == "__main__":
    main()
