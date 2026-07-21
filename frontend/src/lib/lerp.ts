export function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

export function lerpAngle(start: number, end: number, t: number): number {
  let diff = (end - start) % 360;
  if (diff < -180) {
    diff += 360;
  }
  if (diff > 180) {
    diff -= 360;
  }
  return (start + diff * t + 360) % 360;
}

// Clamp a value into the [min, max] range.
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// Smoothstep easing (ease-in-out). Softens the robotic constant-rate slide
// between two 1s position snapshots into something that reads like a vehicle.
export function smoothstep(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

// Shape the interpolation parameter by the vehicle's reported acceleration so
// the on-screen motion mirrors what the tram is physically doing between two
// snapshots:
//   - accelerating (acc > 0): ease-in  — start slow, gather pace (pulling away)
//   - braking      (acc < 0): ease-out — start fast, settle in (rolling to a stop)
//   - cruising     (acc ~ 0): smoothstep, so constant-speed motion still feels natural
// `acc` is metres per second squared; the curve strength saturates so a single
// hard reading can't distort the whole second of travel.
export function easeByAccel(t: number, acc: number): number {
  const x = clamp(t, 0, 1);
  const DEADBAND = 0.15; // ignore sensor jitter around zero
  if (acc > DEADBAND) {
    // Ease-in: exponent grows with acceleration, capped so it stays subtle.
    const k = 1 + clamp(acc / 1.5, 0, 1) * 0.9;
    return Math.pow(x, k);
  }
  if (acc < -DEADBAND) {
    // Ease-out: mirror of the ease-in curve.
    const k = 1 + clamp(-acc / 1.5, 0, 1) * 0.9;
    return 1 - Math.pow(1 - x, k);
  }
  return smoothstep(x);
}
