/* global maplibregl */
import { DAY, GLENDALE, escapeHtml, fmtLocal, indexAt } from "./util.js";
import { valueAt } from "./signals.js";

const BASE_STYLE = "https://tiles.openfreemap.org/styles/dark";

export const ZONE_GROUPS = {
  single_family: { label: "Single-family residential (ROS, R1R, R1)", color: "#f4d35e" },
  multifamily: { label: "Multifamily residential (R-3050 to R-1250)", color: "#ee964b" },
  mixed_use: { label: "Mixed use / downtown (DSP, TOD, SFMU, IMU-R)", color: "#c77dff" },
  commercial: { label: "Commercial (C1–C3, CA, CH, CR, MS…)", color: "#ff5d8f" },
  industrial: { label: "Industrial / transportation (IND, IMU, T)", color: "#8d99ae" },
  recreation: { label: "Special recreation / open space (SR)", color: "#3ddc97" },
  cemetery: { label: "Cemetery", color: "#6c757d" },
  streets_unzoned: { label: "Streets and unzoned gaps", color: "#333a45" },
};

const zoneColorExpr = ["match", ["get", "zone_group"], ...Object.entries(ZONE_GROUPS).flatMap(([k, v]) => [k, v.color]), "#555"];
const yearColorExpr = ["interpolate", ["linear"], ["get", "year"], 1878, "#6b7280", 1950, "#b07d4f", 1980, "#ff9f1c", 2025, "#ff3d00"];

/**
 * Map layers the user can toggle. `kinds` = event types that turn the layer on by default in
 * replay mode; `modes` = other modes that turn it on.
 */
export const GLENDALE_LAYERS = [
  {
    id: "zoning", file: "zoning", label: "Zoning (City of Glendale)", kinds: [], modes: ["zoning"], swatch: "#f4d35e", type: "fill",
    paint: { "fill-color": zoneColorExpr, "fill-opacity": 0.55, "fill-outline-color": "rgba(7,11,18,0.6)" },
  },
  {
    id: "fire_history", url: "data/history/fire_perimeters.geojson", label: "Fire history 1878–2025 (NIFC)", kinds: [], modes: ["history"], swatch: "#ff9f1c", type: "fill",
    paint: { "fill-color": yearColorExpr, "fill-opacity": 0.16, "fill-outline-color": yearColorExpr },
  },
  {
    id: "debris_basins", url: "data/history/debris_flow_basins.geojson", label: "Post-fire debris-flow basins (USGS)", kinds: [], modes: ["history"], swatch: "#8d6e63", type: "fill",
    paint: { "fill-color": ["match", ["get", "hazard"], "High", "#d7263d", "Moderate", "#f49d37", "Low", "#f7e06b", "#888"], "fill-opacity": 0.55 },
  },
  {
    id: "fhsz", file: "calfire_fhsz_lra", label: "Fire hazard severity (CAL FIRE)", kinds: ["fire"],
    swatch: "#ff4d5e", type: "fill",
    paint: {
      "fill-color": ["match", ["get", "FHSZ_Description"], "Very High", "#ff4d5e", "High", "#ff9f1c", "Moderate", "#ffe066", "rgba(0,0,0,0)"],
      "fill-opacity": 0.28,
    },
  },
  {
    id: "flood", file: "fema_flood_zones", label: "FEMA flood zones", kinds: ["flood"], swatch: "#4da3ff", type: "fill",
    filter: ["any", ["==", ["get", "SFHA_TF"], "T"], ["==", ["get", "ZONE_SUBTY"], "0.2 PCT ANNUAL CHANCE FLOOD HAZARD"]],
    paint: { "fill-color": ["case", ["==", ["get", "SFHA_TF"], "T"], "#4da3ff", "#8fc6ff"], "fill-opacity": 0.4 },  },
  {
    id: "dam", file: "dwr_dam_inundation", label: "Dam inundation areas (DWR)", kinds: ["flood"], swatch: "#9b5de5", type: "fill",
    paint: { "fill-color": "#9b5de5", "fill-opacity": 0.18 },  },
  {
    id: "landslide", file: "cgs_landslide_zones", label: "Earthquake landslide zones (CGS)", kinds: ["quake", "flood"], swatch: "#b5835a", type: "fill",
    paint: { "fill-color": "#b5835a", "fill-opacity": 0.3 },  },
  {
    id: "liquefaction", file: "cgs_liquefaction_zones", label: "Liquefaction zones (CGS)", kinds: ["quake"], swatch: "#2ec4b6", type: "fill",
    paint: { "fill-color": "#2ec4b6", "fill-opacity": 0.35 },  },
  {
    id: "fault", file: "cgs_fault_zones", label: "Fault rupture zones (CGS)", kinds: ["quake"], swatch: "#ff4ecd", type: "fill",
    paint: { "fill-color": "#ff4ecd", "fill-opacity": 0.45 },  },
  {
    id: "neighborhoods", file: "neighborhood_zones", label: "Neighborhoods", kinds: [], modes: ["energy"], swatch: "#7d8ba3", type: "line",
    paint: { "line-color": "#7d8ba3", "line-width": 0.6, "line-opacity": 0.7 },
  },
  {
    id: "stations", file: "fire_stations", label: "Fire stations", kinds: ["fire", "flood", "quake"], swatch: "#ff6a3d", type: "circle",
    paint: { "circle-radius": 5, "circle-color": "#ff6a3d", "circle-stroke-color": "#fff", "circle-stroke-width": 1.2 },  },
  {
    id: "hospitals", file: "hospitals", label: "Hospitals", kinds: ["quake"], swatch: "#3ddc97", type: "circle",
    paint: { "circle-radius": 6, "circle-color": "#3ddc97", "circle-stroke-color": "#fff", "circle-stroke-width": 1.2 },  },
  {
    id: "schools", file: "schools", label: "Schools", kinds: [], swatch: "#ffe066", type: "circle",
    paint: { "circle-radius": 3.5, "circle-color": "#ffe066", "circle-stroke-color": "#222", "circle-stroke-width": 0.8 },  },
];

