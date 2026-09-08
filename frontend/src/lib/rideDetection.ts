import type { VehiclePosition } from '../types';
import { haversineMeters } from './trafficLights';

/**
 * Working out which vehicle the reader is *inside*, from their own phone's
 * position and the live feed.
 *
 * A single fix cannot answer it: at a stop you are as close to the tram you
 * are waiting for as to the one you just left, and a bus passing a pavement
 * comes within a few metres of everybody standing on it. What separates a
 * ride from a near miss is that a ride *keeps* being near: the vehicle stays
 * alongside sample after sample while both of you cover ground. So the
 * evidence is accumulated per vehicle over a rolling window — how long it has
 * stayed within reach, how far the two of you have travelled together, how
 * close it has been on average — and a claim is only made once that evidence
 * could not plausibly be a coincidence.
 *
 * Everything here is pure: the hook feeds it samples and gets tracks back.
 */

/** One reading from the browser's Geolocation API, reduced to what matters. */
export interface LocationSample {
  lat: number;
  lon: number;
  /** Horizontal accuracy in metres, as the browser reports it. */
  accuracy: number;
  /** Ground speed in m/s, or null when the device does not report one. */
  speed: number | null;
  /** Wall clock of the reading, ms. */
  ts: number;
}

/** The evidence gathered for one vehicle over the rolling window. */
export interface RideTrack {
  veh: string;
  desi: string;
  mode: string;
  tripId: string;
  /** Samples in which this vehicle was alongside. */
  hits: number;
  /** Samples since the last hit — three in a row and the ride is over. */
  misses: number;
  firstHitTs: number;
  lastHitTs: number;
  /** Metres the reader covered while this vehicle stayed alongside. */
  sharedMeters: number;
  /** Sum of the separations at each hit, for the mean. */
  separationSum: number;
  /** Separation at the newest hit, metres. */
  lastSeparation: number;
}

export type RideConfidence = 'possible' | 'confirmed';

export interface RideCandidate {
  veh: string;
  desi: string;
  mode: string;
  tripId: string;
  confidence: RideConfidence;
  /** Mean separation over the window, metres. */
  separation: number;
  sharedMeters: number;
  /** How long the vehicle has been alongside, ms. */
  heldMs: number;
}

export type RideVerdict =
  | { kind: 'none' }
  /** Two different journeys fit the evidence equally well; naming one would be a guess. */
  | { kind: 'ambiguous'; among: string[] }
  | { kind: 'candidate'; ride: RideCandidate };

/** A fix this vague says nothing about which side of the street you are on. */
const MAX_USEFUL_ACCURACY_M = 120;
/** Accuracy beyond this stops widening the allowance; it is already generous. */
const ACCURACY_ALLOWANCE_CAP_M = 60;
/** Half a long tram, plus the metre or two the aerial sits off centre. */
const VEHICLE_BODY_M = 20;
/** A position older than this is not evidence of where the vehicle is now. */
const MAX_VEHICLE_AGE_MS = 20_000;
/** Evidence older than this is forgotten: rides end, and phones get pocketed. */
const TRACK_TTL_MS = 120_000;
/** Above this the thing is under way; below WALKING_MAX it is not. */
const MOVING_MIN_MS = 3;
const WALKING_MAX_MS = 2;
/** Two consecutive samples further apart than this are a GPS jump, not a step. */
const MAX_STEP_M = 500;

const CONFIRMED = { hits: 4, heldMs: 25_000, sharedMeters: 150 };
const POSSIBLE = { hits: 2, heldMs: 8_000, sharedMeters: 30 };
/** A hit this old means the vehicle has gone quiet; stop offering it. */
const STALE_HIT_MS = 25_000;
/** Runner-up within this of the leader's mean separation: too close to call. */
const AMBIGUITY_MARGIN_M = 25;

