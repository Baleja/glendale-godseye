import { escapeHtml } from "./util.js";
import { bboxOf } from "./geo.js";

export const FIRST_YEAR = 1878;
export const LAST_YEAR = 2025;
const REPLAYS = { 2017: { name: "La Tuna", id: "la-tuna-2017" }, 2009: { name: "Station", id: "station-2009" }, 2025: { name: "Eaton", id: "eaton-2025" } };

/** Fire history view: year-range filter, decade chart, and largest-fires list. */
export class HistoryView {
  constructor({ summaryEl, chartEl, fromEl, toEl, animateBtn, onRange, onFlyTo }) {
    Object.assign(this, { summaryEl, chartEl, fromEl, toEl, animateBtn, onRange, onFlyTo });
    this.fires = null;
    this.chart = null;
    this.timer = null;
    this.from = FIRST_YEAR;
    this.to = LAST_YEAR;
  }

  async load() {
    if (this.fires) return;
    try {
      const res = await fetch("data/history/fire_perimeters.geojson");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.fires = (await res.json()).features;
    } catch (err) {
      this.summaryEl.innerHTML = `<p class="feed-status bad">Could not load fire history (${escapeHtml(err.message)}).</p>`;
      return;
    }
    this.#buildChart();
    this.setRange(this.from, this.to);
  }

  setRange(from, to) {
    this.from = Math.max(FIRST_YEAR, Math.min(from, to));
    this.to = Math.min(LAST_YEAR, Math.max(from, to));
    this.fromEl.value = this.from;
    this.toEl.value = this.to;
    this.onRange(this.from, this.to);
    if (this.fires) {
      this.#renderSummary();
      this.#paintChart();
    }
  }

  toggleAnimate() {
    if (this.timer) return this.stopAnimate();
    const span = 10;
    let start = this.to - this.from < LAST_YEAR - FIRST_YEAR ? this.from : 1900;
    this.animateBtn.textContent = "■ Stop";
    this.timer = setInterval(() => {
      this.setRange(start, start + span - 1);
      start += 2;
      if (start > LAST_YEAR) this.stopAnimate();
    }, 350);
  }

  stopAnimate() {
    clearInterval(this.timer);
    this.timer = null;
    this.animateBtn.textContent = "▶ Animate";
  }

  #inRange() {
    return this.fires.filter((f) => f.properties.year >= this.from && f.properties.year <= this.to);
  }

  #renderSummary() {
    const fires = this.#inRange();
    const acres = fires.reduce((s, f) => s + (f.properties.acres || 0), 0);
    const top = [...fires].sort((a, b) => (b.properties.acres || 0) - (a.properties.acres || 0)).slice(0, 7);
    const replays = Object.entries(REPLAYS).filter(([y]) => y >= this.from && y <= this.to);
    this.summaryEl.innerHTML = `
      <div class="stat-grid">
        <div><b>${fires.length}</b><span>mapped fires, ${this.from}–${this.to}</span></div>
        <div><b>${Math.round(acres).toLocaleString()}</b><span>acres burned (overlaps counted each time)</span></div>
      </div>
      <p class="fine">Largest in range. Click to zoom:</p>
      <ol class="fire-list">${top.map((f, i) => `<li data-i="${this.fires.indexOf(f)}"><b>${escapeHtml(f.properties.name)}</b> ${f.properties.year}
        <span class="fine">${Math.round(f.properties.acres || 0).toLocaleString()} ac</span></li>`).join("") || '<li class="fine">No mapped fires in this range</li>'}</ol>
      ${replays.length ? `<p class="fine">Replay the weather before: ${replays.map(([, r]) => `<a href="#${r.id}">${r.name}</a>`).join(" · ")}</p>` : ""}
      <p class="fine">Red/orange/yellow basins above Altadena are the USGS post-fire debris-flow hazard for the Eaton burn scar. USGS has only published basin estimates for fires since 2020; older Glendale burn scars (La Tuna, Station) were never mapped this way.</p>`;
    this.summaryEl.querySelectorAll(".fire-list li[data-i]").forEach((li) => li.addEventListener("click", () => {
      this.onFlyTo(bboxOf(this.fires[+li.dataset.i].geometry));
    }));
  }

  #buildChart() {
    const decades = [];
    for (let d = 1870; d <= 2020; d += 10) decades.push(d);
    const acres = decades.map((d) => this.fires
      .filter((f) => f.properties.year >= d && f.properties.year < d + 10)
      .reduce((s, f) => s + (f.properties.acres || 0), 0));
    this.decades = decades;
    this.chart = new Chart(this.chartEl, {
      type: "bar",
      data: { labels: decades.map((d) => `${d}s`), datasets: [{ data: acres, backgroundColor: [], borderWidth: 0 }] },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => `${Math.round(c.raw).toLocaleString()} acres burned` } },
        },
        scales: {
          x: { ticks: { color: "#8b98a9", font: { size: 10 } }, grid: { display: false } },
          y: { ticks: { color: "#8b98a9", font: { size: 10 }, callback: (v) => `${v / 1000}k` }, grid: { color: "rgba(255,255,255,0.06)" }, title: { display: true, text: "acres / decade", color: "#8b98a9", font: { size: 10 } } },
        },
        onClick: (_e, els) => {
          if (!els.length) return;
          const d = this.decades[els[0].index];
          this.setRange(d, d + 9);
        },
      },
    });
  }

  #paintChart() {
    this.chart.data.datasets[0].backgroundColor = this.decades.map((d) => (d + 9 >= this.from && d <= this.to ? "#ff9f1c" : "rgba(255,159,28,0.2)"));
    this.chart.update("none");
  }
}
