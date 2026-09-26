import { PERMIT_COLORS, ZONE_GROUPS } from "./map.js";
import { escapeHtml } from "./util.js";

const METRICS = [
  ["very_high_fire", "Very High fire hazard"],
  ["high_or_very_high_fire", "High or Very High fire"],
  ["burned_since_1950", "Burned since 1950"],
  ["burned_2plus_since_1950", "Burned 2+ times since 1950"],
  ["landslide", "Earthquake landslide zone"],
  ["liquefaction", "Liquefaction zone"],
  ["fault_rupture", "Fault rupture zone"],
  ["dam_inundation", "Dam inundation area"],
  ["fema_special_flood", "FEMA special flood area"],
];
const FIRST_PERMIT_YEAR = 2018;
const STATUS_LABEL = { approved: "Approved, not started", started: "Under construction", done: "Completed" };

const pct = (v) => (v == null ? "—" : v >= 0.995 ? "100%" : v > 0 && v < 0.005 ? "<1%" : `${Math.round(v * 100)}%`);
const shade = (v) => `background:rgba(255,77,94,${(0.08 + 0.62 * (v || 0)).toFixed(2)})`;
const fmtDate = (iso) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");

/** Zoning & exposure view: headline numbers, legend, zone-by-hazard table and housing permits. */
export class ZoningView {
  constructor({ summaryEl, tableEl, notesEl, onHighlight, onPermitYear, getMap, permits }) {
    Object.assign(this, { summaryEl, tableEl, notesEl, onHighlight, onPermitYear, getMap, permits });
    this.selected = null;
    this.data = null;
    this.permitData = null;
    this.permitYear = null;
    this.timer = null;
  }

  async load() {
    if (!this.data) {
      try {
        const [exposure, permits] = await Promise.all(["data/glendale/exposure.json", "data/glendale/permits.geojson"].map(async (url) => {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
          return res.json();
        }));
        this.data = exposure;
        this.permitData = permits;
      } catch (err) {
        this.tableEl.innerHTML = `<p class="feed-status bad">Could not load zoning data (${escapeHtml(err.message)}). Run scripts/fetch_permits.py for the permit layer.</p>`;
        return;
      }
      this.#initPermits();
      this.#renderTable();
    }
    this.#renderSummary();
    this.#applyPermitYear();
  }

  leave() {
    this.stopPlay();
    this.popup?.remove();
  }

