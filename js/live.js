import { HOUR, DAY, GLENDALE, clamp01, escapeHtml, fetchJson, fmtLocal, haversineKm } from "./util.js";
import { daysSinceRain, windowValues } from "./signals.js";

const NWS_POINT = "34.146,-118.255";
const NWS_PAGE = "https://forecast.weather.gov/MapClick.php?lat=34.146&lon=-118.255";

/**
 * Illustrative 0-100 "fire weather" score used only to compare conditions side by side.
 * Each part scales linearly between a benign and an extreme value, then they are averaged.
 */
export function fireWeatherScore({ minRh, maxGust, maxTemp, dryDays }) {
  const parts = [
    clamp01((40 - minRh) / 32),
    clamp01((maxGust - 15) / 45),
    clamp01((maxTemp - 65) / 40),
    clamp01((dryDays ?? 365) / 150),
  ];
  return Math.round((parts.reduce((a, b) => a + b, 0) / parts.length) * 100);
}

const minOf = (a) => (a.length ? Math.min(...a) : null);
const maxOf = (a) => (a.length ? Math.max(...a) : null);

function eventFireFingerprint(ev) {
  const wx = ev.wxEvent;
  const from = ev.t0 - 48 * HOUR;
  const f = {
    minRh: minOf(windowValues(wx, "relative_humidity_2m", from, ev.t0)),
    maxGust: maxOf(windowValues(wx, "wind_gusts_10m", from, ev.t0)),
    maxTemp: maxOf(windowValues(wx, "temperature_2m", from, ev.t0)),
    dryDays: daysSinceRain(ev, ev.t0).days,
  };
  return { ...f, score: fireWeatherScore(f) };
}

function eventMax72hRain(ev) {
  const wx = ev.wxGlendale;
  let best = 0;
  for (let i = 0; i < wx.t.length; i++) {
    let s = 0;
    for (let j = i; j < Math.min(wx.t.length, i + 72); j++) s += wx.precipitation[j] || 0;
    best = Math.max(best, s);
  }
  return best;
}

async function todayWeather() {
  const params = new URLSearchParams({
    latitude: GLENDALE.lat, longitude: GLENDALE.lon,
    hourly: "temperature_2m,relative_humidity_2m,wind_gusts_10m,precipitation",
    daily: "precipitation_sum", past_days: "92", forecast_days: "4",
    timezone: "America/Los_Angeles", timeformat: "unixtime",
    wind_speed_unit: "mph", temperature_unit: "fahrenheit", precipitation_unit: "inch",
  });
  const d = await fetchJson(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!d?.hourly?.time) throw new Error("unexpected response");
  const now = Date.now();
  const t = d.hourly.time.map((s) => s * 1000);
  const next = (key, hours) => t.map((x, i) => [x, d.hourly[key][i]]).filter(([x, v]) => x >= now - HOUR && x <= now + hours * HOUR && v != null).map(([, v]) => v);
  const days = d.daily.time.map((s) => s * 1000);
  let dryDays = null;
  for (let i = 0; i < days.length; i++) {
    if (days[i] <= now && (d.daily.precipitation_sum[i] || 0) >= 0.1) dryDays = Math.round((now - days[i]) / DAY);
  }
  const f = {
    minRh: minOf(next("relative_humidity_2m", 48)),
    maxGust: maxOf(next("wind_gusts_10m", 48)),
    maxTemp: maxOf(next("temperature_2m", 48)),
    dryDays,
    dryBeyond: dryDays == null,
    rain72: next("precipitation", 72).reduce((a, b) => a + b, 0),
  };
  return { ...f, score: fireWeatherScore(f) };
}

async function nwsAlerts() {
  const d = await fetchJson(`https://api.weather.gov/alerts/active?point=${NWS_POINT}`, {
    headers: { Accept: "application/geo+json" },
  });
  if (!Array.isArray(d?.features)) throw new Error("unexpected response");
  return d.features.map((f) => f.properties ?? {});
}

async function recentQuakes() {
  const d = await fetchJson("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson");
  if (!Array.isArray(d?.features)) throw new Error("unexpected response");
  return d.features
    .map((f) => ({ ...f.properties, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }))
    .map((q) => ({ ...q, km: haversineKm(q.lat, q.lon, GLENDALE.lat, GLENDALE.lon) }))
    .filter((q) => q.km <= 150)
    .sort((a, b) => b.mag - a.mag);
}

const fmt = (v, d = 0, unit = "") => (v == null ? "—" : `${Number(v).toFixed(d)}${unit}`);
const bar = (score) => `<div style="display:flex;align-items:center;gap:6px"><div class="bar" style="flex:1" title="${score}/100"><i style="width:${score}%"></i></div><b>${score}</b></div>`;

