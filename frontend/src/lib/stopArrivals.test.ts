import { describe, expect, it } from 'vitest';
import type { StopDepartureInfo, VehiclePosition } from '../types';
import {
  arrivalVehicleModes, departureIdentity, focusedArrival, nextArrivals,
  walkVerdict, walkVerdictLabel,
} from './stopArrivals';

const now = Date.parse('2026-09-06T12:00:00+03:00');

function departure(overrides: Partial<StopDepartureInfo> = {}): StopDepartureInfo {
  return {
    line: '9', headsign: 'Pasila', scheduledArrival: '12:05', realtimeArrival: '12:05',
    delay: 0, realtime: true, tripId: 'HSL:1009_20260906_Su_1_1150',
    scheduledDepartureTime: now + 300_000, realtimeDepartureTime: now + 300_000,
    routeId: 'HSL:1009', serviceDate: '2026-09-06', directionId: 0,
    startTimeSeconds: 42_600, mode: 'TRAM',
    ...overrides,
  };
}

function vehicle(overrides: Partial<VehiclePosition> = {}): VehiclePosition {
  return {
    veh: '9-101', desi: '9', lat: 60.17, lng: 24.94, hdg: 90, spd: 6, dl: 0, drst: 0,
    route: '1009', stop: null, ts: now / 1000, mode: 'tram',
    tripId: 'HSL:1009_20260906_Su_1_1150', oday: '2026-09-06',
    dir: '1', start: '11:50',
    ...overrides,
  };
}

describe('departureIdentity', () => {
  it('carries the trip identity through without inventing missing parts', () => {
    expect(departureIdentity(departure())).toEqual({
      tripId: 'HSL:1009_20260906_Su_1_1150', serviceDate: '2026-09-06', routeId: 'HSL:1009',
      directionId: 0, startTimeSeconds: 42_600, mode: 'TRAM', cancelled: false,
    });
    const sparse = departureIdentity(departure({
      routeId: undefined, serviceDate: undefined, directionId: undefined,
      startTimeSeconds: undefined, mode: undefined, realtimeState: 'CANCELED',
    }));
    expect(sparse).toMatchObject({ routeId: undefined, directionId: undefined, cancelled: true });
  });
});

describe('nextArrivals', () => {
  it('pairs a departure with the live vehicle serving it', () => {
    const live = vehicle();
    const [arrival] = nextArrivals([departure()], [live], now);
    expect(arrival.vehicle).toBe(live);
    expect(arrival.confidence).toBe('live-tracked');
    expect(arrival.etaMs).toBe(300_000);
  });

  it('still reports an arrival with no locatable vehicle', () => {
    const [arrival] = nextArrivals([departure()], [], now);
    expect(arrival.vehicle).toBeUndefined();
    expect(arrival.confidence).toBe('live-predicted');
    expect(nextArrivals([departure({ realtime: false })], [], now)[0].confidence).toBe('scheduled');
  });

  it('never guesses a vehicle from the line number alone', () => {
    // Same line and mode, different trip: not this departure's vehicle.
    const other = vehicle({ veh: '9-102', tripId: 'HSL:1009_20260906_Su_1_1210', dir: '1', start: '12:10' });
    expect(nextArrivals([departure()], [other], now)[0].vehicle).toBeUndefined();
  });

  it('drops an ambiguous match rather than picking one', () => {
    const arrivals = nextArrivals([departure()], [vehicle(), vehicle({ veh: '9-102' })], now);
    expect(arrivals[0].vehicle).toBeUndefined();
  });

  it('sorts soonest first and drops cancelled and departed rows', () => {
    const soon = departure({ tripId: 'a', scheduledDepartureTime: now + 60_000, realtimeDepartureTime: now + 60_000 });
    const later = departure({ tripId: 'b', scheduledDepartureTime: now + 600_000, realtimeDepartureTime: now + 600_000 });
    const cancelled = departure({ tripId: 'c', realtimeState: 'CANCELED' });
    const gone = departure({ tripId: 'd', scheduledDepartureTime: now - 90_000, realtimeDepartureTime: now - 90_000 });
    const undated = departure({ tripId: 'e', scheduledDepartureTime: undefined, realtimeDepartureTime: undefined });
    const arrivals = nextArrivals([later, cancelled, gone, undated, soon], [], now);
    expect(arrivals.map((arrival) => arrival.departure.tripId)).toEqual(['a', 'b']);
  });

  it('keeps a departure that is due but not yet a minute gone', () => {
    const due = departure({ scheduledDepartureTime: now - 30_000, realtimeDepartureTime: now - 30_000 });
    expect(nextArrivals([due], [], now)).toHaveLength(1);
  });

  it('filters by line and honours the limit', () => {
    const nine = departure({ tripId: 'a' });
    const seven = departure({ tripId: 'b', line: '7', scheduledDepartureTime: now + 60_000, realtimeDepartureTime: now + 60_000 });
    expect(nextArrivals([nine, seven], [], now, { lines: ['9'] }).map((a) => a.departure.tripId)).toEqual(['a']);
    expect(nextArrivals([nine, seven], [], now, { limit: 1 }).map((a) => a.departure.tripId)).toEqual(['b']);
    expect(nextArrivals([nine, seven], [], now, { lines: [] })).toHaveLength(2);
  });
});