  #initPermits() {
    const p = this.permits;
    const props = this.permitData.features.map((f) => f.properties);
    const last = Math.max(...props.map((x) => x.approved_year || 0), ...props.map((x) => x.started_year || 0));
    this.permitYears = [];
    for (let y = FIRST_PERMIT_YEAR; y <= last; y++) this.permitYears.push(y);
    p.yearsEl.innerHTML = `<button type="button" data-year="">All years</button>${this.permitYears.map((y) => `<button type="button" data-year="${y}">${y}</button>`).join("")}`;
    p.yearsEl.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      this.stopPlay();
      this.permitYear = b.dataset.year ? Number(b.dataset.year) : null;
      this.#applyPermitYear();
    });
    p.playBtn.addEventListener("click", () => (this.timer ? this.stopPlay() : this.play()));

    const m = this.getMap();
    this.popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, maxWidth: "260px", offset: 8 });
    m.on("mousemove", "permits_points", (e) => {
      const f = e.features[0];
      if (f) this.popup.setLngLat(f.geometry.coordinates).setHTML(this.#projectHtml(f.properties)).addTo(m);
    });
    m.on("mouseleave", "permits_points", () => this.popup.remove());
  }

  play() {
    let i = this.permitYear == null ? -1 : this.permitYears.indexOf(this.permitYear);
    if (i >= this.permitYears.length - 1) i = -1;
    this.permits.playBtn.textContent = "❚❚";
    const step = () => {
      i += 1;
      this.permitYear = this.permitYears[i];
      this.#applyPermitYear();
      if (i >= this.permitYears.length - 1) this.stopPlay();
    };
    step();
    this.timer = setInterval(step, 1300);
  }

  stopPlay() {
    clearInterval(this.timer);
    this.timer = null;
    if (this.permits) this.permits.playBtn.textContent = "▶";
  }

  #projectHtml(p) {
    const zone = ZONE_GROUPS[p.zone_group]?.label.replace(/ \(.*\)$/, "");
    const risks = [p.fire && `${p.fire} fire hazard`, p.liquefaction && "liquefaction zone", p.landslide && "landslide zone",
      p.fault && "fault zone", p.dam && "dam inundation area"].filter(Boolean);
    return `<b>${escapeHtml(p.addr || "Housing project")}</b><br>
      <span class="fine">${escapeHtml(p.cat)} · ${p.units} home${p.units === 1 ? "" : "s"}${p.hood ? ` · ${escapeHtml(p.hood)}` : ""}</span>
      <table class="tract-pop">
        <tr><td><span class="swatch" style="background:${PERMIT_COLORS.approved}"></span>Approved</td><td>${fmtDate(p.approved)}</td></tr>
        <tr><td><span class="swatch" style="background:${PERMIT_COLORS.started}"></span>Construction started</td><td>${fmtDate(p.started)}</td></tr>
        <tr><td><span class="swatch" style="background:${PERMIT_COLORS.done}"></span>Completed</td><td>${fmtDate(p.done)}</td></tr>
      </table>
      <span class="fine">${escapeHtml(STATUS_LABEL[p.status])}${zone ? ` · ${escapeHtml(zone)}` : ""}${risks.length ? `<br>In: ${escapeHtml(risks.join(", "))}` : ""}</span>`;
  }

  /** Projects approved and started in the selected year (or since 2018 for "All years"). */
  #permitCounts() {
    const y = this.permitYear;
    const inYear = (v) => (y == null ? v >= FIRST_PERMIT_YEAR : v === y);
    const props = this.permitData.features.map((f) => f.properties);
    const approved = props.filter((p) => inYear(p.approved_year));
    const started = props.filter((p) => inYear(p.started_year));
    return { approved, started, units: (list) => list.reduce((s, p) => s + p.units, 0) };
  }

  #applyPermitYear() {
    if (!this.permitData) return;
    const { approved, started, units } = this.#permitCounts();
    this.onPermitYear(this.permitYear, FIRST_PERMIT_YEAR, { approved: approved.length, started: started.length });
    for (const b of this.permits.yearsEl.querySelectorAll("button")) {
      b.setAttribute("aria-pressed", String(b.dataset.year === (this.permitYear == null ? "" : String(this.permitYear))));
    }
    const when = this.permitYear == null ? `since ${FIRST_PERMIT_YEAR}` : `in ${this.permitYear}`;
    this.permits.countEl.innerHTML = `<b style="color:${PERMIT_COLORS.approved}">${approved.length.toLocaleString()}</b> approved · <b style="color:${PERMIT_COLORS.started}">${started.length.toLocaleString()}</b> started ${when} <span class="fine">(${units(started).toLocaleString()} homes)</span>`;
    this.#renderPermitSummary();
  }

  #renderPermitSummary() {
    const el = this.summaryEl.querySelector("#permit-summary");
    if (!el || !this.permitData) return;
    const { approved, started, units } = this.#permitCounts();
    const when = this.permitYear == null ? `since ${FIRST_PERMIT_YEAR}` : `in ${this.permitYear}`;
    const share = (list, test) => (list.length ? list.filter(test).length / list.length : null);
    const all = this.permitData.features.map((f) => f.properties);
    const building = all.filter((p) => p.status === "started");
    const hoods = new Map();
    for (const p of approved) if (p.hood) hoods.set(p.hood, (hoods.get(p.hood) || 0) + 1);
    const top = [...hoods].sort((a, b) => b[1] - a[1]).slice(0, 5);
    el.innerHTML = `
      <div class="stat-grid">
        <div><b style="color:${PERMIT_COLORS.approved}">${approved.length.toLocaleString()}</b><span>housing projects approved ${when} (${units(approved).toLocaleString()} homes)</span></div>
        <div><b style="color:${PERMIT_COLORS.started}">${started.length.toLocaleString()}</b><span>started construction ${when} (${units(started).toLocaleString()} homes)</span></div>
        <div><b>${pct(share(approved, (p) => p.cat === "ADU"))}</b><span>of approved projects are ADUs (backyard or garage units)</span></div>
        <div><b>${pct(share(approved, (p) => p.fire === "Very High"))}</b><span>of approved projects are in a Very High fire hazard zone</span></div>
      </div>
      <p class="fine">Under construction now: <b>${building.length.toLocaleString()}</b> projects, ${units(building).toLocaleString()} homes. Most approvals ${when}:</p>
      <ol class="tract-list">${top.map(([h, n]) => `<li><b>${escapeHtml(h)}</b> <span class="fine">${n} project${n === 1 ? "" : "s"}</span></li>`).join("")}</ol>
      <p class="fine">Zoom in to street level to see each project. Housing only: commercial, remodel and solar permits aren't in the state data.</p>`;
  }

  #renderSummary() {
    const g = this.data.groups;
    const sf = g.single_family.pct;
    this.summaryEl.innerHTML = `
      <div class="stat-grid">
        <div><b>${pct(g.all.pct.very_high_fire)}</b><span>of Glendale is in a Very High fire hazard zone</span></div>
        <div><b>${pct(sf.very_high_fire)}</b><span>of single-family-zoned land is Very High fire hazard</span></div>
        <div><b>${pct(g.all.pct.burned_since_1950)}</b><span>of the city has burned in a mapped fire since 1950</span></div>
        <div><b>${pct(g.industrial.pct.liquefaction)}</b><span>of industrial land sits in a liquefaction zone</span></div>
      </div>
      <ul class="legend">${Object.entries(ZONE_GROUPS).filter(([k]) => k !== "streets_unzoned").map(([k, v]) => `
        <li data-group="${k}" class="${this.selected === k ? "on" : ""}"><span class="swatch" style="background:${v.color}"></span>${escapeHtml(v.label)}
        <span class="fine">${pct(g[k]?.share_of_city)} of city</span></li>`).join("")}</ul>
      <p class="fine">Click a zone type (here or in the table) to highlight it. Click the map for details at any spot.</p>
      <h4 class="sub">New homes: permits</h4>
      <div id="permit-summary"></div>`;
    this.summaryEl.querySelectorAll("li[data-group]").forEach((li) => li.addEventListener("click", () => this.select(li.dataset.group)));
    this.#renderPermitSummary();
  }

  #renderTable() {
    const groups = Object.entries(this.data.groups)
      .filter(([k]) => k !== "all")
      .sort((a, b) => b[1].area_km2 - a[1].area_km2);
    const rowHtml = ([k, g], label, color) => `
      <tr data-group="${k}" class="${this.selected === k ? "on" : ""}">
        <th><span class="swatch" style="background:${color}"></span>${escapeHtml(label)}<span class="fine"> ${g.area_km2.toFixed(1)} km²</span></th>
        ${METRICS.map(([m]) => `<td style="${shade(g.pct[m])}">${pct(g.pct[m])}</td>`).join("")}
      </tr>`;
    this.tableEl.innerHTML = `
      <table class="exp-table">
        <thead><tr><th>Share of each zone type inside…</th>${METRICS.map(([, l]) => `<th>${l}</th>`).join("")}</tr></thead>
        <tbody>
          ${rowHtml(["all", this.data.groups.all], "All of Glendale", "#e6edf3")}
          ${groups.map(([k, g]) => rowHtml([k, g], ZONE_GROUPS[k]?.label.replace(/ \(.*\)$/, "") || k, ZONE_GROUPS[k]?.color || "#555")).join("")}
        </tbody>
      </table>`;
    this.tableEl.querySelectorAll("tr[data-group]").forEach((tr) => tr.addEventListener("click", () => this.select(tr.dataset.group)));
    this.notesEl.innerHTML = `${escapeHtml(this.data.method)}. ${this.data.notes.map(escapeHtml).join(" ")} Permits: ${escapeHtml(this.permitData.source)}. ${this.permitData.notes.map(escapeHtml).join(" ")}`;
  }

  select(group) {
    this.selected = group === "all" || group === this.selected ? null : group;
    this.onHighlight(this.selected);
    this.#renderSummary();
    this.#renderTable();
  }
}
