// Snapping rail vehicles onto the rails they run on.
//
// Two different problems are solved by the same geometry.
//
// The metro's HFP positions are the worst-behaved of every mode we draw. Most
// of both lines runs in tunnel, where there is no GPS fix at all and the
// reported point is dead-reckoned from odometry — so a train drifts off its
// tunnel, wanders across Töölönlahti or sits a block north of the platform it
// is actually standing at. A metro train 200 m off its tunnel reads as a train
// in a park.
//
// A tram's positions are far better — street-level GPS, good to some tens of
// metres — and that is exactly the problem, because a tram's error is the size
// of a street. Helsinki's tram tracks run as a pair, one direction down each
// side of the carriageway, typically 5–8 m apart; the map draws both of them,
// because each direction is its own pattern polyline. A vehicle drawn at its
// reported point therefore sits between the two tracks, on the wrong one, or
// on the pavement — and which of the pair it belongs on is not something the
// coordinate can answer, since the error is bigger than the gap.
//
// The feed answers it instead: HFP reports the journey's `dir`, which is the
// GTFS direction the vehicle is running in, and Digitransit tells us which
// direction each pattern polyline belongs to. Snapping within that direction's
// polylines alone puts a tram on the rails it is actually on, facing the way
// it is actually going.
//
// Both modes are safe to snap for the same reason: they are grade-separated or
// railbound, so every vehicle that exists is somewhere on one of a handful of
// known polylines. A bus, which may legitimately be on a diversion, is not
// snapped at all.
//
// What this module provides:
//   - `buildTracks` / `buildPatternTracks` turn a route's encoded polylines
//     into indexed tracks with a local metric projection and cumulative arc
//     length, the latter carrying each polyline's direction,
//   - `snapToTracks` projects a reported position onto the nearest track it
//     could plausibly be running along,
//   - `placeOnTracks` adds the continuity that makes a *sequence* of reports
//     read as one vehicle running along one track — which is also what picks
//     the right arm of a junction, where several stretches of the same route
//     pass through the same few metres of street,
//   - `pointOnTrack` reads a position back out at a given arc length, which is
//     what lets the animation slide a vehicle *along* the rails between two
//     snapshots instead of cutting the corner in a straight line,
//   - `orientOnTracks` faces a vehicle along the rails without moving it, for
//     places that can say which way a vehicle points but not which track it is
//     on — Helsinki Central's throat, where the platform tracks are parallel and
//     a route polyline knows nothing about platform assignment,
//   - `trackSpine`, which reads a whole vehicle's length off the rails at once
//     so an articulated body can bend through a curve instead of ploughing
//     across it.

import { decodePolyline } from './polyline';

// Metres per degree of latitude, and of longitude at the equator. Helsinki is
// small enough that a flat local projection anchored at the track's first
// point is accurate to well under a metre over the length of a metro line.
const M_PER_DEG_LAT = 110574;
const M_PER_DEG_LNG = 111320;

export interface RailTrack {
  // [lng, lat] pairs, as decoded from the route polyline.
  coords: [number, number][];
  // GTFS direction_id of the pattern this polyline came from, or null when the
  // caller had no direction to give (a route ribbon fetched for drawing, say).
  // A vehicle is snapped within its own direction's tracks where this is known,
  // which is what keeps a tram on its own side of the street.
  direction: number | null;
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
  // How far the snap may reach. Track further than this from the report is not
  // considered at all, and a report with no track within it is not snapped: a
  // position that far off is more likely a stale or bogus message than a
  // vehicle, and snapping it would invent a confident-looking position out of
  // nothing. Metres.
  maxOffset?: number;
  // The vehicle's own GTFS direction, from the feed. When given, only tracks
  // belonging to that direction are considered — the whole point of the
  // exercise for a tram, whose two directions run a few metres apart on their
  // own rails. Tracks with no direction of their own are always eligible, and
  // if the direction matches nothing (a route whose patterns did not carry one)
  // every track is considered rather than none.
  direction?: number | null;
  // Reported heading, in degrees clockwise from north. Where a track segment
  // runs against it, the fix is charged `headingPenalty` metres before being
  // compared with the others — so a marginally closer stretch of rail heading
  // the other way loses to the one the vehicle is actually running along. This
  // is what separates the two tracks of a pair when the direction is unknown,
  // and the two passes of a loop route that share a street.
  heading?: number;
  headingPenalty?: number;
  // Where the vehicle is expected to be found, from where it was last placed
  // and how far it has travelled since. A fix outside that window — on another
  // track, or a long way along this one — is charged `continuityPenalty`
  // metres before being compared with the rest.
  //
  // This is what a junction needs. Helsinki's tram network crosses and merges
  // constantly, and at a junction one line's own polyline may double back
  // within metres of itself, or run through the intersection on an arm the
  // vehicle is not taking: at Mannerheimintie/Aleksanterinkatu the arms are
  // close enough that the nearest point of the correct polyline can be on the
  // wrong arm entirely. Position cannot separate those — they occupy the same
  // few metres of street — and neither can heading, since a tram turning
  // through a junction points along both arms in turn. What separates them is
  // that only one of them is continuous with where the tram already was: a
  // tram 200 m along the route a second ago is not 900 m along it now.
  expected?: { trackIndex: number; distance: number; window: number };
  continuityPenalty?: number;
}

