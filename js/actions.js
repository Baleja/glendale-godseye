import { escapeHtml } from "./util.js";

const MYGLENDALE = "https://glendaleca.citysourced.com/servicerequests/create";
const COUNCIL = "CityCouncil@GlendaleCA.gov";
const GWP_SERVICE = "GWPCustomerService@glendaleca.gov";
const ZONING = "Zoning@GlendaleCA.gov";

const spotText = (spot) => spot
  ? `${spot.label ? `${spot.label}, ` : ""}near ${spot.lat.toFixed(5)}, ${spot.lng.toFixed(5)} (https://www.google.com/maps?q=${spot.lat.toFixed(5)},${spot.lng.toFixed(5)})`
  : "[your street address or nearest cross streets]";

const mailto = (to, subject, body) =>
  `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

/** Each action returns a draft and where to send it. `facts` are the app's own numbers. */
const ACTIONS = {
  council_grid: {
    modes: ["energy"],
    title: "Ask City Council to prioritize grid improvements",
    how: "Opens an email to all five councilmembers. GWP is city-owned, so the Council sets its rates and budget.",
    draft: (spot, f) => ({
      to: COUNCIL,
      subject: "Glendale grid reliability and electric bills",
      body: `Dear Glendale City Council,

I'm a Glendale resident${spot?.label ? ` in ${spot.label}` : ""}. The typical Glendale household now pays about ${f.bill ?? "$170"} a month for electricity${f.billChange ? ` (${f.billChange} over the last five Census survey years)` : ""}, and adopted rate steps raise average electric rates ${f.rateTotal ?? "further"} through November 2027.

Before the next rate adjustment, I'd like the Council and the GWP Commission to:
1. Publish where rate revenue is going: Grayson repowering, poles and transformers, undergrounding, and wildfire mitigation.
2. Share outage frequency and duration by neighborhood, and a plan for the worst-served areas.
3. Expand Glendale Care and bill-assistance outreach to the neighborhoods with the highest energy cost burden.

Thank you,
[Your name]
[Your address or council district]`,
    }),
  },
  gwp_bill: {
    modes: ["energy"],
    title: "Ask GWP to review my bill",
    how: "Opens an email to GWP Customer Service. Add your account number; they can show your daily usage.",
    draft: () => ({
      to: GWP_SERVICE,
      subject: "Usage inquiry: request to review my bill",
      body: `Hello GWP Customer Service,

My recent bill was $[amount] for [kWh] kWh over [number] days. That's higher than I expected. Could you:
1. Show me my daily or hourly usage for this billing period?
2. Check whether I'm on the best rate plan (standard tiered or time-of-use)?
3. Tell me whether I qualify for Glendale Care or any rebates?

Account number: [your GWP account number]
Service address: [your address]

Thank you,
[Your name]
[Phone]`,
    }),
  },
  outage: {
    modes: ["energy"],
    title: "Report a power outage or a downed line",
    how: "Downed or sparking line: stay 30 feet away and call 911. For outages, use GWP's live map or call.",
    links: [
      ["Live outage map", "https://www.glendaleca.gov/PowerOutages"],
      ["Call GWP 1-855-550-4497", "tel:+18555504497"],
      ["Outage text alerts", "https://www.glendaleca.gov/government/departments/glendale-water-and-power/residential-customers/residential-programs/outage-text-alerts"],
    ],
  },
  care: {
    modes: ["energy"],
    title: "Get a bill discount (Glendale Care)",
    how: "Glendale Care takes $35 a month off electric bills for income-qualified households.",
    links: [["Glendale Care program", "https://www.glendaleca.gov/government/departments/glendale-water-and-power/residential-customers/residential-programs"]],
  },
  myglendale: {
    modes: ["energy", "zoning", "property", "history", "replay"],
    title: "File a MyGlendale service request",
    how: "Streetlight out, water leak, clogged storm drain, tree touching lines, broken sidewalk. Copy the draft, then paste it into MyGlendale. You'll need a free account.",
    draft: (spot) => ({
      subject: "Service request",
      body: `Location: ${spotText(spot)}

Problem: [streetlight out / water leak / clogged storm drain / tree touching power lines / other]

