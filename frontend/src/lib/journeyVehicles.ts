import type { JourneyLeg, VehiclePosition } from '../types';

const MAX_POSITION_AGE_MS = 45_000;
const MODE_NAMES: Record<string, string> = {
  TRAM: 'tram',
  BUS: 'bus',
  SUBWAY: 'metro',
  RAIL: 'train',
  FERRY: 'ferry',
};

/**
 * Everything needed to name one scheduled trip without ambiguity. A journey
 * leg and a stop departure both reduce to this, so one matcher serves both.
 */
export interface TripIdentity {
  tripId?: string;
  serviceDate?: string;
  /** Route GTFS ID, e.g. `HSL:1009` — never the line number on its own. */
  routeId?: string;
  directionId?: number;
  /** Origin departure, seconds since service midnight. */
  startTimeSeconds?: number;
  /** OTP mode: TRAM, BUS, SUBWAY, RAIL, FERRY. */
  mode?: string;
  cancelled?: boolean;
}

function serviceDate(value: string | undefined): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : undefined;
}

function tripParts(id: string): { route: string; direction: string; start: string } | undefined {
  const match = /^(?:HSL:)?([^_]+)_\d{8}_[A-Za-z]{2}_([12])_(\d{4}(?:\d{2})?)$/.exec(id);
  if (!match || Number(match[3].slice(2, 4)) > 59 || Number(match[3].slice(4) || '0') > 59) return undefined;
  return { route: match[1].trim(), direction: match[2], start: match[3].padEnd(6, '0') };
}

function startSeconds(value: string | undefined): number | undefined {
  const match = /^(\d{2,3}):([0-5]\d)(?::([0-5]\d))?$/.exec(value ?? '');
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] ?? 0) : undefined;
}

export function isCancelledState(state: string | undefined): boolean {
  return /^(CANCELED|CANCELLED|DELETED)$/i.test(state ?? '');
}

/**
 * The date embedded in an OTP trip ID can be a timetable version, not its
 * operating day. Require the trip's serviceDate and HFP oday independently.
 * Unknown or ambiguous identities never fall back to matching a line number.
 */
export function findTripVehicle(
  trip: TripIdentity,
  vehicles: VehiclePosition[],
  now: number,
): VehiclePosition | undefined {
  const day = serviceDate(trip.serviceDate);
  if (!trip.tripId || !day || !trip.mode || trip.cancelled) return undefined;
  const planned = tripParts(trip.tripId);
  const routeId = trip.routeId?.replace(/^HSL:/, '').trim();
  const matches = vehicles.filter((vehicle) => {
    const age = now - vehicle.ts * 1000;
    if (!Number.isFinite(age) || age < -10_000 || age > MAX_POSITION_AGE_MS) return false;
    if (serviceDate(vehicle.oday) !== day || vehicle.mode !== MODE_NAMES[trip.mode!]) return false;
    if (!Number.isFinite(vehicle.lat) || !Number.isFinite(vehicle.lng) ||
        Math.abs(vehicle.lat) > 90 || Math.abs(vehicle.lng) > 180) return false;
    if (routeId && routeId !== vehicle.route.replace(/^HSL:/, '').trim()) return false;
    if (routeId && (trip.directionId === 0 || trip.directionId === 1) &&
        Number.isInteger(trip.startTimeSeconds) && trip.startTimeSeconds! >= 0 &&
        vehicle.dir && vehicle.start) {
      return vehicle.dir === String(trip.directionId! + 1) &&
        startSeconds(vehicle.start) === trip.startTimeSeconds;
    }
    if (vehicle.tripId === trip.tripId) return true;
    const live = tripParts(vehicle.tripId);
    return !!planned && !!live && planned.route === live.route &&
      planned.direction === live.direction && planned.start === live.start;
  });
  return matches.length === 1 ? matches[0] : undefined;
}

export function findJourneyVehicle(
  leg: JourneyLeg,
  vehicles: VehiclePosition[],
  now: number,
): VehiclePosition | undefined {
  if (!leg.transit) return undefined;
  return findTripVehicle({
    tripId: leg.tripId,
    serviceDate: leg.serviceDate,
    routeId: leg.route?.gtfsId,
    directionId: leg.directionId,
    startTimeSeconds: leg.startTimeSeconds,
    mode: leg.mode,
    cancelled: isCancelledState(leg.realtimeState),
  }, vehicles, now);
}

export function journeyVehicleModes(legs: JourneyLeg[] | undefined): { bus: boolean; metro: boolean; train: boolean; tram: boolean; ferry: boolean } {
  const modes = new Set(legs?.filter((leg) => leg.transit).map((leg) => leg.mode));
  return {
    bus: modes.has('BUS'),
    metro: modes.has('SUBWAY'),
    train: modes.has('RAIL'),
    tram: modes.has('TRAM'),
    ferry: modes.has('FERRY'),
  };
}