describe('focusedArrival', () => {
  const arrivals = nextArrivals([
    departure({ tripId: 'a' }),
    departure({ tripId: 'b', scheduledDepartureTime: now + 600_000, realtimeDepartureTime: now + 600_000 }),
  ], [], now);

  it('defaults to the soonest arrival', () => {
    expect(focusedArrival(arrivals)?.departure.tripId).toBe('a');
  });
  it('honours a pinned trip while it is still listed', () => {
    expect(focusedArrival(arrivals, 'b')?.departure.tripId).toBe('b');
  });
  it('falls back to the soonest once the pinned trip has gone', () => {
    expect(focusedArrival(arrivals, 'vanished')?.departure.tripId).toBe('a');
    expect(focusedArrival([], 'a')).toBeUndefined();
  });
});

describe('arrivalVehicleModes', () => {
  it('maps OTP modes to the stream’s mode switches', () => {
    expect(arrivalVehicleModes([
      departure({ mode: 'TRAM' }), departure({ mode: 'SUBWAY' }), departure({ mode: 'RAIL' }),
    ])).toEqual({ bus: false, metro: true, train: true, tram: true });
    expect(arrivalVehicleModes(undefined)).toEqual({ bus: false, metro: false, train: false, tram: false });
    expect(arrivalVehicleModes([departure({ mode: undefined })]))
      .toEqual({ bus: false, metro: false, train: false, tram: false });
  });
});

describe('walkVerdict', () => {
  // 1.3 m/s: 130 m is 100 s of walking.
  it('grades the walk against the countdown', () => {
    expect(walkVerdict(130, 600_000)?.outcome).toBe('comfortable');
    expect(walkVerdict(130, 250_000)?.outcome).toBe('brisk');
    expect(walkVerdict(130, 150_000)?.outcome).toBe('run');
    expect(walkVerdict(130, 60_000)?.outcome).toBe('missed');
  });

  it('reports the walking time and the spare time', () => {
    const verdict = walkVerdict(130, 300_000)!;
    expect(Math.round(verdict.walkMs)).toBe(100_000);
    expect(Math.round(verdict.spareMs)).toBe(200_000);
  });

  it('honours a custom pace', () => {
    expect(Math.round(walkVerdict(130, 300_000, { paceMps: 2.6 })!.walkMs)).toBe(50_000);
  });

  it('refuses to guess without usable inputs', () => {
    expect(walkVerdict(undefined, 300_000)).toBeUndefined();
    expect(walkVerdict(NaN, 300_000)).toBeUndefined();
    expect(walkVerdict(-5, 300_000)).toBeUndefined();
    expect(walkVerdict(130, undefined)).toBeUndefined();
    expect(walkVerdict(130, NaN)).toBeUndefined();
    expect(walkVerdict(130, 300_000, { paceMps: 0 })).toBeUndefined();
  });
});

describe('walkVerdictLabel', () => {
  it('says how much slack is left, or how much is missing', () => {
    expect(walkVerdictLabel(walkVerdict(130, 600_000)!)).toBe('Easy walk · 8 min spare');
    expect(walkVerdictLabel(walkVerdict(130, 150_000)!)).toBe('Run for it · 1 min spare');
    expect(walkVerdictLabel(walkVerdict(1300, 300_000)!)).toBe('Too late · 12 min short');
  });
});
