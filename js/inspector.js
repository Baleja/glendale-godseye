import { PolygonIndex } from "./geo.js";
import { HISTORY_BOUNDS, ZONE_GROUPS } from "./map.js";
import { escapeHtml, haversineKm } from "./util.js";

const SOURCES = {
  boundary: "data/glendale/city_boundary.geojson",
  zoning: "data/glendale/zoning.geojson",
  neighborhoods: "data/glendale/neighborhood_zones.geojson",
  fhsz: "data/glendale/calfire_fhsz_lra.geojson",
  flood: "data/glendale/fema_flood_zones.geojson",
  dam: "data/glendale/dwr_dam_inundation.geojson",
  liquefaction: "data/glendale/cgs_liquefaction_zones.geojson",
  landslide: "data/glendale/cgs_landslide_zones.geojson",
  fault: "data/glendale/cgs_fault_zones.geojson",
  districts: "data/glendale/fire_station_districts.geojson",
  fires: "data/history/fire_perimeters.geojson",
  basins: "data/history/debris_flow_basins.geojson",
};
const HAZARD_MARGIN_KM = 2;
const FIRE_IDS = { eat2025: "2025 Eaton" };

let loaded = null;

async function load() {
  if (loaded) return loaded;
  const entries = await Promise.all(Object.entries(SOURCES).map(async ([k, url]) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return [k, new PolygonIndex(await res.json())];
  }));
  const stations = await (await fetch("data/glendale/fire_stations.geojson")).json();
  loaded = { ...Object.fromEntries(entries), stations: stations.features };
  return loaded;
}

const row = (label, html, level = "") => `<div class="insp-row ${level}"><span>${label}</span><div>${html}</div></div>`;
const note = (t) => `<div class="insp-note">${t}</div>`;

