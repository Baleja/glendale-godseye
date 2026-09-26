import { escapeHtml } from "./util.js";
import { bboxOf } from "./geo.js";
import { HEAT_RAMP } from "./map.js";

const HEAT_METRICS = [
  { key: "elec_bill", label: "Electric bill", fmt: (v) => `$${Math.round(v)}/mo` },
  { key: "est_kwh", label: "Electricity use (est.)", fmt: (v) => `${Math.round(v)} kWh/mo` },
  { key: "gas_bill", label: "Gas bill", fmt: (v) => `$${Math.round(v)}/mo` },
  { key: "water_bill", label: "Water & sewer bill", fmt: (v) => `$${Math.round(v)}/mo` },
  { key: "burden_pct", label: "Share of income", fmt: (v) => `${v.toFixed(1)}%` },
];

const GLENDALE_ID = "7294";
const UTILITY_COLORS = {
  "7294": "#38e1ff", "2507": "#f4d35e", "14534": "#3ddc97", "11208": "#c77dff", "17609": "#ff9f1c",
};
const GRAYSON = [-118.2790, 34.1571];
const AXIS = { color: "#8b98a9", font: { size: 10 } };
const GRID = { color: "rgba(255,255,255,0.06)" };

const fracYear = (iso) => {
  const d = new Date(`${iso}T00:00:00`);
  const y = d.getFullYear();
  return y + (d - new Date(y, 0, 1)) / (new Date(y + 1, 0, 1) - new Date(y, 0, 1));
};
const fmtDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/** Compounds rate steps into an index (start = 100). Returns points and the final multiplier. */
function rateIndex(steps, start) {
  let idx = 100;
  const pts = [{ x: start, y: 100, status: "baseline" }];
  for (const s of steps) {
    if (s.status === "baseline") continue;
    idx *= 1 + s.pct / 100;
    pts.push({ x: fracYear(s.effective), y: +idx.toFixed(1), status: s.status, step: s });
  }
  return pts;
}

/** Energy & water view: rate-hike timeline, price history vs. neighbors, monthly water use. */
export class EnergyView {
  constructor({ summaryEl, chartEls, notesEl, getMap, heat, onFlyTo }) {
    Object.assign(this, { summaryEl, chartEls, notesEl, getMap, heat, onFlyTo });
    this.loaded = false;
    this.marker = null;
    this.metric = HEAT_METRICS[0];
    this.yearIdx = 0;
    this.timer = null;
  }

  async load() {
    if (!this.loaded) {
      try {
        [this.rates, this.electric, this.water, this.costs, this.tracts] = await Promise.all([
          getJson("data/utility/rate_actions.json"),
          getJson("data/utility/electric_prices.json"),
          getJson("data/utility/water_use.json"),
          getJson("data/utility/tract_costs.json"),
          getJson("data/glendale/tracts.geojson"),
        ]);
      } catch (err) {
        this.summaryEl.innerHTML = `<p class="feed-status bad">Could not load utility data (${escapeHtml(err.message)}). Run scripts/fetch_utility.py and scripts/fetch_neighborhood_costs.py.</p>`;
        return;
      }
      this.loaded = true;
      this.years = Object.keys(this.costs.years).sort();
      this.yearIdx = this.years.length - 1;
      this.tractInfo = new Map(this.tracts.features.map((f) => [f.properties.geoid, f]));
      this.#initHeat();
      this.#renderSummary();
      this.#buildCharts();
      this.notesEl.innerHTML = [
        `Neighborhood heatmap: ${escapeHtml(this.costs.source)}. ${this.costs.notes.map(escapeHtml).join(" ")}`,
        `Rates: ${escapeHtml(this.rates.note)}`,
        `Prices: ${escapeHtml(this.electric.source)}. ${escapeHtml(this.electric.note)}`,
        `Water: ${escapeHtml(this.water.source)}. ${escapeHtml(this.water.note)}`,
      ].join(" ");
    }
    this.showMarker(true);
    this.#applyHeat();
  }

