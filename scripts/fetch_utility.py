"""Download Glendale electricity and water data into data/utility/.

Usage:
    python3 scripts/fetch_utility.py

- EIA-861 annual utility survey (2015 onward): residential revenue, sales and customers for
  Glendale Water & Power and neighboring utilities. Average price = revenue / sales, so it
  includes fixed charges and is an average across tiers, not a tariff.
- State Water Resources Control Board monthly urban water supplier reports (2014 onward):
  Glendale's potable supply, demand by sector, recycled water, residential gallons per
  person per day and the supplier's declared water shortage level.

Rate increases approved by City Council are hand-curated in data/utility/rate_actions.json
(there is no machine-readable feed for GWP rates).
"""

from __future__ import annotations

import io
import json
import re
import subprocess
import sys
import time
import urllib.parse
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "utility"
UA = "GlendaleGodsEye/0.1 (Jewel City Hacks 5 project)"

EIA_YEARS = range(2015, 2025)
EIA_LATEST_URL = "https://www.eia.gov/electricity/data/eia861/zip/f861{y}.zip"
EIA_ARCHIVE_URL = "https://www.eia.gov/electricity/data/eia861/archive/zip/f861{y}.zip"
UTILITIES = {
    "7294": "Glendale (GWP)",
    "2507": "Burbank (BWP)",
    "14534": "Pasadena (PWP)",
    "11208": "Los Angeles (LADWP)",
    "17609": "Southern California Edison",
}

SWRCB = "https://data.ca.gov/api/3/action/datastore_search"
SWRCB_RESOURCE = "f4d50112-5fb5-4066-b45c-44696b10a49e"
GLENDALE_WATER_ORG = "1004"

XML_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def curl(url: str, attempts: int = 3) -> bytes:
    for attempt in range(attempts):
        try:
            return subprocess.run(["curl", "-sfL", "--max-time", "180", "-A", UA, url],
                                  check=True, capture_output=True).stdout
        except subprocess.CalledProcessError as exc:
            last = exc
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"GET failed: {url}") from last


def xlsx_rows(data: bytes):
    """Yields {column letter: text} for each row of the first sheet (stdlib only)."""
    z = zipfile.ZipFile(io.BytesIO(data))
    strings = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).iter(f"{XML_NS}si"):
            strings.append("".join(t.text or "" for t in si.iter(f"{XML_NS}t")))
    sheet = sorted(n for n in z.namelist() if n.startswith("xl/worksheets/sheet"))[0]
    for row in ET.fromstring(z.read(sheet)).iter(f"{XML_NS}row"):
        out = {}
        for c in row.iter(f"{XML_NS}c"):
            col = re.match(r"[A-Z]+", c.get("r")).group()
            kind, v = c.get("t"), c.find(f"{XML_NS}v")
            if kind == "inlineStr":
                out[col] = "".join(t.text or "" for t in c.iter(f"{XML_NS}t"))
            elif v is not None:
                out[col] = strings[int(v.text)] if kind == "s" else v.text
        yield out


def col_shift(col: str, n: int) -> str:
    i = 0
    for ch in col:
        i = i * 26 + ord(ch) - 64
    i += n
    out = ""
    while i:
        i, rem = divmod(i - 1, 26)
        out = chr(65 + rem) + out
    return out


