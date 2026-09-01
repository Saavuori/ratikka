// Snapping metro vehicles onto the metro tracks.
//
// The metro's HFP positions are the worst-behaved of every mode we draw. Most
// of both lines runs in tunnel, where there is no GPS fix at all and the
// reported point is dead-reckoned from odometry — so a train drifts off its
// tunnel, wanders across Töölönlahti or sits a block north of the platform it
// is actually standing at. Trams and buses follow streets the basemap draws,
// so a 30 m error reads as a vehicle slightly off the kerb; a metro train
// 200 m off its tunnel reads as a train in a park.
//
// The metro is also the one mode where this is fixable: there are exactly two
// lines, both of them entirely grade-separated, so every train that exists is
// somewhere on one of a handful of known polylines. Projecting the reported
// point onto the line's own geometry therefore cannot make the position worse
// in the way it could for a bus, which may legitimately be on a diversion.
//
// What this module provides:
//   - `buildTracks` turns a route's encoded polylines into indexed tracks with
//     a local metric projection and cumulative arc length,
//   - `snapToTracks` projects a reported position onto the nearest track and
//     returns where along it the train is,
//   - `pointOnTrack` reads a position back out at a given arc length, which is
//     what lets the animation slide a train *along* the tunnel between two
//     snapshots instead of cutting the corner in a straight line.

import { decodePolyline } from './polyline';

// Metres per degree of latitude, and of longitude at the equator. Helsinki is
// small enough that a flat local projection anchored at the track's first
// point is accurate to well under a metre over the length of a metro line.
const M_PER_DEG_LAT = 110574;
const M_PER_DEG_LNG = 111320;

export interface MetroTrack {
  // [lng, lat] pairs, as decoded from the route polyline.
  coords: [number, number][];
  // The same points in local metres, for distance maths.
  proj: [number, number][];
  // cum[i] is the arc length in metres from the start of the track to point i.
  cum: number[];
  // Total length of the track in metres.
  length: number;
}

// Where on a track a reported position landed.
export interface TrackFix {
  // Index into the track array the fix belongs to.
  trackIndex: number;
  // Arc length in metres from the start of that track.
  distance: number;
  lng: number;
  lat: number;
  // How far the reported point was from the track, in metres. The caller can
  // use this to judge how much the feed was trusted.
  offset: number;
  // Bearing of the track at the fix, in the track's own direction of travel
  // (degrees clockwise from north).
  bearing: number;
}

export interface SnapOptions {
  // Reject fixes further than this from every track: a position that far off is
  // more likely a stale or bogus message than a train, and snapping it would
  // invent a confident-looking position out of nothing. Metres.
  maxOffset?: number;
}

const DEFAULT_MAX_OFFSET = 400;

function project(lng: number, lat: number, lat0: number): [number, number] {
  const scale = Math.cos((lat0 * Math.PI) / 180);
  return [lng * M_PER_DEG_LNG * scale, lat * M_PER_DEG_LAT];
}

function unproject(x: number, y: number, lat0: number): [number, number] {
  const scale = Math.cos((lat0 * Math.PI) / 180);
  return [x / (M_PER_DEG_LNG * scale), y / M_PER_DEG_LAT];
}

/**
 * Index a single polyline. Returns null for degenerate input (fewer than two
 * distinct points), which cannot be projected onto.
 */
export function buildTrack(coords: [number, number][]): MetroTrack | null {
  if (!coords || coords.length < 2) return null;

  const lat0 = coords[0][1];
  const proj = coords.map(([lng, lat]) => project(lng, lat, lat0));

  const cum: number[] = [0];
  for (let i = 1; i < proj.length; i++) {
    const dx = proj[i][0] - proj[i - 1][0];
    const dy = proj[i][1] - proj[i - 1][1];
    cum.push(cum[i - 1] + Math.hypot(dx, dy));
  }

  const length = cum[cum.length - 1];
  if (length <= 0) return null;

  return { coords, proj, cum, length };
}

/**
 * Decode and index every pattern polyline of a route. Patterns that fail to
 * decode are skipped rather than poisoning the whole route.
 */
export function buildTracks(geometries: string[] | undefined): MetroTrack[] {
  if (!geometries) return [];
  const tracks: MetroTrack[] = [];
  for (const encoded of geometries) {
    if (!encoded) continue;
    let coords: [number, number][];
    try {
      coords = decodePolyline(encoded);
    } catch {
      continue;
    }
    const track = buildTrack(coords);
    if (track) tracks.push(track);
  }
  return tracks;
}

