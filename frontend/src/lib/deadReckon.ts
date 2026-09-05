// Dead reckoning between position reports.
//
// Every mode on this map reports about once a second, and every mode is drawn
// by gliding from the last position to the newest one. Done naively that draws
// each vehicle exactly one report behind reality — the glide only *begins* when
// the report that ends it has already arrived — so every new report lands a
// whole second of travel away and has to be absorbed as a correction. Measured
// on a five-minute capture of the live feed, that correction is 9.6 m at the
// ninetieth percentile for a tram, 13.1 m for a bus and 32.6 m for a commuter
// train: a visible tug, once a second, on every vehicle on the map.
//
// The fix is to aim the glide at where the vehicle will be when the window
// closes rather than at where it was when the window opened. Every report
// carries the speed and acceleration measured on board, and integrating those
// forward turns out to be a very good predictor: over the one to two seconds
// that matter here it puts the vehicle within 0.6 m of its next reported
// position for a tram, 1.1 m for a bus and 2.2 m for a train — the same
// corrections, fifteen times smaller. The vehicle stops being tugged because
// the feed stops disagreeing with it.
//
// How long that holds is measured, not assumed, and it is the reason surface
// modes and the metro get different horizons — see SURFACE_MAX_AGE and MAX_AGE
// below.
//
// The metro feed is the sparsest on the map — but not in the way it first
// appears. Measured off the live HFP feed, the messages arrive at a steady 1 Hz
// like every other mode's; what stands still is their *contents*. A train
// repeats its previous coordinate and speed for about three seconds at a time
// between stations, and far longer at them (median five and a half seconds,
// nine in ten under forty-seven, up to a minute observed), while only the
// timestamp ticks. The backend faithfully caches and rebroadcasts what it is
// given, so from the frontend's side the train simply stops moving without
// saying so.
//
// The animation used to have nothing to say about that silence. It eased into
// the last reported point, arrived, and froze; then the next report landed
// several seconds of travel further down the line and was crammed into one
// second of glide. Stand still, lurch, stand still — the least train-like
// motion there is, and the reason metro movement reads as broken while trams
// (a dependable 1 Hz) look fine.
//
// A metro train is also the easiest vehicle on this map to predict. It is on
// rails, it cannot turn off them, and every report carries the speed measured
// on board. Integrating that forward says where the train is *now*; the next
// report then only has to correct a small error instead of delivering a whole
// jump. (Speed alone: unlike the surface modes, metro messages carry no `acc`
// field at all — not one of 8,178 metro readings in a five-minute capture —
// so a metro prediction is constant-velocity in practice. The same capture
// has no `drst` on a metro either, which is why a metro's doors never read as
// open.)
//
// This module is the physics half of that — how far a vehicle travels in a
// given window, given the speed and acceleration it last reported. The other
// half is `metroTracks`, which turns "this far along" back into a coordinate.

import { clamp, smoothstep } from './lerp';

// How long a reported acceleration is trusted, in seconds. Acceleration is an
// instantaneous reading: a train pulling out of Kamppi at 1.2 m/s² is not
// still doing that ten seconds later, and integrating as if it were would have
// it leave the map. Past this horizon the prediction holds the speed it had
// reached and coasts.
export const ACC_HORIZON = 4;

// Line speed of the Helsinki metro, in m/s (~80 km/h). Caps the integrated
// speed so a spurious acceleration reading cannot outrun the train.
export const MAX_SPEED = 22;

// Give up predicting after this many seconds without a new position. Beyond it
// the train has most likely stopped moving for a reason its last speed cannot
// describe — berthing at a platform, a long dwell, end of journey — and a
// confident-looking position invented from a reading that old is worse than a
// stale one.
//
// Eight seconds is where the live feed puts the knee. A held coordinate between
// stations lasts 2.6 s at the median and 4.2 s at the ninetieth percentile, so
// eight covers essentially all of them, and over those windows the held speed
// predicts the eventual jump to within about a tenth (median ratio 0.99). The
// long holds are the ones at platforms, where the frozen message keeps
// reporting the speed the train came in at while it is in fact slowing, dwelling
// and leaving — the same ratio there ranges from 0.2 to 5.7, so the reading
// says nothing useful. Replaying a captured feed, extending the horizon buys
// steadily less and costs sharply more: at 8 s a correction pulls a train back
// by at most 43 m and by 18 m at the ninetieth percentile, at 12 s that is 66
// and 44, and at 20 s it is 199 and 145 — a train visibly running past its
// platform and being yanked back. Stopping at eight keeps the train still for
// the part of a station dwell we cannot model, which is also what it is
// actually doing.
export const MAX_AGE = 8;

