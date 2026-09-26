/* global Chart */
import { HOUR, DAY, fmtDayLocal, fmtShortLocal, escapeHtml } from "./util.js";
import { WARNING_COLORS } from "./signals.js";

const AXIS_W = 52;
const GRID = "rgba(125,139,163,0.12)";
const TICK = "#7d8ba3";

Chart.defaults.color = TICK;
Chart.defaults.font.family = 'ui-monospace, "SF Mono", Menlo, monospace';
Chart.defaults.font.size = 10;
Chart.defaults.animation = false;

const fixedWidth = (axis) => { axis.width = AXIS_W; };

/** Draws the event line, shades "before" time, and the playback cursor. */
const cursorPlugin = {
  id: "cursor",
  afterDatasetsDraw(chart, _args, opts) {
    const { ctx, chartArea: a, scales: { x } } = chart;
    const state = opts.state;
    if (!state || !x) return;
    ctx.save();
    const tx = x.getPixelForValue(state.t0);
    if (tx >= a.left && tx <= a.right) {
      ctx.strokeStyle = "rgba(255,77,94,0.9)";
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(tx, a.top); ctx.lineTo(tx, a.bottom); ctx.stroke();
      ctx.setLineDash([]);
    }
    const cx = x.getPixelForValue(state.cursor);
    if (cx >= a.left && cx <= a.right) {
      ctx.fillStyle = "rgba(56,225,255,0.06)";
      ctx.fillRect(a.left, a.top, cx - a.left, a.bottom - a.top);
      ctx.strokeStyle = "#38e1ff";
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(cx, a.top); ctx.lineTo(cx, a.bottom); ctx.stroke();
    }
    ctx.restore();
  },
};

function xScale(ev, showTicks) {
  return {
    type: "linear",
    min: ev.start,
    max: ev.end,
    grid: { color: GRID },
    ticks: {
      display: showTicks,
      stepSize: DAY,
      maxRotation: 0,
      autoSkipPadding: 18,
      callback: (v) => fmtDayLocal(v),
    },
    afterBuildTicks: (axis) => {
      // Align ticks to local midnight-ish boundaries (08:00 UTC ≈ midnight Pacific).
      const first = Math.ceil((ev.start - 8 * HOUR) / DAY) * DAY + 8 * HOUR;
      const ticks = [];
      for (let t = first; t <= ev.end; t += DAY) ticks.push({ value: t });
      axis.ticks = ticks;
    },
  };
}

function yAxis(position, extra = {}) {
  return {
    position,
    grid: { color: position === "left" ? GRID : "transparent" },
    ticks: { maxTicksLimit: 3 },
    afterFit: fixedWidth,
    ...extra,
  };
}

const pts = (t, arr) => t.map((x, i) => ({ x, y: arr?.[i] ?? null }));

export class ChartStack {
  constructor(container, state, onSeek) {
    this.container = container;
    this.state = state;
    this.onSeek = onSeek;
    this.charts = [];
  }

  destroy() {
    this.charts.forEach((c) => c.destroy());
    this.charts = [];
    this.container.innerHTML = "";
  }

