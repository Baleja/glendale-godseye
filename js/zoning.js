import { ZONE_GROUPS } from "./map.js";
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

const pct = (v) => (v == null ? "—" : v >= 0.995 ? "100%" : v > 0 && v < 0.005 ? "<1%" : `${Math.round(v * 100)}%`);
const shade = (v) => `background:rgba(255,77,94,${(0.08 + 0.62 * (v || 0)).toFixed(2)})`;

/** Zoning & exposure view: headline numbers, legend, and the zone-by-hazard table. */
export class ZoningView {
  constructor({ summaryEl, tableEl, notesEl, onHighlight }) {
    Object.assign(this, { summaryEl, tableEl, notesEl, onHighlight });
    this.selected = null;
    this.data = null;
  }

  async load() {
    if (this.data) return;
    try {
      const res = await fetch("data/glendale/exposure.json");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.data = await res.json();
    } catch (err) {
      this.tableEl.innerHTML = `<p class="feed-status bad">Could not load exposure table (${escapeHtml(err.message)}).</p>`;
      return;
    }
    this.#renderSummary();
    this.#renderTable();
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
      <p class="fine">Click a zone type (here or in the table) to highlight it. Click the map for details at any spot.</p>`;
    this.summaryEl.querySelectorAll("li[data-group]").forEach((li) => li.addEventListener("click", () => this.select(li.dataset.group)));
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
    this.notesEl.innerHTML = `${escapeHtml(this.data.method)}. ${this.data.notes.map(escapeHtml).join(" ")}`;
  }

  select(group) {
    this.selected = group === "all" || group === this.selected ? null : group;
    this.onHighlight(this.selected);
    this.#renderSummary();
    this.#renderTable();
  }
}
