import { describe, expect, it } from 'vitest';
import type { Alert, JourneyItinerary, JourneyLeg } from '../types';
import { findRefreshedItinerary, helsinkiDateTime, itineraryIdentity, journeyLegStatus, mergeMonitoredLegs, monitoredLegIds, relevantJourneyAlerts, transferEstimates } from './journeyMonitor';

const start = Date.parse('2026-09-05T09:00:00Z');
const leg = (overrides: Partial<JourneyLeg> = {}): JourneyLeg => ({
  mode: 'TRAM', transit: true, duration: 600, distance: 2000,
  startTime: start, endTime: start + 600_000,
  legId: 'opaque-leg-1', tripId: 'HSL:trip-1', serviceDate: '2026-09-05',
  route: { gtfsId: 'HSL:1001', shortName: '1', longName: '', color: '', mode: 'TRAM' },
  from: { name: 'Origin', lat: 60, lon: 24, stopId: 'HSL:origin' },
  to: { name: 'Destination', lat: 60.1, lon: 24, stopId: 'HSL:destination' },
  intermediateStops: [], geometry: '', ...overrides,
});
const itinerary = (legs = [leg()]): JourneyItinerary => ({
  startTime: legs[0].startTime, endTime: legs.at(-1)!.endTime,
  duration: (legs.at(-1)!.endTime - legs[0].startTime) / 1000,
  walkDistance: 0, transfers: 0, legs,
});
const alert = (overrides: Partial<Alert> = {}): Alert => ({
  feed: 'HSL', severityLevel: 'WARNING', effect: '', cause: '',
  headerText: 'Disruption', descriptionText: '', url: '', startDate: 0, endDate: 0,
  entities: [{ type: 'Route', gtfsId: 'HSL:1001', shortName: '1' }], ...overrides,
});

describe('itinerary identity', () => {
  it('preserves the chosen trip through reordered alternatives and changed predictions', () => {
    const chosen = itinerary();
    const other = itinerary([leg({ tripId: 'HSL:other' })]);
    const refreshed = itinerary([leg({ startTime: start + 90_000, realtime: true })]);
    expect(findRefreshedItinerary(chosen, [other, refreshed])).toBe(refreshed);
    expect(itineraryIdentity(chosen)).toBe(itineraryIdentity(refreshed));
  });

  it('never substitutes another trip, service day or boarding stop', () => {
    const chosen = itinerary();
    const alternatives = [
      itinerary([leg({ tripId: 'HSL:other' })]),
      itinerary([leg({ serviceDate: '2026-09-06' })]),
      itinerary([leg({ from: { ...leg().from, stopId: 'HSL:elsewhere' } })]),
    ];
    expect(findRefreshedItinerary(chosen, alternatives)).toBeUndefined();
    expect(findRefreshedItinerary(chosen, [])).toBeUndefined();
    expect(journeyLegStatus(chosen.legs[0], true)).toBe('Stale');
  });

  it('requires reliable identity on every transit leg', () => {
    for (const incomplete of [
      leg({ tripId: undefined }), leg({ serviceDate: undefined }),
      leg({ to: { name: 'No ID', lat: 60, lon: 24 } }),
    ]) {
      const chosen = itinerary([incomplete]);
      expect(itineraryIdentity(chosen)).toBeUndefined();
      expect(findRefreshedItinerary(chosen, [chosen])).toBeUndefined();
    }
    expect(itineraryIdentity(itinerary([leg({ transit: false, mode: 'WALK' })]))).toBeUndefined();
  });

  it('does not identify a changed sequence of connections as the same journey', () => {
    const a = leg();
    const b = leg({ tripId: 'HSL:trip-2' });
    expect(itineraryIdentity(itinerary([a, b]))).not.toBe(itineraryIdentity(itinerary([b, a])));
  });
});

