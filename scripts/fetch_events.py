"""Download the historical record around past Los Angeles disasters into data/events/.

Usage:
    python3 scripts/fetch_events.py            # every event
    python3 scripts/fetch_events.py eaton-2025 # one event

Each event file holds what public archives recorded in the days *before* and after the event,
so the app can replay how conditions changed. Sources (all free, no key):

- Open-Meteo historical weather (ERA5 reanalysis), hourly, at the event and at Glendale
- Open-Meteo air quality (CAMS), hourly at Glendale, where the archive covers the date
- USGS earthquake catalog (FDSN event service)
- NWS watches, warnings and advisories from WFO Los Angeles/Oxnard, via the Iowa Environmental
  Mesonet VTEC archive
- NIFC interagency fire perimeters (final perimeter) and CAL FIRE incident list
- USGS streamflow (Water Data OGC API) for gauges in and around Glendale

HTTP goes through curl so the system certificate store is used.
"""

from __future__ import annotations

import json
import math
import subprocess
import sys
import time
import urllib.parse
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "events"
UA = "TheGlendaleGrid/0.1 (Jewel City Hacks 5 project)"

GLENDALE = (34.1425, -118.2551)

GAUGES = {
    "USGS-11097490": "LA River at Feliz Blvd (Glendale)",
    "USGS-11098000": "Arroyo Seco near Pasadena",
    "USGS-11101000": "Eaton Canyon near Pasadena",
    "USGS-11097260": "Wildwood Canyon Creek at Burbank",
}

# NWS VTEC phenomena worth replaying, keyed by code.
PHENOMENA = {
    "FW": "Red Flag / Fire Weather",
    "HW": "High Wind",
    "WI": "Wind",
    "EH": "Excessive Heat",
    "XH": "Extreme Heat",
    "HT": "Heat",
    "FF": "Flash Flood",
    "FA": "Areal Flood",
    "FL": "Flood",
    "TR": "Tropical Storm",
    "WS": "Winter Storm",
    "SV": "Severe Thunderstorm",
    "DF": "Debris Flow",
}
LA_ZONE_HINTS = ("Los Angeles", "San Gabriel", "San Fernando", "Santa Clarita", "Santa Monica")

