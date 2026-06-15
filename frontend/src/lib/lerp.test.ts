import { describe, it, expect } from 'vitest';
import { lerp, lerpAngle } from './lerp';

describe('Linear Interpolation (lerp)', () => {
  it('interpolates correctly at midpoint', () => {
    expect(lerp(10, 20, 0.5)).toBe(15);
  });

  it('handles start of range (t=0)', () => {
    expect(lerp(10, 20, 0)).toBe(10);
  });

  it('handles end of range (t=1)', () => {
    expect(lerp(10, 20, 1)).toBe(20);
  });
});

describe('Angle Interpolation (lerpAngle)', () => {
  it('interpolates angles without wrap-around', () => {
    expect(lerpAngle(10, 30, 0.5)).toBe(20);
  });

  it('interpolates wrap-around from 359 to 1', () => {
    // 359 -> 1 rotates clockwise: 359 -> 0 -> 1. Midpoint is 0.
    expect(lerpAngle(359, 1, 0.5)).toBe(0);
  });

  it('interpolates wrap-around from 1 to 359', () => {
    // 1 -> 359 rotates counter-clockwise: 1 -> 0 -> 359. Midpoint is 0.
    expect(lerpAngle(1, 359, 0.5)).toBe(0);
  });

  it('interpolates correctly with negative angle calculations', () => {
    expect(lerpAngle(90, 270, 0.5)).toBe(180);
  });
});
