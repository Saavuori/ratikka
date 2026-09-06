import { describe, expect, it } from 'vitest';
import type { StopArrival, VehiclePosition } from '../types';
import { isApproaching, isBoardingAt, tripProgress } from './nextStop';

/**
 * Four stops of route 9, in the order the trip runs them. The times are the
 * ones the timetable fallback reads, so they climb by two minutes a stop.
 */
const STOPS: StopArrival[] = [
  { gtfsId: 'HSL:1020450', name: 'Kolmikulma', code: '0301', lat: 60.164, lon: 24.943, scheduledArrival: '12:00', realtimeArrival: '12:00', delay: 0, realtime: true },
  { gtfsId: 'HSL:1010425', name: 'Ylioppilastalo', code: '0302', lat: 60.168, lon: 24.941, scheduledArrival: '12:02', realtimeArrival: '12:02', delay: 0, realtime: true },
  { gtfsId: 'HSL:1121404', name: 'Kansallismuseo', code: '0303', lat: 60.175, lon: 24.930, scheduledArrival: '12:04', realtimeArrival: '12:04', delay: 0, realtime: true },
  { gtfsId: 'HSL:1122400', name: 'Töölön halli', code: '0304', lat: 60.181, lon: 24.921, scheduledArrival: '12:06', realtimeArrival: '12:06', delay: 0, realtime: true },
];

function vehicle(overrides: Partial<VehiclePosition> = {}): VehiclePosition {
  return {
    veh: '40-456', desi: '9', lat: 60.17, lng: 24.94, hdg: 90, spd: 6, dl: 0, drst: 0,
    route: '1009', stop: null, nextStop: null, ts: 1788706622, mode: 'tram',
    tripId: 'HSL:1009_20260906_Su_1_1150',
    ...overrides,
  };
}

describe('tripProgress', () => {
  it('reads the next stop the vehicle reports, mid-run between two stops', () => {
    // The case that used to go wrong: `stop` is null for the whole run, and
    // the old code answered with the stop already behind the vehicle.
    const progress = tripProgress(
      vehicle({ stop: null, nextStop: 'HSL:1121404' }),
      STOPS,
      { lastSeenStopId: 'HSL:1010425' },
    );
    expect(progress).toEqual({
      currentStopIndex: -1, nextStopIndex: 2, lastKnownIndex: 1, source: 'reported',
    });
  });

  it('answers before the vehicle has been seen at any stop at all', () => {
    // No stop reported yet and nothing remembered: the old code fell through
    // to the timetable and could name any stop, or none.
    const progress = tripProgress(vehicle({ nextStop: 'HSL:1020450' }), STOPS);
    expect(progress.nextStopIndex).toBe(0);
    expect(progress.source).toBe('reported');
  });

  it('matches stop ids whether or not they carry the HSL prefix', () => {
    expect(tripProgress(vehicle({ nextStop: '1121404' }), STOPS).nextStopIndex).toBe(2);
  });

  it('keeps naming the stop it is standing at until it pulls away', () => {
    // Doors open at a stop: that stop is where it is, and also still the one
    // it is "running to" as far as the feed is concerned.
    const progress = tripProgress(
      vehicle({ stop: 'HSL:1010425', nextStop: 'HSL:1010425', drst: 1 }),
      STOPS,
    );
    expect(progress).toEqual({
      currentStopIndex: 1, nextStopIndex: 1, lastKnownIndex: 1, source: 'reported',
    });
  });

  it('does not call a vehicle stopped short of a stop "at" it', () => {
    // Alongside the platform with the doors shut — waiting at a light, say.
    const progress = tripProgress(
      vehicle({ stop: 'HSL:1010425', nextStop: 'HSL:1010425', drst: 0, spd: 0 }),
      STOPS,
    );
    expect(progress.currentStopIndex).toBe(-1);
    expect(progress.nextStopIndex).toBe(1);
  });

  it('falls back to the stop it was last seen at when no next stop is reported', () => {
    const progress = tripProgress(
      vehicle({ stop: null, nextStop: undefined }),
      STOPS,
      { lastSeenStopId: 'HSL:1010425' },
    );
    expect(progress).toEqual({
      currentStopIndex: -1, nextStopIndex: 2, lastKnownIndex: 1, source: 'at-stop',
    });
  });

  it('falls back to the timetable when nothing about the vehicle matches the trip', () => {
    const progress = tripProgress(
      vehicle({ stop: null, nextStop: 'HSL:9999999' }),
      STOPS,
      { now: new Date('2026-09-06T12:03:00+03:00') },
    );
    expect(progress).toEqual({
      currentStopIndex: -1, nextStopIndex: 2, lastKnownIndex: 1, source: 'timetable',
    });
  });

  it('does not read a trip running past midnight as long finished', () => {
    const lateStops: StopArrival[] = STOPS.map((stop, i) => ({
      ...stop, realtimeArrival: `00:0${i * 2}`,
    }));
    const progress = tripProgress(
      vehicle({ nextStop: 'HSL:9999999' }),
      lateStops,
      { now: new Date('2026-09-06T23:57:00+03:00') },
    );
    expect(progress.nextStopIndex).toBe(0);
  });

  it('reports the end of the line as an answer, not a failure', () => {
    const progress = tripProgress(
      vehicle({ stop: 'HSL:1122400', nextStop: null, eol: true, drst: 1 }),
      STOPS,
    );
    expect(progress).toEqual({
      currentStopIndex: 3, nextStopIndex: -1, lastKnownIndex: 3, source: 'end-of-line',
    });
  });

  it('has nothing to say without a trip to say it about', () => {
    expect(tripProgress(vehicle({ nextStop: 'HSL:1121404' }), undefined).source).toBe('unknown');
    expect(tripProgress(vehicle({ nextStop: 'HSL:1121404' }), []).nextStopIndex).toBe(-1);
  });
});

describe('isBoardingAt', () => {
  it('is true only with the doors open at this very stop', () => {
    expect(isBoardingAt(vehicle({ stop: 'HSL:1010425', drst: 1 }), 'HSL:1010425')).toBe(true);
    expect(isBoardingAt(vehicle({ stop: '1010425', drst: 1 }), 'HSL:1010425')).toBe(true);
    expect(isBoardingAt(vehicle({ stop: 'HSL:1010425', drst: 0 }), 'HSL:1010425')).toBe(false);
    expect(isBoardingAt(vehicle({ stop: 'HSL:1121404', drst: 1 }), 'HSL:1010425')).toBe(false);
    expect(isBoardingAt(vehicle({ stop: null, drst: 1 }), 'HSL:1010425')).toBe(false);
  });
});

describe('isApproaching', () => {
  it('is true while the vehicle is running to this stop and has not arrived', () => {
    expect(isApproaching(vehicle({ nextStop: 'HSL:1010425' }), 'HSL:1010425')).toBe(true);
    expect(isApproaching(vehicle({ nextStop: '1010425' }), 'HSL:1010425')).toBe(true);
  });

  it('is false once the vehicle is standing at the stop', () => {
    const arrived = vehicle({ stop: 'HSL:1010425', nextStop: 'HSL:1010425' });
    expect(isApproaching(arrived, 'HSL:1010425')).toBe(false);
  });

  it('is false when it is heading somewhere else, or nowhere stated', () => {
    expect(isApproaching(vehicle({ nextStop: 'HSL:1121404' }), 'HSL:1010425')).toBe(false);
    expect(isApproaching(vehicle({ nextStop: null }), 'HSL:1010425')).toBe(false);
    expect(isApproaching(vehicle({ nextStop: 'HSL:1010425' }), undefined)).toBe(false);
  });
});