EVENTS: list[dict] = [
    {
        "id": "la-tuna-2017",
        "name": "La Tuna Fire",
        "kind": "fire",
        "time": "2017-09-01T20:26:00Z",
        "lat": 34.2296, "lon": -118.2674,
        "days_before": 14, "days_after": 4,
        "perimeter": {"name": "TUNA", "year": "2017"},
        "summary": (
            "Burned about 7,200 acres of the Verdugo Mountains during a record heat wave, the "
            "largest fire by acreage in Los Angeles city history at the time. Evacuations "
            "reached Glendale, Burbank and Tujunga, and the 210 Freeway closed."
        ),
        "glendale_link": "Glendale's northern hillside neighborhoods sit against the Verdugos.",
        "sources": ["https://www.fire.ca.gov/incidents/2017/9/1/la-tuna-fire/"],
    },
    {
        "id": "station-2009",
        "name": "Station Fire",
        "kind": "fire",
        "time": "2009-08-26T22:30:00Z",
        "lat": 34.2556, "lon": -118.1917,
        "days_before": 14, "days_after": 7,
        "perimeter": {"name": "STATION", "year": "2009"},
        "summary": (
            "Started along Angeles Crest Highway above La Cañada Flintridge and burned about "
            "160,000 acres, the largest fire in Los Angeles County's modern history. Two "
            "firefighters died. The burn scar produced destructive debris flows the next "
            "winter."
        ),
        "glendale_link": "The burn area bordered La Crescenta and Tujunga, just north of Glendale.",
        "sources": ["https://www.fs.usda.gov/detail/angeles/home/?cid=stelprdb5203581"],
    },
    {
        "id": "eaton-2025",
        "name": "Eaton Fire",
        "kind": "fire",
        "time": "2025-01-08T02:18:00Z",
        "lat": 34.2033, "lon": -118.0960,
        "days_before": 14, "days_after": 4,
        "perimeter": {"name": "EATON", "year": "2025"},
        "summary": (
            "Ignited in Eaton Canyon during an extreme Santa Ana wind event after months "
            "without rain. It destroyed more than 9,000 structures in Altadena and Pasadena "
            "and killed at least 17 people."
        ),
        "glendale_link": "Altadena is about 10 km east of Glendale, under the same foothills.",
        "sources": ["https://www.fire.ca.gov/incidents/2025/1/7/eaton-fire"],
    },
    {
        "id": "palisades-2025",
        "name": "Palisades Fire",
        "kind": "fire",
        "time": "2025-01-07T18:30:00Z",
        "lat": 34.0706, "lon": -118.5427,
        "days_before": 14, "days_after": 4,
        "perimeter": {"name": "PALISADES", "year": "2025"},
        "summary": (
            "Started the same morning as the Eaton Fire, in the Santa Monica Mountains above "
            "Pacific Palisades. Driven by the same winds, it destroyed nearly 7,000 structures "
            "and burned about 23,000 acres."
        ),
        "glendale_link": "Same weather pattern, same kind of wildland-urban interface as Glendale.",
        "sources": ["https://www.fire.ca.gov/incidents/2025/1/7/palisades-fire"],
    },
    {
        "id": "storm-2024-02",
        "name": "February 2024 Atmospheric River",
        "kind": "flood",
        "time": "2024-02-05T00:00:00Z",
        "lat": 34.1425, "lon": -118.2551,
        "days_before": 10, "days_after": 5,
        "summary": (
            "A slow-moving atmospheric river dropped about 10 inches of rain on parts of Los "
            "Angeles over three days, with hundreds of mudslides, flash flooding and debris "
            "flows in the hills."
        ),
        "glendale_link": "Glendale's canyons and the LA River along its western edge both ran high.",
        "sources": ["https://www.weather.gov/lox/"],
    },
    {
        "id": "hilary-2023",
        "name": "Tropical Storm Hilary + Ojai Quake",
        "kind": "flood",
        "time": "2023-08-20T21:00:00Z",
        "lat": 34.1425, "lon": -118.2551,
        "days_before": 10, "days_after": 4,
        "summary": (
            "The first tropical storm warning ever issued for Southern California. Hilary "
            "brought record August rain, and a magnitude 5.1 earthquake struck near Ojai while "
            "the storm was overhead: two hazards at once."
        ),
        "glendale_link": "Tests the compound-hazard case: flooding and shaking together.",
        "sources": ["https://www.weather.gov/sgx/Hilary2023"],
    },
    {
        "id": "northridge-1994",
        "name": "Northridge Earthquake",
        "kind": "quake",
        "time": "1994-01-17T12:30:55Z",
        "lat": 34.213, "lon": -118.537,
        "days_before": 21, "days_after": 4,
        "quake_radius_km": 150, "quake_min_mag": 2.0,
        "summary": (
            "Magnitude 6.7 under the San Fernando Valley at 4:30 AM. 57 people died, freeways "
            "collapsed, and damage topped $20 billion, one of the costliest disasters in US "
            "history."
        ),
        "glendale_link": "The epicenter was about 27 km west of downtown Glendale.",
        "sources": ["https://earthquake.usgs.gov/earthquakes/eventpage/ci3144585/executive"],
    },
    {
        "id": "ridgecrest-2019",
        "name": "Ridgecrest Earthquakes",
        "kind": "quake",
        "time": "2019-07-06T03:19:53Z",
        "lat": 35.770, "lon": -117.599,
        "days_before": 7, "days_after": 4,
        "quake_radius_km": 250, "quake_min_mag": 2.5,
        "summary": (
            "A magnitude 6.4 on July 4 turned out to be the foreshock of a magnitude 7.1 34 "
            "hours later, the largest California earthquake in 20 years. Shaking was felt "
            "across Los Angeles."
        ),
        "glendale_link": "Shows how a sequence can escalate, and how far strong shaking travels.",
        "sources": ["https://earthquake.usgs.gov/earthquakes/eventpage/ci38457511/executive"],
    },
]


