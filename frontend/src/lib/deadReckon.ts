// Dead reckoning between position reports.
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
// rails, it cannot turn off them, and every report carries the speed and
// acceleration measured on board. Integrating those forward says where the
// train is *now*; the next report then only has to correct a small error
// instead of delivering a whole jump.
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
export function predictedSpeed(spd: number, acc: number, age: number): number {
  const v0 = Number.isFinite(spd) ? Math.max(spd, 0) : 0;
  const a = Number.isFinite(acc) ? acc : 0;
  return clamp(v0 + a * clamp(age, 0, ACC_HORIZON), 0, MAX_SPEED);
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
  toAge: number
): number {
  const from = clamp(fromAge, 0, MAX_AGE);
  const to = clamp(toAge, 0, MAX_AGE);
  if (!(to > from)) return 0;

  let total = 0;
  let prevV = predictedSpeed(spd, acc, from);
  let at = from;
  while (at < to) {
    const next = Math.min(at + STEP, to);
    const v = predictedSpeed(spd, acc, next);
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
  t: number
): number {
  const x = clamp(t, 0, 1);
  const span = predictedAdvance(spd, acc, ageStart, ageStart + 1);
  if (span <= 0.01) return smoothstep(x);
  return clamp(predictedAdvance(spd, acc, ageStart, ageStart + x) / span, 0, 1);
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