export function defaultLayers(mode, kind) {
  return GLENDALE_LAYERS
    .filter((l) => (mode === "replay" ? l.kinds.includes(kind) : (l.modes || []).includes(mode)))
    .map((l) => l.id);
}

const EMPTY = { type: "FeatureCollection", features: [] };
export const GLENDALE_BOUNDS = [[-118.32, 34.10], [-118.18, 34.27]];
export const HISTORY_BOUNDS = [[-118.45, 34.05], [-118.05, 34.35]];

export class GodsEyeMap {
  constructor(el, onReady, onInspect) {
    this.map = new maplibregl.Map({
      container: el,
      style: BASE_STYLE,
      bounds: GLENDALE_BOUNDS,
      fitBoundsOptions: { padding: 40 },
      attributionControl: { compact: true },
    });
    this.map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    this.map.addControl(new maplibregl.ScaleControl({ unit: "imperial" }), "bottom-right");
    this.visible = new Set();
    this.windMarkers = [];
    this.eventMarker = null;
    this.ev = null;
    this.inspectMarker = null;
    this.map.on("load", async () => {
      await this.#addGlendale();
      this.#addEventLayers();
      this.map.on("click", (e) => {
        const onEventFeature = this.map.queryRenderedFeatures(e.point, { layers: ["quakes", "calfire", "gauges"] }).length;
        if (!onEventFeature) onInspect(e.lngLat);
      });
      onReady();
    });
  }

  markInspected(lngLat) {
    if (!this.inspectMarker) {
      const el = document.createElement("div");
      el.className = "inspect-pin";
      this.inspectMarker = new maplibregl.Marker({ element: el });
    }
    this.inspectMarker.setLngLat(lngLat).addTo(this.map);
  }

  /** Turns on exactly the toggleable layers in `ids`. */
  showOnly(ids) {
    for (const l of GLENDALE_LAYERS) this.setLayerVisible(l.id, ids.includes(l.id));
  }

  setEventLayersVisible(on) {
    const v = on ? "visible" : "none";
    for (const id of ["perimeter-fill", "perimeter-line", "gauges", "calfire", "quakes"]) this.map.setLayoutProperty(id, "visibility", v);
    this.windMarkers.forEach((w) => { w.el.style.display = on ? "" : "none"; });
    if (this.eventMarker) this.eventMarker.getElement().style.display = on ? "" : "none";
  }

  setHistoryYears(from, to) {
    this.map.setFilter("fire_history", ["all", [">=", ["get", "year"], from], ["<=", ["get", "year"], to]]);
  }

  highlightZoneGroup(group) {
    this.map.setPaintProperty("zoning", "fill-opacity", group
      ? ["case", ["==", ["get", "zone_group"], group], 0.85, 0.12]
      : 0.55);
  }

  fitTo(bounds, maxZoom = 13) {
    this.map.fitBounds(bounds, { padding: { top: 90, bottom: 60, left: 60, right: 60 }, duration: 1000, maxZoom });
  }

