import { HOUR, escapeHtml, fmtLocal, fmtShortLocal, leadLabel, tMinus } from "./util.js";
import { activeWarnings, precursors, prepareEvent, vitals, WARNING_COLORS } from "./signals.js";
import { ChartStack } from "./charts.js";
import { GodsEyeMap, GLENDALE_LAYERS } from "./map.js";
import { openLive } from "./live.js";

const KIND_ICON = { fire: "🔥", flood: "🌧", quake: "〰" };
const KIND_LABEL = { fire: "Wildfire", flood: "Storm / flood", quake: "Earthquake" };

const LESSONS = {
  fire: [
    "Red Flag Warnings came 1 to 4 days before the worst fires. Treat one as the signal to pack a go-bag and plan two ways out.",
    "Look up your evacuation zone on Genasys Protect now, and sign up for Alert LA County and Glendale's Everbridge alerts.",
    "Leave when an evacuation warning is issued. Don't wait for an order if you need extra time (kids, pets, mobility).",
    "About two-thirds of Glendale is mapped Very High fire hazard. Clear the first 5 feet around your home and use ember-resistant vents.",
    "Keep N95 masks at home. Smoke reached Glendale even from fires miles away.",
    "After a fire, burn scars can flood and slide in the first storms. Watch for Flash Flood Warnings.",
  ],
  flood: [
    "Flood Watches came out days ahead. Use that time to clear drains and move cars out of low spots.",
    "Stay out of canyons, washes and the LA River channel during Flash Flood Warnings. Water rises within minutes.",
    "Never drive through a flooded road. Six inches of moving water can knock you down; a foot can float a car.",
    "Check whether your home is in a FEMA flood zone or a dam inundation area (map layers at left). Standard home insurance doesn't cover floods.",
    "Hillside homes: watch for new cracks, tilting trees or muddy water, which are early signs of a slide.",
  ],
  quake: [
    "Earthquakes give no reliable advance warning. Ridgecrest's foreshock was only recognized as one afterward. Prepare now.",
    "Install MyShake for seconds of early warning, and practice Drop, Cover and Hold On.",
    "Store water and food for at least a week per person, plus medications and a flashlight.",
    "Strap water heaters and tall furniture. Check the liquefaction and landslide layers for your block.",
    "Know where the nearest fire stations and hospitals are (map layers). Phones and roads may fail after a large quake.",
  ],
};

const state = {
  index: [],
  cache: new Map(),
  ev: null,
  cursor: 0,
  t0: 0,
  site: "event",
  playing: false,
  speed: 6,
};

const $ = (id) => document.getElementById(id);
let map;
let charts;

async function loadEvent(id) {
  if (!state.cache.has(id)) {
    const res = await fetch(`data/events/${id}.json`);
    if (!res.ok) throw new Error(`Could not load ${id}: HTTP ${res.status}`);
    state.cache.set(id, prepareEvent(await res.json()));
  }
  return state.cache.get(id);
}

function renderTabs() {
  $("event-tabs").innerHTML = state.index.map((e) => `
    <button type="button" class="event-tab" data-id="${e.id}" aria-pressed="${state.ev?.id === e.id}">
      <span class="k">${KIND_ICON[e.kind]}</span>${escapeHtml(e.name)}
      <small>${new Date(e.time).getUTCFullYear()} · ${KIND_LABEL[e.kind]}</small>
    </button>`).join("");
}

function renderLayerToggles() {
  $("layer-toggles").innerHTML = GLENDALE_LAYERS.map((l) => `
    <label class="layer-row">
      <input type="checkbox" data-layer="${l.id}" ${map.visible.has(l.id) ? "checked" : ""} />
      <span class="swatch" style="background:${l.swatch}"></span>${escapeHtml(l.label)}
    </label>`).join("");
}