// How long a *surface* vehicle's reported speed is worth integrating, in
// seconds. Much shorter than the metro's eight, and for the opposite reason.
//
// A metro holds its coordinate while it is still moving — the tunnel
// positioning is what goes stale, not the train — so predicting through the
// silence is the only way to draw the truth. A tram, bus or train that goes
// quiet has usually *stopped*: at a light, at a stop, or with its unit dropping
// out while parked. Its last reported speed then describes something that is no
// longer happening.
//
// The live feed says exactly where the crossover is. Scoring both strategies
// against the coordinate the vehicle actually reported next, by how long the
// feed had been silent first (ninetieth-percentile error, metres):
//
//     silence   freeze / predict     freeze / predict     freeze / predict
//               tram                 bus                  train
//     0-2 s      9.6 /  0.6          13.1 /  1.1          32.6 /  2.2
//     2-3 s      8.6 / 10.4          11.7 / 15.2          53.6 / 28.8
//     3-4 s      2.0 /  1.5          11.6 / 27.4          28.7 / 45.4
//     4-5 s        —  /   —          14.3 / 42.8          39.7 / 43.3
//
// Under two seconds — which is 99% of all steps — predicting is better by
// tenfold and more. Past two it inverts, and keeps inverting: a bus silent for
// six seconds is 11 m from where freezing would have drawn it and 56 m from
// where its last speed says it should be, because it is standing at a kerb.
//
// So the horizon stops right where the evidence does. Windows aim one interval
// ahead (`age + window`), so in normal 1 Hz service the lead is a second and
// this never binds; it only takes hold once reports actually start going
// missing, and then it coasts the vehicle to a halt instead of driving it on
// down a road it has already stopped on.
export const SURFACE_MAX_AGE = 2;

/** Caps on how fast and how far ahead a mode may be predicted. */
export interface ReckonLimits {
  // Ceiling on the integrated speed, m/s. A single bad acceleration reading
  // cannot push a vehicle past what its mode can physically do.
  maxSpeed: number;
  // Seconds of report age past which prediction stops and the vehicle holds.
  maxAge: number;
}

// Per mode. The speed caps sit just above each mode's fastest honest reading in
// the captured feed (tram 75 km/h, bus 100, metro 80, train 160) — high enough
// never to clip real motion, low enough that the feed's occasional garbage
// coordinate cannot launch a vehicle across the map.
export const METRO_LIMITS: ReckonLimits = { maxSpeed: MAX_SPEED, maxAge: MAX_AGE };
const TRAM_LIMITS: ReckonLimits = { maxSpeed: 22, maxAge: SURFACE_MAX_AGE };
const BUS_LIMITS: ReckonLimits = { maxSpeed: 28, maxAge: SURFACE_MAX_AGE };
const TRAIN_LIMITS: ReckonLimits = { maxSpeed: 45, maxAge: SURFACE_MAX_AGE };

/**
 * The prediction limits for an HFP mode. Anything unrecognised is treated as a
 * tram: the most conservative surface profile, and the mode the feed defaults
 * to when a topic cannot be parsed.
 */
export function reckonLimits(mode: string | undefined): ReckonLimits {
  switch (mode) {
    case 'metro':
      return METRO_LIMITS;
    case 'bus':
      return BUS_LIMITS;
    case 'train':
      return TRAIN_LIMITS;
    default:
      return TRAM_LIMITS;
  }
}

// Integration step, in seconds. The speed curve is piecewise linear, so the
// trapezoid rule is exact except at the two breakpoints; this only bounds the
// error those contribute.
const STEP = 0.1;

/**
 * The speed a vehicle is predicted to have `age` seconds after a report of
 * `spd` m/s and `acc` m/s². Acceleration applies for `ACC_HORIZON` seconds,
 * and the result is clamped to a plausible range: never reversing, never
 * faster than the line allows.
 */
