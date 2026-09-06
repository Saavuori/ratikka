import { describe, expect, it } from 'vitest';
import type { JourneyLeg, VehiclePosition } from '../types';
import { findJourneyVehicle, journeyVehicleModes } from './journeyVehicles';

const now = Date.parse('2026-09-06T00:15:00+03:00');
const leg: JourneyLeg = {
  mode: 'BUS', transit: true, duration: 600, distance: 1000,
  startTime: now, endTime: now + 600_000, intermediateStops: [], geometry: '',
  from: { name: 'A', lat: 60.1, lon: 24.9 }, to: { name: 'B', lat: 60.2, lon: 24.9 },
  tripId: 'HSL:1055_20260831_La_1_2350', serviceDate: '2026-09-05',
  route: { gtfsId: 'HSL:1055', shortName: '55', longName: '', color: '', mode: 'BUS' },
};
const vehicle: VehiclePosition = {
  veh: '12-34', desi: '55', lat: 60.1, lng: 24.9, hdg: 0, spd: 5, dl: 0, drst: 0,
  route: '1055', stop: null, ts: now / 1000, mode: 'bus',
  tripId: 'HSL:1055_20260905_Sa_1_2350', oday: '2026-09-05',
};

describe('findJourneyVehicle', () => {
  it('matches the operating day independently of the timetable version and wall-clock date', () => {
    expect(findJourneyVehicle(leg, [vehicle], now)).toBe(vehicle);
  });
  it('supports zero seconds without collapsing different departures', () => {
    expect(findJourneyVehicle({ ...leg, tripId: `${leg.tripId}00` }, [vehicle], now)).toBe(vehicle);
    expect(findJourneyVehicle({ ...leg, tripId: `${leg.tripId}30` }, [vehicle], now)).toBeUndefined();
  });
  it.each([
    { oday: '2026-09-06' }, { oday: undefined }, { mode: 'tram' },
    { route: '2055' }, { tripId: 'HSL:1055_20260905_Sa_2_2350' },
    { tripId: 'HSL:1055_20260905_Sa_1_2355' }, { ts: now / 1000 - 46 },
    { ts: now / 1000 + 11 }, { ts: NaN }, { lat: NaN },
  ])('rejects misleading or stale vehicles: %j', (change) => {
    expect(findJourneyVehicle(leg, [{ ...vehicle, ...change }], now)).toBeUndefined();
  });
  it('rejects cancelled, undated and ambiguous legs', () => {
    expect(findJourneyVehicle({ ...leg, serviceDate: undefined }, [vehicle], now)).toBeUndefined();
    expect(findJourneyVehicle({ ...leg, realtimeState: 'CANCELED' }, [vehicle], now)).toBeUndefined();
    expect(findJourneyVehicle(leg, [vehicle, { ...vehicle, veh: '12-35' }], now)).toBeUndefined();
  });
  it('allows an exact opaque ID only with a matching operating day', () => {
    expect(findJourneyVehicle({ ...leg, tripId: 'opaque' }, [{ ...vehicle, tripId: 'opaque' }], now)?.veh).toBe(vehicle.veh);
    expect(findJourneyVehicle({ ...leg, tripId: 'opaque' }, [vehicle], now)).toBeUndefined();
  });
  it('matches opaque OTP IDs using documented route, direction and origin departure', () => {
    const planned = { ...leg, tripId: 'opaque', directionId: 0, startTimeSeconds: 85_800 };
    const live = { ...vehicle, dir: '1', start: '23:50' };
    expect(findJourneyVehicle(planned, [live], now)).toBe(live);
    expect(findJourneyVehicle(planned, [{ ...live, dir: '2' }], now)).toBeUndefined();
    expect(findJourneyVehicle(planned, [{ ...live, start: '23:51' }], now)).toBeUndefined();
    expect(findJourneyVehicle(planned, [{ ...live, start: '23:50:30' }], now)).toBeUndefined();
    expect(findJourneyVehicle({ ...planned, startTimeSeconds: 0 }, [{ ...live, start: '00:00' }], now)?.veh).toBe(live.veh);
  });
  it('does not wrap GTFS departures beyond 24 hours to the next service day', () => {
    const planned = { ...leg, tripId: 'opaque', directionId: 0, startTimeSeconds: 90_000 };
    expect(findJourneyVehicle(planned, [{ ...vehicle, dir: '1', start: '25:00' }], now)?.veh).toBe(vehicle.veh);
    expect(findJourneyVehicle(planned, [{ ...vehicle, dir: '1', start: '01:00' }], now)).toBeUndefined();
  });
});

describe('journeyVehicleModes', () => {
  it('requests only the modes needed by transit legs', () => {
    expect(journeyVehicleModes([leg])).toEqual({ bus: true, metro: false, train: false, tram: false });
    expect(journeyVehicleModes([{ ...leg, transit: false }])).toEqual(journeyVehicleModes(undefined));
  });
});