function renderEventCard(ev) {
  $("event-kind").className = `event-kind ${ev.kind}`;
  $("event-kind").textContent = `${KIND_LABEL[ev.kind]} · ${fmtLocal(ev.t0)}`;
  $("event-name").textContent = ev.name;
  $("event-summary").textContent = ev.summary;
  $("event-glendale").textContent = ev.glendale_link;

  $("precursors").innerHTML = precursors(ev).map((p) => `
    <li>
      <span class="lead ${p.hours < 0 ? "after" : ""}">${p.hours < 0 ? "+" : "−"}${leadLabel(p.hours)}</span>
      <span${p.color ? ` style="border-left:3px solid ${p.color};padding-left:6px"` : ""}>${p.html}<br><span class="src">${escapeHtml(p.src)}</span></span>
    </li>`).join("") || "<li>No precursor data for this event.</li>";

  $("lessons").innerHTML = LESSONS[ev.kind].map((l) => `<li>${escapeHtml(l)}</li>`).join("");

  const eventSiteAvailable = ev.wxEvent !== ev.wxGlendale;
  $("site-toggle").style.display = eventSiteAvailable ? "" : "none";
  if (!eventSiteAvailable) state.site = "glendale";

  const notes = [
    `Weather: ERA5 reanalysis via Open-Meteo (about 10 km grid; smoother than station readings).`,
    ev.air ? "Air quality: CAMS model via Open-Meteo." : "Air quality: no archive for this date.",
    `NWS products: Iowa Environmental Mesonet VTEC archive, WFO Los Angeles/Oxnard.`,
    ev.perimeter ? `Fire perimeter: final extent from NIFC, shown from ignition onward.` : "",
    ev.calfire.length ? "Fire starts: CAL FIRE incident list." : "",
    "Earthquakes: USGS ComCat.",
    ev.gauges.length ? "Streamflow: USGS Water Data." : "",
    `Data fetched ${fmtShortLocal(Date.parse(ev.fetched_at))}.`,
  ];
  const missing = Object.keys(ev.errors || {});
  if (missing.length) notes.push(`Could not load: ${missing.join(", ")}.`);
  $("data-notes").textContent = notes.filter(Boolean).join(" ");
  $("window-label").textContent = `${fmtShortLocal(ev.start)} → ${fmtShortLocal(ev.end)}`;
}

function renderCursor() {
  const ev = state.ev;
  if (!ev) return;
  const at = state.cursor;

  const tm = $("clock-tminus");
  tm.textContent = tMinus(at, ev.t0);
  tm.classList.toggle("after", at >= ev.t0);
  $("clock-local").textContent = fmtLocal(at);
  $("scrubber").value = String(Math.round(((at - ev.start) / (ev.end - ev.start)) * 1000));

  $("vitals").innerHTML = vitals(ev, state.site, at).map((v) => `
    <div class="vital ${v.level || ""} ${v.na ? "na" : ""}">
      <div class="label">${escapeHtml(v.label)}</div>
      <div class="value">${escapeHtml(v.value)}<small>${escapeHtml(v.unit)}</small></div>
      ${v.sub ? `<div class="fine" style="margin:0">${escapeHtml(v.sub)}</div>` : ""}
    </div>`).join("");

  const active = activeWarnings(ev, at);
  $("active-warnings").innerHTML = active.length
    ? active.map((w) => `<div class="warn-chip" style="border-color:${WARNING_COLORS[w.code] || "#aaa"}"><span>${escapeHtml(w.name)}</span><span>until ${fmtShortLocal(w.expiresMs)}</span></div>`).join("")
    : '<div class="no-warn">No NWS watch, warning or advisory in effect for LA at this moment in the archive.</div>';

  map.update(at);
  charts.redraw();
}

function seek(ms) {
  const ev = state.ev;
  state.cursor = Math.max(ev.start, Math.min(ev.end, ms));
  charts.state.cursor = state.cursor;
  renderCursor();
}

function setSegPressed(groupId, attr, value) {
  for (const b of $(groupId).querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset[attr] === String(value)));
}