export function predictedSpeed(
  spd: number,
  acc: number,
  age: number,
  limits: ReckonLimits = METRO_LIMITS
): number {
  const v0 = Number.isFinite(spd) ? Math.max(spd, 0) : 0;
  const a = Number.isFinite(acc) ? acc : 0;
  return clamp(v0 + a * clamp(age, 0, ACC_HORIZON), 0, limits.maxSpeed);
}

/**
 * How far the vehicle travels between `fromAge` and `toAge` seconds after the
 * report, in metres. Both ages are clamped to `MAX_AGE`, so a window that runs
 * past the prediction horizon contributes nothing and the vehicle coasts to a
 * halt on screen rather than running away.
 */
export function predictedAdvance(
  spd: number,
  acc: number,
  fromAge: number,
  toAge: number,
  limits: ReckonLimits = METRO_LIMITS
): number {
  const from = clamp(fromAge, 0, limits.maxAge);
  const to = clamp(toAge, 0, limits.maxAge);
  if (!(to > from)) return 0;

  let total = 0;
  let prevV = predictedSpeed(spd, acc, from, limits);
  let at = from;
  while (at < to) {
    const next = Math.min(at + STEP, to);
    const v = predictedSpeed(spd, acc, next, limits);
    total += ((prevV + v) / 2) * (next - at);
    prevV = v;
    at = next;
  }
  return total;
}

/**
 * How much of a one-second glide window has been covered at time `t` (0..1),
 * shaped by the vehicle's own speed profile rather than by an easing curve.
 *
 * `ageStart` is how old the underlying report already was when the window
 * began, which is what makes a long silence keep moving realistically: the
 * fifth second after a report is animated with the speed the train would have
 * in its fifth second, not with the speed it had when it last spoke.
 *
 * A window in which the vehicle is predicted not to move at all — standing at
 * a platform, or past the prediction horizon — has no profile to follow, so it
 * falls back to smoothstep. That window only ever carries a correction from
 * the feed, and easing one in beats snapping it.
 */
export function glideFraction(
  spd: number,
  acc: number,
  ageStart: number,
  t: number,
  limits: ReckonLimits = METRO_LIMITS,
  window = 1
): number {
  const x = clamp(t, 0, 1);
  const span = predictedAdvance(spd, acc, ageStart, ageStart + window, limits);
  if (span <= 0.01) return smoothstep(x);
  return clamp(
    predictedAdvance(spd, acc, ageStart, ageStart + window * x, limits) / span,
    0,
    1
  );
}

// Mean Earth radius, m. Only ever used over a few tens of metres here, where a
// sphere and the local tangent plane are the same thing to well under a
// millimetre.
const EARTH_RADIUS = 6371000;

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
 */
export function advanceAlongHeading(
  lat: number,
  lng: number,
  hdg: number,
  metres: number
): { lat: number; lng: number } {
  if (!(metres > 0) || !Number.isFinite(hdg)) return { lat, lng };
  const rad = (hdg * Math.PI) / 180;
  const dLat = ((metres * Math.cos(rad)) / EARTH_RADIUS) * (180 / Math.PI);
  const cosLat = Math.cos((lat * Math.PI) / 180);
  // At the poles a metre east is an unbounded number of degrees. Helsinki is
  // nowhere near one, but the guard keeps a garbage coordinate from producing
  // an infinite longitude rather than a wrong one.
  const dLng =
    Math.abs(cosLat) < 1e-6
      ? 0
      : ((metres * Math.sin(rad)) / (EARTH_RADIUS * cosLat)) * (180 / Math.PI);
  return { lat: lat + dLat, lng: lng + dLng };
}

/**
 * Whether a snapshot carries a position the animation has not already seen.
 *
 * This is the whole distinction the metro's motion turns on, so it is stated
 * once, here. HFP repeats a metro's coordinate for seconds at a time while the
 * timestamp on it keeps ticking, and the backend rebroadcasts its cache every
 * second on top of that — so neither the timestamp nor the fact that a message
 * arrived says anything about whether the train has been somewhere new. Only
 * the coordinate does. Treating a ticking timestamp as a fresh report re-anchors
 * the train on its own stale position every second, which leaves nothing for the
 * dead reckoning to carry forward.
 */
export function hasMoved(
  previous: { lat: number; lng: number } | undefined,
  next: { lat: number; lng: number }
): boolean {
  return !previous || previous.lat !== next.lat || previous.lng !== next.lng;
}
