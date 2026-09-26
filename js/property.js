import { escapeHtml } from "./util.js";
import { bboxOf } from "./geo.js";
import { HEAT_RAMP } from "./map.js";

const money = (v) => (v >= 999500 ? `$${(v / 1e6).toFixed(2)}M` : `$${Math.round(v / 1000)}K`);
const METRICS = [
  { key: "value", label: "Typical home value", fmt: money },
  { key: "value_sfr", label: "Single-family homes", fmt: money },
  { key: "value_condo", label: "Condos", fmt: money },
  { key: "rent", label: "Rent", fmt: (v) => `$${Math.round(v).toLocaleString()}/mo` },
];
const AXIS = { color: "#8b98a9", font: { size: 10 } };
const GRID = { color: "rgba(255,255,255,0.06)" };
const signed = (v) => `${v >= 0 ? "+" : ""}${Math.round(v)}%`;

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/** Annual averages of a monthly series; years with no months are left out. */
function yearly(months, values) {
  const acc = new Map();
  months.forEach((m, i) => {
    const v = values?.[i];
    if (v == null) return;
    const y = Number(m.slice(0, 4));
    const a = acc.get(y) || { sum: 0, n: 0, last: m };
    a.sum += v; a.n += 1; a.last = m;
    acc.set(y, a);
  });
  return new Map([...acc].map(([y, a]) => [y, { v: a.sum / a.n, n: a.n, last: a.last }]));
}

/** Stand-in city series when Zillow has none: the median ZIP value for each year. */
function medianSeries(zips) {
  const out = new Map();
  const years = new Set(Object.values(zips).flatMap((s) => [...s.keys()]));
  for (const y of years) {
    const rows = Object.values(zips).map((s) => s.get(y)).filter(Boolean);
    const vals = rows.map((r) => r.v).sort((a, b) => a - b);
    out.set(y, { v: vals[Math.floor(vals.length / 2)], n: Math.min(...rows.map((r) => r.n)), last: rows[0].last });
  }
  return out;
}

/** Property view ($$$): Zillow home values and rents by ZIP, with a year timeline. */
export class PropertyView {
  constructor({ summaryEl, chartEls, notesEl, getMap, heat, onFlyTo }) {
    Object.assign(this, { summaryEl, chartEls, notesEl, getMap, heat, onFlyTo });
    this.loaded = false;
    this.metric = METRICS[0];
    this.year = null;
    this.scale = "all";
    this.timer = null;
    this.charts = [];
  }

  async load() {
    if (!this.loaded) {
      try {
        [this.data, this.zips] = await Promise.all([getJson("data/property/values.json"), getJson("data/glendale/zips.geojson")]);
      } catch (err) {
        this.summaryEl.innerHTML = `<p class="feed-status bad">Could not load property data (${escapeHtml(err.message)}). Run scripts/fetch_property_values.py.</p>`;
        return;
      }
      this.loaded = true;
      this.zipInfo = new Map(this.zips.features.map((f) => [f.properties.zip, f]));
      this.annual = Object.fromEntries(METRICS.map((m) => {
        const d = this.data.metrics[m.key];
        const zips = Object.fromEntries(Object.entries(d.zips).map(([z, vals]) => [z, yearly(d.months, vals)]));
        return [m.key, { zips, glendale: d.glendale ? yearly(d.months, d.glendale) : medianSeries(zips), county: d.la_county && yearly(d.months, d.la_county) }];
      }));
      this.#initHeat();
      this.#setMetric(METRICS[0]);
      this.#buildCharts();
      this.notesEl.innerHTML = `${escapeHtml(this.data.source)}. ${this.data.notes.map(escapeHtml).join(" ")} ZIP boundaries: City of Glendale GIS.`;
    }
    this.#apply();
  }

  leave() {
    this.stopPlay();
    this.popup?.remove();
  }

