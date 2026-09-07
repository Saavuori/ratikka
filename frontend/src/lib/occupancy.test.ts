import { describe, it, expect } from 'vitest';
import {
  OCCUPANCY_BUCKETS,
  occupancyBucket,
  occupancyBucketIndex,
  occupancyColor,
  occupancyFraction,
  occupancyLabel,
  reportsOccupancy,
} from './occupancy';

describe('reportsOccupancy', () => {
  it('is true only for the mode that actually counts passengers', () => {
    expect(reportsOccupancy('ferry')).toBe(true);
    for (const mode of ['tram', 'bus', 'metro', 'train', '', undefined, null]) {
      expect(reportsOccupancy(mode)).toBe(false);
    }
  });
});

describe('occupancyFraction', () => {
  // The whole point: a tram sending occu 0 is a tram with no counter, not an
  // empty tram, so it must come back as "no reading" rather than as zero.
  it('ignores the field entirely on modes that do not measure it', () => {
    expect(occupancyFraction('tram', 0)).toBeNull();
    expect(occupancyFraction('bus', 100)).toBeNull();
    expect(occupancyFraction('metro', 40)).toBeNull();
    expect(occupancyFraction('train', 40)).toBeNull();
  });

  it('turns a ferry percentage into a fraction', () => {
    expect(occupancyFraction('ferry', 0)).toBe(0);
    expect(occupancyFraction('ferry', 50)).toBe(0.5);
    expect(occupancyFraction('ferry', 100)).toBe(1);
  });

  it('rejects a missing or impossible reading rather than clamping it', () => {
    expect(occupancyFraction('ferry', undefined)).toBeNull();
    expect(occupancyFraction('ferry', null)).toBeNull();
    expect(occupancyFraction('ferry', NaN)).toBeNull();
    expect(occupancyFraction('ferry', -1)).toBeNull();
    expect(occupancyFraction('ferry', 101)).toBeNull();
  });
});

describe('the load gauge scale', () => {
  it('runs from empty to full across every bucket', () => {
    expect(OCCUPANCY_BUCKETS[0].fill).toBe(0);
    expect(OCCUPANCY_BUCKETS[OCCUPANCY_BUCKETS.length - 1].fill).toBe(1);
    const fills = OCCUPANCY_BUCKETS.map((bucket) => bucket.fill);
    expect([...fills].sort((a, b) => a - b)).toEqual(fills);
  });

  it('picks the nearest step, and clamps outside 0…1', () => {
    expect(occupancyBucketIndex(0)).toBe(0);
    expect(occupancyBucketIndex(1)).toBe(OCCUPANCY_BUCKETS.length - 1);
    expect(occupancyBucketIndex(0.5)).toBe(Math.round(0.5 * (OCCUPANCY_BUCKETS.length - 1)));
    expect(occupancyBucketIndex(-5)).toBe(0);
    expect(occupancyBucketIndex(5)).toBe(OCCUPANCY_BUCKETS.length - 1);
  });

  // An empty boat is the good news and a full one the bad, so the colours run
  // the opposite way to the city-bike gauge.
  it('goes green when there is room and red when there is not', () => {
    expect(occupancyColor(0)).toBe(occupancyColor(0.2));
    expect(occupancyColor(1)).not.toBe(occupancyColor(0));
    expect(occupancyBucket(1).label).toBe('Full');
    expect(occupancyLabel(0)).toBe('Empty');
  });

  it('names every step', () => {
    for (const bucket of OCCUPANCY_BUCKETS) {
      expect(bucket.label.length).toBeGreaterThan(0);
      expect(bucket.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