const DEFAULT_MAX_OFFSET = 400;
const DEFAULT_HEADING_PENALTY = 20;
// Deliberately large: a discontinuous fix is not a slightly worse reading of
// the same vehicle, it is a different place on the network. It is a penalty
// rather than a veto so that a vehicle whose continuity has genuinely been lost
// — it was off the network, or the feed skipped a stretch — is still placed
// somewhere, on the next report that agrees with itself.
const DEFAULT_CONTINUITY_PENALTY = 60;

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
export function buildTrack(
  coords: [number, number][],
  direction: number | null = null
): RailTrack | null {
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

  return { coords, proj, cum, length, direction };
}

/** One directional variant of a route, as the backend reports it. */
export interface RoutePattern {
  points: string;
  directionId?: number | null;
}

/**
 * Decode and index every pattern polyline of a route, keeping the direction
 * each one belongs to. Patterns that fail to decode are skipped rather than
 * poisoning the whole route.
 */
export function buildPatternTracks(patterns: RoutePattern[] | undefined): RailTrack[] {
  if (!patterns) return [];
  const tracks: RailTrack[] = [];
  for (const pattern of patterns) {
    if (!pattern?.points) continue;
    let coords: [number, number][];
    try {
      coords = decodePolyline(pattern.points);
    } catch {
      continue;
    }
    const track = buildTrack(coords, pattern.directionId ?? null);
    if (track) tracks.push(track);
  }
  return tracks;
}

/** The same, for bare polylines whose direction is not known. */
export function buildTracks(geometries: string[] | undefined): RailTrack[] {
  return buildPatternTracks(geometries?.map((points) => ({ points })));
}

