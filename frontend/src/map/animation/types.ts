import type { VehiclePosition, TripDetailsResponse } from '../../types';
import type { ArrivalFocus } from '../../lib/stopArrivals';
import type { MapTheme } from '../../lib/stopPlatforms';
import type { RailTrack, TrackPlacement } from '../../lib/railTracks';
import type { ReckonLimits } from '../../lib/deadReckon';
import type { DoorAnimation } from '../../lib/vehicleAnimation';

export interface VehicleFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: {
    veh: string;
    desi: string;
    hdg: number;
    stopped: boolean;
    mode: string;
    spd: number;
    acc: number;
    speedNorm: number;
    doorsOpen: boolean;
    /**
     * Which load step the vessel is reporting, as an index into
     * `OCCUPANCY_BUCKETS`; -1 for every mode that does not measure occupancy and
     * for a ferry whose counter is silent. The vehicle-body layer matches on it
     * to pick the marker with the right deck gauge.
     */
    occuBucket: number;
  };
}

export interface RenderPosition {
  lat: number;
  lng: number;
  hdg: number;
  // Rail modes only: where this position sits on the line's own track
  // geometry, so the animation can slide a vehicle *along* its rails between
  // two snapshots instead of cutting across the ground between them, and so an
  // articulated body can be bent along them. See lib/railTracks.
  track?: TrackPlacement;
}

// A metro position is only pulled onto the tracks if it is within this far of
// them. Underground, HFP positions are dead-reckoned and drift by a couple of
// hundred metres; past that the message is more likely stale or bogus than a
// train, and snapping it would invent a confident-looking position.
export const METRO_SNAP_MAX_OFFSET = 400;

// A tram is pulled onto its rails only from this close. Its GPS is ordinary
// street-level GPS — good to some tens of metres, worse between tall buildings
// — so this has to cover the error without covering the next street: past 35 m
// the nearest rail is as likely to be a different line's as this tram's own,
// and a tram genuinely off its route (a diversion, a depot run, a replacement
// working) should be drawn where it says it is rather than dragged onto rails
// it is not using.
export const TRAM_SNAP_MAX_OFFSET = 35;

// Commuter-train GPS is better than metro odometry, but still cannot identify
// parallel railway tracks. Keep the match conservative outside station throats.
export const TRAIN_SNAP_MAX_OFFSET = 80;

// How far the rails may be for a train inside Helsinki Central to be *turned* by
// them without being moved onto them. Wider than the snap above on purpose:
// nothing is being asserted about which of the station's tracks the train is on,
// only about which way that whole fan of tracks runs, and the fan is some
// hundred metres wide. Metres.
export const TRAIN_ORIENT_MAX_OFFSET = 150;

// How much closer another pattern has to be before a tram is moved onto it.
// The two directions of a tram line are one carriageway apart, so the margin
// that keeps a metro train on its (all but coincident) pattern would instead
// pin a tram to whichever rail it first snapped to. Metres.
export const TRAM_TRACK_SWITCH_MARGIN = 4;

// How much slack the junction test allows around where a tram is expected to
// have got to, on top of the distance its own reported speed accounts for.
// Wide enough that ordinary running, a late snapshot and a stretch of standing
// still all stay inside it; far narrower than the distance between two passes
// of the same junction, which is what it exists to tell apart. Metres.
export const TRAM_CONTINUITY_SLACK = 40;

// The last position report from a vehicle that actually said something new,
// kept so the animation can carry it forward until the next one.
//
// Every mode needs this, for two different reasons.
//
// A metro's HFP messages arrive every second like everything else's, but only
// their timestamp moves at that rate: the coordinate and speed are held and
// refreshed in steps of a few seconds. Measured on the live feed, 74% of
// consecutive messages between stations repeat the previous coordinate exactly,
// and 96% of them do at a platform — so a train stands still for about three
// seconds and then arrives some fifty metres further down the line. That is what
// makes a metro look stuck and then lurch, and it is why the timestamp cannot be
// what marks a new report: it ticks either way.
//
// A tram, bus or commuter train does report a fresh coordinate every second, so
// it never looks stuck — but drawn by gliding to the newest report it is always
// a full second behind, and every report lands a second of travel away and has
// to be tugged in. On the captured feed that tug is 9.6 m for a tram, 13.1 m for
// a bus and 32.6 m for a train at the ninetieth percentile. Anchoring here and
// aiming the glide at the end of the window instead cuts it to 0.6, 1.1 and
// 2.2 m. See lib/deadReckon.
export interface VehicleFix {
  // HFP timestamp and coordinates of the last message whose *coordinate* was
  // new. The coordinate is what tells a fresh position from a repeat of the one
  // we already have; `ts` moves every second regardless.
  ts: number;
  lat: number;
  lng: number;
  // Wall clock (performance.now()) when the report first reached us. Ages are
  // measured against this rather than against `ts`, so a client whose clock
  // disagrees with HSL's by a few seconds still predicts correctly.
  seenAt: number;
  // Speed and acceleration the vehicle reported, which is what is integrated.
  spd: number;
  acc: number;
  // Reported heading, which is the direction a surface vehicle is carried in.
  // A metro ignores it and follows its track instead.
  hdg: number;
  // How far and how fast this mode may be predicted.
  limits: ReckonLimits;
  // Metro only: where the report put the train on the network.
  track?: TrackPlacement;
}

