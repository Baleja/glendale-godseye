import { HOUR, DAY, indexAt, localDate, haversineKm } from "./util.js";

/** Thresholds are rough fire-weather and flood rules of thumb, used only for coloring. */
export const THRESHOLDS = {
  temp: { warn: 90, danger: 100 },
  rh: { warn: 25, danger: 15, lowerIsWorse: true },
  gust: { warn: 35, danger: 50 },
  vpd: { warn: 3, danger: 5 },
  rain24: { warn: 1, danger: 2 },
  aqi: { warn: 101, danger: 151 },
  dry: { warn: 60, danger: 120 },
  soil: { warn: 0.12, danger: 0.07, lowerIsWorse: true },
};

export const WARNING_COLORS = {
  FW: "#ff4d5e", HW: "#ff9f1c", WI: "#ffc857", EH: "#ff6a3d", XH: "#ff3d00", HT: "#ffa07a",
  FF: "#4da3ff", FA: "#6fb8ff", FL: "#2f7fd6", TR: "#c77dff", WS: "#9fd3ff", SV: "#ffe066",
  DF: "#8d6e63",
};

export function level(kind, v) {
  const t = THRESHOLDS[kind];
  if (!t || v == null || Number.isNaN(v)) return "";
  if (t.lowerIsWorse) return v <= t.danger ? "danger" : v <= t.warn ? "warn" : "";
  return v >= t.danger ? "danger" : v >= t.warn ? "warn" : "";
}

function prepWeather(wx) {
  if (!wx) return null;
  return { ...wx, t: wx.time.map(Date.parse) };
}

