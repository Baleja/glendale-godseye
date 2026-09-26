# The Glendale Grid

One map of what public data says about living in Glendale, California: what you pay for power and water and where it's heading, which hazards your block is mapped for, what has burned before, and what the days before LA's biggest disasters looked like.

## Why this exists: the story for Glendale residents

Glendale households are being asked to absorb a lot at once. Glendale Water & Power raised electric rates about 42% between January 2024 and November 2027, and the city has proposed a water plan that would more than double water rates by 2031. Meanwhile about two-thirds of the city sits in a Very High fire hazard zone, the Eaton fire burned into the foothills next door in 2025, and the next large earthquake is a matter of when.

The facts behind all of this are public, but they are scattered across council agendas, federal utility surveys, state hazard maps and fire archives that few residents will ever open. The Glendale Grid puts them on one map, in plain language, for your neighborhood.

**Maria, a renter in the City Center**, opens the app and lands on Energy & water. Her neighborhood is blue on the electric-bill map, since apartments use less, but it turns red on "Share of income": one City Center tract spends about 6% of household income on utilities, the highest in the city. She sees the next electric step (+2.95% on November 1) and the proposed 53% water increase for January 2027 (about $37 a month for an average single-family home). She also learns that City Council, not the state, sets these rates, and that community meetings and a Prop 218 hearing come before the water vote.

**David, a homeowner in the Verdugo foothills**, sees some of the highest electric bills in the city on his hillside. He switches to Fire history and moves a 10-year window across more than a century of fire perimeters to see how often the hills above him have burned. Then he clicks his block and gets a plain summary: zoning, fire hazard class, flood and seismic zones, how many times the spot has burned, and the nearest fire station.

**A neighborhood council or CERT volunteer** uses Zoning & exposure to show that 74% of single-family-zoned land is in a Very High fire hazard zone and 74% of industrial land sits on liquefaction-prone ground. Then they play Event replay to show that before Eaton, a Red Flag Watch went out about four days ahead and the warning about two days ahead. That lead time is the case for signing people up for Alert LA County and Genasys Protect now.

What residents get:

- **Know your bill before it arrives.** Every approved and proposed rate step, with dates and links to the source, and how Glendale compares with Burbank, Pasadena, LADWP and SCE.
- **See your neighborhood, not just the city average.** Bills, estimated usage and utility cost burden for each of 42 census tracts, with a timeline to watch them change.
- **See what your home is worth, and what rent costs, over time.** Zillow home values by ZIP since 2000 and rents since 2015, next to Glendale overall and LA County.
- **See where Glendale is building.** Every housing project approved and started since 2018, as a heatmap over zoning, with how many are ADUs and how many sit in Very High fire hazard zones.
- **Know your risk in one click.** Zoning, fire hazard, flood, dam inundation, seismic zones, burn history and the nearest fire station for any spot on the map.
- **Learn what warning looks like.** Replays of eight LA disasters show the signals that came before, and how long before.

What it is not: an alert system, a site assessment, or a bill calculator. Every view says where its numbers come from and what they can't tell you.

## The five views