  leave() {
    this.stopPlay();
    this.showMarker(false);
    this.popup?.remove();
  }

  #initHeat() {
    const h = this.heat;
    this.ranges = Object.fromEntries(HEAT_METRICS.map((m) => {
      const vals = this.years.flatMap((y) => Object.values(this.costs.years[y].tracts).map((t) => t[m.key])).filter((v) => v != null);
      return [m.key, [Math.min(...vals), Math.max(...vals)]];
    }));
    h.metricEl.innerHTML = HEAT_METRICS.map((m) => `<button type="button" data-key="${m.key}">${escapeHtml(m.label)}</button>`).join("");
    h.metricEl.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      this.metric = HEAT_METRICS.find((m) => m.key === b.dataset.key);
      this.#applyHeat();
    });
    h.yearEl.max = String(this.years.length - 1);
    h.yearEl.value = String(this.yearIdx);
    h.ticksEl.innerHTML = this.years.map((_, i) => `<option value="${i}"></option>`).join("");
    h.yearEl.addEventListener("input", () => {
      this.stopPlay();
      this.yearIdx = Number(h.yearEl.value);
      this.#applyHeat();
    });
    h.playBtn.addEventListener("click", () => (this.timer ? this.stopPlay() : this.play()));

    const m = this.getMap();
    let hovered = null;
    this.popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, maxWidth: "260px", offset: 8 });
    m.on("mousemove", "tract_heat", (e) => {
      const f = e.features[0];
      if (!f) return;
      if (hovered && hovered !== f.id) m.setFeatureState({ source: "tract_heat", id: hovered }, { hover: false });
      hovered = f.id;
      m.setFeatureState({ source: "tract_heat", id: hovered }, { hover: true });
      this.popup.setLngLat(e.lngLat).setHTML(this.#tractHtml(f.id)).addTo(m);
    });
    m.on("mouseleave", "tract_heat", () => {
      if (hovered) m.setFeatureState({ source: "tract_heat", id: hovered }, { hover: false });
      hovered = null;
      this.popup.remove();
    });
    // GeoJSON feature state can only be set once the source has parsed its data.
    m.on("sourcedata", (e) => {
      if (e.sourceId === "tract_heat" && e.isSourceLoaded && !this.stateReady) {
        this.stateReady = true;
        this.#applyHeat();
      }
    });
  }

  play() {
    if (this.yearIdx >= this.years.length - 1) this.yearIdx = 0;
    this.heat.playBtn.textContent = "❚❚";
    this.#applyHeat();
    this.timer = setInterval(() => {
      this.yearIdx += 1;
      this.#applyHeat();
      if (this.yearIdx >= this.years.length - 1) this.stopPlay();
    }, 1300);
  }

  stopPlay() {
    clearInterval(this.timer);
    this.timer = null;
    if (this.heat) this.heat.playBtn.textContent = "▶";
  }

  #tractName(geoid) {
    const p = this.tractInfo.get(geoid)?.properties;
    if (!p) return geoid;
    return p.neighborhood ? `${p.neighborhood} (${p.name.replace("Census ", "")})` : p.name;
  }

  #tractHtml(geoid) {
    const y = this.years[this.yearIdx];
    const t = this.costs.years[y].tracts[geoid];
    if (!t) return escapeHtml(this.#tractName(geoid));
    const row = (m) => {
      const v = t[m.key];
      return `<tr${m.key === this.metric.key ? ' class="on"' : ""}><td>${escapeHtml(m.label)}</td><td>${v == null ? "—" : m.fmt(v)}</td></tr>`;
    };
    return `<b>${escapeHtml(this.#tractName(geoid))}</b><br><span class="fine">Survey years ${this.costs.years[y].span}</span>
      <table class="tract-pop">${HEAT_METRICS.map(row).join("")}
      <tr><td>Median household income</td><td>${t.income ? `$${Math.round(t.income).toLocaleString()}` : "—"}</td></tr>
      <tr><td>Households paying own electric</td><td>${t.pays_own_electric_pct ?? "—"}%</td></tr></table>`;
  }

  #applyHeat() {
    if (!this.loaded) return;
    const h = this.heat;
    const y = this.years[this.yearIdx];
    const period = this.costs.years[y];
    const [lo, hi] = this.ranges[this.metric.key];
    const m = this.getMap();
    if (m.getSource("tract_heat")) {
      for (const geoid of this.tractInfo.keys()) {
        const v = period.tracts[geoid]?.[this.metric.key];
        m.setFeatureState({ source: "tract_heat", id: geoid }, { t: v == null ? -1 : (v - lo) / (hi - lo || 1) });
      }
    }
    for (const b of h.metricEl.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.key === this.metric.key));
    h.yearEl.value = String(this.yearIdx);
    h.yearLabel.textContent = `Survey years ${period.span}`;
    h.legendEl.innerHTML = `${this.metric.fmt(lo)}<i style="background:linear-gradient(90deg,${HEAT_RAMP.join(",")})"></i>${this.metric.fmt(hi)}`;
    this.#renderRank();
  }

  #renderRank() {
    const el = this.summaryEl.querySelector("#heat-rank");
    if (!el) return;
    const key = this.metric.key;
    const y = this.years[this.yearIdx];
    const period = this.costs.years[y];
    const median = (yr) => {
      const vals = Object.values(this.costs.years[yr].tracts).map((t) => t[key]).filter((v) => v != null).sort((a, b) => a - b);
      return vals[Math.floor(vals.length / 2)];
    };
    const first = this.years[0];
    const change = y !== first ? ((median(y) / median(first) - 1) * 100) : null;
    const ranked = [...this.tractInfo.keys()]
      .map((g) => ({ g, v: period.tracts[g]?.[key] }))
      .filter((r) => r.v != null)
      .sort((a, b) => b.v - a.v);
    el.innerHTML = `
      <p class="fine">Typical Glendale neighborhood, ${period.span}: <b>${this.metric.fmt(median(y))}</b>${change != null ? ` (${change >= 0 ? "+" : ""}${change.toFixed(0)}% vs. ${this.costs.years[first].span})` : ""}. Highest ${escapeHtml(this.metric.label.toLowerCase())}:</p>
      <ol class="tract-list">${ranked.slice(0, 5).map((r) => `<li data-g="${r.g}"><b>${escapeHtml(this.#tractName(r.g))}</b> <span class="fine">${this.metric.fmt(r.v)}</span></li>`).join("")}</ol>`;
    el.querySelectorAll("li[data-g]").forEach((li) => li.addEventListener("click", () => {
      this.onFlyTo(bboxOf(this.tractInfo.get(li.dataset.g).geometry));
    }));
  }

  showMarker(on) {
    if (!on || !this.loaded) return this.marker?.remove();
    if (!this.marker) {
      const el = document.createElement("div");
      el.className = "poi-pin";
      el.textContent = "⚡";
      const s = this.rates.storage;
      const popup = new maplibregl.Popup({ offset: 14, maxWidth: "280px" }).setHTML(
        `<b>${escapeHtml(s.name)}</b><br>${escapeHtml(s.address)}<br>${s.battery_mw} MW / ${s.battery_mwh} MWh battery + ${s.engines_mw} MW gas engines<br><span class="fine">${escapeHtml(s.status_note)}</span>`);
      this.marker = new maplibregl.Marker({ element: el }).setLngLat(GRAYSON).setPopup(popup);
      el.addEventListener("click", (e) => e.stopPropagation());
    }
    this.marker.addTo(this.getMap());
  }

  #renderSummary() {
    const today = new Date().toISOString().slice(0, 10);
    const el = this.rates.electric;
    const wa = this.rates.water.filter((s) => s.status !== "baseline");
    const compound = (steps) => (steps.reduce((m, s) => m * (1 + s.pct / 100), 1) - 1) * 100;
    const elecTotal = compound(el);
    const waterProposed = compound(wa.filter((s) => s.status === "proposed"));
    const upcoming = [...el.map((s) => ({ ...s, kind: "Electric" })), ...wa.map((s) => ({ ...s, kind: "Water" }))]
      .filter((s) => s.effective > today)
      .sort((a, b) => a.effective.localeCompare(b.effective));

    const glendale = this.electric.rows.filter((r) => r.utility_id === GLENDALE_ID).sort((a, b) => a.year - b.year);
    const first = glendale[0];
    const last = glendale.at(-1);
    const neighbors = this.electric.rows.filter((r) => r.year === last.year).sort((a, b) => b.res_cents_per_kwh - a.res_cents_per_kwh);
    const latestWater = this.water.months.at(-1);
    const s = this.rates.storage;

    this.summaryEl.innerHTML = `
      <div id="heat-rank"></div>
      <p class="fine">Hover a neighborhood on the map for all its numbers. Use the timeline below to step through survey periods.</p>
      <h4 class="sub">Rates</h4>
      <div class="stat-grid">
        <div><b>+${Math.round(elecTotal)}%</b><span>average electric rates, Jan 2024 → Nov 2027 (all steps adopted)</span></div>
        <div><b>+${Math.round(waterProposed)}%</b><span>water rates 2027 → 2031 if the proposed plan is adopted</span></div>
        <div><b>${last.res_cents_per_kwh.toFixed(1)}¢</b><span>average residential price per kWh in ${last.year}, up from ${first.res_cents_per_kwh.toFixed(1)}¢ in ${first.year}</span></div>
        <div><b>$${Math.round(last.res_avg_monthly_bill)}</b><span>average residential electric bill per month in ${last.year} (${Math.round(last.res_kwh_per_month)} kWh)</span></div>
      </div>
      <p class="fine">Coming up:</p>
      <ul class="upcoming">${upcoming.slice(0, 4).map((u) => `
        <li><span class="tag ${u.kind.toLowerCase()}">${u.kind}</span> <b>+${u.pct}%</b> ${fmtDate(u.effective)}
          <span class="fine">${escapeHtml(u.status)}</span></li>`).join("")}</ul>
      <p class="fine">Residential price in ${last.year}: ${neighbors.map((n) => `<span style="color:${UTILITY_COLORS[n.utility_id]}">${escapeHtml(n.utility)} ${n.res_cents_per_kwh.toFixed(1)}¢</span>`).join(" · ")}</p>
      <div class="storage-card">
        <b>⚡ ${escapeHtml(s.name)}</b>: ${s.battery_mw} MW / ${s.battery_mwh} MWh battery (about 4 hours at full output) plus ${s.engines_mw} MW of gas engines at ${escapeHtml(s.address)}.
        <span class="fine">${escapeHtml(s.status_note)}</span>
      </div>
      <p class="fine">Water use in ${latestWater.month}: <b>${latestWater.r_gpcd}</b> residential gallons per person per day. Declared shortage level: ${escapeHtml(latestWater.shortage_level || "none reported")}.</p>
      <p class="fine">GWP is city-owned, so rates are set by Glendale City Council (not the CPUC). Agendas: <a href="https://glendaleca.primegov.com/" target="_blank" rel="noopener">PrimeGov</a>.</p>`;
  }

  #buildCharts() {
    const [rateEl, priceEl, waterEl] = this.chartEls;
    const elec = rateIndex(this.rates.electric, 2023.0);
    const water = rateIndex(this.rates.water, 2019.0);
    const dashed = (ctx) => (ctx.p1.raw.status === "proposed" ? [5, 4] : undefined);
    const now = fracYear(new Date().toISOString().slice(0, 10));

    const todayLine = {
      id: "today",
      afterDatasetsDraw(chart) {
        const x = chart.scales.x.getPixelForValue(now);
        const { top, bottom } = chart.chartArea;
        const c = chart.ctx;
        c.save();
        c.strokeStyle = "rgba(255,255,255,0.45)";
        c.setLineDash([3, 3]);
        c.beginPath(); c.moveTo(x, top); c.lineTo(x, bottom); c.stroke();
        c.fillStyle = "#8b98a9"; c.font = "10px ui-monospace, monospace"; c.fillText("today", x + 3, top + 10);
        c.restore();
      },
    };

    new Chart(rateEl, {
      type: "line",
      data: {
        datasets: [
          { label: "Electric (2023 = 100)", data: elec, stepped: "before", borderColor: "#38e1ff", backgroundColor: "#38e1ff", pointRadius: 3, segment: { borderDash: dashed } },
          { label: "Water (2019 = 100)", data: water, stepped: "before", borderColor: "#4da3ff", backgroundColor: "#4da3ff", pointRadius: 3, segment: { borderDash: dashed, borderColor: "#6fb6ff" } },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false, parsing: false,
        plugins: {
          title: { display: true, text: "Rate index (dashed = proposed)", color: "#8b98a9", font: { size: 11 } },
          legend: { labels: { color: "#8b98a9", boxWidth: 10, font: { size: 10 } } },
          tooltip: { callbacks: { label: (c) => {
            const st = c.raw.step;
            return st ? `${c.dataset.label.split(" ")[0]} +${st.pct}% on ${fmtDate(st.effective)} (${st.status}) → index ${c.raw.y}` : `${c.dataset.label}: 100`;
          } } },
        },
        scales: {
          x: { type: "linear", min: 2019, max: 2032, ticks: { ...AXIS, stepSize: 1, callback: (v) => (v % 2 === 0 ? String(v) : "") }, grid: GRID },
          y: { ticks: AXIS, grid: GRID, suggestedMin: 90 },
        },
      },
      plugins: [todayLine],
    });

    const years = [...new Set(this.electric.rows.map((r) => r.year))].sort();
    const utils = [...new Set(this.electric.rows.map((r) => r.utility_id))];
    new Chart(priceEl, {
      type: "line",
      data: {
        labels: years,
        datasets: utils.map((id) => {
          const rows = this.electric.rows.filter((r) => r.utility_id === id);
          return {
            label: rows[0].utility,
            data: years.map((y) => rows.find((r) => r.year === y)?.res_cents_per_kwh ?? null),
            borderColor: UTILITY_COLORS[id], backgroundColor: UTILITY_COLORS[id],
            borderWidth: id === GLENDALE_ID ? 3 : 1.5, pointRadius: id === GLENDALE_ID ? 2.5 : 0,
          };
        }),
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: {
          title: { display: true, text: "Average residential price, ¢/kWh (EIA-861)", color: "#8b98a9", font: { size: 11 } },
          legend: { labels: { color: "#8b98a9", boxWidth: 10, font: { size: 10 } } },
          tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.raw?.toFixed(1)}¢` } },
        },
        scales: { x: { ticks: AXIS, grid: { display: false } }, y: { ticks: { ...AXIS, callback: (v) => `${v}¢` }, grid: GRID } },
      },
    });

    const months = this.water.months.filter((m) => m.r_gpcd != null);
    new Chart(waterEl, {
      type: "line",
      data: {
        labels: months.map((m) => m.month),
        datasets: [{
          label: "Residential gallons per person per day",
          data: months.map((m) => m.r_gpcd),
          borderColor: "#4da3ff", backgroundColor: "rgba(77,163,255,0.15)", fill: true, borderWidth: 1.5, pointRadius: 0,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: {
          title: { display: true, text: "Glendale water use, gallons per person per day (monthly)", color: "#8b98a9", font: { size: 11 } },
          legend: { display: false },
          tooltip: { callbacks: { afterLabel: (c) => `Shortage level: ${months[c.dataIndex].shortage_level || "none reported"}` } },
        },
        scales: {
          x: {
            ticks: { ...AXIS, autoSkip: false, maxRotation: 0, callback(v) {
              const l = this.getLabelForValue(v);
              return l.endsWith("-01") && Number(l.slice(0, 4)) % 2 === 0 ? l.slice(0, 4) : "";
            } },
            grid: { display: false },
          },
          y: { ticks: AXIS, grid: GRID, beginAtZero: true },
        },
      },
    });
  }
}
