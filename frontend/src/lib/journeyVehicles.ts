import type { JourneyLeg, VehiclePosition } from '../types';

const MAX_POSITION_AGE_MS = 45_000;
const MODE_NAMES: Record<string, string> = {
  TRAM: 'tram',
  BUS: 'bus',
  SUBWAY: 'metro',
  RAIL: 'train',
  FERRY: 'ferry',
};

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

/**
 * The date embedded in an OTP trip ID can be a timetable version, not its
 * operating day. Require the leg's serviceDate and HFP oday independently.
 * Unknown or ambiguous identities never fall back to matching a line number.
 */
export function findJourneyVehicle(
  leg: JourneyLeg,
  vehicles: VehiclePosition[],
  now: number,
): VehiclePosition | undefined {
  const day = serviceDate(leg.serviceDate);
  if (!leg.transit || !leg.tripId || !day || leg.realtimeState === 'CANCELED' || leg.realtimeState === 'CANCELLED') return undefined;
  const planned = tripParts(leg.tripId);
  const matches = vehicles.filter((vehicle) => {
    const age = now - vehicle.ts * 1000;
    if (!Number.isFinite(age) || age < -10_000 || age > MAX_POSITION_AGE_MS) return false;
    if (serviceDate(vehicle.oday) !== day || vehicle.mode !== MODE_NAMES[leg.mode]) return false;
    if (!Number.isFinite(vehicle.lat) || !Number.isFinite(vehicle.lng) ||
        Math.abs(vehicle.lat) > 90 || Math.abs(vehicle.lng) > 180) return false;
    if (leg.route?.gtfsId && leg.route.gtfsId.replace(/^HSL:/, '').trim() !== vehicle.route.replace(/^HSL:/, '').trim()) return false;
    if (leg.route?.gtfsId && (leg.directionId === 0 || leg.directionId === 1) &&
        Number.isInteger(leg.startTimeSeconds) && leg.startTimeSeconds! >= 0 &&
        vehicle.dir && vehicle.start) {
      return vehicle.dir === String(leg.directionId + 1) &&
        startSeconds(vehicle.start) === leg.startTimeSeconds;
    }
    if (vehicle.tripId === leg.tripId) return true;
    const live = tripParts(vehicle.tripId);
    return !!planned && !!live && planned.route === live.route &&
      planned.direction === live.direction && planned.start === live.start;
  });
  return matches.length === 1 ? matches[0] : undefined;
}

export function journeyVehicleModes(legs: JourneyLeg[] | undefined): { bus: boolean; metro: boolean; train: boolean; tram: boolean } {
  const modes = new Set(legs?.filter((leg) => leg.transit).map((leg) => leg.mode));
  return {
    bus: modes.has('BUS'),
    metro: modes.has('SUBWAY'),
    train: modes.has('RAIL'),
    tram: modes.has('TRAM'),
  };
}
