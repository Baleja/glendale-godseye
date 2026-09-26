# Glendale God's Eye: Disaster Time Machine

A "god's eye view" of Glendale, California, that replays the public data record around past Los Angeles disasters so you can watch conditions change in the days **before** each event: when NWS warnings went out, how fast humidity collapsed, when winds peaked, how long it had been since rain, how a quake sequence escalated. The goal is preparedness: learn what the lead-up looks like so the next one isn't a surprise.

Built for Jewel City Hacks 5 on top of the [GlendaleGisMcp](https://github.com/HackerFund/GlendaleGisMcp) hazard snapshot and the feeds listed in its [real-time sources guide](https://github.com/HackerFund/GlendaleGisMcp/blob/main/docs/real-time-sources.md).

## Run it

No install and no build step. You only need Python 3 (for the static file server).

```sh
cd ~/Projects/glendale-godseye
python3 -m http.server 8765
# open http://localhost:8765
```

The event data is already in `data/`. To refresh it:

```sh
python3 scripts/fetch_events.py              # all events (~2 minutes)
python3 scripts/fetch_events.py eaton-2025   # one event
```

To rebuild the Glendale layers from a newer snapshot, download and unzip the snapshot release from GlendaleGisMcp, then:

```sh
python3 scripts/prepare_glendale.py /path/to/unzipped/snapshot
python3 scripts/compute_exposure.py      # zoning × hazard table (~30 s)
```

To refresh electricity prices and water use (about 5 minutes; EIA downloads are slow):

```sh
python3 scripts/fetch_utility.py
```

Rate increases are hand-curated in `data/utility/rate_actions.json`, with a source link for each step. Update it when City Council adopts new rates.

To refresh the fire history and debris-flow layers:

```sh
python3 scripts/fetch_history.py
python3 scripts/compute_exposure.py
```

## Using it

The top bar has three views. Click anywhere on the map in any view to see what the data says about that spot: zoning, fire hazard, FEMA flood zone, dam inundation, seismic zones, how many times it has burned, and the nearest Glendale fire station.

**Fire history** (`#history`) maps about 600 wildfire perimeters around Glendale from 1878 to 2025. Overlapping burns stack darker. Pick a year range, click a decade bar, or press Animate to sweep a 10-year window through time. The side panel lists the largest fires in range (click to zoom) and links to the weather replays for La Tuna, Station and Eaton. The Eaton burn scar also shows USGS post-fire debris-flow basins.

**Zoning & exposure** (`#zoning`) colors Glendale's zoning by type and shows a table of how much of each zone type sits in each hazard area, for example 74% of single-family-zoned land is Very High fire hazard and 74% of industrial land is in a liquefaction zone. Click a row or legend entry to highlight that zone type.

**Energy & water** (`#energy`) tracks what Glendale pays for power and water. A rate index charts every electric and water increase since 2019, with proposed steps dashed: electric is up about 42% from Jan 2024 to Nov 2027, and the proposed water plan would add about 120% from 2027 to 2031. A second chart compares Glendale's average residential price per kWh with Burbank, Pasadena, LADWP and SCE since 2015. A third shows monthly water use per person. The map pin marks the Grayson plant's 75 MW / 300 MWh battery project.

**Event replay** (the default):

- Pick an event in the top bar. The replay starts 72 hours before the event.
- Press ▶ (or Space) to play; drag the slider, click any chart, or use ← → (Shift for a day) to scrub.
- **Readings at cursor** shows conditions at that moment, at the event site or at Glendale; red and amber mark dangerous levels.
- **Warning signs before the event** lists what the record showed and how many hours or days ahead.
- **Map layers** toggles the hazard maps (fire hazard, flood, dam inundation, landslide, liquefaction, fault zones), zoning, fire history, fire stations, hospitals and schools.
- **Compare with today** puts the live Glendale forecast, NWS alerts and USGS quakes beside the 48 hours before each past fire.

## Events

| Event | Type | Why it matters for Glendale |
| --- | --- | --- |
| La Tuna Fire (Sep 2017) | Wildfire | Burned the Verdugo Mountains; Glendale evacuations |
| Station Fire (Aug 2009) | Wildfire | Bordered La Crescenta and Tujunga; debris flows followed |
| Eaton Fire (Jan 2025) | Wildfire | Same foothills, 10 km east |
| Palisades Fire (Jan 2025) | Wildfire | Same Santa Ana wind event |
| February 2024 atmospheric river | Flood | Mudslides and flash floods across LA |
| Tropical Storm Hilary + Ojai M5.1 (Aug 2023) | Flood + quake | Compound hazards at once |
| Northridge earthquake (Jan 1994) | Earthquake | 27 km from downtown Glendale |
| Ridgecrest earthquakes (Jul 2019) | Earthquake | A foreshock that escalated to M7.1 |

Add an event by appending to `EVENTS` in `scripts/fetch_events.py` and re-running it.

## Data sources

| Data | Source | Notes |
| --- | --- | --- |
| Hourly weather (temp, humidity, wind, rain, VPD, soil moisture) | [Open-Meteo historical API](https://open-meteo.com/en/docs/historical-weather-api) (ERA5) | About 10 km grid; smoother than station readings |
| Air quality (PM2.5, US AQI) | [Open-Meteo air quality](https://open-meteo.com/en/docs/air-quality-api) (CAMS) | Modeled; only available from about 2022 |
| NWS watches, warnings, advisories | [Iowa Environmental Mesonet VTEC archive](https://mesonet.agron.iastate.edu/vtec/), WFO LOX | Filtered to LA County zones |
| Earthquakes | [USGS ComCat](https://earthquake.usgs.gov/fdsnws/event/1/) | |
| Fire perimeters | [NIFC](https://data-nifc.opendata.arcgis.com/) interagency history and WFIGS | Final perimeter only, no day-by-day spread |
| Fire starts | [CAL FIRE incidents](https://www.fire.ca.gov/incidents) | Undocumented feed |
| Streamflow | [USGS Water Data API](https://api.waterdata.usgs.gov/) | Only Arroyo Seco has data in the new API for these dates |
| Glendale hazard and city layers | [GlendaleGisMcp](https://github.com/HackerFund/GlendaleGisMcp) snapshot 2026-09-26 | Simplified to about 1 m for the browser |
| Zoning | City of Glendale zoning via the GlendaleGisMcp snapshot | Current zoning only (no history); simplified to about 3 m |
| Fire history | NIFC [InterAgency Fire Perimeter History](https://data-nifc.opendata.arcgis.com/) (to 2019) and WFIGS (2020+) | Incomplete before 1950; small fires often missing |
| Residential electricity prices | [EIA Form 861](https://www.eia.gov/electricity/data/eia861/) sales to ultimate customers | Annual average (revenue ÷ kWh), not a tariff; bundled customers only |
| Water use | [State Water Board urban supplier reports](https://data.ca.gov/dataset/urws-conservation-supply-demand) | Monthly, self-reported by the City of Glendale |
| Rate increases, Grayson storage | City of Glendale notices, council actions and local news | Hand-curated; sources in `data/utility/rate_actions.json` |
| Post-fire debris flow | [USGS emergency assessments](https://www.usgs.gov/programs/landslide-hazards/science/emergency-assessment-post-fire-debris-flow-hazards) | Basin estimates only exist for fires since 2020 (Eaton here) |
| Live mode | Open-Meteo forecast, [NWS alerts API](https://www.weather.gov/documentation/services-web-api), USGS feeds | Fetched in the browser |
| Basemap | [OpenFreeMap](https://openfreemap.org/) dark style, © OpenStreetMap | |

## Limits

- This replays archives for learning. **It is not an alert system.** In an emergency, follow official channels: [Alert LA County](https://alertlacounty.genasys.com/portal/en/register), [Glendale Everbridge](https://www.glendaleca.gov/government/departments/fire-department/other/emergency-preparedness-response/city-wide-emergency-communications), [Genasys Protect](https://protect.genasys.com/), [MyShake](https://www.earthquake.ca.gov/get-alerts/).
- Hazard layers are regulatory maps, not site assessments. Outside a zone doesn't mean safe. CAL FIRE "NonWildland" means unzoned, not safe, and FEMA Zone D means not studied.
- Zoning shows what is allowed, not what is built. Exposure shares come from a 50 m sample grid and are approximate.
- Dam inundation areas show what would flood if a dam failed; the hazard class rates consequences, not likelihood.
- The fire-weather score in live mode is an illustrative comparison made for this app, not an official rating.
- Event times are approximate local reports of ignition or peak.
