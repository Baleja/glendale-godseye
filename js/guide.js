import { escapeHtml } from "./util.js";

const SEEN_KEY = "grid-guide-seen";

/** Steps per tab. `target` is a selector the step's bubble points at. */
const GUIDES = {
  energy: {
    title: "Energy & water",
    steps: [
      { target: "#heat-play", text: "See how much energy cost and consumption has changed over time. Press play to step through each Census survey period." },
      { target: "#heat-metric", text: "Switch what the map colors: electric bill, estimated electricity use, gas, water and sewer, or share of income." },
      { target: "#map", text: "Hover a neighborhood for all its numbers. Click anywhere for the zoning and hazards at that spot." },
      { target: "#bill-check", text: "Check your own bill against GWP's published rates and see what other sources say a typical bill is." },
      { target: "#actions", text: "Ready to act? Report an outage, ask GWP about a bill, or email City Council with the numbers already filled in." },
    ],
  },
  property: {
    title: "Property values",
    steps: [
      { target: "#value-play", text: "Press play to watch typical home values rise ZIP by ZIP since 2000." },
      { target: "#value-metric", text: "Switch between all homes, single-family, condos and rents." },
      { target: "#value-scale", text: "“Same scale” shows the whole city getting pricier. “Rescale each year” compares ZIPs within one year." },
      { target: "#map", text: "Hover a ZIP code for its value, rent and change since 2000." },
    ],
  },
  history: {
    title: "Fire history",
    steps: [
      { target: "#year-presets", text: "Pick a time range, or type your own years." },
      { target: "#animate-btn", text: "Animate to watch fires burn in decade by decade. Darker areas burned more than once." },
      { target: "#history-summary", text: "Click a fire in the list to zoom to it, or jump to a replay of the weather before it." },
    ],
  },
  zoning: {
    title: "Zoning & exposure",
    steps: [
      { target: "#zoning-summary", text: "Click a zone type to highlight where it is. The table shows how much of each type sits in fire, quake and flood zones." },
      { target: "#permit-years", text: "Blue heat is where new homes were approved; orange is where construction started. Pick a year or press play." },
      { target: "#map", text: "Zoom in to street level to see each housing project. Click any spot for its zoning and hazards." },
      { target: "#actions", text: "Have a question about a spot? Email the city's zoning desk with the location already filled in." },
    ],
  },
  replay: {
    title: "Event replay",
    steps: [
      { target: "#event-tabs", text: "Pick a past disaster: La Tuna, Station, Eaton and more." },
      { target: "#play-btn", text: "Press play to replay the days before it hour by hour. Watch the warnings and weather build." },
      { target: "#precursors", text: "The warning signs, in the order they appeared, with how long before the event each one came." },
      { target: "#live-btn", text: "Compare today's conditions in Glendale with the days before past disasters." },
    ],
  },
};

/** "How to use" guides: a step-through tour per tab, plus the Energy tab's intro bubble. */
export class Guide {
  constructor({ button, getMode, onShowMe }) {
    this.getMode = getMode;
    this.onShowMe = onShowMe;
    this.bubble = document.createElement("div");
    this.bubble.className = "guide-bubble";
    this.bubble.setAttribute("role", "dialog");
    this.bubble.hidden = true;
    document.body.append(this.bubble);
    this.step = -1;
    button.addEventListener("click", () => this.start());
    this.bubble.addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act === "next") this.#show(this.step + 1);
      if (act === "back") this.#show(this.step - 1);
      if (act === "close") this.close();
      if (act === "showme") { this.close(); this.onShowMe?.(); }
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !this.bubble.hidden) this.close(); });
    const reposition = () => this.#place();
    window.addEventListener("resize", reposition);
    document.addEventListener("scroll", reposition, true);
  }

  /** Called on every tab change. Shows the Energy intro bubble once per visitor. */
  onMode(mode) {
    this.#hide();
    if (mode === "energy" && !localStorage.getItem(SEEN_KEY)) {
      this.introTimer = setTimeout(() => this.#intro(), 900);
    }
  }

  start() {
    this.guide = GUIDES[this.getMode()] || GUIDES.energy;
    this.#show(0);
  }

  close() {
    this.#hide();
    localStorage.setItem(SEEN_KEY, "1");
  }

  #hide() {
    clearTimeout(this.introTimer);
    this.bubble.hidden = true;
    this.target?.classList.remove("guide-target");
    this.target = null;
    this.step = -1;
  }

  #intro() {
    if (this.getMode() !== "energy" || this.step >= 0) return;
    this.guide = GUIDES.energy;
    this.step = 0;
    this.#point(document.querySelector("#heat-play"), `
      <p><b>See how much energy cost and consumption has changed over time.</b></p>
      <div class="guide-actions">
        <button type="button" data-act="showme">▶ Show me</button>
        <button type="button" class="ghost" data-act="next">Take the tour</button>
        <button type="button" class="ghost" data-act="close">Dismiss</button>
      </div>`);
  }

  #show(i) {
    const steps = this.guide.steps.filter((s) => {
      const el = document.querySelector(s.target);
      return el && el.offsetParent !== null;
    });
    if (i < 0 || i >= steps.length) return this.close();
    this.step = i;
    const s = steps[i];
    const last = i === steps.length - 1;
    this.#point(document.querySelector(s.target), `
      <p class="guide-step">${escapeHtml(this.guide.title)} · ${i + 1} of ${steps.length}</p>
      <p>${escapeHtml(s.text)}</p>
      <div class="guide-actions">
        ${i > 0 ? '<button type="button" class="ghost" data-act="back">Back</button>' : ""}
        <button type="button" data-act="${last ? "close" : "next"}">${last ? "Done" : "Next"}</button>
        ${last ? "" : '<button type="button" class="ghost" data-act="close">Skip</button>'}
      </div>`);
  }

  #point(el, html) {
    this.target?.classList.remove("guide-target");
    this.target = el;
    el?.classList.add("guide-target");
    this.bubble.innerHTML = `<button type="button" class="guide-x" data-act="close" aria-label="Close guide">✕</button>${html}`;
    this.bubble.hidden = false;
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    this.#place();
    setTimeout(() => this.#place(), 350);
    this.bubble.querySelector(".guide-actions button")?.focus({ preventScroll: true });
  }

  #place() {
    if (this.bubble.hidden || !this.target) return;
    const r = this.target.getBoundingClientRect();
    const b = this.bubble.getBoundingClientRect();
    const pad = 10;
    const big = r.height > window.innerHeight * 0.5;
    let top;
    let below;
    if (big) {
      top = r.top + 16;
      below = true;
    } else if (r.top - b.height - 14 > pad) {
      top = r.top - b.height - 14;
      below = false;
    } else {
      top = r.bottom + 14;
      below = true;
    }
    top = Math.max(pad, Math.min(window.innerHeight - b.height - pad, top));
    const center = big ? r.left + r.width / 2 : r.left + Math.min(r.width, 60) / 2;
    const left = Math.max(pad, Math.min(window.innerWidth - b.width - pad, center - 28));
    this.bubble.style.top = `${top}px`;
    this.bubble.style.left = `${left}px`;
    this.bubble.dataset.arrow = big ? "none" : below ? "up" : "down";
    this.bubble.style.setProperty("--arrow-x", `${Math.max(14, Math.min(b.width - 24, center - left - 7))}px`);
  }
}
