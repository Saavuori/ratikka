// Geodesy primitives.
//
// Everything in the app that converts between WGS84 degrees and metres does it
// through this module. Before it existed the same four formulas were written
// out five times across `trafficLights`, `deadReckon`, `stopModels` and
// `vehicleModels`, against three different Earth radii — which over Helsinki
// disagreed by about a millimetre in ten metres, i.e. never visibly, which is
// exactly why nobody would ever have caught it.
//
// The one deliberate exception is `railTracks`, which anchors a flat local
// projection at the first point of a track and works in that plane for the
// whole polyline. That is a different thing from the point-to-point conversions
// here: it needs one fixed origin so arc lengths along a track stay consistent,
// where these each re-linearise around the points they are given.

/**
 * WGS84 semi-major axis, in metres.
 *
 * The functions below are all local linearisations or a spherical great circle,
 * so the "right" radius is really the Earth's radius of curvature at Helsinki:
 * about 6383 km along a meridian and 6394 km along a parallel at 60°N. Neither
 * this nor the 6371 km mean radius matches those exactly — this one is within
 * ~0.25%, the mean radius within ~0.35% — so the semi-major axis is the closer
 * of the two conventional choices at this latitude, and a single number that is
 * consistently a quarter-percent out beats three numbers that are each out by a
 * different amount. Over the tens of metres these are used for, that is a
 * couple of centimetres.
 */
export const EARTH_RADIUS_METERS = 6378137;

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/**
 * Great-circle distance between two WGS84 points, in metres.
 *
 * Takes its arguments as (lat, lon) pairs rather than the [lng, lat] tuples the
 * rest of this module uses, because its callers are working with vehicle and
 * junction records — which carry named `lat`/`lng` fields — rather than with
 * GeoJSON coordinates.
 */
export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Metres between two [lng, lat] points, linearised about their midpoint.
 *
 * The flat-earth counterpart to `haversineMeters`, for the geometry code that
 * is already working in GeoJSON coordinate order. Over the few hundred metres
 * a vehicle body or a stop platform spans, the two agree to well under a
 * millimetre.
 */
export function metersBetween(a: [number, number], b: [number, number]): number {
  const [east, north] = localOffset(a, b);
  return Math.hypot(east, north);
}

/** Bearing from a to b, in degrees clockwise from north. */
export function bearingBetween(a: [number, number], b: [number, number]): number {
  const lat = ((a[1] + b[1]) / 2) * RAD;
  const east = (b[0] - a[0]) * Math.cos(lat);
  const north = b[1] - a[1];
  return ((Math.atan2(east, north) * DEG) + 360) % 360;
}

/**
 * Offset a point by metres along and across a heading. `along` is towards the
 * nose, `across` is towards the vehicle's right-hand side; `hdg` is the HFP
 * heading in degrees clockwise from north.
 */
export function offsetMeters(
  lng: number,
  lat: number,
  hdg: number,
  along: number,
  across: number,
): [number, number] {
  const h = hdg * RAD;
  const east = along * Math.sin(h) + across * Math.cos(h);
  const north = along * Math.cos(h) - across * Math.sin(h);
  const dLat = (north / EARTH_RADIUS_METERS) * DEG;
  const dLng = (east / (EARTH_RADIUS_METERS * Math.cos(lat * RAD))) * DEG;
  return [lng + dLng, lat + dLat];
}

/**
 * Move a point `metres` along a compass heading, in degrees clockwise from
 * north.
 *
 * This is the surface modes' answer to `pointOnTrack`. A metro is carried along
 * its own rails because it has rails and we have their geometry; a bus has
 * neither, so its predicted position runs along the heading it last reported.
 * Over the second or two this is used for that is an excellent approximation —
 * the arc a road vehicle cuts in a second is a few centimetres off its own
 * tangent even on a tight turn — and it degrades in the right direction, since
 * a vehicle turning hard is usually a vehicle going slowly.
 *
 * Same maths as `offsetMeters` with `across` zero, but it keeps the caller's
 * named-field shape: dead reckoning is threading `{ lat, lng }` records, not
 * building GeoJSON rings, and a silent tuple reorder there would be a bug
 * nobody could see.
 */
export function advanceAlongHeading(
  lat: number,
  lng: number,
  hdg: number,
  metres: number
): { lat: number; lng: number } {
  if (!(metres > 0) || !Number.isFinite(hdg)) return { lat, lng };
  const rad = hdg * RAD;
  const dLat = ((metres * Math.cos(rad)) / EARTH_RADIUS_METERS) * DEG;
  const cosLat = Math.cos(lat * RAD);
  // At the poles a metre east is an unbounded number of degrees. Helsinki is
  // nowhere near one, but the guard keeps a garbage coordinate from producing
  // an infinite longitude rather than a wrong one.
  const dLng =
    Math.abs(cosLat) < 1e-6
      ? 0
      : ((metres * Math.sin(rad)) / (EARTH_RADIUS_METERS * cosLat)) * DEG;
  return { lat: lat + dLat, lng: lng + dLng };
}

/** Metres from point `p` to the segment `a`–`b`, all as [lng, lat]. */
export function distanceToSegment(
  p: [number, number],
  a: [number, number],
  b: [number, number],
): number {
  const [px, py] = localOffset(a, p);
  const [bx, by] = localOffset(a, b);
  const lengthSq = bx * bx + by * by;
  if (lengthSq === 0) return Math.hypot(px, py);
  const t = Math.max(0, Math.min(1, (px * bx + py * by) / lengthSq));
  return Math.hypot(px - bx * t, py - by * t);
}

/** East/north metres from `a` to `b`, linearised about the latitude between them. */
function localOffset(a: [number, number], b: [number, number]): [number, number] {
  const lat = ((a[1] + b[1]) / 2) * RAD;
  return [
    (b[0] - a[0]) * RAD * Math.cos(lat) * EARTH_RADIUS_METERS,
    (b[1] - a[1]) * RAD * EARTH_RADIUS_METERS,
  ];
}
