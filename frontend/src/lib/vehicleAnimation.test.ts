import { describe, expect, it } from 'vitest';
import { advanceDoors, DOOR_TRAVEL_MS, isVehicleBraking, vehicles3DEnabled } from './vehicleAnimation';

describe('door animation', () => {
  it('initialises from actual telemetry rather than animating a made-up transition', () => {
    expect(advanceDoors(undefined, true, 100).progress).toBe(1);
    expect(advanceDoors(undefined, false, 100).progress).toBe(0);
  });

  it('opens gradually and can reverse while part way open', () => {
    const closed = advanceDoors(undefined, false, 0);
    const halfway = advanceDoors(closed, true, DOOR_TRAVEL_MS / 2);
    expect(halfway.progress).toBe(0.5);
    expect(advanceDoors(halfway, false, DOOR_TRAVEL_MS).progress).toBe(0);
    expect(advanceDoors(halfway, true, DOOR_TRAVEL_MS).progress).toBe(1);
  });

  it('clamps long frame gaps and ignores backwards time', () => {
    const closed = advanceDoors(undefined, false, 100);
    expect(advanceDoors(closed, true, 0).progress).toBe(0);
    const open = advanceDoors(closed, true, 10000);
    expect(open.progress).toBe(1);
    expect(advanceDoors(open, false, 20000).progress).toBe(0);
  });
});

describe('braking indication', () => {
  it('lights while stopped, doors open or decelerating', () => {
    expect(isVehicleBraking(0, 0)).toBe(true);
    expect(isVehicleBraking(5, -0.5)).toBe(true);
    expect(isVehicleBraking(undefined, undefined, true)).toBe(true);
  });

  it('does not treat missing telemetry as stopped', () => {
    expect(isVehicleBraking()).toBe(false);
    expect(isVehicleBraking(5, 0)).toBe(false);
    expect(isVehicleBraking(5, -0.35)).toBe(false);
    expect(isVehicleBraking(undefined, NaN)).toBe(false);
  });
});

describe('3D vehicle preference', () => {
  it.each([
    [false, false, false],
    [true, false, true],
    [false, true, true],
    [true, true, true],
  ])('tilted=%s, always=%s renders models=%s', (tilted, always, visible) => {
    expect(vehicles3DEnabled(tilted, always)).toBe(visible);
  });
});