function bearingBetween(from: [number, number], to: [number, number]): number {
  // Both points are already in local metres, so the bearing is a plain atan2 of
  // the easting/northing delta.
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  if (dx === 0 && dy === 0) return 0;
  const deg = (Math.atan2(dx, dy) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/**
 * Project a reported position onto the nearest point of the nearest track.
 * Returns null when no track is within `maxOffset`.
 */
export function snapToTracks(
  tracks: MetroTrack[],
  lng: number,
  lat: number,
  options: SnapOptions = {}
): TrackFix | null {
  const maxOffset = options.maxOffset ?? DEFAULT_MAX_OFFSET;
  if (!tracks.length) return null;

  let best: TrackFix | null = null;

  for (let t = 0; t < tracks.length; t++) {
    const track = tracks[t];
    const lat0 = track.coords[0][1];
    const [px, py] = project(lng, lat, lat0);

    for (let i = 1; i < track.proj.length; i++) {
      const [ax, ay] = track.proj[i - 1];
      const [bx, by] = track.proj[i];
      const dx = bx - ax;
      const dy = by - ay;
      const segLen2 = dx * dx + dy * dy;
      if (segLen2 === 0) continue;

      // Parameter of the closest point on the segment, clamped to its ends.
      let u = ((px - ax) * dx + (py - ay) * dy) / segLen2;
      if (u < 0) u = 0;
      if (u > 1) u = 1;

      const cx = ax + u * dx;
      const cy = ay + u * dy;
      const offset = Math.hypot(px - cx, py - cy);
      if (best && offset >= best.offset) continue;

      const segLen = Math.sqrt(segLen2);
      const [dLng, dLat] = unproject(cx, cy, lat0);
      best = {
        trackIndex: t,
        distance: track.cum[i - 1] + u * segLen,
        lng: dLng,
        lat: dLat,
        offset,
        bearing: bearingBetween([ax, ay], [bx, by]),
      };
    }
  }

  if (!best || best.offset > maxOffset) return null;
  return best;
}

/**
 * Read a position back out of a track at a given arc length. Distances outside
 * the track clamp to its ends, so an over-shooting extrapolation parks the
 * train at the terminus instead of flying off into nothing.
 */
export function pointOnTrack(
  track: MetroTrack,
  distance: number
): { lng: number; lat: number; bearing: number } {
  const lat0 = track.coords[0][1];
  const d = Math.min(Math.max(distance, 0), track.length);

  // Binary search for the segment containing `d`.
  let lo = 0;
  let hi = track.cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (track.cum[mid] <= d) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  const segLen = track.cum[hi] - track.cum[lo];
  const u = segLen > 0 ? (d - track.cum[lo]) / segLen : 0;
  const [ax, ay] = track.proj[lo];
  const [bx, by] = track.proj[hi];
  const [lng, lat] = unproject(ax + u * (bx - ax), ay + u * (by - ay), lat0);

  return {
    lng,
    lat,
    bearing: bearingBetween([ax, ay], [bx, by]),
  };
}

/**
 * Distance in metres between two lng/lat points, using the same flat local
 * projection as the tracks. Used to decide whether a correction is small enough
 * to glide into or big enough to warrant a jump.
 */
export function distanceBetween(
  a: { lng: number; lat: number },
  b: { lng: number; lat: number }
): number {
  const [ax, ay] = project(a.lng, a.lat, a.lat);
  const [bx, by] = project(b.lng, b.lat, a.lat);
  return Math.hypot(bx - ax, by - ay);
}

// Where a train currently is on the network, as the animation carries it from
// one snapshot to the next.
export interface TrackPlacement {
  // Line the track belongs to (`desi`, e.g. "M1"), and which of that line's
  // pattern polylines the train was matched to.
  line: string;
  index: number;
  // Arc length along that polyline, in metres.
  distance: number;
  // Whether the train is running in the polyline's own direction. The two
  // directions of a metro line are all but coincident on the map, so which
  // pattern a train snaps to says nothing about which way it is facing — this
  // does, and it is what the icon is rotated by.
  forward: boolean;
}

export interface Placement {
  lat: number;
  lng: number;
  // Heading along the track, in the direction the train is actually running.
  hdg: number;
  track: TrackPlacement;
}

// How much closer another pattern polyline has to be before a train is moved
// onto it. A line's patterns overlap almost exactly, so without this hysteresis
// a train flickers between them from one snapshot to the next, losing its
// along-track continuity every time it does. Metres.
const TRACK_SWITCH_MARGIN = 25;

// Below this, movement since the last snapshot is too small to tell which way
// the train is pointing — a train at a platform still jitters by a few metres.
// Metres.
const DIRECTION_MIN_ADVANCE = 2;

/**
 * Pull a reported metro position onto a line's tracks and work out which way
 * along them the train is facing.
 *
 * `previous` is where the same train was placed on the last snapshot, which is
 * what makes the result continuous: it keeps the train on the pattern it was
 * already running along, and it is the strongest evidence of which direction
 * the train faces. Returns null when the position is too far off the network
 * to be trusted — the caller should then draw the raw position.
 */
export function placeOnTracks(
  line: string,
  tracks: MetroTrack[],
  position: { lat: number; lng: number; hdg: number },
  previous: TrackPlacement | undefined,
  options: SnapOptions = {}
): Placement | null {
  let fix = snapToTracks(tracks, position.lng, position.lat, options);
  if (!fix) return null;

  const wasHere = previous?.line === line;

  // Stay on the pattern the train was already running along unless another one
  // is clearly closer.
  if (wasHere && previous!.index !== fix.trackIndex) {
    const prevTrack = tracks[previous!.index];
    if (prevTrack) {
      const onPrev = snapToTracks([prevTrack], position.lng, position.lat, options);
      if (onPrev && onPrev.offset <= fix.offset + TRACK_SWITCH_MARGIN) {
        fix = { ...onPrev, trackIndex: previous!.index };
      }
    }
  }

  const sameTrack = wasHere && previous!.index === fix.trackIndex;
  const advance = sameTrack ? fix.distance - previous!.distance : 0;

  // Which way the train faces: how it moved along the track since the last
  // snapshot, if it moved at all; otherwise whatever we decided last time;
  // otherwise the reported heading against the track's own bearing.
  let forward: boolean;
  if (sameTrack && Math.abs(advance) > DIRECTION_MIN_ADVANCE) {
    forward = advance > 0;
  } else if (sameTrack) {
    forward = previous!.forward;
  } else {
    const delta = Math.abs((((position.hdg - fix.bearing) % 360) + 540) % 360 - 180);
    forward = delta <= 90;
  }

  return {
    lat: fix.lat,
    lng: fix.lng,
    hdg: forward ? fix.bearing : (fix.bearing + 180) % 360,
    track: { line, index: fix.trackIndex, distance: fix.distance, forward },
  };
}
