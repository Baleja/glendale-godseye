const BUCKET = 0.005;

function polygons(geom) {
  if (!geom) return [];
  if (geom.type === "Polygon") return [geom.coordinates];
  if (geom.type === "MultiPolygon") return geom.coordinates;
  return [];
}

function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const inPolygon = (x, y, poly) => inRing(x, y, poly[0]) && !poly.slice(1).some((h) => inRing(x, y, h));

/** Bucketed point-in-polygon index over a GeoJSON FeatureCollection of polygons. */
export class PolygonIndex {
  constructor(fc) {
    this.buckets = new Map();
    for (const f of fc.features) {
      for (const poly of polygons(f.geometry)) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const [x, y] of poly[0]) {
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
        const entry = { bbox: [x0, y0, x1, y1], poly, props: f.properties };
        for (let bx = Math.floor(x0 / BUCKET); bx <= Math.floor(x1 / BUCKET); bx++) {
          for (let by = Math.floor(y0 / BUCKET); by <= Math.floor(y1 / BUCKET); by++) {
            const k = `${bx},${by}`;
            if (!this.buckets.has(k)) this.buckets.set(k, []);
            this.buckets.get(k).push(entry);
          }
        }
      }
    }
  }

  /** Properties of every feature containing the point (one entry per matching part). */
  hits(lon, lat) {
    const list = this.buckets.get(`${Math.floor(lon / BUCKET)},${Math.floor(lat / BUCKET)}`) || [];
    return list
      .filter(({ bbox: b, poly }) => lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3] && inPolygon(lon, lat, poly))
      .map((e) => e.props);
  }
}

export function bboxOf(geom) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const walk = (c) => {
    if (typeof c[0] === "number") {
      if (c[0] < x0) x0 = c[0]; if (c[0] > x1) x1 = c[0];
      if (c[1] < y0) y0 = c[1]; if (c[1] > y1) y1 = c[1];
    } else c.forEach(walk);
  };
  walk(geom.coordinates);
  return [[x0, y0], [x1, y1]];
}