def http_json(url: str, retries: int = 3) -> object:
    last = None
    for attempt in range(retries):
        try:
            out = subprocess.run(
                ["curl", "-sfL", "--max-time", "90", "-A", UA, url],
                check=True, capture_output=True,
            ).stdout
            return json.loads(out)
        except (subprocess.CalledProcessError, json.JSONDecodeError) as exc:
            last = exc
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"GET failed after {retries} tries: {url}") from last


def iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


# ---------------------------------------------------------------------------------------------

HOURLY_VARS = [
    "temperature_2m", "relative_humidity_2m", "dew_point_2m", "precipitation",
    "wind_speed_10m", "wind_gusts_10m", "wind_direction_10m", "soil_moisture_0_to_7cm",
    "vapour_pressure_deficit",
]


def fetch_weather(lat: float, lon: float, start: datetime, end: datetime) -> dict:
    params = {
        "latitude": lat, "longitude": lon,
        "start_date": start.date().isoformat(), "end_date": end.date().isoformat(),
        "hourly": ",".join(HOURLY_VARS), "timezone": "GMT",
        "wind_speed_unit": "mph", "temperature_unit": "fahrenheit", "precipitation_unit": "inch",
    }
    d = http_json("https://archive-api.open-meteo.com/v1/archive?" + urllib.parse.urlencode(params))
    h = d["hourly"]
    return {
        "grid": {"lat": d["latitude"], "lon": d["longitude"], "elevation_m": d.get("elevation")},
        "units": d["hourly_units"],
        "time": [t + ":00Z" for t in h["time"]],
        **{k: h[k] for k in HOURLY_VARS},
    }


def fetch_rain_history(lat: float, lon: float, event: datetime) -> dict:
    """Daily rainfall for the 365 days before the event, for dryness context."""
    start = (event - timedelta(days=365)).date()
    params = {
        "latitude": lat, "longitude": lon, "start_date": start.isoformat(),
        "end_date": event.date().isoformat(), "daily": "precipitation_sum",
        "timezone": "America/Los_Angeles", "precipitation_unit": "inch",
    }
    d = http_json("https://archive-api.open-meteo.com/v1/archive?" + urllib.parse.urlencode(params))
    return {"date": d["daily"]["time"], "precip_in": d["daily"]["precipitation_sum"]}


def fetch_air(start: datetime, end: datetime) -> dict | None:
    params = {
        "latitude": GLENDALE[0], "longitude": GLENDALE[1],
        "start_date": start.date().isoformat(), "end_date": end.date().isoformat(),
        "hourly": "pm2_5,us_aqi", "timezone": "GMT",
    }
    try:
        d = http_json("https://air-quality-api.open-meteo.com/v1/air-quality?"
                      + urllib.parse.urlencode(params))
    except RuntimeError:
        return None
    h = d.get("hourly") or {}
    if not any(v is not None for v in h.get("pm2_5", [])):
        return None
    return {"time": [t + ":00Z" for t in h["time"]], "pm2_5": h["pm2_5"], "us_aqi": h["us_aqi"]}


def fetch_quakes(ev: dict, start: datetime, end: datetime) -> list[dict]:
    params = {
        "format": "geojson", "starttime": iso(start), "endtime": iso(end),
        "latitude": ev["lat"], "longitude": ev["lon"],
        "maxradiuskm": ev.get("quake_radius_km", 120),
        "minmagnitude": ev.get("quake_min_mag", 2.5), "orderby": "time-asc",
    }
    d = http_json("https://earthquake.usgs.gov/fdsnws/event/1/query?" + urllib.parse.urlencode(params))
    out = []
    for f in d["features"]:
        p = f["properties"]
        lon, lat, depth = f["geometry"]["coordinates"][:3]
        out.append({
            "t": iso(datetime.fromtimestamp(p["time"] / 1000, tz=timezone.utc)),
            "mag": p["mag"], "place": p["place"], "lat": round(lat, 4), "lon": round(lon, 4),
            "depth_km": depth, "url": p["url"],
            "km_to_glendale": round(haversine_km(lat, lon, *GLENDALE), 1),
        })
    return out