async function selectEvent(id) {
  stop();
  let ev;
  try {
    ev = await loadEvent(id);
  } catch (err) {
    $("event-summary").textContent = `${err.message}. Run scripts/fetch_events.py to download event data.`;
    return;
  }
  state.ev = ev;
  state.t0 = ev.t0;
  state.site = ev.kind === "flood" ? "glendale" : "event";
  charts.state.t0 = ev.t0;
  history.replaceState(null, "", `#${id}`);
  renderTabs();
  renderEventCard(ev);
  setSegPressed("site-toggle", "site", state.site);
  charts.build(ev, state.site);
  map.map.resize();
  map.setEvent(ev);
  renderLayerToggles();
  seek(ev.t0 - 72 * HOUR);
}

let timer = null;
function play() {
  if (state.cursor >= state.ev.end) seek(state.ev.start);
  state.playing = true;
  $("play-btn").textContent = "❚❚";
  $("play-btn").setAttribute("aria-label", "Pause");
  let last = performance.now();
  const tick = (now) => {
    if (!state.playing) return;
    const dt = (now - last) / 1000;
    last = now;
    seek(state.cursor + dt * state.speed * HOUR);
    if (state.cursor >= state.ev.end) return stop();
    timer = requestAnimationFrame(tick);
  };
  timer = requestAnimationFrame(tick);
}

function stop() {
  state.playing = false;
  if (timer) cancelAnimationFrame(timer);
  $("play-btn").textContent = "▶";
  $("play-btn").setAttribute("aria-label", "Play");
}

function bindUi() {
  $("event-tabs").addEventListener("click", (e) => {
    const b = e.target.closest(".event-tab");
    if (b) selectEvent(b.dataset.id);
  });
  $("play-btn").addEventListener("click", () => (state.playing ? stop() : play()));
  $("speed").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    state.speed = Number(b.dataset.speed);
    setSegPressed("speed", "speed", state.speed);
  });
  $("jump-event").addEventListener("click", () => { stop(); seek(state.ev.t0 - HOUR); });
  $("scrubber").addEventListener("input", (e) => {
    stop();
    const ev = state.ev;
    seek(ev.start + (Number(e.target.value) / 1000) * (ev.end - ev.start));
  });
  $("site-toggle").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    state.site = b.dataset.site;
    setSegPressed("site-toggle", "site", state.site);
    charts.build(state.ev, state.site);
    renderCursor();
  });
  $("layer-toggles").addEventListener("change", (e) => {
    const id = e.target.dataset.layer;
    if (id) map.setLayerVisible(id, e.target.checked);
  });
  $("live-btn").addEventListener("click", async () => {
    stop();
    const all = await Promise.allSettled(state.index.map((e) => loadEvent(e.id)));
    const events = all.filter((r) => r.status === "fulfilled").map((r) => r.value);
    openLive($("live-dialog"), $("live-body"), events);
  });
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" && e.target.type !== "range") return;
    if (e.code === "Space") { e.preventDefault(); state.playing ? stop() : play(); }
    if (e.key === "ArrowRight") seek(state.cursor + (e.shiftKey ? 24 : 1) * HOUR);
    if (e.key === "ArrowLeft") seek(state.cursor - (e.shiftKey ? 24 : 1) * HOUR);
  });
}

async function main() {
  charts = new ChartStack($("charts"), { cursor: 0, t0: 0 }, (ms) => { stop(); seek(ms); });
  try {
    const res = await fetch("data/events/index.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.index = await res.json();
  } catch (err) {
    $("event-summary").textContent = `Could not load the event list (${err.message}). Serve this folder over HTTP and run scripts/fetch_events.py first.`;
    return;
  }
  setSegPressed("speed", "speed", state.speed);
  renderTabs();
  bindUi();
  map = new GodsEyeMap("map", () => {
    const fromHash = location.hash.slice(1);
    selectEvent(state.index.some((e) => e.id === fromHash) ? fromHash : "eaton-2025");
  });
}

main();
