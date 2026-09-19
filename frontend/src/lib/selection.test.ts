import { describe, expect, it } from 'vitest';
import { NO_MODES } from './modes';
import { selectionKey, stopSelection, tripSelection } from './selection';
import type { VehiclePosition } from '../types';

const vehicle = (veh: string, tripId: string): VehiclePosition => ({
  veh,
  desi: '4',
  lat: 60.17,
  lng: 24.94,
  hdg: 0,
  spd: 0,
  dl: 0,
  drst: 0,
  route: 'HSL:1004',
  stop: null,
  ts: 0,
  tripId,
  mode: 'tram',
});

describe('tripSelection', () => {
  it('selects the running vehicle when the trip is already in the feed', () => {
    const running = vehicle('40', 'HSL:1004_20260919_Ti_2_1205');
    expect(tripSelection('HSL:1004_20260919_Ti_2_1205', '4', [running])).toEqual({
      kind: 'vehicle',
      vehicle: running,
    });
  });

  it('matches a vehicle whose trip id differs only in the service day', () => {
    const running = vehicle('40', 'HSL:1004_20260919_Ti_2_1205');
    const picked = tripSelection('HSL:1004_20260920_Ti_2_1205', '4', [running]);
    expect(picked.kind).toBe('vehicle');
  });

  it('holds a placeholder for a trip whose vehicle has not appeared yet', () => {
    const picked = tripSelection('HSL:1004_20260919_Ti_2_1205', '4', []);
    expect(picked.kind).toBe('scheduledTrip');
    if (picked.kind !== 'scheduledTrip') return;
    expect(picked.placeholder.tripId).toBe('HSL:1004_20260919_Ti_2_1205');
    expect(picked.placeholder.desi).toBe('4');
  });

  it('labels a placeholder with no line as unknown', () => {
    const picked = tripSelection('HSL:1004_20260919_Ti_2_1205', '', []);
    if (picked.kind !== 'scheduledTrip') throw new Error('expected a placeholder');
    expect(picked.placeholder.desi).toBe('?');
  });
});

describe('stopSelection', () => {
  it('opens a stop with nothing yet reported about it', () => {
    expect(stopSelection({ id: 'HSL:1020201', name: 'Kolmikulma', code: 'H0201' })).toEqual({
      kind: 'stop',
      stop: { id: 'HSL:1020201', name: 'Kolmikulma', code: 'H0201' },
      routes: [],
      modes: NO_MODES,
      arrivalFocus: null,
    });
  });
});

describe('selectionKey', () => {
  it('is null with nothing selected', () => {
    expect(selectionKey(null)).toBeNull();
  });

  it('stays put while an open stop is updated', () => {
    const opened = stopSelection({ id: 'HSL:1020201', name: 'Kolmikulma', code: 'H0201' });
    const reported = { ...opened, routes: ['4', '10'] };
    expect(selectionKey(reported)).toBe(selectionKey(opened));
  });

  it('tells apart different kinds that share an id', () => {
    expect(selectionKey({ kind: 'bikeStation', station: { id: '7', name: 'Kamppi' } }))
      .not.toBe(selectionKey({ kind: 'junction', junctionId: 7 }));
  });
});
