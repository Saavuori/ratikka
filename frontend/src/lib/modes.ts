/**
 * The five vehicle modes the app draws, and the shape a set of them takes.
 *
 * Almost everything that talks about modes talks about all five at once —
 * what the reader has switched on, what a journey needs, what a stop's
 * departures need, what the ride detector is scanning for, what the backend is
 * asked to stream. Keeping that as one record rather than five booleans means
 * combining two sets is a fold instead of five hand-written `||` lines, and
 * adding a sixth mode is a change here rather than a search for every place
 * that spelled the five out.
 */
export type TransportMode = 'tram' | 'bus' | 'metro' | 'train' | 'ferry';

export type ModeFlags = Record<TransportMode, boolean>;

export const TRANSPORT_MODES: readonly TransportMode[] = [
  'tram',
  'bus',
  'metro',
  'train',
  'ferry',
];

/**
 * The feeds a client opts into. Trams always stream; the rest are ingested by
 * the backend only while at least one client has asked for them, because they
 * are either huge (buses are ~80% of the whole feed) or of narrower interest.
 */
export type OptionalMode = Exclude<TransportMode, 'tram'>;

export const OPTIONAL_MODES: readonly OptionalMode[] = ['bus', 'metro', 'train', 'ferry'];

export const NO_MODES: ModeFlags = {
  tram: false,
  bus: false,
  metro: false,
  train: false,
  ferry: false,
};

export const ALL_MODES: ModeFlags = {
  tram: true,
  bus: true,
  metro: true,
  train: true,
  ferry: true,
};

/** Build a set from a predicate over the modes. */
export function modeFlags(include: (mode: TransportMode) => boolean): ModeFlags {
  return {
    tram: include('tram'),
    bus: include('bus'),
    metro: include('metro'),
    train: include('train'),
    ferry: include('ferry'),
  };
}

/**
 * The union of several sets: a mode is in the result if any set has it. This is
 * how the layers stack — the reader's own toggles, plus whatever a selected
 * journey, stop or ride needs in order to answer for itself.
 */
export function anyMode(...sets: ModeFlags[]): ModeFlags {
  return modeFlags((mode) => sets.some((set) => set[mode]));
}

/** Flip one mode in a set, leaving the others alone. */
export function withMode(set: ModeFlags, mode: TransportMode, on: boolean): ModeFlags {
  return { ...set, [mode]: on };
}

/** The GTFS spelling of each mode, as Digitransit and the HFP feed send it. */
const GTFS_MODES: Record<TransportMode, string> = {
  tram: 'TRAM',
  bus: 'BUS',
  metro: 'SUBWAY',
  train: 'RAIL',
  ferry: 'FERRY',
};

/** Which modes appear among a collection of GTFS mode strings. */
export function modesPresent(gtfsModes: Iterable<string | undefined>): ModeFlags {
  const present = new Set(gtfsModes);
  return modeFlags((mode) => present.has(GTFS_MODES[mode]));
}

/** Narrow an arbitrary mode string from the feed to one the app draws. */
export function asTransportMode(mode: string | null | undefined): TransportMode | null {
  return TRANSPORT_MODES.includes(mode as TransportMode) ? (mode as TransportMode) : null;
}
