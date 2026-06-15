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