  #years(key = this.metric.key) {
    const ys = new Set();
    for (const s of Object.values(this.annual[key].zips)) for (const y of s.keys()) ys.add(y);
    return [...ys].sort((a, b) => a - b);
  }

  #initHeat() {
    const h = this.heat;
    h.metricEl.innerHTML = METRICS.map((m) => `<button type="button" data-key="${m.key}">${escapeHtml(m.label)}</button>`).join("");
    h.metricEl.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (b) this.#setMetric(METRICS.find((m) => m.key === b.dataset.key));
    });
    h.scaleEl.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      this.scale = b.dataset.scale;
      this.#apply();
    });
    h.yearEl.addEventListener("input", () => {
      this.stopPlay();
      this.year = this.years[Number(h.yearEl.value)];
      this.#apply();
    });
    h.playBtn.addEventListener("click", () => (this.timer ? this.stopPlay() : this.play()));

    const m = this.getMap();
    let hovered = null;
    this.popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, maxWidth: "260px", offset: 8 });
    m.on("mousemove", "zip_heat", (e) => {
      const f = e.features[0];
      if (!f) return;
      if (hovered && hovered !== f.id) m.setFeatureState({ source: "zip_heat", id: hovered }, { hover: false });
      hovered = f.id;
      m.setFeatureState({ source: "zip_heat", id: hovered }, { hover: true });
      this.popup.setLngLat(e.lngLat).setHTML(this.#zipHtml(f.id)).addTo(m);
      this.#highlightChart(f.id);
    });
    m.on("mouseleave", "zip_heat", () => {
      if (hovered) m.setFeatureState({ source: "zip_heat", id: hovered }, { hover: false });
      hovered = null;
      this.popup.remove();
      this.#highlightChart(null);
    });
    m.on("sourcedata", (e) => {
      if (e.sourceId === "zip_heat" && e.isSourceLoaded && !this.stateReady) {
        this.stateReady = true;
        this.#apply();
      }
    });
  }

  #setMetric(metric) {
    this.metric = metric;
    this.years = this.#years();
    if (!this.years.includes(this.year)) this.year = this.years.at(-1);
    const vals = Object.values(this.annual[metric.key].zips).flatMap((s) => [...s.values()].map((x) => x.v));
    this.range = [Math.min(...vals), Math.max(...vals)];
    const h = this.heat;
    h.yearEl.max = String(this.years.length - 1);
    h.ticksEl.innerHTML = this.years.map((_, i) => `<option value="${i}"></option>`).join("");
    this.#apply();
  }

  play() {
    let i = this.years.indexOf(this.year);
    if (i >= this.years.length - 1) i = -1;
    this.heat.playBtn.textContent = "❚❚";
    const step = () => {
      i += 1;
      this.year = this.years[i];
      this.#apply();
      if (i >= this.years.length - 1) this.stopPlay();
    };
    step();
    this.timer = setInterval(step, 700);
  }

  stopPlay() {
    clearInterval(this.timer);
    this.timer = null;
    if (this.heat) this.heat.playBtn.textContent = "▶";
  }

  #zipName(zip) {
    const hoods = this.zipInfo.get(zip)?.properties.neighborhoods || [];
    return hoods.length ? `${zip} · ${hoods.slice(0, 2).join(", ")}` : zip;
  }

  #valueAt(key, zip, year) {
    return this.annual[key].zips[zip]?.get(year)?.v ?? null;
  }

  #yearLabel(year) {
    const any = Object.values(this.annual[this.metric.key].zips).map((s) => s.get(year)).find(Boolean);
    return any && any.n < 12 ? `${year} (through ${new Date(`${any.last}-01T00:00:00`).toLocaleDateString("en-US", { month: "short" })})` : String(year);
  }

  #zipHtml(zip) {
    const p = this.zipInfo.get(zip)?.properties;
    const row = (m) => {
      const v = this.#valueAt(m.key, zip, this.year);
      return `<tr${m.key === this.metric.key ? ' class="on"' : ""}><td>${escapeHtml(m.label)}</td><td>${v == null ? "—" : m.fmt(v)}</td></tr>`;
    };
    const cur = this.#valueAt(this.metric.key, zip, this.year);
    const base = this.years.find((y) => this.#valueAt(this.metric.key, zip, y) != null);
    const prev = this.#valueAt(this.metric.key, zip, this.year - 1);
    const first = this.#valueAt(this.metric.key, zip, base);
    return `<b>ZIP ${escapeHtml(zip)}</b><br><span class="fine">${escapeHtml((p?.neighborhoods || []).join(", "))}${p && p.share_in_city < 0.9 ? ` · ${Math.round(p.share_in_city * 100)}% inside Glendale` : ""}</span>
      <table class="tract-pop">${METRICS.map(row).join("")}</table>
      <span class="fine">${escapeHtml(this.#yearLabel(this.year))}${cur && prev ? ` · ${signed((cur / prev - 1) * 100)} vs. ${this.year - 1}` : ""}${cur && first && base !== this.year ? ` · ${signed((cur / first - 1) * 100)} since ${base}` : ""}</span>`;
  }

  #apply() {
    if (!this.loaded) return;
    const h = this.heat;
    const key = this.metric.key;
    let [lo, hi] = this.range;
    if (this.scale === "year") {
      const vals = [...this.zipInfo.keys()].map((z) => this.#valueAt(key, z, this.year)).filter((v) => v != null);
      [lo, hi] = [Math.min(...vals), Math.max(...vals)];
    }
    const m = this.getMap();
    if (m.getSource("zip_heat")) {
      for (const zip of this.zipInfo.keys()) {
        const v = this.#valueAt(key, zip, this.year);
        m.setFeatureState({ source: "zip_heat", id: zip }, { t: v == null ? -1 : (v - lo) / (hi - lo || 1) });
      }
    }
    for (const b of h.metricEl.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.key === key));
    for (const b of h.scaleEl.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.scale === this.scale));
    h.yearEl.value = String(this.years.indexOf(this.year));
    h.yearLabel.textContent = this.#yearLabel(this.year);
    h.legendEl.innerHTML = `${this.metric.fmt(lo)}<i style="background:linear-gradient(90deg,${HEAT_RAMP.join(",")})"></i>${this.metric.fmt(hi)}`;
    this.#renderSummary();
    for (const c of this.charts) c.update("none");
  }

  #renderSummary() {
    const key = this.metric.key;
    const a = this.annual[key];
    const y = this.year;
    const first = this.years[0];
    const g = a.glendale;
    const gNow = g?.get(y)?.v;
    const change = (s, from) => (s?.get(y) && s?.get(from) ? (s.get(y).v / s.get(from).v - 1) * 100 : null);
    const ranked = [...this.zipInfo.keys()]
      .map((z) => ({ z, v: this.#valueAt(key, z, y), ch: first !== y && this.#valueAt(key, z, first) ? (this.#valueAt(key, z, y) / this.#valueAt(key, z, first) - 1) * 100 : null }))
      .filter((r) => r.v != null)
      .sort((p, q) => q.v - p.v);
    const lo = ranked.at(-1);
    const hi = ranked[0];
    const rentKey = this.annual.rent;
    const rentNow = rentKey.glendale?.get(y)?.v;
    const valNow = this.annual.value.glendale?.get(y)?.v;
    const fiveAgo = y - 5;
    const stats = [];
    const where = this.data.metrics[key].glendale ? "in Glendale" : "in the median Glendale ZIP";
    if (gNow) stats.push(`<div><b>${this.metric.fmt(gNow)}</b><span>${escapeHtml(this.metric.label.toLowerCase())} ${where}, ${escapeHtml(this.#yearLabel(y))}</span></div>`);
    const since = change(g, first);
    const countySince = change(a.county, first);
    if (since != null && first !== y) stats.push(`<div><b>${signed(since)}</b><span>since ${first}${countySince != null ? ` (LA County: ${signed(countySince)})` : ""}</span></div>`);
    const five = change(g, fiveAgo);
    if (five != null) stats.push(`<div><b>${signed(five)}</b><span>in the last five years (${fiveAgo} → ${y})</span></div>`);
    if (hi && lo && hi !== lo) stats.push(`<div><b>${(hi.v / lo.v).toFixed(1)}×</b><span>gap between the priciest ZIP (${hi.z}) and the least expensive (${lo.z})</span></div>`);
    const priceToRent = valNow && rentNow ? valNow / (rentNow * 12) : null;
    this.summaryEl.innerHTML = `
      <div class="stat-grid">${stats.join("")}</div>
      <p class="fine">Highest ${escapeHtml(this.metric.label.toLowerCase())}, ${escapeHtml(this.#yearLabel(y))}:</p>
      <ol class="tract-list">${ranked.slice(0, 11).map((r) => `<li data-z="${r.z}"><b>${escapeHtml(this.#zipName(r.z))}</b> <span class="fine">${this.metric.fmt(r.v)}${r.ch != null ? ` · ${signed(r.ch)} since ${first}` : ""}</span></li>`).join("")}</ol>
      ${priceToRent ? `<p class="fine">In ${y}, the typical Glendale home cost <b>${priceToRent.toFixed(0)} years</b> of typical rent. Rents: Zillow data starts in 2015.</p>` : ""}
      <p class="fine">Hover a ZIP code on the map for all its numbers. Values are Zillow estimates, not sale prices or assessed values.</p>`;
    this.summaryEl.querySelectorAll("li[data-z]").forEach((li) => li.addEventListener("click", () => {
      this.onFlyTo(bboxOf(this.zipInfo.get(li.dataset.z).geometry));
    }));
  }

  #highlightChart(zip) {
    this.hoverZip = zip;
    for (const c of this.charts) c.update("none");
  }

  #buildCharts() {
    const view = this;
    const yearLine = {
      id: "yearLine",
      afterDatasetsDraw(chart) {
        if (view.year < chart.scales.x.min) return;
        const x = chart.scales.x.getPixelForValue(view.year + 0.5);
        const { top, bottom } = chart.chartArea;
        const c = chart.ctx;
        c.save();
        c.strokeStyle = "rgba(255,255,255,0.45)";
        c.setLineDash([3, 3]);
        c.beginPath(); c.moveTo(x, top); c.lineTo(x, bottom); c.stroke();
        c.restore();
      },
    };
    const build = (el, key, title, fmt, minYear) => {
      const d = this.data.metrics[key];
      const toPts = (vals) => d.months.map((m, i) => ({ x: Number(m.slice(0, 4)) + (Number(m.slice(5, 7)) - 0.5) / 12, y: vals?.[i] ?? null }));
      const zipSets = Object.keys(d.zips).map((z) => ({
        label: `ZIP ${z}`, zip: z, data: toPts(d.zips[z]), borderWidth: 1, pointRadius: 0,
        borderColor: (ctx) => (view.hoverZip === ctx.dataset.zip ? "#ffe066" : "rgba(139,152,169,0.35)"),
      }));
      const chart = new Chart(el, {
        type: "line",
        data: {
          datasets: [
            { label: "Glendale", data: toPts(d.glendale), borderColor: "#38e1ff", backgroundColor: "#38e1ff", borderWidth: 2.5, pointRadius: 0 },
            { label: "LA County", data: toPts(d.la_county), borderColor: "#ff9f1c", backgroundColor: "#ff9f1c", borderWidth: 1.5, pointRadius: 0, borderDash: [4, 3] },
            ...zipSets,
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false, animation: false, parsing: false, spanGaps: true,
          interaction: { mode: "nearest", intersect: false },
          plugins: {
            title: { display: true, text: title, color: "#8b98a9", font: { size: 11 } },
            legend: { labels: { color: "#8b98a9", boxWidth: 10, font: { size: 10 }, filter: (item) => !item.text.startsWith("ZIP") } },
            tooltip: { callbacks: {
              title: (items) => {
                const x = items[0].raw.x;
                return new Date(Math.floor(x), Math.round((x - Math.floor(x)) * 12 - 0.5), 1).toLocaleDateString("en-US", { month: "short", year: "numeric" });
              },
              label: (c) => `${c.dataset.label}${view.zipInfo.get(c.dataset.zip) ? ` (${view.zipInfo.get(c.dataset.zip).properties.neighborhoods[0]})` : ""}: ${fmt(c.raw.y)}`,
            } },
          },
          scales: {
            x: { type: "linear", min: minYear, max: 2027, ticks: { ...AXIS, stepSize: minYear === 2000 ? 5 : 2, callback: (v) => String(v) }, grid: GRID },
            y: { ticks: { ...AXIS, callback: (v) => fmt(v) }, grid: GRID },
          },
        },
        plugins: [yearLine],
      });
      this.charts.push(chart);
    };
    const [valueEl, rentEl] = this.chartEls;
    build(valueEl, "value", "Typical home value (Zillow ZHVI). Gray = each Glendale ZIP", money, 2000);
    build(rentEl, "rent", "Typical rent (Zillow ZORI)", (v) => `$${Math.round(v).toLocaleString()}`, 2015);
  }
}
