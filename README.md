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
```

## Using it

- Pick an event in the top bar. The replay starts 72 hours before the event.
- Press ▶ (or Space) to play; drag the slider, click any chart, or use ← → (Shift for a day) to scrub.
- **Readings at cursor** shows conditions at that moment, at the event site or at Glendale; red and amber mark dangerous levels.
- **Warning signs before the event** lists what the record showed and how many hours or days ahead.
- **Glendale layers** toggles the hazard maps (fire hazard, flood, dam inundation, landslide, liquefaction, fault zones) plus fire stations, hospitals and schools.
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
| Live mode | Open-Meteo forecast, [NWS alerts API](https://www.weather.gov/documentation/services-web-api), USGS feeds | Fetched in the browser |
| Basemap | [OpenFreeMap](https://openfreemap.org/) dark style, © OpenStreetMap | |

## Limits

- This replays archives for learning. **It is not an alert system.** In an emergency, follow official channels: [Alert LA County](https://alertlacounty.genasys.com/portal/en/register), [Glendale Everbridge](https://www.glendaleca.gov/government/departments/fire-department/other/emergency-preparedness-response/city-wide-emergency-communications), [Genasys Protect](https://protect.genasys.com/), [MyShake](https://www.earthquake.ca.gov/get-alerts/).
- Hazard layers are regulatory maps, not site assessments. Outside a zone doesn't mean safe.
- The fire-weather score in live mode is an illustrative comparison made for this app, not an official rating.
- Event times are approximate local reports of ignition or peak.