function status(name, result, fetchedAt) {
  if (result.status === "rejected") {
    return `<p class="feed-status bad">✕ ${name}: could not load (${escapeHtml(result.reason?.message)}). This does not mean there is nothing to report.</p>`;
  }
  return `<p class="feed-status">✓ ${name} · fetched ${fmtLocal(fetchedAt)}</p>`;
}

export async function openLive(dialog, body, events) {
  dialog.showModal();
  body.innerHTML = "<p>Loading live data for Glendale…</p>";
  const fetchedAt = Date.now();
  const [wx, alerts, quakes] = await Promise.allSettled([todayWeather(), nwsAlerts(), recentQuakes()]);

  const fires = events.filter((e) => e.kind === "fire").map((e) => ({ ev: e, f: eventFireFingerprint(e) }));
  const floods = events.filter((e) => e.kind === "flood").map((e) => ({ ev: e, rain: eventMax72hRain(e) }));

  const today = wx.status === "fulfilled" ? wx.value : null;
  const rows = fires
    .map(({ ev, f }) => `<tr><td>${escapeHtml(ev.name)} <span class="fine">48 h before</span></td><td>${fmt(f.minRh, 0, "%")}</td><td>${fmt(f.maxGust, 0, " mph")}</td><td>${fmt(f.maxTemp, 0, "°F")}</td><td>${f.dryDays ?? ">365"}</td><td>${bar(f.score)}</td></tr>`)
    .join("");
  const todayRow = today
    ? `<tr class="today"><td>Glendale, next 48 h</td><td>${fmt(today.minRh, 0, "%")}</td><td>${fmt(today.maxGust, 0, " mph")}</td><td>${fmt(today.maxTemp, 0, "°F")}</td><td>${today.dryBeyond ? ">92" : today.dryDays}</td><td>${bar(today.score)}</td></tr>`
    : `<tr><td colspan="6" class="feed-status bad">Today's forecast could not be loaded.</td></tr>`;

  const alertHtml = alerts.status === "fulfilled"
    ? (alerts.value.length
      ? alerts.value.map((a) => `<div class="alert-item"><b>${escapeHtml(a.event)}</b> · ${escapeHtml(a.senderName || "NWS")}<br>${escapeHtml(a.headline || "")}</div>`).join("")
      : `<p class="fine">The NWS feed lists no active alerts for this point right now. That is not an all-clear; conditions and feeds can lag.</p>`)
    : "";
  const quakeHtml = quakes.status === "fulfilled"
    ? (quakes.value.length
      ? `<ul>${quakes.value.slice(0, 6).map((q) => `<li>M${q.mag.toFixed(1)} ${escapeHtml(q.place)} · ${Math.round(q.km)} km away · <a href="${escapeHtml(q.url)}" target="_blank" rel="noopener">USGS</a></li>`).join("")}</ul>`
      : '<p class="fine">No earthquakes within 150 km in the past day in the USGS feed.</p>')
    : "";
  const floodHtml = today
    ? `<p>Forecast rain at Glendale, next 72 h: <b>${today.rain72.toFixed(2)} in</b>. For comparison, the wettest 72 h: ${floods.map(({ ev, rain }) => `${escapeHtml(ev.name)} <b>${rain.toFixed(2)} in</b>`).join(" · ")}.</p>`
    : "";

  body.innerHTML = `
    <div class="live-grid">
      <section>
        <h3 class="panel-title">Fire weather: today vs. the 48 hours before past fires</h3>
        <table class="cmp-table">
          <thead><tr><th></th><th>Min humidity</th><th>Max gust</th><th>High</th><th>Days since rain</th><th>Score</th></tr></thead>
          <tbody>${todayRow}${rows}</tbody>
        </table>
        <p class="fine">Score averages four parts: humidity (40%→8%), gusts (15→60 mph), heat (65→105°F), and days without 0.1 in of rain (0→150). It is an illustrative comparison built for this app, not an official fire danger rating or forecast. Past events use ERA5 reanalysis at the ignition point; today uses the Open-Meteo forecast for Glendale.</p>
        ${floodHtml}
      </section>
      <section>
        <h3 class="panel-title">Official alerts right now</h3>
        ${status("NWS active alerts", alerts, fetchedAt)}
        ${alertHtml}
        <p><a href="${NWS_PAGE}" target="_blank" rel="noopener">Open NWS forecast and alerts for Glendale</a> · <a href="https://alertlacounty.genasys.com/portal/en/register" target="_blank" rel="noopener">Sign up for Alert LA County</a> · <a href="https://protect.genasys.com/" target="_blank" rel="noopener">Genasys evacuation zones</a></p>
        <h3 class="panel-title">Earthquakes in the past day (150 km)</h3>
        ${status("USGS feed", quakes, fetchedAt)}
        ${quakeHtml}
        ${status("Open-Meteo forecast", wx, fetchedAt)}
      </section>
    </div>`;
}