def fetch_warnings(start: datetime, end: datetime) -> list[dict]:
    out = []
    for year in sorted({start.year, end.year}):
        try:
            d = http_json(f"https://mesonet.agron.iastate.edu/json/vtec_events.py?wfo=LOX&year={year}")
        except RuntimeError:
            continue
        for e in d.get("events", []):
            if e["phenomena"] not in PHENOMENA:
                continue
            if not any(h in (e.get("locations") or "") for h in LA_ZONE_HINTS):
                continue
            issue = e.get("product_issue") or e["issue"]
            if not issue or not e.get("expire"):
                continue
            if issue > iso(end) or e["expire"] < iso(start):
                continue
            out.append({
                "code": e["phenomena"], "sig": e["significance"],
                "name": f'{e["ph_name"]} {e["sig_name"]}',
                "group": PHENOMENA[e["phenomena"]],
                "issued": issue, "starts": e["issue"], "expires": e["expire"],
                "locations": e["locations"], "url": e["url"],
            })
    out.sort(key=lambda w: w["issued"])
    return out


PERIM_HISTORY = ("https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/"
                 "InterAgencyFirePerimeterHistory_All_Years_View/FeatureServer/0/query")
PERIM_WFIGS = ("https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/"
               "WFIGS_Interagency_Perimeters/FeatureServer/0/query")


def fetch_perimeter(spec: dict) -> dict | None:
    name = spec["name"].upper()
    attempts = [
        (PERIM_HISTORY,
         f"UPPER(INCIDENT) LIKE '%{name}%' AND FIRE_YEAR='{spec['year']}'", "GIS_ACRES"),
        (PERIM_WFIGS,
         f"UPPER(poly_IncidentName) LIKE '%{name}%' AND "
         f"attr_FireDiscoveryDateTime >= DATE '{spec['year']}-01-01' AND "
         f"attr_FireDiscoveryDateTime < DATE '{int(spec['year']) + 1}-01-01'", "poly_GISAcres"),
    ]
    for url, where, acres_field in attempts:
        params = {"where": where, "outFields": "*", "outSR": 4326, "f": "geojson",
                  "geometryPrecision": 4}
        try:
            d = http_json(url + "?" + urllib.parse.urlencode(params))
        except RuntimeError:
            continue
        feats = [f for f in d.get("features", []) if f.get("geometry")]
        if not feats:
            continue
        best = max(feats, key=lambda f: f["properties"].get(acres_field) or 0)
        return {
            "type": "Feature", "geometry": best["geometry"],
            "properties": {"acres": round(best["properties"].get(acres_field) or 0),
                           "source": url.rsplit("/FeatureServer", 1)[0]},
        }
    return None


def fetch_calfire(start: datetime, end: datetime) -> list[dict]:
    out = []
    for year in sorted({start.year, end.year}):
        try:
            d = http_json("https://incidents.fire.ca.gov/umbraco/api/IncidentApi/List?"
                          f"inactive=true&year={year}")
        except RuntimeError:
            continue
        for i in d:
            started = i.get("Started")
            if not started or not i.get("Latitude"):
                continue
            if not (iso(start) <= started[:19] + "Z" <= iso(end)):
                continue
            km = haversine_km(i["Latitude"], i["Longitude"], *GLENDALE)
            if km > 150:
                continue
            out.append({
                "t": started[:19] + "Z", "name": (i.get("Name") or "").strip(),
                "acres": i.get("AcresBurned"), "lat": i["Latitude"], "lon": i["Longitude"],
                "county": i.get("County"), "url": i.get("Url"), "km_to_glendale": round(km, 1),
            })
    out.sort(key=lambda x: x["t"])
    return out