  build(ev, site) {
    this.destroy();
    const wx = site === "glendale" ? ev.wxGlendale : ev.wxEvent;
    const where = site === "glendale" || ev.wxEvent === ev.wxGlendale ? "Glendale" : "event site";
    const rows = [];

    rows.push(this.#warningsRow(ev));
    rows.push({
      title: `Heat °F / humidity % · ${where}`,
      datasets: [
        { label: "Temp °F", data: pts(wx.t, wx.temperature_2m), borderColor: "#ff6a3d", yAxisID: "y" },
        { label: "Humidity %", data: pts(wx.t, wx.relative_humidity_2m), borderColor: "#38e1ff", yAxisID: "y1" },
      ],
      scales: { y: yAxis("left"), y1: yAxis("right", { min: 0, max: 100 }) },
    });
    rows.push({
      title: `Wind mph · ${where}`,
      datasets: [
        { label: "Gusts", data: pts(wx.t, wx.wind_gusts_10m), borderColor: "#ff4d5e", yAxisID: "y", fill: { target: "origin", above: "rgba(255,77,94,0.10)" } },
        { label: "Sustained", data: pts(wx.t, wx.wind_speed_10m), borderColor: "#ffc857", yAxisID: "y" },
      ],
      scales: { y: yAxis("left", { min: 0 }), y1: yAxis("right", { display: true, ticks: { display: false }, grid: { display: false } }) },
    });

    const gauge = ev.gauges[0];
    const water = [
      { type: "bar", label: "Rain in/h (Glendale)", data: pts(ev.wxGlendale.t, ev.wxGlendale.precipitation), backgroundColor: "#4da3ff", yAxisID: "y", barThickness: 2 },
    ];
    if (gauge) water.push({ label: `${gauge.name} cfs`, data: pts(gauge.t, gauge.cfs), borderColor: "#9fd3ff", borderDash: [3, 2], yAxisID: "y1" });
    rows.push({
      title: gauge ? `Rain in/h · ${gauge.name} flow cfs` : "Rain in/h · Glendale",
      datasets: water,
      scales: { y: yAxis("left", { min: 0 }), y1: yAxis("right", { min: 0, display: true, ticks: { display: !!gauge, maxTicksLimit: 3 } }) },
    });

    const airSets = [
      { label: "VPD kPa", data: pts(wx.t, wx.vapour_pressure_deficit), borderColor: "#ffb020", yAxisID: "y" },
    ];
    if (ev.air) airSets.push({ label: "AQI", data: pts(ev.air.t, ev.air.us_aqi), borderColor: "#b388ff", yAxisID: "y1" });
    rows.push({
      title: ev.air ? `Dryness VPD kPa · ${where} / AQI · Glendale` : `Dryness VPD kPa · ${where} (no air-quality archive for this date)`,
      datasets: airSets,
      scales: { y: yAxis("left", { min: 0 }), y1: yAxis("right", { min: 0, display: true, ticks: { display: !!ev.air, maxTicksLimit: 3 } }) },
    });

    rows.push({
      title: `Earthquakes (magnitude) within ${ev.quake_radius_km || 120} km`,
      tall: true,
      datasets: [{
        type: "scatter",
        label: "Quakes",
        data: ev.quakes.map((q) => ({ x: q.ms, y: q.mag, place: q.place })),
        backgroundColor: "rgba(199,125,255,0.65)",
        pointRadius: (c) => Math.max(1.5, ((c.raw?.y || 0) - 1.5) * 1.6),
        yAxisID: "y",
      }],
      scales: { y: yAxis("left", { min: 1, suggestedMax: 5 }), y1: yAxis("right", { display: true, ticks: { display: false }, grid: { display: false } }) },
    });

    rows.forEach((r, i) => this.#mount(ev, r, i === rows.length - 1));
  }

  #warningsRow(ev) {
    const groups = [...new Set(ev.warnings.map((w) => w.group))];
    return {
      title: ev.warnings.length ? "NWS watches · warnings · advisories (Los Angeles)" : "No NWS products archived for LA in this window",
      lane: true,
      type: "bar",
      labels: groups.length ? groups : [""],
      datasets: [{
        label: "NWS",
        data: ev.warnings.map((w) => ({ x: [w.issuedMs, w.expiresMs], y: w.group, w })),
        backgroundColor: (c) => {
          const w = c.raw?.w;
          if (!w) return "#555";
          const col = WARNING_COLORS[w.code] || "#aaa";
          return w.sig === "W" ? col : w.sig === "A" ? `${col}99` : `${col}55`;
        },
        borderSkipped: false,
        borderRadius: 2,
        barThickness: 6,
        grouped: false,
      }],
      indexAxis: "y",
      scales: {
        y: { position: "left", ticks: { display: false }, grid: { display: false }, afterFit: fixedWidth },
        y1: { position: "right", display: true, ticks: { display: false }, grid: { display: false }, afterFit: fixedWidth },
      },
      tooltip: (item) => {
        const w = item.raw.w;
        return `${w.name}: ${fmtShortLocal(w.issuedMs)} → ${fmtShortLocal(w.expiresMs)}`;
      },
    };
  }

  #mount(ev, row, showTicks) {
    const wrap = document.createElement("div");
    wrap.className = `chart-row${row.tall ? " tall" : ""}${row.lane ? " lane" : ""}`;
    wrap.innerHTML = `<span class="chart-title">${escapeHtml(row.title)}</span><canvas></canvas>`;
    this.container.appendChild(wrap);
    const canvas = wrap.querySelector("canvas");

    const chart = new Chart(canvas, {
      type: row.type || "line",
      data: { labels: row.labels, datasets: row.datasets.map((d) => ({ pointRadius: 0, borderWidth: 1.4, tension: 0.2, spanGaps: true, ...d })) },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        parsing: row.lane ? undefined : false,
        normalized: true,
        indexAxis: row.indexAxis || "x",
        layout: { padding: { top: 12, right: 0, left: 0, bottom: 0 } },
        interaction: { mode: row.lane ? "nearest" : "index", intersect: !!row.lane, axis: "x" },
        plugins: {
          legend: { display: false },
          cursor: { state: this.state },
          tooltip: {
            callbacks: {
              title: (items) => (items[0] && !row.lane ? fmtShortLocal(items[0].parsed.x) : ""),
              label: row.tooltip || ((item) => {
                const place = item.raw?.place ? ` ${item.raw.place}` : "";
                const y = item.parsed.y;
                return `${item.dataset.label}: ${y == null ? "—" : Number(y).toFixed(y < 10 ? 2 : 0)}${place}`;
              }),
            },
          },
        },
        scales: { x: xScale(ev, showTicks), ...row.scales },
        onClick: (e, _els, c) => {
          const v = c.scales.x.getValueForPixel(e.x);
          if (v != null) this.onSeek(v);
        },
      },
      plugins: [cursorPlugin],
    });
    this.charts.push(chart);
  }

  redraw() {
    this.charts.forEach((c) => c.draw());
  }
}
