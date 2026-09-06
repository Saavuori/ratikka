import type { StopDepartureInfo, VehiclePosition } from '../types';
import { departureEpoch, isCancelledDeparture } from './departures';
import { findTripVehicle, type TripIdentity } from './journeyVehicles';

/**
 * How the arrival's countdown was arrived at. The number itself always comes
 * from the timetable feed — `live-tracked` only adds that the vehicle serving
 * it has been located on the map, so its approach can be drawn.
 */
export type ArrivalConfidence = 'live-tracked' | 'live-predicted' | 'scheduled';

export interface StopArrival {
  departure: StopDepartureInfo;
  /** The live vehicle serving this departure, when it could be named exactly. */
  vehicle?: VehiclePosition;
  /** Departure time from this stop, epoch ms. */
  epoch: number;
  /** Milliseconds until departure; negative once it is due or gone. */
  etaMs: number;
  confidence: ArrivalConfidence;
}

/**
 * A departure has left once it is a minute past due — the same grace period
 * the timetable rows use before they read "Departed".
 */
export const DEPARTED_GRACE_MS = 60_000;

/** Roughly 4.7 km/h, the pace OTP itself assumes for a walking leg. */
export const DEFAULT_WALK_PACE_MPS = 1.3;

export function departureIdentity(departure: StopDepartureInfo): TripIdentity {
  return {
    tripId: departure.tripId,
    serviceDate: departure.serviceDate,
    routeId: departure.routeId,
    directionId: departure.directionId,
    startTimeSeconds: departure.startTimeSeconds,
    mode: departure.mode,
    cancelled: isCancelledDeparture(departure),
  };
}

export interface NextArrivalsOptions {
  /** Keep only these line numbers (`desi`/shortName). Empty or absent keeps all. */
  lines?: string[];
  /** Maximum arrivals to return. */
  limit?: number;
}

/**
 * The upcoming departures from one stop, soonest first, each paired with the
 * live vehicle serving it where that vehicle can be identified beyond doubt.
 *
 * Countdowns come from the feed's prediction, never from measuring the
 * vehicle: a stop with no locatable vehicle still gets an honest arrival, and
 * two sources can never disagree about the same number.
 */
export function nextArrivals(
  departures: StopDepartureInfo[],
  vehicles: VehiclePosition[],
  now: number,
  options: NextArrivalsOptions = {},
): StopArrival[] {
  const lines = options.lines?.length ? new Set(options.lines) : undefined;
  const arrivals: StopArrival[] = [];
  for (const departure of departures) {
    if (isCancelledDeparture(departure)) continue;
    if (lines && !lines.has(departure.line)) continue;
    const epoch = departureEpoch(departure);
    if (epoch === undefined) continue;
    const etaMs = epoch - now;
    if (etaMs < -DEPARTED_GRACE_MS) continue;
    const vehicle = findTripVehicle(departureIdentity(departure), vehicles, now);
    arrivals.push({
      departure,
      vehicle,
      epoch,
      etaMs,
      confidence: vehicle ? 'live-tracked' : departure.realtime ? 'live-predicted' : 'scheduled',
    });
  }
  arrivals.sort((a, b) => a.epoch - b.epoch);
  return typeof options.limit === 'number' ? arrivals.slice(0, Math.max(0, options.limit)) : arrivals;
}

/**
 * The arrival the map is following: which stop, which trip, and the live
 * vehicle serving it. Only ever built for an arrival whose vehicle is known.
 */
export interface ArrivalFocus {
  stopId: string;
  tripId: string;
  vehicleId: string;
  line: string;
}

/** The arrival a focused stop should track: the soonest one still catchable. */
export function focusedArrival(arrivals: StopArrival[], tripId?: string): StopArrival | undefined {
  if (tripId) {
    const pinned = arrivals.find((arrival) => arrival.departure.tripId === tripId);
    if (pinned) return pinned;
  }
  return arrivals[0];
}

/** Which live vehicle modes a stop's departures need streamed to be trackable. */
export function arrivalVehicleModes(departures: StopDepartureInfo[] | undefined): {
  bus: boolean; metro: boolean; train: boolean; tram: boolean;
} {
  const modes = new Set(departures?.map((departure) => departure.mode));
  return {
    bus: modes.has('BUS'),
    metro: modes.has('SUBWAY'),
    train: modes.has('RAIL'),
    tram: modes.has('TRAM'),
  };
}

export type WalkOutcome = 'comfortable' | 'brisk' | 'run' | 'missed';

export interface WalkVerdict {
  outcome: WalkOutcome;
  /** Estimated walking time to the stop, ms. */
  walkMs: number;
  /** Time left over on arrival; negative when the departure goes first. */
  spareMs: number;
}

export interface WalkVerdictOptions {
  paceMps?: number;
}

/**
 * Whether the walk to a stop beats the departure from it.
 *
 * `distanceMetres` must be a walking distance along streets — the value
 * `/stops/nearby` returns. A straight-line distance would cheerfully route the
 * reader across open water, which in Helsinki is most directions.
 */
export function walkVerdict(
  distanceMetres: number | undefined,
  etaMs: number | undefined,
  options: WalkVerdictOptions = {},
): WalkVerdict | undefined {
  const pace = options.paceMps ?? DEFAULT_WALK_PACE_MPS;
  if (typeof distanceMetres !== 'number' || !Number.isFinite(distanceMetres) || distanceMetres < 0) return undefined;
  if (typeof etaMs !== 'number' || !Number.isFinite(etaMs)) return undefined;
  if (!Number.isFinite(pace) || pace <= 0) return undefined;
  const walkMs = (distanceMetres / pace) * 1000;
  const spareMs = etaMs - walkMs;
  const outcome: WalkOutcome = spareMs < 0 ? 'missed'
    : spareMs < 60_000 ? 'run'
      : spareMs < 180_000 ? 'brisk'
        : 'comfortable';
  return { outcome, walkMs, spareMs };
}

const WALK_LABELS: Record<WalkOutcome, string> = {
  comfortable: 'Easy walk',
  brisk: 'Walk now',
  run: 'Run for it',
  missed: 'Too late',
};

export function walkVerdictLabel(verdict: WalkVerdict): string {
  const minutes = Math.max(1, Math.round(Math.abs(verdict.spareMs) / 60_000));
  if (verdict.outcome === 'missed') return `${WALK_LABELS.missed} · ${minutes} min short`;
  return `${WALK_LABELS[verdict.outcome]} · ${minutes} min spare`;
}