def fetch_gauges(start: datetime, end: datetime) -> list[dict]:
    out = []
    for site, label in GAUGES.items():
        params = {
            "f": "json", "monitoring_location_id": site, "parameter_code": "00060",
            "datetime": f"{iso(start)}/{iso(end)}", "limit": 10000,
            "properties": "time,value",
        }
        try:
            d = http_json("https://api.waterdata.usgs.gov/ogcapi/v0/collections/continuous/items?"
                          + urllib.parse.urlencode(params))
        except RuntimeError:
            continue
        feats = d.get("features", [])
        if not feats:
            continue
        # Hourly max keeps the file small while preserving flood peaks.
        hourly: dict[str, float] = {}
        for f in feats:
            p = f["properties"]
            if p.get("value") in (None, ""):
                continue
            hour = p["time"][:13] + ":00:00Z"
            hourly[hour] = max(hourly.get(hour, 0.0), float(p["value"]))
        if not hourly:
            continue
        times = sorted(hourly)
        coords = feats[0]["geometry"]["coordinates"] if feats[0].get("geometry") else None
        out.append({"id": site, "name": label, "lonlat": coords,
                    "time": times, "cfs": [hourly[t] for t in times]})
    return out


def build(ev: dict) -> dict:
    t0 = datetime.strptime(ev["time"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    start = t0 - timedelta(days=ev["days_before"])
    end = t0 + timedelta(days=ev["days_after"])
    print(f"\n{ev['id']}: {iso(start)} .. {iso(end)}")

    def step(label, fn, *args):
        t = time.time()
        try:
            val = fn(*args)
        except Exception as exc:  # keep going; the app shows the gap
            print(f"  {label:10s} FAILED: {exc}")
            return None, str(exc)
        n = len(val) if isinstance(val, list) else ("ok" if val else "none")
        print(f"  {label:10s} {n} ({time.time() - t:.1f}s)")
        return val, None

    errors = {}
    data: dict = {k: v for k, v in ev.items() if k not in ("perimeter",)}
    data["window"] = {"start": iso(start), "end": iso(end)}
    data["glendale"] = {"lat": GLENDALE[0], "lon": GLENDALE[1]}

    wx_g, errors["weather_glendale"] = step("wx glen", fetch_weather, *GLENDALE, start, end)
    data["weather_glendale"] = wx_g
    if haversine_km(ev["lat"], ev["lon"], *GLENDALE) > 3:
        wx_e, errors["weather_event"] = step("wx event", fetch_weather, ev["lat"], ev["lon"],
                                              start, end)
        data["weather_event"] = wx_e
    else:
        data["weather_event"] = None
    data["rain_year_glendale"], errors["rain_year"] = step(
        "rain 365d", fetch_rain_history, *GLENDALE, t0)
    data["air_glendale"], errors["air"] = step("air", fetch_air, start, end)
    data["quakes"], errors["quakes"] = step("quakes", fetch_quakes, ev, start, end)
    data["warnings"], errors["warnings"] = step("warnings", fetch_warnings, start, end)
    data["calfire"], errors["calfire"] = step("calfire", fetch_calfire, start, end)
    if ev.get("perimeter"):
        data["perimeter"], errors["perimeter"] = step("perimeter", fetch_perimeter,
                                                       ev["perimeter"])
    else:
        data["perimeter"] = None
    data["gauges"], errors["gauges"] = step("gauges", fetch_gauges, start, end)
    data["errors"] = {k: v for k, v in errors.items() if v}
    data["fetched_at"] = iso(datetime.now(timezone.utc))
    return data


def main(only: list[str]) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    index = []
    for ev in EVENTS:
        path = OUT / f"{ev['id']}.json"
        if not only or ev["id"] in only:
            data = build(ev)
            path.write_text(json.dumps(data, separators=(",", ":")))
            print(f"  -> {path.relative_to(ROOT)} {path.stat().st_size / 1e3:.0f} KB")
        index.append({k: ev[k] for k in ("id", "name", "kind", "time", "summary")})
    (OUT / "index.json").write_text(json.dumps(index, indent=2))


if __name__ == "__main__":
    main(sys.argv[1:])