describe('stable leg monitoring', () => {
  it('requests only transit legs and respects the eight-ID limit', () => {
    const walk = leg({ transit: false, mode: 'WALK', legId: undefined });
    expect(monitoredLegIds(itinerary([walk, leg(), walk]))).toEqual(['opaque-leg-1']);
    expect(monitoredLegIds(itinerary([leg({ legId: undefined })]))).toBeUndefined();
    expect(monitoredLegIds(itinerary(Array.from({ length: 9 }, () => leg())))).toBeUndefined();
    expect(monitoredLegIds(itinerary([walk]))).toBeUndefined();
  });

  it('updates a departed selected trip directly and moves estimated egress after arrival', () => {
    const walk = leg({ transit: false, mode: 'WALK', duration: 120 });
    const selected = itinerary([leg(), walk]);
    const updated = leg({ realtime: true, endTime: start + 900_000 });
    const result = mergeMonitoredLegs(selected, [updated]);
    expect(result.missingLegIndexes).toEqual([]);
    expect(result.itinerary.legs[0]).toBe(updated);
    expect(result.itinerary.legs[1].startTime).toBe(updated.endTime);
    expect(result.itinerary.endTime).toBe(updated.endTime + 120_000);
    expect(result.itinerary.duration).toBe(1020);
  });

  it('retains null or mismatched legs, while updating other reliable legs', () => {
    const second = leg({ tripId: 'HSL:trip-2', legId: 'opaque-leg-2' });
    const selected = itinerary([leg(), second]);
    const updated = leg({ realtime: true, endTime: start + 720_000 });
    const partial = mergeMonitoredLegs(selected, [updated, null]);
    expect(partial.missingLegIndexes).toEqual([1]);
    expect(partial.itinerary.legs[0]).toBe(updated);
    expect(partial.itinerary.legs[1]).toBe(second);
    expect(journeyLegStatus(partial.itinerary.legs[1], true)).toBe('Stale');
    for (const mismatch of [
      leg({ legId: 'different-id' }),
      leg({ tripId: 'different-trip' }),
      leg({ serviceDate: '2026-09-06' }),
      leg({ from: { ...leg().from, stopId: 'different-stop' } }),
    ]) {
      const result = mergeMonitoredLegs(selected, [mismatch, second]);
      expect(result.missingLegIndexes).toEqual([0]);
      expect(result.itinerary.legs[0]).toBe(selected.legs[0]);
    }
  });

  it('preserves cancellation evidence but never infers it from absent data', () => {
    const selected = itinerary();
    const cancelled = mergeMonitoredLegs(selected, [leg({ realtimeState: 'CANCELED' })]);
    expect(cancelled.missingLegIndexes).toEqual([]);
    expect(journeyLegStatus(cancelled.itinerary.legs[0], false)).toBe('Cancelled');
    const absent = mergeMonitoredLegs(selected, []);
    expect(absent.missingLegIndexes).toEqual([0]);
    expect(journeyLegStatus(absent.itinerary.legs[0], false)).toBe('Scheduled');
  });
});

describe('transfer estimates', () => {
  it('subtracts walking time, rather than treating it as connection margin', () => {
    const journey = itinerary([
      leg(),
      leg({ transit: false, mode: 'WALK', duration: 180 }),
      leg({ transit: false, mode: 'WALK', duration: 60 }),
      leg({ tripId: 'HSL:next', startTime: start + 900_000 }),
    ]);
    expect(transferEstimates(journey)[0]).toMatchObject({ marginSeconds: 60, risk: 'tight', legIndex: 3 });
    expect(transferEstimates(journey)[0].message).toContain('Estimated');
  });

  it('warns that a connection may be missed and never promises a connection', () => {
    const estimates = transferEstimates(itinerary([
      leg(), leg({ transit: false, mode: 'WALK', duration: 240 }),
      leg({ startTime: start + 700_000 }),
    ]));
    expect(estimates[0].risk).toBe('missed');
    expect(estimates[0].message).toContain('may be missed');
    expect(transferEstimates(itinerary())).toEqual([]);
  });

  it('handles midnight using epoch times and marks larger margins as estimates', () => {
    const a = Date.parse('2026-09-05T20:59:00Z');
    const estimates = transferEstimates(itinerary([
      leg({ endTime: a }), leg({ startTime: a + 300_000 }),
    ]));
    expect(estimates[0]).toMatchObject({ risk: 'normal', marginSeconds: 300 });
    expect(estimates[0].message).toContain('Estimated 5 min');
  });
});

