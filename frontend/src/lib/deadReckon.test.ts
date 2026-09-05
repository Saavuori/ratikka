import { describe, it, expect } from 'vitest';
import {
  ACC_HORIZON,
  MAX_AGE,
  MAX_SPEED,
  METRO_LIMITS,
  SURFACE_MAX_AGE,
  advanceAlongHeading,
  glideFraction,
  predictedAdvance,
  predictedSpeed,
  reckonLimits,
  hasMoved,
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

describe('hasMoved', () => {
  const at = (lat: number, lng: number, ts: number) => ({ lat, lng, ts });

  it('is false for a repeated coordinate, however much the timestamp ticks', () => {
    // The regression this exists for: HFP repeats a metro's coordinate for
    // seconds at a time with a fresh timestamp on each one. Reading the
    // timestamp as a new report re-anchored the train on its own stale position
    // every second, so it was never carried forward — it sat still and then
    // covered the whole step in one glide.
    const fix = at(60.1699, 24.9384, 1000);
    expect(hasMoved(fix, at(60.1699, 24.9384, 1001))).toBe(false);
    expect(hasMoved(fix, at(60.1699, 24.9384, 1005))).toBe(false);
  });

  it('is true when the coordinate actually changes', () => {
    const fix = at(60.1699, 24.9384, 1000);
    expect(hasMoved(fix, at(60.1704, 24.9384, 1000))).toBe(true);
    expect(hasMoved(fix, at(60.1699, 24.9390, 1003))).toBe(true);
  });

  it('is true for a train with no fix yet', () => {
    expect(hasMoved(undefined, at(60.1699, 24.9384, 1000))).toBe(true);
  });
});

describe('the metro prediction horizon', () => {
  it('covers a whole between-stations hold', () => {
    // Those last 2.6 s at the median and 4.2 s at the ninetieth percentile, and
    // the held speed predicts the eventual jump to within about a tenth, so the
    // prediction must run for the whole of one rather than stopping partway.
    expect(MAX_AGE).toBeGreaterThanOrEqual(5);
    expect(predictedAdvance(17, 0, 0, 4.2)).toBeCloseTo(17 * 4.2, 5);
  });

  it('stops well before a platform dwell can run a train off its station', () => {
    // A message frozen on the way in keeps reporting the speed the train came
    // in at while it is in fact slowing, dwelling and leaving. Holds there run
    // to a minute; carrying a 20 m/s reading across one of those would put the
    // train more than a kilometre past the platform.
    expect(MAX_AGE).toBeLessThanOrEqual(10);
    expect(predictedAdvance(20, 0, 0, 60)).toBeLessThanOrEqual(20 * 10);
  });
});

describe('reckonLimits', () => {
  it('gives the metro the long horizon and everything else the short one', () => {
    // Different reasons, opposite conclusions: a metro holds its coordinate
    // while it is still moving, so predicting through the silence is the only
    // way to draw the truth. A surface vehicle that goes quiet has usually
    // stopped, and its last speed then describes something that is no longer
    // happening.
    expect(reckonLimits('metro').maxAge).toBe(MAX_AGE);
    expect(reckonLimits('tram').maxAge).toBe(SURFACE_MAX_AGE);
    expect(reckonLimits('bus').maxAge).toBe(SURFACE_MAX_AGE);
    expect(reckonLimits('train').maxAge).toBe(SURFACE_MAX_AGE);
    expect(SURFACE_MAX_AGE).toBeLessThan(MAX_AGE);
  });

  it('caps each mode above its fastest honest reading and below the feed junk', () => {
    // Observed maxima on the captured feed: tram 75 km/h, bus 100, train 160 —
    // and single steps implying 1200 and 2800 km/h, which are the ones this
    // keeps off the map.
    expect(reckonLimits('tram').maxSpeed * 3.6).toBeGreaterThan(75);
    expect(reckonLimits('bus').maxSpeed * 3.6).toBeGreaterThan(100);
    expect(reckonLimits('train').maxSpeed * 3.6).toBeGreaterThan(160);
    expect(reckonLimits('train').maxSpeed * 3.6).toBeLessThan(250);
  });

  it('treats an unknown mode as a tram', () => {
    expect(reckonLimits(undefined)).toEqual(reckonLimits('tram'));
    expect(reckonLimits('ferry')).toEqual(reckonLimits('tram'));
  });

  it('stops carrying a surface vehicle once its horizon passes', () => {
    const bus = reckonLimits('bus');
    // Two seconds of a 10 m/s bus, and then nothing however long the silence.
    expect(predictedAdvance(10, 0, 0, 2, bus)).toBeCloseTo(20, 3);
    expect(predictedAdvance(10, 0, 0, 30, bus)).toBeCloseTo(20, 3);
    expect(predictedAdvance(10, 0, SURFACE_MAX_AGE, 30, bus)).toBe(0);
    // Where a metro would still be running.
    expect(predictedAdvance(10, 0, 0, 6, METRO_LIMITS)).toBeCloseTo(60, 3);
  });

  it('clamps a mode to its own top speed, not the metro line speed', () => {
    // A commuter train genuinely runs faster than the metro's 22 m/s, and used
    // to be clipped to it.
    expect(predictedSpeed(40, 0, 1, reckonLimits('train'))).toBe(40);
    expect(predictedSpeed(40, 0, 1, METRO_LIMITS)).toBe(MAX_SPEED);
    // And a spurious reading is still caught.
    expect(predictedSpeed(400, 0, 1, reckonLimits('bus'))).toBe(
      reckonLimits('bus').maxSpeed
    );
  });
});

describe('glideFraction over a window that is not one second', () => {
  it('still spans the whole window', () => {
    const bus = reckonLimits('bus');
    expect(glideFraction(10, 0, 0, 0, bus, 1.6)).toBeCloseTo(0, 6);
    expect(glideFraction(10, 0, 0, 1, bus, 1.6)).toBeCloseTo(1, 6);
  });

  it('is linear at constant speed however long the window', () => {
    const bus = reckonLimits('bus');
    expect(glideFraction(10, 0, 0, 0.25, bus, 1.6)).toBeCloseTo(0.25, 3);
  });

  it('coasts to a halt when the window runs past the horizon', () => {
    // A 2.5 s window opened 1 s into a gap: the bus covers the first second of
    // it and then stops, because SURFACE_MAX_AGE says its speed reading has
    // expired. The fraction reaches 1 early and stays there rather than
    // carrying it on down the road.
    const bus = reckonLimits('bus');
    expect(glideFraction(10, 0, 1, 0.4, bus, 2.5)).toBeCloseTo(1, 3);
  });
});

describe('advanceAlongHeading', () => {
  const HELSINKI = { lat: 60.1699, lng: 24.9384 };

  it('moves north, east, south and west by the heading given', () => {
    const north = advanceAlongHeading(HELSINKI.lat, HELSINKI.lng, 0, 100);
    expect(north.lat).toBeGreaterThan(HELSINKI.lat);
    expect(north.lng).toBeCloseTo(HELSINKI.lng, 9);

    const east = advanceAlongHeading(HELSINKI.lat, HELSINKI.lng, 90, 100);
    expect(east.lng).toBeGreaterThan(HELSINKI.lng);
    expect(east.lat).toBeCloseTo(HELSINKI.lat, 9);

    const south = advanceAlongHeading(HELSINKI.lat, HELSINKI.lng, 180, 100);
    expect(south.lat).toBeLessThan(HELSINKI.lat);

    const west = advanceAlongHeading(HELSINKI.lat, HELSINKI.lng, 270, 100);
    expect(west.lng).toBeLessThan(HELSINKI.lng);
  });

  it('moves the distance it was asked to', () => {
    // A degree of latitude is ~111.19 km on a sphere of this radius; 100 m north
    // is that many degrees. Longitude is the same scaled by cos(lat).
    const moved = advanceAlongHeading(HELSINKI.lat, HELSINKI.lng, 45, 100);
    const dNorth = (moved.lat - HELSINKI.lat) * (Math.PI / 180) * 6371000;
    const dEast =
      (moved.lng - HELSINKI.lng) *
      (Math.PI / 180) *
      6371000 *
      Math.cos((HELSINKI.lat * Math.PI) / 180);
    expect(Math.hypot(dNorth, dEast)).toBeCloseTo(100, 3);
    expect(dNorth).toBeCloseTo(dEast, 3);
  });

  it('leaves a standing vehicle exactly where it is', () => {
    expect(advanceAlongHeading(HELSINKI.lat, HELSINKI.lng, 225, 0)).toEqual(HELSINKI);
    expect(advanceAlongHeading(HELSINKI.lat, HELSINKI.lng, 225, -5)).toEqual(HELSINKI);
    expect(advanceAlongHeading(HELSINKI.lat, HELSINKI.lng, NaN, 20)).toEqual(HELSINKI);
  });

  it('composes with the predicted advance to place a vehicle a second on', () => {
    // The whole surface-mode prediction in one line: a tram at 8 m/s heading
    // due east is 8 m further east a second later.
    const tram = reckonLimits('tram');
    const metres = predictedAdvance(8, 0, 0, 1, tram);
    const next = advanceAlongHeading(HELSINKI.lat, HELSINKI.lng, 90, metres);
    const dEast =
      (next.lng - HELSINKI.lng) *
      (Math.PI / 180) *
      6371000 *
      Math.cos((HELSINKI.lat * Math.PI) / 180);
    expect(dEast).toBeCloseTo(8, 2);
  });
});