function usableVehicle(vehicle: VehiclePosition, now: number): boolean {
  const age = now - vehicle.ts * 1000;
  if (!Number.isFinite(age) || age < -10_000 || age > MAX_VEHICLE_AGE_MS) return false;
  return Number.isFinite(vehicle.lat) && Number.isFinite(vehicle.lng) &&
    Math.abs(vehicle.lat) <= 90 && Math.abs(vehicle.lng) <= 180 &&
    !(vehicle.lat === 0 && vehicle.lng === 0);
}

/**
 * How far the vehicle may be from the reader and still be the one carrying
 * them: the length of its body, the phone's own uncertainty, and the ground
 * the vehicle has covered since its last report.
 */
export function separationTolerance(sample: LocationSample, vehicle: VehiclePosition, now: number): number {
  const ageSeconds = Math.max(0, Math.min(now - vehicle.ts * 1000, MAX_VEHICLE_AGE_MS) / 1000);
  const speed = Number.isFinite(vehicle.spd) ? Math.max(0, vehicle.spd) : 0;
  const accuracy = Math.min(Math.max(sample.accuracy, 0), ACCURACY_ALLOWANCE_CAP_M);
  return VEHICLE_BODY_M + accuracy + ageSeconds * speed;
}

/** The reader's speed: the device's own figure when it has one, else derived. */
export function riderSpeed(sample: LocationSample, previous: LocationSample | null): number | null {
  if (sample.speed !== null && Number.isFinite(sample.speed) && sample.speed >= 0) return sample.speed;
  if (!previous) return null;
  const seconds = (sample.ts - previous.ts) / 1000;
  if (!(seconds >= 1 && seconds <= 30)) return null;
  const metres = haversineMeters(previous.lat, previous.lon, sample.lat, sample.lon);
  if (metres > MAX_STEP_M) return null;
  return metres / seconds;
}

/**
 * Standing on a pavement while a tram rolls past is the false positive this
 * rules out: one of you is under way and the other is not.
 */
function speedsDisagree(speed: number | null, vehicle: VehiclePosition): boolean {
  if (speed === null) return false;
  const vehicleSpeed = Number.isFinite(vehicle.spd) ? Math.max(0, vehicle.spd) : 0;
  if (speed < WALKING_MAX_MS && vehicleSpeed > MOVING_MIN_MS) return true;
  if (vehicleSpeed < WALKING_MAX_MS && speed > MOVING_MIN_MS) return true;
  if (speed > MOVING_MIN_MS && vehicleSpeed > MOVING_MIN_MS) {
    const allowed = Math.max(4, 0.5 * Math.max(speed, vehicleSpeed));
    return Math.abs(speed - vehicleSpeed) > allowed;
  }
  return false;
}

/**
 * Fold one location reading into the running evidence. Vehicles alongside gain
 * a hit; vehicles previously alongside and no longer gain a miss; evidence
 * that has gone cold is dropped. The input map is not modified.
 */
export function updateRideTracks(
  tracks: ReadonlyMap<string, RideTrack>,
  vehicles: VehiclePosition[],
  sample: LocationSample,
  previous: LocationSample | null,
): Map<string, RideTrack> {
  const next = new Map<string, RideTrack>();
  for (const [veh, track] of tracks) {
    if (sample.ts - track.lastHitTs <= TRACK_TTL_MS) next.set(veh, { ...track });
  }

  // Too vague to place anyone: keep what is known rather than score noise.
  if (!(sample.accuracy <= MAX_USEFUL_ACCURACY_M)) return next;

  const speed = riderSpeed(sample, previous);
  const step = previous ? haversineMeters(previous.lat, previous.lon, sample.lat, sample.lon) : 0;
  const stepSeconds = previous ? (sample.ts - previous.ts) / 1000 : 0;
  const usableStep = previous !== null && step <= MAX_STEP_M && stepSeconds > 0 && stepSeconds <= 30;

  const hit = new Set<string>();
  for (const vehicle of vehicles) {
    if (!usableVehicle(vehicle, sample.ts)) continue;
    const separation = haversineMeters(sample.lat, sample.lon, vehicle.lat, vehicle.lng);
    if (separation > separationTolerance(sample, vehicle, sample.ts)) continue;
    if (speedsDisagree(speed, vehicle)) continue;

    hit.add(vehicle.veh);
    const existing = next.get(vehicle.veh);
    // A vehicle that has started a different trip is a new run: the evidence
    // for the old one says nothing about whether the reader stayed aboard.
    const continuing = existing && existing.tripId === vehicle.tripId;
    const carried = continuing && usableStep && sample.ts - existing.lastHitTs <= 30_000 ? step : 0;
    next.set(vehicle.veh, {
      veh: vehicle.veh,
      desi: vehicle.desi,
      mode: vehicle.mode,
      tripId: vehicle.tripId,
      hits: continuing ? existing.hits + 1 : 1,
      misses: 0,
      firstHitTs: continuing ? existing.firstHitTs : sample.ts,
      lastHitTs: sample.ts,
      sharedMeters: (continuing ? existing.sharedMeters : 0) + carried,
      separationSum: (continuing ? existing.separationSum : 0) + separation,
      lastSeparation: separation,
    });
  }

  for (const [veh, track] of next) {
    if (!hit.has(veh)) track.misses += 1;
  }
  return next;
}