describe('contextual alerts', () => {
  it('uses GTFS route and stop IDs, never shared short route names', () => {
    const matchingRoute = alert();
    const wrongRoute = alert({ entities: [{ type: 'Route', gtfsId: 'OTHER:1', shortName: '1' }] });
    const matchingStop = alert({ entities: [{ type: 'Stop', gtfsId: 'HSL:destination' }] });
    const unrelated = alert({ entities: [{ type: 'Stop', gtfsId: 'HSL:elsewhere' }] });
    expect(relevantJourneyAlerts(itinerary(), [matchingRoute, wrongRoute, matchingStop, unrelated]))
      .toEqual([matchingRoute, matchingStop]);
  });

  it('filters alert validity against journey time, including future trips', () => {
    const active = alert({ startDate: start / 1000, endDate: start / 1000 + 600 });
    const expired = alert({ endDate: start / 1000 - 1 });
    const later = alert({ startDate: start / 1000 + 601 });
    const openEnded = alert();
    expect(relevantJourneyAlerts(itinerary(), [expired, active, later, openEnded])).toEqual([active, openEnded]);
  });

  it('includes intermediate stops and matches validity only for the affected leg', () => {
    const via = { name: 'Via', lat: 60, lon: 24, stopId: 'HSL:via' };
    expect(relevantJourneyAlerts(itinerary([leg({ intermediateStops: [via] })]),
      [alert({ entities: [{ type: 'Stop', gtfsId: via.stopId }] })])).toHaveLength(1);
    const journey = itinerary([leg(), leg({ route: undefined, startTime: start + 3600_000, endTime: start + 4200_000 })]);
    expect(relevantJourneyAlerts(journey, [alert({ startDate: start / 1000 + 1800 })])).toEqual([]);
  });
});

describe('prediction labels and Helsinki dates', () => {
  it('does not call schedules or stale results live', () => {
    expect(journeyLegStatus(leg(), false)).toBe('Scheduled');
    expect(journeyLegStatus(leg({ realtime: false }), false)).toBe('Scheduled');
    expect(journeyLegStatus(leg({ realtime: true }), false)).toBe('Live prediction');
    expect(journeyLegStatus(leg({ realtime: true }), true)).toBe('Stale');
    expect(journeyLegStatus(leg({ realtimeState: 'CANCELED' }), true)).toBe('Cancelled');
    expect(journeyLegStatus(leg({ realtimeState: 'CANCELLED' }), false)).toBe('Cancelled');
  });

  it('uses Helsinki rather than the browser timezone, including midnight', () => {
    expect(helsinkiDateTime(Date.parse('2026-09-05T21:10:00Z'))).toEqual({ date: '2026-09-06', time: '00:10' });
    expect(helsinkiDateTime(Date.parse('2026-01-05T21:10:00Z'))).toEqual({ date: '2026-01-05', time: '23:10' });
  });

  it('follows the spring DST jump and repeated autumn hour', () => {
    expect(helsinkiDateTime(Date.parse('2026-03-29T00:59:00Z')).time).toBe('02:59');
    expect(helsinkiDateTime(Date.parse('2026-03-29T01:00:00Z')).time).toBe('04:00');
    expect(helsinkiDateTime(Date.parse('2026-10-25T00:30:00Z')).time).toBe('03:30');
    expect(helsinkiDateTime(Date.parse('2026-10-25T01:30:00Z')).time).toBe('03:30');
  });
});