// How the current glide window should be shaped: by the speed profile the
// vehicle is actually predicted to follow, rather than by a generic easing
// curve. `ageStart` is how old the underlying report already was when the
// window opened, so a window that opens into a gap in the feed is animated at
// the speed the vehicle has by then rather than the speed it last reported.
export interface Glide {
  spd: number;
  acc: number;
  ageStart: number;
  limits: ReckonLimits;
}

/**
 * What the animation remembers between frames.
 *
 * This was twenty refs on the component, which is what a mutable per-map
 * scratchpad looks like when React is the only place to put one. It is not
 * React state — nothing here should cause a render, and the loop writes to it
 * sixty times a second — so it is a plain object the component owns and the
 * loop is handed.
 */
export interface AnimationState {
  /** Last known fix per vehicle, and the glide carrying it to the next one. */
  fixes: Record<string, VehicleFix>;
  glides: Record<string, Glide>;
  /** Where each vehicle is gliding from, to, and where it was last drawn. */
  prev: Record<string, RenderPosition>;
  target: Record<string, RenderPosition>;
  rendered: Record<string, RenderPosition>;
  /** Door open/shut animations in flight, keyed by vehicle. */
  doors: Record<string, DoorAnimation>;
  /**
   * Rail geometry per line, and the pattern payload each was built from.
   * Indexing walks every point of every pattern, so a line is only rebuilt
   * when its polylines actually change.
   */
  tracks: Record<string, RailTrack[]>;
  trackSources: Record<string, unknown>;
  /**
   * How long the current glide window is on the wall clock, how much travel it
   * covers, and how far prediction may carry a vehicle into it. See timeScale.
   */
  windowSec: number;
  stepSec: number;
  dataWindowSec: number;
  timeScale: number;
  /** Clocks: when the last snapshot arrived, and when the last frame drew. */
  lastUpdate: number;
  lastRender: number;
  /** How many vehicles the last frame actually drew. */
  visibleCount: number;
  /** The pending requestAnimationFrame, so it can be cancelled on teardown. */
  frame: number | null;
  /** Whether the 3D source currently holds bodies, so it is emptied once. */
  vehicles3dDrawn: boolean;
  /** The stop a selected vehicle is heading for, and whether it is boarding. */
  stopHighlight: {
    key: string;
    stopId: string | null;
    boarding: boolean;
    coords: [number, number] | null;
  };
  /** The last stop the selected vehicle reported, for trip progress. */
  lastSeenStopId: string | null;
  /** Whether the reader is dragging the map, which suspends camera follow. */
  interacting: boolean;
}

export function createAnimationState(timeScale = 1): AnimationState {
  return {
    fixes: {},
    glides: {},
    prev: {},
    target: {},
    rendered: {},
    doors: {},
    tracks: {},
    trackSources: {},
    windowSec: 1,
    stepSec: 1,
    dataWindowSec: 1,
    timeScale,
    lastUpdate: 0,
    lastRender: 0,
    visibleCount: 0,
    frame: null,
    vehicles3dDrawn: false,
    stopHighlight: { key: '', stopId: null, boarding: false, coords: null },
    lastSeenStopId: null,
    interacting: false,
  };
}

/**
 * What the loop reads from the app on each frame. The component passes a
 * function returning this rather than the values themselves: the loop outlives
 * the render that started it, and must see what is true now, not then.
 */
export interface FrameInputs {
  vehicles: Record<string, VehiclePosition>;
  selectedVehicleId: string | null;
  selectedTripDetails: TripDetailsResponse | null;
  arrivalFocus: ArrivalFocus | null;
  arrivalStopCoords: [number, number] | null;
  theme: MapTheme;
  is3D: boolean;
  always3DVehicles: boolean;
  isFollowing: boolean;
}

/** Work the loop asks the app to do when something it draws has moved on. */
export interface FrameEffects {
  /** Rebuild the 3D stop and bike furniture around a changed highlight. */
  rebuildFurniture: () => void;
}

export type { TrackPlacement, ReckonLimits };