  async #addGlendale() {
    const m = this.map;
    // Areas go under the basemap's labels; points go on top.
    this.labelsId = m.getStyle().layers.find((l) => l.type === "symbol")?.id;
    const boundary = await (await fetch("data/glendale/city_boundary.geojson")).json();
    for (const layer of GLENDALE_LAYERS) {
      m.addSource(layer.id, { type: "geojson", data: layer.url || `data/glendale/${layer.file}.geojson` });
      m.addLayer({
        id: layer.id, type: layer.type, source: layer.id, paint: layer.paint,
        layout: { visibility: "none" }, ...(layer.filter ? { filter: layer.filter } : {}),
      }, layer.type === "circle" ? undefined : this.labelsId);
    }
    m.getCanvas().style.cursor = "crosshair";
    m.addSource("boundary", { type: "geojson", data: boundary });
    m.addLayer({ id: "boundary-glow", type: "line", source: "boundary", paint: { "line-color": "#38e1ff", "line-width": 6, "line-opacity": 0.18, "line-blur": 4 } }, this.labelsId);
    m.addLayer({ id: "boundary", type: "line", source: "boundary", paint: { "line-color": "#38e1ff", "line-width": 1.6 } }, this.labelsId);
  }

  #addEventLayers() {
    const m = this.map;
    m.addSource("perimeter", { type: "geojson", data: EMPTY });
    m.addLayer({ id: "perimeter-fill", type: "fill", source: "perimeter", paint: { "fill-color": "#ff3d00", "fill-opacity": ["get", "opacity"] } }, this.labelsId);
    m.addLayer({ id: "perimeter-line", type: "line", source: "perimeter", paint: { "line-color": "#ff6a3d", "line-width": 1.6, "line-dasharray": [2, 1] } }, this.labelsId);

    m.addSource("gauges", { type: "geojson", data: EMPTY });
    m.addLayer({
      id: "gauges", type: "circle", source: "gauges",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["get", "cfs"], 0, 4, 100, 8, 1000, 16, 5000, 28],
        "circle-color": "rgba(77,163,255,0.35)", "circle-stroke-color": "#9fd3ff", "circle-stroke-width": 1.5,
      },
    });

    m.addSource("calfire", { type: "geojson", data: EMPTY });
    m.addLayer({
      id: "calfire", type: "circle", source: "calfire",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["coalesce", ["get", "acres"], 0], 0, 4, 1000, 7, 20000, 12, 150000, 18],
        "circle-color": "#ff6a3d", "circle-opacity": ["get", "opacity"], "circle-stroke-color": "#ffd6c9", "circle-stroke-width": 1,
      },
    });

    m.addSource("quakes", { type: "geojson", data: EMPTY });
    m.addLayer({
      id: "quakes", type: "circle", source: "quakes",
      paint: {
        "circle-radius": ["interpolate", ["exponential", 1.8], ["get", "mag"], 1, 1.5, 3, 4, 5, 12, 7, 34],
        "circle-color": "#c77dff",
        "circle-opacity": ["*", 0.75, ["get", "fresh"]],
        "circle-stroke-color": "#f3e1ff",
        "circle-stroke-width": ["case", [">", ["get", "fresh"], 0.9], 1.5, 0],
      },
    });

    const popup = (id, html) => {
      m.on("click", id, (e) => {
        new maplibregl.Popup({ maxWidth: "280px" }).setLngLat(e.lngLat).setHTML(html(e.features[0].properties)).addTo(m);
      });
      m.on("mouseenter", id, () => { m.getCanvas().style.cursor = "pointer"; });
      m.on("mouseleave", id, () => { m.getCanvas().style.cursor = "crosshair"; });
    };
    popup("quakes", (p) => `<b>M${Number(p.mag).toFixed(1)}</b> ${escapeHtml(p.place)}<br>${fmtLocal(p.ms)}<br>${p.km_to_glendale} km from Glendale · <a href="${escapeHtml(p.url)}" target="_blank" rel="noopener">USGS</a>`);
    popup("calfire", (p) => `<b>${escapeHtml(p.name)}</b><br>Started ${fmtLocal(p.ms)}<br>${p.acres ? `${Number(p.acres).toLocaleString()} acres (final)` : ""}${p.url && p.url !== "null" ? `<br><a href="${escapeHtml(p.url)}" target="_blank" rel="noopener">CAL FIRE</a>` : ""}`);
    popup("perimeter-fill", (p) => `<b>Final fire perimeter</b><br>${Number(p.acres).toLocaleString()} acres<br>Mapped after the fire; the app does not show day-by-day spread.`);
    popup("gauges", (p) => `<b>${escapeHtml(p.name)}</b><br>${Math.round(p.cfs)} cubic feet per second<br>USGS ${escapeHtml(p.id)}`);
  }

  setLayerVisible(id, on) {
    this.map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    if (on) this.visible.add(id); else this.visible.delete(id);
  }

  setEvent(ev) {
    this.ev = ev;
    this.showOnly(defaultLayers("replay", ev.kind));

    this.windMarkers.forEach((w) => w.marker.remove());
    this.windMarkers = [];
    const sites = [{ key: "glendale", lat: GLENDALE.lat, lon: GLENDALE.lon, wx: ev.wxGlendale, name: "Glendale" }];
    if (ev.wxEvent !== ev.wxGlendale) sites.push({ key: "event", lat: ev.lat, lon: ev.lon, wx: ev.wxEvent, name: "Event site" });
    for (const s of sites) {
      const el = document.createElement("div");
      el.className = "wind-marker";
      el.innerHTML = '<div class="arrow">➤</div><div class="speed"></div>';
      const marker = new maplibregl.Marker({ element: el, offset: [0, -34] }).setLngLat([s.lon, s.lat]).addTo(this.map);
      this.windMarkers.push({ ...s, el, marker });
    }

    if (this.eventMarker) this.eventMarker.remove();
    const el = document.createElement("div");
    el.className = `event-pin ${ev.kind}`;
    el.title = ev.name;
    this.eventMarker = new maplibregl.Marker({ element: el }).setLngLat([ev.lon, ev.lat]).addTo(this.map);

    const g = ev.gauges;
    this.map.getSource("gauges").setData({
      type: "FeatureCollection",
      features: g.filter((x) => x.lonlat).map((x) => ({ type: "Feature", geometry: { type: "Point", coordinates: x.lonlat }, properties: { id: x.id, name: x.name, cfs: 0 } })),
    });

    this.fitEvent(ev);
  }

  fitEvent(ev) {
    const bounds = new maplibregl.LngLatBounds(GLENDALE_BOUNDS[0], GLENDALE_BOUNDS[1]);
    bounds.extend([ev.lon, ev.lat]);
    if (ev.perimeter) this.#eachCoord(ev.perimeter.geometry, (c) => bounds.extend(c));
    this.fitTo(bounds, 12.5);
  }

  #eachCoord(geom, fn) {
    const walk = (c) => (typeof c[0] === "number" ? fn(c) : c.forEach(walk));
    walk(geom.coordinates);
  }

  update(at) {
    const ev = this.ev;
    if (!ev || !this.map.getSource("quakes")) return;
    const m = this.map;

    m.getSource("quakes").setData({
      type: "FeatureCollection",
      features: ev.quakes.filter((q) => q.ms <= at).map((q) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [q.lon, q.lat] },
        properties: { mag: q.mag, place: q.place, ms: q.ms, url: q.url, km_to_glendale: q.km_to_glendale, fresh: Math.max(0.15, 1 - (at - q.ms) / (2 * DAY)) },
      })),
    });

    m.getSource("calfire").setData({
      type: "FeatureCollection",
      features: ev.calfire.filter((c) => c.ms <= at).map((c) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [c.lon, c.lat] },
        properties: { ...c, opacity: Math.max(0.35, 1 - (at - c.ms) / (3 * DAY)) },
      })),
    });

    if (ev.perimeter) {
      const since = at - ev.t0;
      const opacity = since < 0 ? 0 : Math.min(0.45, 0.1 + since / (2 * DAY) * 0.35);
      m.getSource("perimeter").setData(since < 0 ? EMPTY : {
        type: "FeatureCollection",
        features: [{ ...ev.perimeter, properties: { ...ev.perimeter.properties, opacity } }],
      });
    }

    m.getSource("gauges").setData({
      type: "FeatureCollection",
      features: ev.gauges.filter((x) => x.lonlat).map((x) => {
        const i = indexAt(x.t, at);
        return { type: "Feature", geometry: { type: "Point", coordinates: x.lonlat }, properties: { id: x.id, name: x.name, cfs: i < 0 ? 0 : x.cfs[i] } };
      }),
    });

    for (const w of this.windMarkers) {
      const dir = valueAt(w.wx, "wind_direction_10m", at);
      const gust = valueAt(w.wx, "wind_gusts_10m", at);
      const speed = valueAt(w.wx, "wind_speed_10m", at);
      if (dir == null) continue;
      // Direction is where wind comes from; the arrow points where it blows. ➤ points east (90°).
      w.el.querySelector(".arrow").style.transform = `rotate(${(dir + 180 - 90 + 360) % 360}deg) scale(${0.8 + Math.min(1.4, (speed || 0) / 25)})`;
      w.el.querySelector(".speed").textContent = `${w.name}: ${Math.round(speed)} mph, gusts ${Math.round(gust)}`;
      w.el.classList.toggle("strong", gust >= 35);
    }

    this.eventMarker?.getElement().classList.toggle("active", at >= ev.t0);
  }
}