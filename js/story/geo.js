// Small, dependency-free geometry helpers shared by the 3D stage, the map and
// the data scripts. Pure functions only.

const R = 6371; // km
export const ORIGIN = { lon: -73.94, lat: 40.7 };
const K = Math.cos((ORIGIN.lat * Math.PI) / 180);
const rad = (d) => (d * Math.PI) / 180;
const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + rad(lat) / 2));

/**
 * Mercator projection (the same math as d3.geoMercator), scaled so one unit is
 * one kilometre near the city. Returns [x east, y north] in km from ORIGIN.
 */
export function project(lon, lat) {
  return [R * rad(lon - ORIGIN.lon) * K, R * (merc(lat) - merc(ORIGIN.lat)) * K];
}

/** Ray-casting point-in-ring test. ring: [[lon, lat], ...] */
export function inRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Polygon / MultiPolygon containment, honoring holes. */
export function inGeometry(lon, lat, geometry) {
  const polys = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates];
  return polys.some((rings) => inRing(lon, lat, rings[0]) && !rings.slice(1).some((h) => inRing(lon, lat, h)));
}

/** Area-weighted centroid of the outer rings of a Polygon or MultiPolygon. */
export function centroid(geometry) {
  const polys = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates];
  let cx = 0;
  let cy = 0;
  let total = 0;
  for (const rings of polys) {
    const ring = rings[0];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
      cx += (ring[j][0] + ring[i][0]) * f;
      cy += (ring[j][1] + ring[i][1]) * f;
      total += f;
    }
  }
  if (!total) return polys[0][0][0];
  return [cx / (3 * total), cy / (3 * total)];
}

/** Distance in km between two lon/lat points (fine for city scale). */
export function kmBetween(lon1, lat1, lon2, lat2) {
  const [x1, y1] = project(lon1, lat1);
  const [x2, y2] = project(lon2, lat2);
  return Math.hypot(x2 - x1, y2 - y1);
}