/** Renders what the data says about one point into `el`. Returns the neighborhood name, or null outside the city. */
export async function inspect(el, lngLat) {
  el.innerHTML = '<p class="fine">Checking every layer at this spot…</p>';
  let d;
  try {
    d = await load();
  } catch (err) {
    el.innerHTML = `<p class="feed-status bad">Could not load map layers (${escapeHtml(err.message)}).</p>`;
    return;
  }
  const { lng: lon, lat } = lngLat;
  const inCity = d.boundary.hits(lon, lat).length > 0;
  const hood = d.neighborhoods.hits(lon, lat)[0]?.NAME;
  const html = [];

  html.push(`<div class="insp-head"><b>${inCity ? escapeHtml(hood || "Glendale") : "Outside Glendale city limits"}</b>
    <span class="fine">${lat.toFixed(5)}, ${lon.toFixed(5)}</span></div>`);

  // Zoning is only mapped inside the city.
  const z = d.zoning.hits(lon, lat)[0];
  if (z) {
    const g = ZONE_GROUPS[z.zone_group];
    html.push(row("Zoning", `<span class="swatch" style="background:${g?.color}"></span><b>${escapeHtml(z.ZONE_DISTR)}</b> · ${escapeHtml(z.ZONE_DESC || "")}<br><span class="fine">${escapeHtml(g?.label || "")}. General plan: ${escapeHtml(z.GPLANDESC || "—")}. Zoning is what's allowed, not what's built.</span>`));
  } else {
    html.push(row("Zoning", inCity ? '<span class="fine">Street or right-of-way (no zoning polygon)</span>' : '<span class="fine">Not covered (city data only)</span>'));
  }

  // Hazard layers extend about 2 km past the city; beyond that, "no zone" means "no data".
  const nearCity = inCity || isNearGlendale(lon, lat);
  if (!nearCity) {
    html.push(note("Hazard maps in this app only cover Glendale plus about 2 km. Outside that, no zone shown does not mean no hazard."));
  } else {
    const fire = d.fhsz.hits(lon, lat)[0]?.FHSZ_Description;
    const fireLevel = fire === "Very High" ? "danger" : fire === "High" ? "warn" : "";
    html.push(row("Fire hazard", fire
      ? `<b>${escapeHtml(fire)}</b>${fire === "NonWildland" ? ' <span class="fine">(unzoned, not safe: embers travel)</span>' : ""}`
      : '<span class="fine">No class mapped</span>', fireLevel));

    const fl = d.flood.hits(lon, lat)[0];
    let floodHtml = '<span class="fine">No FEMA zone mapped here</span>';
    if (fl) {
      floodHtml = `<b>Zone ${escapeHtml(fl.FLD_ZONE)}</b>${fl.ZONE_SUBTY ? ` · ${escapeHtml(fl.ZONE_SUBTY.toLowerCase())}` : ""}`;
      if (fl.FLD_ZONE === "D") floodHtml += ' <span class="fine">(not studied, not safe)</span>';
    }
    html.push(row("Flood (FEMA)", floodHtml, fl?.SFHA_TF === "T" ? "danger" : ""));

    const dams = [...new Set(d.dam.hits(lon, lat).map((p) => p.DamName))];
    html.push(row("Dam inundation", dams.length
      ? `<b>${dams.map(escapeHtml).join(", ")}</b><br><span class="fine">Area that could flood if the dam failed. Hazard class rates consequences, not likelihood.</span>`
      : '<span class="fine">Not in a mapped inundation area</span>', dams.length ? "warn" : ""));

    const seismic = [
      d.fault.hits(lon, lat).length && "fault rupture",
      d.liquefaction.hits(lon, lat).length && "liquefaction",
      d.landslide.hits(lon, lat).length && "earthquake landslide",
    ].filter(Boolean);
    html.push(row("Seismic zones (CGS)", seismic.length
      ? `<b>${seismic.join(", ")}</b>`
      : '<span class="fine">None mapped (shaking still reaches everywhere)</span>', seismic.length ? "warn" : ""));
  }

  const burns = d.fires.hits(lon, lat).sort((a, b) => b.year - a.year);
  const unique = [...new Map(burns.map((b) => [`${b.year}-${b.name}`, b])).values()];
  const [[x0, y0], [x1, y1]] = HISTORY_BOUNDS;
  if (lon < x0 || lon > x1 || lat < y0 || lat > y1) html.push(row("Fire history", '<span class="fine">Outside the area fire history was downloaded for</span>'));
  else html.push(row("Fire history", unique.length
    ? `<b>Burned ${unique.length} time${unique.length > 1 ? "s" : ""}</b> in mapped fires<br><span class="fine">${unique.slice(0, 6).map((b) => `${escapeHtml(b.name)} ${b.year}`).join(" · ")}${unique.length > 6 ? " …" : ""}</span>`
    : '<span class="fine">No mapped fire perimeter here (the archive is incomplete, especially before 1950)</span>', unique.length >= 2 ? "danger" : unique.length ? "warn" : ""));

  const basin = d.basins.hits(lon, lat)[0];
  if (basin) html.push(row("Debris flow (USGS)", `<b>${escapeHtml(basin.hazard || "Unrated")}</b> combined hazard after the ${escapeHtml(FIRE_IDS[basin.fire_id] || basin.fire_id)} fire<br><span class="fine">Conditions right after the fire; does not show where debris would run out.</span>`, basin.hazard === "High" ? "danger" : "warn"));

  const nearest = d.stations
    .map((s) => ({ s, km: haversineKm(lat, lon, s.geometry.coordinates[1], s.geometry.coordinates[0]) }))
    .sort((a, b) => a.km - b.km)[0];
  const district = d.districts.hits(lon, lat)[0]?.Fire_Distr;
  if (nearest && nearCity) html.push(row("Nearest Glendale fire station", `<b>${escapeHtml(nearest.s.properties.NAME)}</b>, ${(nearest.km * 0.621).toFixed(1)} mi straight-line<br><span class="fine">${escapeHtml(nearest.s.properties.ADDRESS)}${district ? ` · district ${escapeHtml(district)}` : ""}</span>`));

  html.push(note('Regulatory maps, not a site assessment. Find your evacuation zone on <a href="https://protect.genasys.com/" target="_blank" rel="noopener">Genasys Protect</a>.'));
  el.innerHTML = html.join("");
  return inCity ? hood || "Glendale" : null;
}

function isNearGlendale(lon, lat) {
  // Rough test against the city's extent grown by the hazard layers' 2 km margin.
  const dLat = HAZARD_MARGIN_KM / 111.3;
  const dLon = HAZARD_MARGIN_KM / (111.3 * Math.cos((34.19 * Math.PI) / 180));
  return lon >= -118.32 - dLon && lon <= -118.18 + dLon && lat >= 34.10 - dLat && lat <= 34.27 + dLat;
}
