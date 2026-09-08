import { describe, expect, it } from 'vitest';
import type { JourneyItinerary, JourneyLeg, VehiclePosition } from '../types';
import { activeLegIndex, alightAlert, alightNotification, isAlertingPhase, legStops } from './alightAlert';

const NOW = Date.parse('2026-09-06T12:00:00+03:00');

/** Four stops of a tram leg: board at the first, get off at the last. */
const STOPS = [
  { name: 'Kolmikulma', lat: 60.164, lon: 24.943, stopId: 'HSL:1020450' },
  { name: 'Ylioppilastalo', lat: 60.168, lon: 24.941, stopId: 'HSL:1010425' },
  { name: 'Kansallismuseo', lat: 60.175, lon: 24.930, stopId: 'HSL:1121404' },
  { name: 'Töölön halli', lat: 60.181, lon: 24.921, stopId: 'HSL:1122400' },
];

function leg(overrides: Partial<JourneyLeg> = {}): JourneyLeg {
  return {
    mode: 'TRAM', transit: true, duration: 600, distance: 2000,
    startTime: NOW - 120_000, endTime: NOW + 480_000,
    from: STOPS[0], to: STOPS[3], intermediateStops: [STOPS[1], STOPS[2]],
    geometry: '', tripId: 'HSL:1009_20260906_Su_1_1150', serviceDate: '2026-09-06',
    route: { gtfsId: 'HSL:1009', shortName: '9', longName: '', color: '', mode: 'TRAM' },
    ...overrides,
  };
}

function itinerary(...legs: JourneyLeg[]): JourneyItinerary {
  return {
    duration: 900, walkDistance: 200, transfers: legs.filter((l) => l.transit).length - 1,
    startTime: legs[0].startTime, endTime: legs.at(-1)!.endTime, legs,
  };
}

function walk(startTime: number, endTime: number): JourneyLeg {
  return {
    mode: 'WALK', transit: false, duration: (endTime - startTime) / 1000, distance: 200,
    startTime, endTime, from: STOPS[3], to: { name: 'Home', lat: 60.19, lon: 24.92 },
    intermediateStops: [], geometry: '',
  };
}

function vehicle(overrides: Partial<VehiclePosition> = {}): VehiclePosition {
  return {
    veh: '40-456', desi: '9', lat: 60.17, lng: 24.94, hdg: 0, spd: 8, dl: 0, drst: 0,
    route: '1009', stop: null, nextStop: 'HSL:1010425', ts: NOW / 1000, mode: 'tram',
    tripId: 'HSL:1009_20260906_Su_1_1150', oday: '2026-09-06',
    ...overrides,
  };
}

describe('legStops', () => {
  it('runs from the boarding stop to the alighting stop', () => {
    expect(legStops(leg()).map((stop) => stop.name)).toEqual(
      ['Kolmikulma', 'Ylioppilastalo', 'Kansallismuseo', 'Töölön halli']);
  });
});

describe('activeLegIndex', () => {
  it('picks the leg that is running by the clock', () => {
    const plan = itinerary(leg(), walk(NOW + 480_000, NOW + 600_000));
    expect(activeLegIndex(plan, [], NOW)).toBe(0);
  });

  it('arms just before the leg departs, so boarding need not be timed', () => {
    const plan = itinerary(leg({ startTime: NOW + 20_000, endTime: NOW + 600_000 }));
    expect(activeLegIndex(plan, [], NOW)).toBe(0);
  });

  it('lets go of a leg a couple of minutes after it has arrived', () => {
    const plan = itinerary(leg({ startTime: NOW - 600_000, endTime: NOW - 180_000 }));
    expect(activeLegIndex(plan, [], NOW)).toBeNull();
  });

  it('never treats a walking leg as one to get off', () => {
    expect(activeLegIndex(itinerary(walk(NOW - 60_000, NOW + 60_000)), [], NOW)).toBeNull();
  });

  it('a detected ride settles which leg is being ridden, whatever the clock says', () => {
    // The clock would pick the second leg; the reader is demonstrably on the first.
    const first = leg({ startTime: NOW - 900_000, endTime: NOW - 180_000 });
    const second = leg({
      startTime: NOW - 60_000, endTime: NOW + 600_000,
      tripId: 'HSL:1007_20260906_Su_1_1150',
      route: { gtfsId: 'HSL:1007', shortName: '7', longName: '', color: '', mode: 'TRAM' },
    });
    const plan = itinerary(first, second);
    expect(activeLegIndex(plan, [vehicle()], NOW)).toBe(1);
    expect(activeLegIndex(plan, [vehicle()], NOW, '40-456')).toBe(0);
  });
});