def num(s: str | None) -> float | None:
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def fetch_eia() -> list[dict]:
    rows = []
    for y in EIA_YEARS:
        # Past years move to the archive path; the newest year is only on the main path.
        try:
            z = curl(EIA_ARCHIVE_URL.format(y=y), attempts=1)
            zipfile.ZipFile(io.BytesIO(z))
        except (RuntimeError, zipfile.BadZipFile):
            z = curl(EIA_LATEST_URL.format(y=y))
        book = zipfile.ZipFile(io.BytesIO(z)).read(f"Sales_Ult_Cust_{y}.xlsx")
        sheet = xlsx_rows(book)
        groups, _, fields = next(sheet), next(sheet), next(sheet)
        # Column letters shift between years, so locate them from the header rows.
        by_name = {v.strip(): k for k, v in fields.items()}
        res = next(k for k, v in groups.items() if v.strip().upper() == "RESIDENTIAL")
        rev_c, mwh_c, cust_c = res, col_shift(res, 1), col_shift(res, 2)
        util_c, part_c, state_c = by_name["Utility Number"], by_name["Part"], by_name["State"]
        ba_c = next((k for n, k in by_name.items() if n.upper().startswith("BA")), None)
        for r in sheet:
            # Part A / Bundled = customers who buy both energy and delivery from the utility.
            uid = (r.get(util_c) or "").split(".")[0]
            if uid in UTILITIES and r.get(part_c) == "A" and r.get(state_c) == "CA":
                rev_k, mwh, cust = num(r.get(rev_c)), num(r.get(mwh_c)), num(r.get(cust_c))
                if not (rev_k and mwh and cust):
                    continue
                rows.append({
                    "year": y,
                    "utility_id": uid,
                    "utility": UTILITIES[uid],
                    "res_cents_per_kwh": round(rev_k * 1000 / (mwh * 1000) * 100, 2),
                    "res_avg_monthly_bill": round(rev_k * 1000 / cust / 12, 2),
                    "res_kwh_per_month": round(mwh * 1000 / cust / 12, 1),
                    "res_customers": int(cust),
                    "ba_code": r.get(ba_c) if ba_c else None,
                })
        print(f"  EIA-861 {y}: {sum(1 for x in rows if x['year'] == y)} utilities", file=sys.stderr)
    return rows


def fetch_water() -> list[dict]:
    params = {"resource_id": SWRCB_RESOURCE, "limit": 1000,
              "filters": json.dumps({"ORG_ID": GLENDALE_WATER_ORG}),
              "sort": "REPORT_PERIOD_START_DATE asc"}
    data = json.loads(curl(SWRCB + "?" + urllib.parse.urlencode(params)))
    months = {}
    for r in data["result"]["records"]:
        month = r["REPORT_PERIOD_START_DATE"][:7]
        months[month] = {
            "month": month,
            "r_gpcd": round(r["R-GPCD"], 1) if r.get("R-GPCD") is not None else None,
            "potable_supply_mgal": round(r["POTABLE_SUPPLY_MINUS_SOLD_GAL"] / 1e6, 1) if r.get("POTABLE_SUPPLY_MINUS_SOLD_GAL") is not None else None,
            "residential_mgal": round(r["POTABLE_DEMAND_RES_GAL"] / 1e6, 1) if r.get("POTABLE_DEMAND_RES_GAL") is not None else None,
            "business_mgal": round(r["POTABLE_DEMAND_CII_GAL"] / 1e6, 1) if r.get("POTABLE_DEMAND_CII_GAL") is not None else None,
            "recycled_mgal": round(r["RECYCLED_DEMAND_GAL"] / 1e6, 1) if r.get("RECYCLED_DEMAND_GAL") is not None else None,
            "shortage_level": r.get("DWR_STANDARD_LEVEL"),
            "population": r.get("POP_REPORT_PERIOD"),
        }
    print(f"  SWRCB water: {len(months)} months", file=sys.stderr)
    return [months[k] for k in sorted(months)]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    electric = fetch_eia()
    (OUT / "electric_prices.json").write_text(json.dumps({
        "generated_at": now,
        "source": "U.S. EIA Form 861, Sales to Ultimate Customers (bundled service)",
        "source_url": "https://www.eia.gov/electricity/data/eia861/",
        "note": "Average residential price = revenue / kWh sold, including fixed charges. Annual averages, not tariffs.",
        "rows": electric,
    }, indent=1))
    water = fetch_water()
    (OUT / "water_use.json").write_text(json.dumps({
        "generated_at": now,
        "source": "State Water Resources Control Board, Urban Retail Water Supplier monthly reports (City of Glendale)",
        "source_url": "https://data.ca.gov/dataset/urws-conservation-supply-demand",
        "note": "Self-reported by the supplier. R-GPCD = residential gallons per person per day.",
        "months": water,
    }, indent=1))
    print(f"wrote {OUT}", file=sys.stderr)


if __name__ == "__main__":
    main()