function confidenceOf(track: RideTrack, now: number): RideConfidence | null {
  if (now - track.lastHitTs > STALE_HIT_MS) return null;
  const heldMs = track.lastHitTs - track.firstHitTs;
  if (track.misses === 0 && track.hits >= CONFIRMED.hits &&
      heldMs >= CONFIRMED.heldMs && track.sharedMeters >= CONFIRMED.sharedMeters) {
    return 'confirmed';
  }
  if (track.misses <= 1 && track.hits >= POSSIBLE.hits &&
      heldMs >= POSSIBLE.heldMs && track.sharedMeters >= POSSIBLE.sharedMeters) {
    return 'possible';
  }
  return null;
}

function candidateOf(track: RideTrack, confidence: RideConfidence): RideCandidate {
  return {
    veh: track.veh,
    desi: track.desi,
    mode: track.mode,
    tripId: track.tripId,
    confidence,
    separation: track.separationSum / track.hits,
    sharedMeters: track.sharedMeters,
    heldMs: track.lastHitTs - track.firstHitTs,
  };
}

const RANK: Record<RideConfidence, number> = { confirmed: 2, possible: 1 };

/**
 * The vehicle the evidence points at, if it points at one. Two vehicles
 * running different journeys and fitting equally well are reported as
 * ambiguous rather than resolved by a coin toss — the coupled halves of one
 * train are not, since either answer names the same ride.
 */
export function rideVerdict(tracks: ReadonlyMap<string, RideTrack>, now: number): RideVerdict {
  const scored: { candidate: RideCandidate }[] = [];
  for (const track of tracks.values()) {
    const confidence = confidenceOf(track, now);
    if (confidence) scored.push({ candidate: candidateOf(track, confidence) });
  }
  if (scored.length === 0) return { kind: 'none' };

  scored.sort((a, b) =>
    RANK[b.candidate.confidence] - RANK[a.candidate.confidence] ||
    b.candidate.sharedMeters - a.candidate.sharedMeters ||
    a.candidate.separation - b.candidate.separation);

  const best = scored[0].candidate;
  const rival = scored.find((entry) =>
    entry.candidate.veh !== best.veh &&
    entry.candidate.confidence === best.confidence &&
    (entry.candidate.tripId !== best.tripId || entry.candidate.desi !== best.desi) &&
    entry.candidate.separation - best.separation < AMBIGUITY_MARGIN_M);
  if (rival) {
    return { kind: 'ambiguous', among: [...new Set([best.desi, rival.candidate.desi])] };
  }
  return { kind: 'candidate', ride: best };
}

/**
 * Whether the ride being followed has ended — the reader stepped off, or the
 * vehicle stopped reporting. Three consecutive samples without it alongside is
 * roughly half a minute of walking away from it.
 */
export function rideEnded(track: RideTrack | undefined, now: number): boolean {
  if (!track) return true;
  return track.misses >= 3 || now - track.lastHitTs > 60_000;
}
