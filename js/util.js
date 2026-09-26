export const HOUR = 3600e3;
export const DAY = 24 * HOUR;
export const GLENDALE = { lat: 34.1425, lon: -118.2551 };
const TZ = "America/Los_Angeles";

const fmtFull = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ, weekday: "short", month: "short", day: "numeric", year: "numeric",
  hour: "numeric", minute: "2-digit", timeZoneName: "short",
});
const fmtShort = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ, month: "short", day: "numeric", hour: "numeric",
});
const fmtDay = new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric" });
const fmtIsoDay = new Intl.DateTimeFormat("en-CA", { timeZone: TZ });

export const fmtLocal = (ms) => fmtFull.format(new Date(ms));
export const fmtShortLocal = (ms) => fmtShort.format(new Date(ms));
export const fmtDayLocal = (ms) => fmtDay.format(new Date(ms));
/** YYYY-MM-DD in Los Angeles time. */
export const localDate = (ms) => fmtIsoDay.format(new Date(ms));

export function tMinus(ms, t0) {
  const diff = ms - t0;
  const abs = Math.abs(diff);
  const d = Math.floor(abs / DAY);
  const h = Math.floor((abs % DAY) / HOUR);
  return `T${diff < 0 ? "−" : "+"}${d}d ${String(h).padStart(2, "0")}h`;
}

export function leadLabel(hours) {
  const a = Math.abs(hours);
  if (a < 1) return "<1 h";
  if (a < 48) return `${Math.round(a)} h`;
  return `${(a / 24).toFixed(1)} d`;
}

/** Index of the last element of a sorted ms array that is <= ms, or -1. */
export function indexAt(times, ms) {
  let lo = 0;
  let hi = times.length - 1;
  if (hi < 0 || ms < times[0]) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (times[mid] <= ms) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function haversineKm(lat1, lon1, lat2, lon2) {
  const r = 6371;
  const toRad = (x) => (x * Math.PI) / 180;
  const dp = toRad(lat2 - lat1);
  const dl = toRad(lon2 - lon1);
  const a = Math.sin(dp / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

export const clamp01 = (x) => Math.max(0, Math.min(1, x));

export async function fetchJson(url, { timeoutMs = 20000, headers = {} } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    throw new Error(err.name === "AbortError" ? "timed out" : err.message);
  } finally {
    clearTimeout(timer);
  }
}
