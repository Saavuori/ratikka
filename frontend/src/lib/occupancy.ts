// How full a vehicle is, and how that is drawn.
//
// HFP carries an `occu` field on every mode, and on every mode but one it is
// the constant 0: buses, trams, the metro and the commuter trains have nothing
// counting passengers on board, so the field is sent because the schema has it
// rather than because it says anything. The Suomenlinna ferry is the exception.
// Its vessels report a genuine load percentage, which makes it the one mode
// where "how busy is the one that is coming?" is a question the live feed can
// actually answer — and, for a boat that leaves on the hour and takes what fits,
// the question a reader most wants answered before walking to the quay.
//
// So occupancy is drawn only where it is measured. Everywhere else the field is
// treated as absent rather than as "empty", because a tram reporting 0 is not a
// tram with nobody on it.

/** Modes whose `occu` is a measurement rather than a schema placeholder. */
const OCCUPANCY_MODES = new Set(['ferry']);

/** Whether this mode's `occu` means anything at all. */
export function reportsOccupancy(mode: string | null | undefined): boolean {
  return OCCUPANCY_MODES.has(mode ?? '');
}

/**
 * The reported load as a 0…1 fraction, or null when there is none to show —
 * a mode that does not measure it, a missing field, or a value outside the
 * percentage the field is defined to carry.
 */
export function occupancyFraction(
  mode: string | null | undefined,
  occu: number | null | undefined,
): number | null {
  if (!reportsOccupancy(mode)) return null;
  if (occu === null || occu === undefined || !Number.isFinite(occu)) return null;
  if (occu < 0 || occu > 100) return null;
  return occu / 100;
}

/** One step of the load gauge: how much of it is filled, and in what colour. */
export interface OccupancyBucket {
  /** Share of the gauge drawn in `color`, 0…1. */
  fill: number;
  color: string;
  /** What this much of a boat is called, for labels and tooltips. */
  label: string;
}

// Six steps, coloured the opposite way round to the city-bike gauge and for the
// same reason: there, a full rack is the good news; here, an empty deck is. The
// palette is the one the bike gauge already uses, so the two markers read as one
// system — green is "no question", amber is "think about it", red is "you may
// not fit".
export const OCCUPANCY_BUCKETS: OccupancyBucket[] = [
  { fill: 0.0, color: '#20bf6b', label: 'Empty' },
  { fill: 0.2, color: '#20bf6b', label: 'Quiet' },
  { fill: 0.4, color: '#20bf6b', label: 'Room aboard' },
  { fill: 0.6, color: '#fcbc19', label: 'Filling up' },
  { fill: 0.8, color: '#f0932b', label: 'Busy' },
  { fill: 1.0, color: '#ef4444', label: 'Full' },
];

/**
 * Which bucket a fraction falls in. Bucketed rather than continuous because the
 * map draws the gauge as a registered icon per step, and because a boat that is
 * "about half full" is all the precision a percentage off a passenger counter
 * deserves.
 */
export function occupancyBucketIndex(fraction: number): number {
  const clamped = Math.max(0, Math.min(1, fraction));
  return Math.min(
    OCCUPANCY_BUCKETS.length - 1,
    Math.round(clamped * (OCCUPANCY_BUCKETS.length - 1)),
  );
}

export function occupancyBucket(fraction: number): OccupancyBucket {
  return OCCUPANCY_BUCKETS[occupancyBucketIndex(fraction)];
}

/** The gauge colour for a load fraction. */
export function occupancyColor(fraction: number): string {
  return occupancyBucket(fraction).color;
}

/** The word for a load fraction, e.g. "Filling up". */
export function occupancyLabel(fraction: number): string {
  return occupancyBucket(fraction).label;
}