describe('alightAlert', () => {
  it('says nothing when no leg of the journey is being ridden', () => {
    const plan = itinerary(leg({ startTime: NOW + 3_600_000, endTime: NOW + 4_000_000 }));
    expect(alightAlert(plan, [], NOW)).toBeNull();
  });

  it('counts the stops off the vehicle\'s own reported next stop', () => {
    const alert = alightAlert(itinerary(leg()), [vehicle({ nextStop: 'HSL:1010425' })], NOW)!;
    expect(alert.source).toBe('vehicle');
    expect(alert.stopsAway).toBe(2);
    expect(alert.phase).toBe('prepare');
    expect(alert.message).toBe('2 stops to Töölön halli');
  });

  it('stays quiet while the stop is still several away', () => {
    const long = leg({ intermediateStops: [STOPS[1], STOPS[2], STOPS[1], STOPS[2]] });
    const alert = alightAlert(itinerary(long), [vehicle({ nextStop: 'HSL:1010425' })], NOW)!;
    expect(alert.phase).toBe('riding');
    expect(isAlertingPhase(alert.phase)).toBe(false);
  });

  it('calls the stop next when the vehicle is running to it', () => {
    const alert = alightAlert(itinerary(leg()), [vehicle({ nextStop: 'HSL:1122400' })], NOW)!;
    expect(alert.phase).toBe('next');
    expect(alert.stopsAway).toBe(0);
    expect(alert.message).toBe('Your stop is next — Töölön halli');
  });

  it('says get off here once the doors are open at the stop', () => {
    const alert = alightAlert(itinerary(leg()),
      [vehicle({ stop: 'HSL:1122400', nextStop: 'HSL:1122400', drst: 1 })], NOW)!;
    expect(alert.phase).toBe('now');
    expect(alert.message).toBe('Get off here — Töölön halli');
  });

  it('reports a stop the vehicle has left behind rather than counting down to it', () => {
    // Get off at Ylioppilastalo; the tram is already running to Kansallismuseo,
    // two stops beyond it, at the moment it was due to arrive.
    const short = leg({ to: STOPS[1], intermediateStops: [], endTime: NOW });
    const passed = alightAlert(itinerary(short), [vehicle({ nextStop: 'HSL:1121404' })], NOW)!;
    expect(passed.phase).toBe('passed');
    expect(passed.message).toBe('You have passed Ylioppilastalo');
    expect(isAlertingPhase(passed.phase)).toBe(false);
  });

  it('does not call a stop passed while the vehicle is still minutes short of it', () => {
    // Mid-leg the vehicle can name a stop the leg does not list; that is not
    // evidence of an overshoot, so the prediction answers instead.
    const early = leg({ to: STOPS[1], intermediateStops: [], endTime: NOW + 400_000 });
    const alert = alightAlert(itinerary(early), [vehicle({ nextStop: 'HSL:9999999' })], NOW)!;
    expect(alert.source).toBe('timetable');
    expect(alert.phase).toBe('riding');
  });

  it('falls back to the prediction when no vehicle can be matched, and says so', () => {
    const alert = alightAlert(itinerary(leg({ endTime: NOW + 60_000 })), [], NOW)!;
    expect(alert.source).toBe('timetable');
    expect(alert.stopsAway).toBeNull();
    expect(alert.phase).toBe('next');
    expect(alert.secondsAway).toBe(60);
  });

  it('paces the clock fallback: minutes out, then get ready, then next', () => {
    const at = (secondsOut: number) =>
      alightAlert(itinerary(leg({ endTime: NOW + secondsOut * 1000 })), [], NOW)!.phase;
    expect(at(600)).toBe('riding');
    expect(at(240)).toBe('prepare');
    expect(at(60)).toBe('next');
    expect(at(-30)).toBe('next');
    expect(at(-90)).toBe('passed');
    // A couple of minutes past arrival the leg is behind the reader, and the
    // journey has nothing left to say about getting off it.
    expect(alightAlert(itinerary(leg({ endTime: NOW - 180_000 })), [], NOW)).toBeNull();
  });

  it('does not let an ambiguous vehicle match stand in for the prediction', () => {
    const twins = [vehicle(), vehicle({ veh: '40-457' })];
    expect(alightAlert(itinerary(leg()), twins, NOW)!.source).toBe('timetable');
  });
});

describe('alightNotification', () => {
  it('names the stop first, because that is what is read on a lock screen', () => {
    const alert = alightAlert(itinerary(leg()), [vehicle({ nextStop: 'HSL:1122400' })], NOW)!;
    expect(alightNotification(alert)).toEqual({
      title: 'Next stop is yours — Töölön halli',
      body: 'Line 9 is running to your stop.',
    });
  });

  it('gives the prediction its own words when no vehicle was matched', () => {
    const alert = alightAlert(itinerary(leg({ endTime: NOW + 60_000, mode: 'BUS' })), [], NOW)!;
    expect(alightNotification(alert).body).toBe('Line 9 arrives in about 1 min.');
  });

  it('is unambiguous at the door', () => {
    const alert = alightAlert(itinerary(leg()),
      [vehicle({ stop: 'HSL:1122400', nextStop: 'HSL:1122400', drst: 1 })], NOW)!;
    expect(alightNotification(alert).title).toBe('Get off now — Töölön halli');
  });
});
