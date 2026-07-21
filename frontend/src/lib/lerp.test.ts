import { describe, it, expect } from 'vitest';
import { lerp, lerpAngle, clamp, smoothstep, easeByAccel } from './lerp';

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

describe('clamp', () => {
  it('passes values already in range through unchanged', () => {
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });

  it('clamps below the minimum', () => {
    expect(clamp(-3, 0, 1)).toBe(0);
  });

  it('clamps above the maximum', () => {
    expect(clamp(4, 0, 1)).toBe(1);
  });
});

describe('smoothstep', () => {
  it('pins the endpoints', () => {
    expect(smoothstep(0)).toBe(0);
    expect(smoothstep(1)).toBe(1);
  });

  it('is symmetric about the midpoint', () => {
    expect(smoothstep(0.5)).toBe(0.5);
  });

  it('clamps out-of-range input', () => {
    expect(smoothstep(-1)).toBe(0);
    expect(smoothstep(2)).toBe(1);
  });
});

describe('easeByAccel', () => {
  it('always pins the endpoints regardless of acceleration', () => {
    expect(easeByAccel(0, 2)).toBe(0);
    expect(easeByAccel(1, 2)).toBe(1);
    expect(easeByAccel(0, -2)).toBe(0);
    expect(easeByAccel(1, -2)).toBe(1);
  });

  it('eases in when accelerating (lags behind linear early on)', () => {
    // Pulling away from a stop: covers less ground in the first half.
    expect(easeByAccel(0.5, 2)).toBeLessThan(0.5);
  });

  it('eases out when braking (leads linear early on)', () => {
    // Rolling to a stop: covers more ground early, then settles.
    expect(easeByAccel(0.5, -2)).toBeGreaterThan(0.5);
  });

  it('falls back to smoothstep inside the deadband', () => {
    expect(easeByAccel(0.5, 0)).toBe(0.5);
    expect(easeByAccel(0.5, 0.1)).toBe(smoothstep(0.5));
  });
});
