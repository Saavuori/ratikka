import type { StopDepartureInfo, VehiclePosition } from '../types';
import { departureEpoch, isCancelledDeparture } from './departures';
import { findTripVehicle, type TripIdentity } from './journeyVehicles';
import { isApproaching, isBoardingAt } from './nextStop';

/**
 * What is known about the vehicle behind the arrival. The countdown itself
 * always comes from the timetable feed; these say how much the live feed
 * corroborates it, strongest first:
 *
 * - `at-stop` — the vehicle is standing at this stop with its doors open.
 * - `approaching` — the vehicle names this stop as the one it is running to.
 *   The strongest confirmation short of the vehicle being here, and the feed's
 *   own word rather than anything inferred from position or timetable.
 * - `live-tracked` — the vehicle has been located on the map, but is not yet
 *   heading for this stop: it has stops to make first, or has already been.
 * - `live-predicted` — nobody could be located, but the feed's time is a live
 *   prediction rather than the printed timetable.
 * - `scheduled` — the timetable, and nothing more.
 */
export type ArrivalConfidence =
  | 'at-stop'
  | 'approaching'
  | 'live-tracked'
  | 'live-predicted'
  | 'scheduled';

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
  /**
   * The stop these departures leave from. Without it a located vehicle can
   * only be reported as `live-tracked`, because nothing says whether it is
   * heading here.
   */
  stopId?: string;
}

/**
 * How much the live feed corroborates a departure, given the vehicle serving
 * it. Never touches the countdown — only what can be said about the vehicle.
 */
function arrivalConfidence(
  vehicle: VehiclePosition | undefined,
  departure: StopDepartureInfo,
  stopId: string | undefined,
): ArrivalConfidence {
  if (vehicle) {
    if (isBoardingAt(vehicle, stopId)) return 'at-stop';
    if (isApproaching(vehicle, stopId)) return 'approaching';
    return 'live-tracked';
  }
  return departure.realtime ? 'live-predicted' : 'scheduled';
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
      confidence: arrivalConfidence(vehicle, departure, options.stopId),
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
  bus: boolean; metro: boolean; train: boolean; tram: boolean; ferry: boolean;
} {
  const modes = new Set(departures?.map((departure) => departure.mode));
  return {
    bus: modes.has('BUS'),
    metro: modes.has('SUBWAY'),
    train: modes.has('RAIL'),
    tram: modes.has('TRAM'),
    ferry: modes.has('FERRY'),
  };
}

/**
 * The zoom at which a stop stops being a dot and becomes a place: the same
 * zoom `stops_signs` puts up the sign boards. Zooming in on a stop therefore
 * brings up its sign and what is coming to it in one move.
 */
export const ARRIVAL_LABEL_MIN_ZOOM = 15.5;

/**
 * How many stops around the middle of the screen get a label. A dense view
 * holds hundreds of stops and each one is a departure lookup, so the eye's
 * own area wins — the same rule the 3D stop furniture is capped by.
 */
export const ARRIVAL_LABEL_STOP_LIMIT = 12;

/** An arrival older than this has left; its label would be a lie. */
const LABEL_DUE_FLOOR_MS = -30_000;

/**
 * One stop's label: the line and how long you have, short enough to sit above
 * a sign board without covering the street. Undefined when there is nothing
 * honest to say, which is the signal to draw no label at all rather than an
 * empty one.
 */
export function arrivalLabel(arrival: StopArrival | undefined): string | undefined {
  if (!arrival || arrival.etaMs < LABEL_DUE_FLOOR_MS) return undefined;
  const line = arrival.departure.line?.trim();
  if (!line) return undefined;
  const minutes = arrival.etaMs <= 0 ? 'now'
    : arrival.etaMs < 60_000 ? '<1 min'
      : `${Math.ceil(arrival.etaMs / 60_000)} min`;
  return `${line} · ${minutes}`;
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
