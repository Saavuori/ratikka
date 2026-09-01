import { describe, it, expect } from 'vitest';
import {
  ACC_HORIZON,
  MAX_AGE,
  MAX_SPEED,
  glideFraction,
  predictedAdvance,
  predictedSpeed,
} from './deadReckon';

describe('predictedSpeed', () => {
  it('holds a cruising speed', () => {
    expect(predictedSpeed(15, 0, 0)).toBe(15);
    expect(predictedSpeed(15, 0, 8)).toBe(15);
  });

  it('integrates acceleration until the trust horizon, then coasts', () => {
    expect(predictedSpeed(10, 1, 2)).toBeCloseTo(12, 6);
    expect(predictedSpeed(10, 1, ACC_HORIZON)).toBeCloseTo(14, 6);
    // Past the horizon the train keeps the speed it reached rather than
    // accelerating forever.
    expect(predictedSpeed(10, 1, 30)).toBeCloseTo(10 + ACC_HORIZON, 6);
  });

  it('never reverses under braking', () => {
    expect(predictedSpeed(2, -3, 3)).toBe(0);
  });

  it('never exceeds line speed', () => {
    expect(predictedSpeed(20, 5, 4)).toBe(MAX_SPEED);
  });

  it('treats missing readings as zero', () => {
    expect(predictedSpeed(NaN, NaN, 3)).toBe(0);
    expect(predictedSpeed(-4, 0, 1)).toBe(0);
  });
});

describe('predictedAdvance', () => {
  it('is distance = speed x time at constant speed', () => {
    expect(predictedAdvance(12, 0, 0, 3)).toBeCloseTo(36, 3);
    expect(predictedAdvance(12, 0, 2, 3)).toBeCloseTo(12, 3);
  });

  it('matches the kinematic result while accelerating', () => {
    // s = v0*t + 0.5*a*t^2 for t inside the acceleration horizon.
    expect(predictedAdvance(5, 1, 0, 4)).toBeCloseTo(5 * 4 + 0.5 * 4 * 4, 2);
  });

  it('is zero for an empty or inverted window', () => {
    expect(predictedAdvance(12, 0, 3, 3)).toBe(0);
    expect(predictedAdvance(12, 0, 4, 1)).toBe(0);
  });

  it('is monotonic and additive across adjacent windows', () => {
    const whole = predictedAdvance(8, 0.5, 0, 6);
    const first = predictedAdvance(8, 0.5, 0, 2.5);
    const rest = predictedAdvance(8, 0.5, 2.5, 6);
    expect(first + rest).toBeCloseTo(whole, 3);
    expect(first).toBeGreaterThan(0);
  });

  it('stops predicting past the horizon', () => {
    expect(predictedAdvance(15, 0, MAX_AGE, MAX_AGE + 10)).toBe(0);
    // A window straddling the horizon only counts the part inside it.
    expect(predictedAdvance(10, 0, MAX_AGE - 1, MAX_AGE + 5)).toBeCloseTo(10, 3);
  });

  it('does not move a standing train', () => {
    expect(predictedAdvance(0, 0, 0, 5)).toBe(0);
  });
});

describe('glideFraction', () => {
  it('spans the whole window', () => {
    expect(glideFraction(12, 0, 0, 0)).toBeCloseTo(0, 6);
    expect(glideFraction(12, 0, 0, 1)).toBeCloseTo(1, 6);
  });

  it('is linear at constant speed', () => {
    expect(glideFraction(12, 0, 0, 0.25)).toBeCloseTo(0.25, 3);
    expect(glideFraction(12, 0, 3, 0.5)).toBeCloseTo(0.5, 3);
  });

  it('is monotonic', () => {
    let last = -1;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const f = glideFraction(6, 1.2, 1, t);
      expect(f).toBeGreaterThanOrEqual(last);
      last = f;
    }
    expect(last).toBeCloseTo(1, 6);
  });

  it('lags behind linear while accelerating and leads while braking', () => {
    expect(glideFraction(4, 1.5, 0, 0.5)).toBeLessThan(0.5);
    expect(glideFraction(12, -1.5, 0, 0.5)).toBeGreaterThan(0.5);
  });

  it('eases a correction when no motion is predicted', () => {
    // Standing train: nothing to follow, so the window uses smoothstep.
    expect(glideFraction(0, 0, 0, 0.5)).toBeCloseTo(0.5, 6);
    expect(glideFraction(0, 0, 0, 0.25)).toBeCloseTo(0.15625, 6);
  });

  it('clamps out-of-range time', () => {
    expect(glideFraction(12, 0, 0, -1)).toBe(0);
    expect(glideFraction(12, 0, 0, 5)).toBe(1);
  });
});