Details: [what you saw, when it started, and whether it's a safety hazard]`,
    }),
    open: ["Open MyGlendale", MYGLENDALE],
  },
  zoning_q: {
    modes: ["zoning", "property"],
    title: "Ask the city's zoning desk about this spot",
    how: "Opens an email to Glendale Planning's zoning desk. They usually reply in 1 to 3 business days.",
    draft: (spot) => ({
      to: ZONING,
      subject: "Zoning question about a location",
      body: `Hello Glendale Planning,

I have a question about this location: ${spotText(spot)}

[Your question: what can be built here? Is there an ADU or housing project planned nearby? Are there upcoming hearings?]

Thank you,
[Your name]`,
    }),
    links: [
      ["Upcoming hearings", "https://www.glendaleca.gov/government/departments/community-development/development-services/current-projects/public-notices"],
      ["Planning projects map", "https://www.glendaleca.gov/government/departments/community-development/development-services/current-projects/planning-division-applications-submitted"],
    ],
  },
  comment: {
    modes: ["energy", "zoning", "property"],
    title: "Speak at a public meeting",
    how: "Council and the GWP Commission take public comment by phone during meetings at (818) 937-8100. Agendas are posted on PrimeGov.",
    links: [["Meeting agendas", "https://glendaleca.primegov.com/public/portal"]],
  },
};

/** "Take action" panel: next steps with drafts pre-filled from the map and the app's data. */
export class ActionsPanel {
  constructor({ el, getMode, getFacts }) {
    Object.assign(this, { el, getMode, getFacts });
    this.spot = null;
    this.open = null;
    el.addEventListener("click", (e) => this.#onClick(e));
  }

  setSpot(lngLat, label) {
    this.spot = { lng: lngLat.lng, lat: lngLat.lat, label };
    this.render();
  }

  render() {
    const mode = this.getMode();
    const items = Object.entries(ACTIONS).filter(([, a]) => a.modes.includes(mode));
    this.el.innerHTML = `
      <p class="fine">${this.spot ? `Using the spot you clicked${this.spot.label ? ` in <b>${escapeHtml(this.spot.label)}</b>` : ""}.` : "Click the map first to fill in a location."}
      Nothing is sent until you press send in your own email or MyGlendale account.</p>
      <ul class="action-list">${items.map(([id, a]) => this.#item(id, a)).join("")}</ul>`;
  }

  #item(id, a) {
    const isOpen = this.open === id;
    const d = a.draft && isOpen ? a.draft(this.spot, this.getFacts?.() || {}) : null;
    return `<li class="action ${isOpen ? "open" : ""}" data-id="${id}">
      <button type="button" class="action-head" data-act="toggle" aria-expanded="${isOpen}">${escapeHtml(a.title)}<span>${isOpen ? "−" : "+"}</span></button>
      ${isOpen ? `<div class="action-body">
        <p class="fine">${escapeHtml(a.how)}</p>
        ${d ? `<textarea rows="8" aria-label="Draft">${escapeHtml(d.body)}</textarea>` : ""}
        <div class="action-btns">
          ${d?.to ? `<a class="btn" data-act="mail" href="#">Open email to ${escapeHtml(d.to)}</a>` : ""}
          ${d ? '<button type="button" class="ghost" data-act="copy">Copy text</button>' : ""}
          ${a.open ? `<a class="btn" href="${a.open[1]}" target="_blank" rel="noopener">${escapeHtml(a.open[0])}</a>` : ""}
          ${(a.links || []).map(([t, u]) => `<a class="ghost btn" href="${u}" ${u.startsWith("tel:") ? "" : 'target="_blank" rel="noopener"'}>${escapeHtml(t)}</a>`).join("")}
        </div>
      </div>` : ""}
    </li>`;
  }

  async #onClick(e) {
    const act = e.target.closest("[data-act]")?.dataset.act;
    const li = e.target.closest("li[data-id]");
    if (!act || !li) return;
    const id = li.dataset.id;
    const text = li.querySelector("textarea")?.value ?? "";
    if (act === "toggle") {
      this.open = this.open === id ? null : id;
      this.render();
    } else if (act === "mail") {
      e.preventDefault();
      const d = ACTIONS[id].draft(this.spot, this.getFacts?.() || {});
      window.location.href = mailto(d.to, d.subject, text);
    } else if (act === "copy") {
      const btn = e.target.closest("button");
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = "Copied ✓";
      } catch {
        li.querySelector("textarea").select();
        btn.textContent = "Press ⌘C to copy";
      }
      setTimeout(() => { btn.textContent = "Copy text"; }, 2000);
    }
  }
}