function bearingOfProjectedSegment(from: [number, number], to: [number, number]): number {
  // Both points are already in local metres, so the bearing is a plain atan2 of
  // the easting/northing delta.
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  if (dx === 0 && dy === 0) return 0;
  const deg = (Math.atan2(dx, dy) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** Smallest absolute angle between two bearings, in degrees (0..180). */
function angleBetween(a: number, b: number): number {
  return Math.abs((((a - b) % 360) + 540) % 360 - 180);
}

/**
 * Project a reported position onto the nearest point of the nearest track it
 * could plausibly be running along.
 * Returns null when no track is within `maxOffset`.
 */
export function snapToTracks(
  tracks: RailTrack[],
  lng: number,
  lat: number,
  options: SnapOptions = {}
): TrackFix | null {
  const maxOffset = options.maxOffset ?? DEFAULT_MAX_OFFSET;
  if (!tracks.length) return null;

  // Which tracks the vehicle could be on at all. A direction that matches no
  // track leaves every track eligible: it means the route's patterns carried no
  // direction, not that the vehicle is nowhere.
  const wanted = options.direction;
  const eligible =
    wanted === undefined || wanted === null
      ? tracks
      : tracks.filter((t) => t.direction === null || t.direction === wanted);
  const candidates = eligible.length ? eligible : tracks;

  const heading = options.heading;
  const penalty = options.headingPenalty ?? DEFAULT_HEADING_PENALTY;
  const expected = options.expected;
  const strayPenalty = expected ? options.continuityPenalty ?? DEFAULT_CONTINUITY_PENALTY : 0;
  const maxPenalty = penalty + strayPenalty;

  let best: TrackFix | null = null;
  // The score `best` won on: its offset plus whatever the heading and
  // continuity tests charged it. Kept apart from the offset itself, which is
  // reported to the caller as the honest distance between report and rail.
  let bestScore = Infinity;

  for (let t = 0; t < candidates.length; t++) {
    const track = candidates[t];
    // Index into the caller's array, which is what a placement is stored by.
    const trackIndex = tracks.indexOf(track);
    const lat0 = track.coords[0][1];
    const [px, py] = project(lng, lat, lat0);

    for (let i = 1; i < track.proj.length; i++) {
      const [ax, ay] = track.proj[i - 1];
      const [bx, by] = track.proj[i];
      const dx = bx - ax;
      const dy = by - ay;
      const segLen2 = dx * dx + dy * dy;
      if (segLen2 === 0) continue;

      // Segments out of reach are skipped without the projection maths: nothing
      // on one is closer to the report than its near end is, less its own
      // length. Every vehicle in the feed is snapped against every polyline of
      // its line once a second, and nearly all of each polyline is kilometres
      // from the vehicle — this drops those for the cost of one hypot.
      const reach = Math.hypot(px - ax, py - ay) - (track.cum[i] - track.cum[i - 1]);
      if (reach > maxOffset) continue;

      // Parameter of the closest point on the segment, clamped to its ends.
      let u = ((px - ax) * dx + (py - ay) * dy) / segLen2;
      if (u < 0) u = 0;
      if (u > 1) u = 1;

      const cx = ax + u * dx;
      const cy = ay + u * dy;
      const offset = Math.hypot(px - cx, py - cy);
      if (offset - maxPenalty >= bestScore) continue;

      const bearing = bearingOfProjectedSegment([ax, ay], [bx, by]);
      const against =
        heading !== undefined && angleBetween(heading, bearing) > 90;
      let score = against ? offset + penalty : offset;

      const segLen = Math.sqrt(segLen2);
      const distance = track.cum[i - 1] + u * segLen;
      if (
        expected &&
        (trackIndex !== expected.trackIndex ||
          Math.abs(distance - expected.distance) > expected.window)
      ) {
        score += strayPenalty;
      }
      if (score >= bestScore) continue;
      const [dLng, dLat] = unproject(cx, cy, lat0);
      bestScore = score;
      best = {
        trackIndex,
        distance,
        lng: dLng,
        lat: dLat,
        offset,
        bearing,
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
  track: RailTrack,
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
    bearing: bearingOfProjectedSegment([ax, ay], [bx, by]),
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

// Where a vehicle currently is on the network, as the animation carries it
// from one snapshot to the next.
export interface TrackPlacement {
  // Line the track belongs to (`desi`, e.g. "M1" or "9"), and which of that
  // line's pattern polylines the vehicle was matched to.
  line: string;
  index: number;
  // Arc length along that polyline, in metres.
  distance: number;
  // Whether the vehicle is running in the polyline's own direction. The two
  // directions of a metro line are all but coincident on the map, so which
  // pattern a train snaps to says nothing about which way it is facing — this
  // does, and it is what the icon is rotated by. A tram snapped within its own
  // direction is running forwards along it by construction, but the same field
  // still carries it, so one animation path serves both.
  forward: boolean;
}

export interface Placement {
  lat: number;
  lng: number;
  // Heading along the track, in the direction the vehicle is actually running.
  hdg: number;
  // How far the reported point was from the rail it was pulled onto, in metres.
  offset: number;
  // Where on the network the vehicle was placed, which is what the next
  // snapshot continues from and what the animation slides along. Absent when
  // the vehicle was only *oriented* by the rails and left where the feed put it
  // — see `orientOnTracks` — because there is then no track it is known to be
  // running along.
  track?: TrackPlacement;
}

// A placement that put the vehicle *on* a track, which is what `placeOnTracks`
// returns and what the animation slides along.
export interface TrackedPlacement extends Placement {
  track: TrackPlacement;
}

// How much closer another pattern polyline has to be before a train is moved
// onto it. A line's patterns overlap almost exactly, so without this hysteresis
// a train flickers between them from one snapshot to the next, losing its
// along-track continuity every time it does. Metres.
const TRACK_SWITCH_MARGIN = 25;

export interface PlaceOptions extends SnapOptions {
  // How much closer another pattern has to be before the vehicle is moved onto
  // it, overriding TRACK_SWITCH_MARGIN. A tram's two directions are only some
  // metres apart, so it wants a far smaller margin than a metro line whose
  // patterns are all but coincident. Metres.
  switchMargin?: number;
  // How far along its route the vehicle is expected to have travelled since
  // `previous` was recorded, and how much slack to allow around that. Together
  // they turn the previous placement into the `expected` window that keeps a
  // vehicle on the arm of a junction it is actually taking. Set both, or
  // neither: with no window there is no continuity test.
  expectedAdvance?: number;
  continuityWindow?: number;
}

/**
 * Which way along a track the vehicle is running: with the polyline's own
 * direction of travel, or against it.
 *
 * Where the track carries the GTFS direction the vehicle reported, that answers
 * it outright — a pattern polyline runs the way its direction runs, so a
 * vehicle matched within its own direction is running forwards along it by
 * construction. This is worth more than it sounds for a commuter train, whose
 * reported heading in a station throat is whatever the last GPS fix that moved
 * said, which at a stand is nothing much.
 *
 * Otherwise the reported heading decides, as it must for the metro, whose
 * patterns carry no direction we can match a train to.
 */
function runsForward(
  track: RailTrack | undefined,
  direction: number | null | undefined,
  heading: number,
  bearing: number
): boolean {
  if (track && track.direction !== null && direction !== undefined && direction !== null) {
    if (track.direction === direction) return true;
  }
  return angleBetween(heading, bearing) <= 90;
}

/**
 * Face a vehicle along the rails without moving it.
 *
 * Some places can say which way a vehicle is pointing but not which track it is
 * on. Helsinki Central's throat is the example: twenty-odd parallel tracks a few
 * metres apart, all running the same way, with platform assignments that no
 * route polyline knows — pulling a train sideways onto its route's polyline
 * there is a guess at a platform, but reading the bearing off that polyline is
 * not a guess at all, because every track in the fan is parallel to it.
 *
 * So the reported position is kept, honestly, and only the heading comes from
 * the rails. No `track` is returned: the vehicle is not known to be on one, so
 * nothing may slide it along one.
 */
export function orientOnTracks(
  tracks: RailTrack[],
  position: { lat: number; lng: number; hdg: number },
  options: SnapOptions = {}
): Placement | null {
  const fix = snapToTracks(tracks, position.lng, position.lat, options);
  if (!fix) return null;
  const forward = runsForward(
    tracks[fix.trackIndex],
    options.direction,
    position.hdg,
    fix.bearing
  );
  return {
    lat: position.lat,
    lng: position.lng,
    hdg: forward ? fix.bearing : (fix.bearing + 180) % 360,
    offset: fix.offset,
  };
}

/**
 * Pull a reported position onto a line's tracks and work out which way along
 * them the vehicle is facing.
 *
 * `previous` is where the same vehicle was placed on the last snapshot, which
 * is what makes the result continuous: it keeps the vehicle on the pattern it
 * was already running along, and it is the strongest evidence of which
 * direction it faces. Returns null when the position is too far off the network
 * to be trusted — the caller should then draw the raw position.
 */
export function placeOnTracks(
  line: string,
  tracks: RailTrack[],
  position: { lat: number; lng: number; hdg: number },
  previous: TrackPlacement | undefined,
  options: PlaceOptions = {}
): TrackedPlacement | null {
  const wasHere = previous?.line === line;

  // Where the vehicle should turn up, given where it was and how far it has
  // travelled since. This is what picks the right arm of a junction: several
  // stretches of the same polyline pass through one, and only one of them
  // continues the run the vehicle is already making.
  const snapOptions: SnapOptions =
    wasHere && options.continuityWindow !== undefined && tracks[previous!.index]
      ? {
          ...options,
          expected: {
            trackIndex: previous!.index,
            distance:
              previous!.distance +
              (previous!.forward ? 1 : -1) * (options.expectedAdvance ?? 0),
            window: options.continuityWindow,
          },
        }
      : options;

  let fix = snapToTracks(tracks, position.lng, position.lat, snapOptions);
  if (!fix) return null;

  // Stay on the pattern the vehicle was already running along unless another
  // one is clearly closer.
  if (wasHere && previous!.index !== fix.trackIndex) {
    const prevTrack = tracks[previous!.index];
    if (prevTrack) {
      // Snapping to one track alone renumbers it, so the continuity window —
      // which names a track by its index — has to be renumbered with it.
      const onPrev = snapToTracks([prevTrack], position.lng, position.lat, {
        ...snapOptions,
        expected: snapOptions.expected ? { ...snapOptions.expected, trackIndex: 0 } : undefined,
      });
      if (onPrev && onPrev.offset <= fix.offset + (options.switchMargin ?? TRACK_SWITCH_MARGIN)) {
        fix = { ...onPrev, trackIndex: previous!.index };
      }
    }
  }

  const sameTrack = wasHere && previous!.index === fix.trackIndex;

  // Which way the train faces. Along one pattern polyline it never changes: the
  // two directions of a metro line are separate patterns, so a train that turns
  // round arrives here on a different track and has its direction read afresh
  // from the heading below.
  //
  // Deriving it from movement instead — which way the train appears to have gone
  // since the last placement — looks more direct and is a trap. It reverses the
  // train on any step that measures backwards, and the feed produces those
  // without the train ever turning: of ~1700 movement steps captured off the
  // live feed, 64 measured as reversals and every one of them fell in an exact
  // pair, the signature of a single coordinate flung off the line and then
  // returned. Not one was a real reversal. A flip is expensive, too — it points
  // the icon the wrong way and sends the dead reckoning back down the track — so
  // the standing direction wins unless the train is somewhere new.
  let forward: boolean;
  if (sameTrack) {
    forward = previous!.forward;
  } else {
    // The pattern's own direction where the feed gave one to match it against,
    // and the reported heading otherwise. On the metro that is the heading: it
    // is dead-reckoned like everything else, but it agrees with the direction
    // of travel 98% of the time, which is what this has to get right.
    forward = runsForward(tracks[fix.trackIndex], options.direction, position.hdg, fix.bearing);
  }

  return {
    lat: fix.lat,
    lng: fix.lng,
    hdg: forward ? fix.bearing : (fix.bearing + 180) % 360,
    offset: fix.offset,
    track: { line, index: fix.trackIndex, distance: fix.distance, forward },
  };
}

/**
 * Read the rails as a moving frame: where the point `along` metres ahead of a
 * vehicle's centre sits, and which way the track faces there.
 *
 * This is what lets an articulated body bend. A tram is three rigid sections on
 * a 27 m wheelbase, and through a Helsinki street corner the rails turn well
 * inside that length — so a body drawn as one rigid box at one heading either
 * ploughs its nose through the building on the outside of the curve or swings
 * its tail through the one on the inside. Placing each section at its own point
 * on the rails, at the bearing the rails have *there*, is the same thing the
 * real vehicle does with its articulation joints.
 *
 * `along` is measured towards the nose, so it maps onto the arc length in the
 * direction the vehicle is running, whichever way that is along the polyline.
 */
export function trackSpine(
  track: RailTrack,
  distance: number,
  forward: boolean
): (along: number) => { lng: number; lat: number; hdg: number } {
  return (along: number) => {
    const point = pointOnTrack(track, distance + (forward ? along : -along));
    return {
      lng: point.lng,
      lat: point.lat,
      hdg: forward ? point.bearing : (point.bearing + 180) % 360,
    };
  };
}

/**
 * Whether a line number names a metro line. HSL spells the metro's `desi` as
 * "M" plus a digit ("M1", "M2", and their short-turn variants); trams are bare
 * numbers and commuter trains single letters, so that shape is the whole test.
 */
export function isMetroLine(desi: string | undefined | null): boolean {
  return !!desi && /^M\d/i.test(desi);
}

/**
 * The GTFS direction a vehicle is running in, from the `dir` the HFP topic
 * carries. HFP numbers the two directions "1" and "2"; GTFS numbers the same
 * two 0 and 1, and Digitransit reports patterns by the GTFS numbering. Anything
 * else — an absent field, a garbled value — is null, which snaps against every
 * direction rather than none.
 */
export function hfpDirectionId(dir: string | number | undefined | null): number | null {
  if (dir === undefined || dir === null || dir === '') return null;
  const n = typeof dir === 'number' ? dir : parseInt(dir, 10);
  if (n === 1) return 0;
  if (n === 2) return 1;
  return null;
}

/**
 * Whether a vehicle of this mode is eligible for route-constrained placement.
 * Buses may legitimately be on diversions; rail vehicles have fixed geometry.
 * Commuter trains still have a separate station-throat safeguard in the map.
 */
export function isSnappedMode(mode: string | undefined | null): boolean {
  return mode === 'metro' || mode === 'tram' || mode === 'train';
}

/**
 * Helsinki Central is a deliberately unresolved area for commuter-train
 * placement. Its throat and platforms contain many parallel, reversing and
 * overlapping movements that route polylines cannot distinguish reliably.
 */
export function isHelsinkiCentralStationZone(lng: number, lat: number): boolean {
  return lng >= 24.936 && lng <= 24.950 && lat >= 60.169 && lat <= 60.175;
}

/**
 * The distinct lines present in a feed snapshot whose vehicles are snapped to
 * their rails, sorted.
 *
 * Sorting is what makes this usable as a fetch dependency: the snapshot is a
 * fresh object every second and its key order is not stable, so the lines have
 * to reduce to the same value each time or the geometry would be re-fetched
 * once a second.
 */
export function snappedLinesInFeed(
  vehicles: Record<string, { mode?: string; desi?: string }>
): string[] {
  const lines = new Set<string>();
  for (const vehicle of Object.values(vehicles)) {
    if (!isSnappedMode(vehicle.mode) || !vehicle.desi) continue;
    if (vehicle.mode === 'metro' && !isMetroLine(vehicle.desi)) continue;
    lines.add(vehicle.desi);
  }
  return [...lines].sort();
}