/** Adds millisecond timestamps and lookup tables to a raw event file. */
export function prepareEvent(raw) {
  const ev = { ...raw };
  ev.t0 = Date.parse(raw.time);
  ev.start = Date.parse(raw.window.start);
  ev.end = Date.parse(raw.window.end);
  ev.wxGlendale = prepWeather(raw.weather_glendale);
  ev.wxEvent = prepWeather(raw.weather_event) || ev.wxGlendale;
  ev.air = raw.air_glendale ? { ...raw.air_glendale, t: raw.air_glendale.time.map(Date.parse) } : null;
  ev.quakes = (raw.quakes || []).map((q) => ({ ...q, ms: Date.parse(q.t) }));
  ev.warnings = (raw.warnings || []).map((w) => ({
    ...w, issuedMs: Date.parse(w.issued), expiresMs: Date.parse(w.expires),
  }));
  ev.calfire = (raw.calfire || []).map((c) => ({ ...c, ms: Date.parse(c.t) }));
  ev.gauges = (raw.gauges || []).map((g) => ({ ...g, t: g.time.map(Date.parse) }));

  // Daily rain at Glendale by local date: the 365-day record, then hourly data for the window.
  const daily = new Map();
  const ry = raw.rain_year_glendale;
  if (ry) ry.date.forEach((d, i) => daily.set(d, ry.precip_in[i] ?? 0));
  if (ev.wxGlendale) {
    const fromHourly = new Map();
    ev.wxGlendale.t.forEach((ms, i) => {
      const d = localDate(ms);
      fromHourly.set(d, (fromHourly.get(d) || 0) + (ev.wxGlendale.precipitation[i] || 0));
    });
    for (const [d, v] of fromHourly) if (!daily.has(d) || ms(d) > ev.t0 - DAY) daily.set(d, v);
  }
  ev.dailyRain = [...daily.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return ev;
}

const ms = (isoDay) => Date.parse(`${isoDay}T12:00:00Z`);

export function valueAt(wx, key, at) {
  if (!wx || !wx[key]) return null;
  const i = indexAt(wx.t, at);
  return i < 0 ? null : wx[key][i];
}

export function windowValues(wx, key, from, to) {
  if (!wx || !wx[key]) return [];
  const out = [];
  for (let i = 0; i < wx.t.length; i++) {
    if (wx.t[i] > to) break;
    if (wx.t[i] >= from && wx[key][i] != null) out.push(wx[key][i]);
  }
  return out;
}

export function daysSinceRain(ev, at, minInches = 0.1) {
  const today = localDate(at);
  let last = null;
  for (const [d, v] of ev.dailyRain) {
    if (d > today) break;
    if (v >= minInches) last = d;
  }
  if (!last) return { days: null, beyondRecord: true };
  return { days: Math.round((ms(today) - ms(last)) / DAY), beyondRecord: false };
}

export function rainTotal(ev, fromDay, toDay) {
  let sum = 0;
  for (const [d, v] of ev.dailyRain) if (d >= fromDay && d <= toDay) sum += v || 0;
  return sum;
}

export function activeWarnings(ev, at) {
  return ev.warnings.filter((w) => w.issuedMs <= at && at <= w.expiresMs);
}

const sum = (a) => a.reduce((s, v) => s + (v || 0), 0);
const max = (a) => (a.length ? Math.max(...a) : null);
const min = (a) => (a.length ? Math.min(...a) : null);

/** Readings at the cursor, for the side panel. */
export function vitals(ev, site, at) {
  const wx = site === "glendale" ? ev.wxGlendale : ev.wxEvent;
  const temp = valueAt(wx, "temperature_2m", at);
  const rh = valueAt(wx, "relative_humidity_2m", at);
  const gust = valueAt(wx, "wind_gusts_10m", at);
  const wind = valueAt(wx, "wind_speed_10m", at);
  const vpd = valueAt(wx, "vapour_pressure_deficit", at);
  const soil = valueAt(wx, "soil_moisture_0_to_7cm", at);
  const rain24 = sum(windowValues(wx, "precipitation", at - DAY + 1, at));
  const aqi = ev.air ? valueAt(ev.air, "us_aqi", at) : null;
  const dry = daysSinceRain(ev, at);
  const q24 = ev.quakes.filter((q) => q.ms <= at && q.ms > at - DAY);
  const qmax = max(q24.map((q) => q.mag));

  const f = (v, d = 0) => (v == null ? "—" : Number(v).toFixed(d));
  return [
    { label: "Temperature", value: f(temp), unit: "°F", level: level("temp", temp) },
    { label: "Humidity", value: f(rh), unit: "%", level: level("rh", rh) },
    { label: "Wind gusts", value: f(gust), unit: "mph", level: level("gust", gust), sub: wind != null ? `sustained ${f(wind)}` : "" },
    { label: "Dryness (VPD)", value: f(vpd, 1), unit: "kPa", level: level("vpd", vpd) },
    { label: "Rain last 24 h", value: f(rain24, 2), unit: "in", level: level("rain24", rain24) },
    { label: "Days since rain", value: dry.days == null ? ">365" : String(dry.days), unit: "d", level: dry.days == null ? "danger" : level("dry", dry.days), sub: "at Glendale, ≥0.1 in" },
    { label: "Soil moisture", value: f(soil, 2), unit: "m³/m³", level: level("soil", soil) },
    { label: "Air quality", value: ev.air ? f(aqi) : "n/a", unit: ev.air ? "AQI" : "", level: level("aqi", aqi), na: !ev.air, sub: ev.air ? "Glendale" : "no archive" },
    { label: "Quakes 24 h", value: String(q24.length), unit: qmax != null ? `max M${qmax.toFixed(1)}` : "", level: qmax >= 5 ? "danger" : qmax >= 3.5 ? "warn" : "" },
  ];
}

/**
 * Start of the run of days, ending at t0, on which the condition held at least once in every
 * trailing 24 hours. Returns the first hour of that run, or null if it didn't hold in the last day.
 */
function sustainedSince(wx, key, test, t0, lookbackMs) {
  if (!wx || !wx[key]) return null;
  const end = indexAt(wx.t, t0);
  if (end < 0) return null;
  const hits = wx[key].map((v) => v != null && test(v));
  const hitInLastDay = (i) => {
    for (let j = Math.max(0, i - 23); j <= i; j++) if (hits[j]) return true;
    return false;
  };
  if (!hitInLastDay(end)) return null;
  let i = end;
  while (i > 0 && wx.t[i - 1] >= t0 - lookbackMs && hitInLastDay(i - 1)) i--;
  const first = hits.indexOf(true, Math.max(0, i - 23));
  return first >= 0 ? wx.t[first] : wx.t[i];
}

/** The "warning signs" list: what the record showed, and how long before the event. */
export function precursors(ev) {
  const out = [];
  const t0 = ev.t0;
  const wx = ev.wxEvent;
  const lookback = (ev.days_before || 14) * DAY;

  // NWS products in effect at (or just before) the event, earliest issuance per product type.
  const byName = new Map();
  for (const w of ev.warnings) {
    if (w.issuedMs <= t0 && w.expiresMs >= t0 - 12 * HOUR) {
      const cur = byName.get(w.name);
      if (!cur || w.issuedMs < cur.issuedMs) byName.set(w.name, w);
    }
  }
  for (const w of byName.values()) {
    out.push({
      hours: (t0 - w.issuedMs) / HOUR,
      html: `NWS <b>${w.name}</b> issued`,
      src: "NWS via Iowa Environmental Mesonet",
      color: WARNING_COLORS[w.code],
    });
  }

  if (ev.kind === "fire") {
    const rules = [
      ["relative_humidity_2m", (v) => v <= 15, "Humidity fell below <b>15%</b> every day"],
      ["wind_gusts_10m", (v) => v >= 35, "Wind gusts topped <b>35 mph</b> every day"],
      ["temperature_2m", (v) => v >= 95, "Temperatures reached <b>95°F</b> every day"],
      ["vapour_pressure_deficit", (v) => v >= 3, "Air dryness (VPD) above <b>3 kPa</b> every day"],
    ];
    for (const [key, test, text] of rules) {
      const since = sustainedSince(wx, key, test, t0, lookback);
      if (since != null) out.push({ hours: (t0 - since) / HOUR, html: `${text} from then on`, src: "ERA5 reanalysis at the ignition point" });
    }
    const last48 = (k) => windowValues(wx, k, t0 - 48 * HOUR, t0);
    const minRh = min(last48("relative_humidity_2m"));
    const maxG = max(last48("wind_gusts_10m"));
    const maxT = max(last48("temperature_2m"));
    out.push({
      hours: 48,
      html: `Final 48 h extremes: humidity down to <b>${minRh?.toFixed(0)}%</b>, gusts up to <b>${maxG?.toFixed(0)} mph</b>, high of <b>${maxT?.toFixed(0)}°F</b>`,
      src: "ERA5 reanalysis (grid cell, smoother than station readings)",
    });
  }

  if (ev.kind === "fire" || ev.kind === "flood") {
    const dry = daysSinceRain(ev, t0);
    const endDay = localDate(t0);
    const d180 = localDate(t0 - 180 * DAY);
    const r180 = rainTotal(ev, d180, endDay);
    if (ev.kind === "fire" && dry.days != null) {
      out.push({
        hours: dry.days * 24,
        html: `Last rain of 0.1 in or more at Glendale; <b>${r180.toFixed(2)} in</b> fell in the 180 days before`,
        src: "ERA5 daily rainfall",
      });
    } else if (ev.kind === "fire") {
      out.push({ hours: 365 * 24, html: "No day with 0.1 in of rain at Glendale in the prior year", src: "ERA5 daily rainfall" });
    }
  }

  if (ev.kind === "flood") {
    const rain = ev.wxGlendale;
    const before = sum(windowValues(rain, "precipitation", t0 - 72 * HOUR, t0));
    const after = sum(windowValues(rain, "precipitation", t0, t0 + 72 * HOUR));
    out.push({ hours: 72, html: `<b>${before.toFixed(2)} in</b> of rain at Glendale in the 72 h before; <b>${after.toFixed(2)} in</b> in the 72 h after`, src: "ERA5 hourly rainfall" });
    if (rain) {
      let peak = -1;
      let peakAt = null;
      rain.t.forEach((t, i) => { if (rain.precipitation[i] > peak) { peak = rain.precipitation[i]; peakAt = t; } });
      if (peakAt != null) out.push({ hours: (t0 - peakAt) / HOUR, html: `Heaviest hour: <b>${peak.toFixed(2)} in</b> at Glendale`, src: "ERA5 hourly rainfall" });
    }
    for (const g of ev.gauges) {
      let pi = 0;
      g.cfs.forEach((v, i) => { if (v > g.cfs[pi]) pi = i; });
      const base = g.cfs[0];
      out.push({ hours: (t0 - g.t[pi]) / HOUR, html: `${g.name} peaked at <b>${Math.round(g.cfs[pi]).toLocaleString()} cfs</b> (window began at ${Math.round(base)} cfs)`, src: `USGS gauge ${g.id.replace("USGS-", "")}` });
    }
  }

  // Seismic activity near the event location before it.
  const near = ev.quakes.filter((q) => q.ms < t0 && haversineKm(q.lat, q.lon, ev.lat, ev.lon) <= 30);
  if (ev.kind === "quake") {
    const big = near.filter((q) => q.mag >= 4).sort((a, b) => b.mag - a.mag);
    if (big.length) {
      const b = big[0];
      out.push({ hours: (t0 - b.ms) / HOUR, html: `Foreshock <b>M${b.mag.toFixed(1)}</b>, ${b.place}; ${near.length} quakes within 30 km before the mainshock`, src: "USGS ComCat" });
    } else {
      out.push({ hours: (ev.days_before || 14) * 24, html: `Only <b>${near.length}</b> small quakes within 30 km in the ${ev.days_before} days before, and no foreshock warned of what came next`, src: "USGS ComCat" });
    }
  } else {
    const all = ev.quakes.filter((q) => q.ms >= t0 - 6 * HOUR && q.ms <= t0 + 6 * HOUR && q.mag >= 4);
    for (const q of all) out.push({ hours: (t0 - q.ms) / HOUR, html: `Earthquake <b>M${q.mag.toFixed(1)}</b>, ${q.place}, during the event`, src: "USGS ComCat" });
  }

  // After-effects worth knowing.
  if (ev.air) {
    let peak = -1;
    let at = null;
    ev.air.t.forEach((t, i) => { if (t >= t0 && ev.air.us_aqi[i] > peak) { peak = ev.air.us_aqi[i]; at = t; } });
    if (at != null && peak >= 101) out.push({ hours: (t0 - at) / HOUR, html: `Air quality in Glendale peaked at <b>AQI ${Math.round(peak)}</b>`, src: "CAMS modeled air quality" });
  }
  const floodAfter = ev.kind === "fire" && ev.warnings.find((w) => w.issuedMs > t0 && (w.code === "FF" || w.code === "FA"));
  if (floodAfter) out.push({ hours: (t0 - floodAfter.issuedMs) / HOUR, html: `<b>${floodAfter.name}</b> after the fire: burn scars flood fast`, src: "NWS via IEM" });

  out.sort((a, b) => b.hours - a.hours);
  return out;
}
