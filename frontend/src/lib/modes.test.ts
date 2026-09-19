import { describe, expect, it } from 'vitest';
import {
  ALL_MODES,
  NO_MODES,
  OPTIONAL_MODES,
  TRANSPORT_MODES,
  anyMode,
  asTransportMode,
  modeFlags,
  modesPresent,
  withMode,
} from './modes';

describe('the mode set', () => {
  it('covers every mode, with trams the one that always streams', () => {
    expect(TRANSPORT_MODES).toEqual(['tram', 'bus', 'metro', 'train', 'ferry']);
    expect(OPTIONAL_MODES).not.toContain('tram');
    expect([...OPTIONAL_MODES, 'tram' as const].sort()).toEqual([...TRANSPORT_MODES].sort());
  });

  it('builds a set from a predicate', () => {
    expect(modeFlags((mode) => mode === 'tram')).toEqual({ ...NO_MODES, tram: true });
  });
});

describe('anyMode', () => {
  it('unions the sets: a mode any layer wants is in', () => {
    const reader = { ...NO_MODES, tram: true };
    const journey = { ...NO_MODES, bus: true };
    const stop = { ...NO_MODES, bus: true, ferry: true };

    expect(anyMode(reader, journey, stop)).toEqual({
      tram: true,
      bus: true,
      metro: false,
      train: false,
      ferry: true,
    });
  });

  it('is unchanged by an empty set and saturated by a full one', () => {
    const some = { ...NO_MODES, metro: true };
    expect(anyMode(some, NO_MODES)).toEqual(some);
    expect(anyMode(some, ALL_MODES)).toEqual(ALL_MODES);
  });
});

describe('withMode', () => {
  it('flips one mode and leaves the rest', () => {
    expect(withMode(ALL_MODES, 'bus', false)).toEqual({ ...ALL_MODES, bus: false });
    expect(withMode(NO_MODES, 'ferry', true)).toEqual({ ...NO_MODES, ferry: true });
  });
});

describe('modesPresent', () => {
  it('reads the GTFS spellings the feed and the API use', () => {
    expect(modesPresent(['BUS', 'SUBWAY'])).toEqual({
      ...NO_MODES,
      bus: true,
      metro: true,
    });
    // RAIL is the app's "train", SUBWAY its "metro".
    expect(modesPresent(['RAIL'])).toEqual({ ...NO_MODES, train: true });
  });

  it('ignores modes it does not draw, and undefined entries', () => {
    expect(modesPresent(['BICYCLE', undefined, 'WALK'])).toEqual(NO_MODES);
  });

  it('is empty for nothing at all', () => {
    expect(modesPresent([])).toEqual(NO_MODES);
  });
});

describe('asTransportMode', () => {
  it('accepts the modes the app draws', () => {
    expect(asTransportMode('tram')).toBe('tram');
    expect(asTransportMode('ferry')).toBe('ferry');
  });

  it('rejects anything else, so an unknown mode is not filtered out by accident', () => {
    expect(asTransportMode('bicycle')).toBeNull();
    expect(asTransportMode('TRAM')).toBeNull();
    expect(asTransportMode(undefined)).toBeNull();
    expect(asTransportMode(null)).toBeNull();
  });
});
