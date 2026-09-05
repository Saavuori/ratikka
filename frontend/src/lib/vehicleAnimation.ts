/** HFP reports door state, not leaf position; interpolate transitions locally. */
export interface DoorAnimation {
  progress: number;
  updatedAt: number;
}

export const DOOR_TRAVEL_MS = 700;

export function advanceDoors(
  previous: DoorAnimation | undefined,
  open: boolean,
  now: number,
): DoorAnimation {
  const target = open ? 1 : 0;
  if (!previous) return { progress: target, updatedAt: now };
  const step = Math.max(0, now - previous.updatedAt) / DOOR_TRAVEL_MS;
  const progress = previous.progress < target
    ? Math.min(target, previous.progress + step)
    : Math.max(target, previous.progress - step);
  return { progress, updatedAt: now };
}

/** A visual braking cue inferred from telemetry, not a reported lamp signal. */
export function isVehicleBraking(speed?: number, acceleration?: number, doorsOpen = false): boolean {
  return doorsOpen || speed === 0 || (Number.isFinite(acceleration) && acceleration! < -0.35);
}

export function vehicles3DEnabled(tilted: boolean, always: boolean): boolean {
  return tilted || always;
}