**Energy & water** (the default), **$$$ Property values**, **Fire history**, **Zoning & exposure** (with housing permits) and **Event replay**. Details are under [Using it](#using-it).

## Future use cases

### Vacant properties

Vacant lots and empty buildings matter to residents in three ways: fire risk (unmaintained brush and structures in the foothills), housing supply (units that could be homes) and neighborhood safety. A vacancy layer would let residents and the city see where vacancy concentrates and how it overlaps with fire hazard and zoning.

- **Where vacancy is.** ACS table B25002 (occupied vs. vacant units) and B25004 (why units are vacant: for rent, for sale, seasonal, "other vacant") from the same keyless Census summary files the energy heatmap already uses, mapped by tract with the same timeline.
- **Vacant land by parcel.** The city's live parcel layer (`Common/Zoning/FeatureServer/1`, about 54,000 parcels with a land-use type) and the LA County Assessor's parcel data (use codes and land vs. improvement values) identify vacant lots. Querying one parcel at a time on click, as the GlendaleGisMcp notes recommend, keeps the city's server load low.
- **Vacant and at risk.** Combine vacant parcels with Very High fire hazard and burn history to flag lots where brush clearance matters most. This could support the fire department's weed-abatement inspections or a resident "report an overgrown lot" flow.
- **Postal vacancy trends.** HUD's quarterly USPS vacancy data (free registration required) would add a more current, quarterly signal than the 5-year Census averages.

### Permitting

Permits show where Glendale is changing: new ADUs, apartment projects, solar and battery installs, and rebuilding after disasters.

- **Housing permits on the map (built).** Zoning & exposure now maps every housing project from the state's Housing Element Annual Progress Reports since 2018: approvals in cyan, construction starts in orange, with a year picker. See [Using it](#using-it).
- **Permits vs. hazards (started).** The permit panel already reports the share of approved projects in Very High fire hazard zones. Next: a year-by-year chart of new units inside fire, liquefaction and dam inundation zones, to show whether growth is moving toward or away from risk.
- **Non-housing permits.** The state data only covers projects that add homes. Commercial, remodel and demolition permits need the city's own building permit records.
- **Energy permits.** Solar, battery and electrification permits by neighborhood would show who is adopting clean energy as rates rise, and where rebates or outreach could help. This needs the city's building permit records, which have no public API yet; a records request or city data partnership would come first.
- **"What can I build here?"** Pair the city's address geocoder (`Common/CAD_SiteAddress_Street/GeocodeServer`) with zoning, hazards and recent nearby permits, so a homeowner considering an ADU sees the rules, the risks and what neighbors have already built. The city's GIS terms require a clear disclaimer that this is not a legal description or survey.
- **Rebuild tracking after a disaster.** After a fire or quake, permit activity inside the damage footprint shows how fast a neighborhood is recovering, which pairs naturally with the Event replay view.

## Background

The project started as a disaster time machine: replay the public data record around past Los Angeles disasters so you can watch conditions change in the days **before** each event (when NWS warnings went out, how fast humidity collapsed, when winds peaked, how long it had been since rain, how a quake sequence escalated) and learn what the lead-up looks like so the next one isn't a surprise.

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

To refresh the neighborhood heatmap (Census tract boundaries and ACS utility costs, about 1 minute, no API key):

```sh
python3 scripts/fetch_neighborhood_costs.py
```

To refresh home values and rents (Zillow ZIP files are streamed and filtered, under a minute) and housing permits (a few seconds):

```sh
python3 scripts/fetch_property_values.py
python3 scripts/fetch_permits.py
```

Rate increases are hand-curated in `data/utility/rate_actions.json`, with a source link for each step. Update it when City Council adopts new rates.

To refresh the fire history and debris-flow layers:

```sh
python3 scripts/fetch_history.py
python3 scripts/compute_exposure.py
```

## Using it

The bar under the title switches between the five views. Click anywhere on the map in any view to see what the data says about that spot: zoning, fire hazard, FEMA flood zone, dam inundation, seismic zones, how many times it has burned, and the nearest Glendale fire station.

**Fire history** (`#history`) maps about 600 wildfire perimeters around Glendale from 1878 to 2025. Overlapping burns stack darker. Pick a year range, click a decade bar, or press Animate to sweep a 10-year window through time. The side panel lists the largest fires in range (click to zoom) and links to the weather replays for La Tuna, Station and Eaton. The Eaton burn scar also shows USGS post-fire debris-flow basins.

**Zoning & exposure** (`#zoning`) colors Glendale's zoning by type and shows a table of how much of each zone type sits in each hazard area, for example 74% of single-family-zoned land is Very High fire hazard and 74% of industrial land is in a liquefaction zone. Click a row or legend entry to highlight that zone type.

The same view maps **housing permits** from the state's Annual Progress Reports: a cyan heatmap of projects approved and an orange one of projects where construction has started (building permit issued). Pick a year from 2018 to 2025 or "All years", or press ▶ to step through them. Zoom to street level to see each project as a dot (cyan = approved, not started; orange = under construction; gray = completed) and hover it for the address, unit type, dates and hazard zones. Since 2018, Glendale approved 1,997 housing projects (4,096 homes). 90% were ADUs, 29% are in a Very High fire hazard zone, and 499 projects (1,388 homes) are under construction now.

**$$$ Property values** (`#property`) colors Glendale's ZIP codes by Zillow's typical home value (all homes, single-family or condos) or typical rent. Drag the timeline or press ▶ to go year by year from 2000 (rents from 2015). "Same scale, all years" shows values rising citywide; "Rescale each year" compares ZIPs within a year. The side panel ranks ZIPs and compares Glendale with LA County: the typical Glendale home went from about $270,000 in 2000 to $1.18 million in 2026 (+337%, vs. +301% for the county). Charts show every ZIP's value and rent history.

**Energy & water** (`#energy`, the default view) tracks what Glendale pays for power and water. A heatmap colors each of Glendale's 42 census tracts by median electric bill, estimated electricity use, gas bill, water and sewer bill, or utility costs as a share of income. Drag the timeline or press ▶ to step through the Census survey periods from 2017–2021 to 2020–2024, and hover a neighborhood for all its numbers. A rate index charts every electric and water increase since 2019, with proposed steps dashed: electric is up about 42% from Jan 2024 to Nov 2027, and the proposed water plan would add about 120% from 2027 to 2031. A second chart compares Glendale's average residential price per kWh with Burbank, Pasadena, LADWP and SCE since 2015. A third shows monthly water use per person. The map pin marks the Grayson plant's 75 MW / 300 MWh battery project.

**Event replay**:

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
| Neighborhood bills and usage | [ACS 5-year summary files](https://www.census.gov/programs-surveys/acs/data/summary-file.html) B25132–B25134, B19013; [TIGERweb](https://tigerweb.geo.census.gov/) 2020 tracts | Self-reported bills in dollar bands; usage is an estimate scaled to GWP's EIA average |
| Home values and rents | [Zillow Research](https://www.zillow.com/research/data/) ZHVI (all homes, single-family, condo) and ZORI by ZIP; ZIP boundaries from City of Glendale GIS | Smoothed estimates for the middle of the market, not sale or assessed prices; not inflation-adjusted |
| Housing permits | [HCD Housing Element Annual Progress Report, Table A2](https://data.ca.gov/dataset/housing-element-annual-progress-report-apr-data-by-jurisdiction-and-year) | Housing projects only; yearly reports merged by the city's tracking ID; locations geocoded by HCD |
| Water use | [State Water Board urban supplier reports](https://data.ca.gov/dataset/urws-conservation-supply-demand) | Monthly, self-reported by the City of Glendale |
| Rate increases, Grayson storage | City of Glendale notices, council actions and local news | Hand-curated; sources in `data/utility/rate_actions.json` |
| Post-fire debris flow | [USGS emergency assessments](https://www.usgs.gov/programs/landslide-hazards/science/emergency-assessment-post-fire-debris-flow-hazards) | Basin estimates only exist for fires since 2020 (Eaton here) |
| Live mode | Open-Meteo forecast, [NWS alerts API](https://www.weather.gov/documentation/services-web-api), USGS feeds | Fetched in the browser |
| Basemap | [OpenFreeMap](https://openfreemap.org/) dark style, © OpenStreetMap | |

## Limits

- This replays archives for learning. **It is not an alert system.** In an emergency, follow official channels: [Alert LA County](https://alertlacounty.genasys.com/portal/en/register), [Glendale Everbridge](https://www.glendaleca.gov/government/departments/fire-department/other/emergency-preparedness-response/city-wide-emergency-communications), [Genasys Protect](https://protect.genasys.com/), [MyShake](https://www.earthquake.ca.gov/get-alerts/).
- Hazard layers are regulatory maps, not site assessments. Outside a zone doesn't mean safe. CAL FIRE "NonWildland" means unzoned, not safe, and FEMA Zone D means not studied.
- Zoning shows what is allowed, not what is built. Exposure shares come from a 50 m sample grid and are approximate.
- ZIP codes don't follow city lines. 91020 (Montrose) and 91214 (La Crescenta) include unincorporated LA County, and 91210 is a tiny downtown ZIP with only a few large buildings.
- Housing permits cover only projects that add homes. "Construction started" means a building permit was issued, not that crews are on site.
- Dam inundation areas show what would flood if a dam failed; the hazard class rates consequences, not likelihood.
- The fire-weather score in live mode is an illustrative comparison made for this app, not an official rating.
- Event times are approximate local reports of ignition or peak.
