import type { VehiclePosition } from '../../types';
import { clamp } from '../../lib/lerp';
import { hasMoved, reckonLimits } from '../../lib/deadReckon';
import { distanceBetween } from '../../lib/railTracks';
import type { TrackPlacement } from '../../lib/railTracks';
import { placeOnRails, predictPosition } from './rails';
import { MAX_WINDOW_SEC, MIN_REPLAY_WINDOW_SEC, MIN_WINDOW_SEC } from './windows';
import type { AnimationState, Glide, RenderPosition, VehicleFix } from './types';

/**
 * Take a new snapshot of vehicle positions and set up the glide that carries
 * every vehicle from where it was drawn to where it now is.
 *
 * This runs once per broadcast, not once per frame: it decides where each
 * vehicle is heading and how long it has to get there, and the loop does the
 * moving.
 */
export function receivePositions(
  state: AnimationState,
  vehicles: Record<string, VehiclePosition>,
  lineFilters: string[],
): void {
  const now = performance.now();
  const newPrev: Record<string, RenderPosition> = {};
  const newTarget: Record<string, RenderPosition> = {};

  // How long this glide window gets. The backend broadcasts once a second, so
  // the gap between two snapshots is what the next window has to cover —
  // measuring it rather than assuming a second keeps the vehicles moving at
  // the right rate when the feed is late, instead of arriving early and
  // standing still until it catches up.
  if (state.lastUpdate > 0) {
    const wallSec = (now - state.lastUpdate) / 1000;
    const scale = Math.max(state.timeScale, 0.1);
    const floor = scale > 1 ? MIN_REPLAY_WINDOW_SEC : MIN_WINDOW_SEC;
    state.windowSec = clamp(wallSec, floor, MAX_WINDOW_SEC);
    // The travel this window covers, which at speed is the step the replay
    // advanced by rather than the sliver of wall clock it took.
    state.stepSec = state.windowSec * scale;
    // Prediction is still bounded by MAX_WINDOW_SEC: a fast replay may hand
    // over eight seconds of travel at a time, but carrying a vehicle eight
    // seconds forward on a stale speed invents more than it draws. Nor is it
    // ever carried further than the window itself covers.
    state.dataWindowSec = clamp(
      Math.min(state.stepSec, MAX_WINDOW_SEC),
      MIN_WINDOW_SEC,
      MAX_WINDOW_SEC
    );
  }

  // Filter trams based on line filters
  const filteredTrams = Object.entries(vehicles).filter((entry) => {
    const tram = entry[1];
    if (lineFilters.length === 0) return true;
    return lineFilters.includes(tram.desi);
  });

  const newFixes: Record<string, VehicleFix> = {};
  const newGlides: Record<string, Glide> = {};

  filteredTrams.forEach(([id, tram]) => {
    const previous = state.target[id];
    const fix = state.fixes[id];
    const limits = reckonLimits(tram.mode);

    // Which way along the track a train is running is judged by comparing this
    // report with the one before it — so the comparison has to be against the
    // last *reported* placement, not against the last target. The target is
    // normally a prediction that has deliberately run ahead of the feed, and a
    // new report measured against it reads as travel backwards: the train
    // turns round, and the next prediction carries it back down its own track
    // until the following report turns it round again.
    const previousPlacement: TrackPlacement | undefined = fix?.track ?? previous?.track;

    // Rail vehicles are drawn on their rails, not where the feed claims they
    // are: a metro because its underground position is dead-reckoned and
    // drifts out of its tunnel, a tram because its position cannot tell the
    // two tracks of a street apart and its journey's direction can.
    //
    // How stale the placement being continued from is — the age of the anchor
    // it came from, or one snapshot when the vehicle has only a target — sets
    // how far along its route the vehicle may have got since.
    const placementAge = fix
      ? ((now - fix.seenAt) / 1000) * Math.max(state.timeScale, 0.1)
      : state.dataWindowSec;
    const snapped = placeOnRails(tram, previousPlacement, placementAge, state.tracks);
    let target: RenderPosition = snapped
      ? { lat: snapped.lat, lng: snapped.lng, hdg: snapped.hdg, track: snapped.track }
      : { lat: tram.lat, lng: tram.lng, hdg: tram.hdg };

    // Only a new *coordinate* is a new report. A metro repeats its position
    // for seconds at a time while the timestamp keeps ticking, so testing the
    // timestamp — as this once did — re-anchored the train on its own stale
    // position every second and left the prediction below with nothing to do.
    // Surface vehicles repeat a coordinate too, about a fifth of the time,
    // and for them it almost always means what it looks like: standing still.
    // Either way the anchor should only move when the vehicle does.
    const moved = hasMoved(fix, tram);
    // A metro that could not be snapped — no geometry yet, or too far off the
    // network to trust — carries no anchor: its raw reported position is
    // drawn, and the next successful snap starts a fresh one. A tram is
    // anchored either way: unlike the metro its raw position is a real GPS
    // fix, so it is worth dead-reckoning from whether or not it snapped.
    const anchorable = tram.mode !== 'metro' || !!snapped;

    if (anchorable && moved) {
      // A real report: it becomes the new anchor everything is predicted
      // from, and this window animates the correction into it.
      newFixes[id] = {
        ts: tram.ts,
        lat: tram.lat,
        lng: tram.lng,
        seenAt: now,
        spd: tram.spd ?? 0,
        acc: tram.acc ?? 0,
        hdg: tram.hdg,
        limits,
        track: snapped?.track,
      };
      newGlides[id] = { spd: tram.spd ?? 0, acc: tram.acc ?? 0, ageStart: 0, limits };

      // Aim at where the vehicle will be at the *end* of this window rather
      // than at the report itself. Targeting the bare report would draw it a
      // whole window behind and step it back by the travel already drawn for
      // it, so every report landed as a small reversal — once a second on
      // every vehicle on the map.
      const projected = predictPosition(newFixes[id], 0, state.dataWindowSec, state.tracks);
      if (projected) {
        target = projected;
      }
    } else if (anchorable && fix) {
      // The coordinate stood still. Carry the vehicle on at the speed it last
      // reported, and keep the anchor so the next real position corrects a few
      // metres of prediction error rather than landing as a jump. One that has
      // genuinely stopped reported zero and therefore stays put; one whose
      // message froze mid-journey is carried for its mode's horizon and then
      // holds, which past that horizon is what it is most likely doing anyway.
      newFixes[id] = fix;
      const age = ((now - fix.seenAt) / 1000) * Math.max(state.timeScale, 0.1);
      const predicted = predictPosition(fix, age, state.dataWindowSec, state.tracks);
      if (predicted) {
        target = predicted;
      }
      newGlides[id] = { spd: fix.spd, acc: fix.acc, ageStart: age, limits: fix.limits };
    }

    // Start the next glide from what is on screen right now — mid-glide when
    // an update lands early, the last target when it lands on time — so a
    // correction is eased in rather than snapped back to.
    const from = state.rendered[id] || previous || target;

    // Unless gliding there would be a lie. The feed does occasionally fling a
    // coordinate right across the city — single steps implying 427 km/h for a
    // tram, 1198 for a bus and 2867 for a train all appear in a five-minute
    // capture — and a smooth glide renders one of those as a vehicle
    // sprinting down a street it was never on. Past a plainly impossible
    // speed the honest drawing is a jump: the vehicle is simply somewhere
    // else now.
    //
    // Four times the mode's top speed is where that line sits, and the metro
    // is what puts it there rather than the surface modes. A metro's
    // coordinate is held for seconds and then arrives fifty metres on, so its
    // ordinary steps are large by construction: at twice top speed this would
    // fire on 96% of them and snap away the very corrections the metro's
    // dead reckoning exists to smooth. At four times it fires on 0.4% of
    // metro steps, 0.04% of tram steps, 0.02% of train steps and no bus step
    // at all — the outliers, and nothing else.
    // Measured against the history the window covers, not against the wall
    // clock it took: at sixty times a perfectly ordinary tram moves eight
    // seconds' worth between snapshots, and a guard sized for one second
    // would call every one of those a teleport and snap it into place —
    // turning the whole replay into a slideshow.
    const leap =
      distanceBetween(from, target) >
      limits.maxSpeed * 4 * Math.max(state.stepSec, MIN_WINDOW_SEC);
    newPrev[id] = leap ? target : from;
    newTarget[id] = target;
  });

  state.prev = newPrev;
  state.target = newTarget;
  // Rebuilt rather than mutated, so a vehicle that left the feed does not keep
  // being predicted forward forever.
  state.fixes = newFixes;
  state.glides = newGlides;
  state.lastUpdate = now;
}
