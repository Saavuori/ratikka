import { describe, expect, it } from 'vitest';
import { nextSeenStop } from './useLastSeenStop';

describe('nextSeenStop', () => {
  const seen = { tripId: 'T1', stopId: 'HSL:1' };

  it('keeps the last stop while the vehicle is between stops', () => {
    expect(nextSeenStop(seen, { tripId: 'T1', stop: null })).toBe(seen);
  });

  it('keeps the same object when the same stop is reported again', () => {
    expect(nextSeenStop(seen, { tripId: 'T1', stop: 'HSL:1' })).toBe(seen);
  });

  it('moves on to a newly reported stop', () => {
    expect(nextSeenStop(seen, { tripId: 'T1', stop: 'HSL:2' })).toEqual({ tripId: 'T1', stopId: 'HSL:2' });
  });

  it('forgets the last trip’s stop when a new trip starts between stops', () => {
    expect(nextSeenStop(seen, { tripId: 'T2', stop: null })).toEqual({ tripId: 'T2', stopId: null });
  });

  it('takes the stop a new trip starts at', () => {
    expect(nextSeenStop(seen, { tripId: 'T2', stop: 'HSL:9' })).toEqual({ tripId: 'T2', stopId: 'HSL:9' });
  });
});
