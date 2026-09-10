import { describe, it, expect } from 'vitest';
import {
  advanceAlongHeading,
  bearingBetween,
  distanceToSegment,
  haversineMeters,
  metersBetween,
  offsetMeters,
} from './geo';

const HELSINKI: [number, number] = [24.9384, 60.1699];
const [LNG, LAT] = HELSINKI;

/** `toBeCloseTo` precision for "the same to the nearest millimetre". */
const MILLIMETRE = 2.5;

describe('haversineMeters', () => {
  it('is zero for a point against itself', () => {
    expect(haversineMeters(LAT, LNG, LAT, LNG)).toBe(0);
  });

  it('is symmetric', () => {
    expect(haversineMeters(LAT, LNG, 60.18, 24.95)).toBeCloseTo(
      haversineMeters(60.18, 24.95, LAT, LNG), 9);
  });

  it('measures a known north-south offset', () => {
    // 0.001° of latitude is a shade over 111 m anywhere on the sphere.
    expect(haversineMeters(LAT, LNG, LAT + 0.001, LNG)).toBeCloseTo(111.3, 1);
  });
});

describe('the flat and spherical distances agree', () => {
  // This is the assertion the codebase could not previously make: `metersBetween`
  // and `haversineMeters` used to live in different modules against different
  // Earth radii, so they disagreed by ~0.11% and nothing said so.
  it.each([
    ['a tram length', 30],
    ['a city block', 250],
    ['across the centre', 3000],
  ])('to within a millimetre over %s', (_label, metres) => {
    for (const hdg of [0, 45, 90, 135, 180, 225, 270, 315]) {
      const [lng, lat] = offsetMeters(LNG, LAT, hdg, metres, 0);
      const flat = metersBetween(HELSINKI, [lng, lat]);
      const sphere = haversineMeters(LAT, LNG, lat, lng);
      expect(Math.abs(flat - sphere)).toBeLessThan(0.001);
    }
  });
});

describe('offsetMeters', () => {
  // `offsetMeters` linearises at the latitude it is given; `metersBetween` and
  // `bearingBetween` linearise at the midpoint of the pair. Over the distances
  // below that leaves them a few tenths of a millimetre and a few thousandths
  // of a degree apart, which is what the tolerances here are measuring.
  it('moves the distance it was asked to, on every heading', () => {
    for (const hdg of [0, 37, 90, 180, 271, 359]) {
      const along = offsetMeters(LNG, LAT, hdg, 100, 0);
      expect(metersBetween(HELSINKI, along)).toBeCloseTo(100, MILLIMETRE);
      const across = offsetMeters(LNG, LAT, hdg, 0, 100);
      expect(metersBetween(HELSINKI, across)).toBeCloseTo(100, MILLIMETRE);
    }
  });

  it('puts `across` a quarter turn clockwise of `along`', () => {
    // Facing north, the vehicle's right-hand side is east.
    const right = offsetMeters(LNG, LAT, 0, 0, 50);
    expect(right[0]).toBeGreaterThan(LNG);
    expect(right[1]).toBeCloseTo(LAT, 9);
  });

  it('agrees with advanceAlongHeading when nothing moves across', () => {
    for (const hdg of [0, 37, 90, 180, 271, 359]) {
      const [lng, lat] = offsetMeters(LNG, LAT, hdg, 60, 0);
      const advanced = advanceAlongHeading(LAT, LNG, hdg, 60);
      expect(advanced.lng).toBeCloseTo(lng, 9);
      expect(advanced.lat).toBeCloseTo(lat, 9);
    }
  });
});

describe('bearingBetween', () => {
  it('inverts the heading offsetMeters was given', () => {
    for (const hdg of [0, 37, 90, 180, 271, 359]) {
      expect(bearingBetween(HELSINKI, offsetMeters(LNG, LAT, hdg, 200, 0)))
        .toBeCloseTo(hdg, 2);
    }
  });

  it('reports clockwise from north in [0, 360)', () => {
    expect(bearingBetween(HELSINKI, [LNG, LAT + 0.01])).toBeCloseTo(0, 6);
    expect(bearingBetween(HELSINKI, [LNG + 0.01, LAT])).toBeCloseTo(90, 6);
    expect(bearingBetween(HELSINKI, [LNG, LAT - 0.01])).toBeCloseTo(180, 6);
    expect(bearingBetween(HELSINKI, [LNG - 0.01, LAT])).toBeCloseTo(270, 6);
  });
});

describe('advanceAlongHeading', () => {
  it('leaves a standing vehicle exactly where it is', () => {
    expect(advanceAlongHeading(LAT, LNG, 225, 0)).toEqual({ lat: LAT, lng: LNG });
    expect(advanceAlongHeading(LAT, LNG, 225, -5)).toEqual({ lat: LAT, lng: LNG });
    expect(advanceAlongHeading(LAT, LNG, NaN, 20)).toEqual({ lat: LAT, lng: LNG });
  });

  it('does not produce an infinite longitude at a pole', () => {
    const atPole = advanceAlongHeading(90, LNG, 90, 100);
    expect(Number.isFinite(atPole.lng)).toBe(true);
    expect(atPole.lng).toBe(LNG);
  });
});

describe('distanceToSegment', () => {
  const a = HELSINKI;
  const b = offsetMeters(LNG, LAT, 90, 100, 0); // 100 m due east

  it('is zero on the segment', () => {
    expect(distanceToSegment(a, a, b)).toBeCloseTo(0, 6);
    expect(distanceToSegment(b, a, b)).toBeCloseTo(0, 6);
  });

  it('measures perpendicular distance from the middle', () => {
    const mid = offsetMeters(LNG, LAT, 90, 50, 0);
    const off = offsetMeters(mid[0], mid[1], 0, 20, 0); // 20 m north of the midpoint
    expect(distanceToSegment(off, a, b)).toBeCloseTo(20, 2);
  });

  it('clamps to the endpoints rather than the infinite line', () => {
    // 40 m past `b`, still on the line: the segment's answer is 40, not 0.
    const beyond = offsetMeters(LNG, LAT, 90, 140, 0);
    expect(distanceToSegment(beyond, a, b)).toBeCloseTo(40, 2);
  });

  it('handles a degenerate zero-length segment', () => {
    const off = offsetMeters(LNG, LAT, 0, 15, 0);
    expect(distanceToSegment(off, a, a)).toBeCloseTo(15, 6);
  });
});
