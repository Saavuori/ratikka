import type { StopArrival, VehiclePosition } from '../types';

/**
 * Where a vehicle has got to along its trip: which stop it is standing at, if
 * any, and which one it is running to next.
 *
 * Both are indices into the trip's own stop list, or -1 for "not established".
 */
export interface TripProgress {
  /** The stop the vehicle is standing at with its doors open. */
  currentStopIndex: number;
  /** The stop the vehicle is running to. */
  nextStopIndex: number;
  /** The furthest stop the vehicle is known to have reached. */
  lastKnownIndex: number;
  /** Where the answer came from; see the notes on each value. */
  source: NextStopSource;
}

/**
 * How the next stop was established, worst case last:
 *
 * - `reported` — the feed named it. The vehicle's own next stop, published on
 *   every message, matched against the trip's stops.
 * - `at-stop` — the feed named a stop the vehicle is standing at, and the trip
 *   says the one after it comes next. Only used when the reported next stop is
 *   missing, which for a vehicle sitting at a stop it is about to leave is the
 *   one moment the two disagree.
 * - `timetable` — nothing about this vehicle could be matched to the trip, so
 *   the first stop whose scheduled time has not passed is offered instead. A
 *   guess, and the only source that can be wrong about a vehicle that is
 *   running to time.
 * - `end-of-line` — the vehicle has finished the trip. There is no next stop,
 *   and saying so is the correct answer rather than a failure.
 * - `unknown` — nothing could be established at all.
 */
export type NextStopSource = 'reported' | 'at-stop' | 'timetable' | 'end-of-line' | 'unknown';

const NOT_FOUND: TripProgress = {
  currentStopIndex: -1,
  nextStopIndex: -1,
  lastKnownIndex: -1,
  source: 'unknown',
};

/** Stop IDs reach us both bare and `HSL:`-prefixed; compare them as one. */
function sameStop(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.replace(/^HSL:/, '') === b.replace(/^HSL:/, '');
}

function indexOfStop(stops: StopArrival[], stopId: string | null | undefined): number {
  if (!stopId) return -1;
  return stops.findIndex((stop) => sameStop(stop.gtfsId, stopId));
}

/**
 * Minutes past midnight in Helsinki. The trip's times are stop times on the
 * network's own clock, so reading the browser's clock instead would put every
 * comparison out by the reader's offset from Finland.
 */
const HELSINKI_CLOCK = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Helsinki', hour: '2-digit', minute: '2-digit', hour12: false,
});

function helsinkiMinutes(now: Date): number {
  const [h, m] = HELSINKI_CLOCK.format(now).split(':').map(Number);
  return h * 60 + m;
}

/**
 * The first stop the trip is not yet due to have left, by the clock alone.
 *
 * Times arrive as `HH:MM` and can run past midnight on a late trip, so a stop
 * timed 00:10 is compared against a `now` of 23:55 by pulling it forward a day
 * rather than treating it as long past.
 */
function timetableIndex(stops: StopArrival[], now: Date): number {
  const nowMinutes = helsinkiMinutes(now);
  return stops.findIndex((stop) => {
    const [h, m] = (stop.realtimeArrival ?? '').split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return false;
    let stopMinutes = h * 60 + m;
    // A trip that crosses midnight leaves the small hours looking like the
    // distant past; a stop more than twelve hours behind is really ahead.
    if (nowMinutes - stopMinutes > 12 * 60) stopMinutes += 24 * 60;
    return stopMinutes >= nowMinutes;
  });
}

/**
 * Where a vehicle has got to along a trip.
 *
 * The vehicle's own reported next stop is preferred over everything else,
 * because it is the only account of the journey that the vehicle itself gives
 * and it is given on every message. Anything derived from `stop` — the stop the
 * vehicle is standing *at* — is a fallback, since that field is null for the
 * whole run between two stops, which is more than half the messages a tram
 * sends. Guessing "the one after the last stop we saw" during those gaps is
 * what used to leave the display naming a stop already behind the vehicle, or
 * naming none at all before its first stop of the trip was seen.
 *
 * `lastSeenStopId` is the caller's memory of the last stop the vehicle reported
 * standing at, kept so the fallback still has something to work from; it is
 * only consulted once the reported next stop has come up empty.
 */
export function tripProgress(
  vehicle: Pick<VehiclePosition, 'stop' | 'drst'> & Partial<Pick<VehiclePosition, 'nextStop' | 'eol'>>,
  stops: StopArrival[] | undefined,
  options: { lastSeenStopId?: string | null; now?: Date } = {},
): TripProgress {
  if (!stops?.length) return NOT_FOUND;

  const doorsOpen = vehicle.drst === 1;
  // The stop the vehicle is standing at is only meaningful while it is there;
  // `stop` matching `nextStop` is exactly how the feed says "still here".
  const atIndex = indexOfStop(stops, vehicle.stop);
  const currentStopIndex = doorsOpen ? atIndex : -1;

  const reportedIndex = indexOfStop(stops, vehicle.nextStop);
  if (reportedIndex !== -1) {
    return {
      currentStopIndex,
      nextStopIndex: reportedIndex,
      // Standing at the stop it is running to means it has reached that stop;
      // otherwise the last one it is known to have reached is the one before.
      lastKnownIndex: atIndex !== -1 ? atIndex : reportedIndex - 1,
      source: 'reported',
    };
  }

  // A vehicle that has run out of line has no next stop, and that is an answer.
  if (vehicle.eol) {
    return {
      currentStopIndex,
      nextStopIndex: -1,
      lastKnownIndex: atIndex !== -1 ? atIndex : stops.length - 1,
      source: 'end-of-line',
    };
  }

  const seenIndex = atIndex !== -1 ? atIndex : indexOfStop(stops, options.lastSeenStopId);
  if (seenIndex !== -1) {
    // Standing at a stop with the doors open: the next one is the one after.
    // Alongside it with the doors shut: it is either arriving or pulling away,
    // and the stop itself is the safer of the two answers.
    const nextStopIndex = doorsOpen || atIndex === -1 ? seenIndex + 1 : seenIndex;
    return {
      currentStopIndex,
      nextStopIndex: nextStopIndex < stops.length ? nextStopIndex : -1,
      lastKnownIndex: seenIndex,
      source: 'at-stop',
    };
  }

  const scheduled = timetableIndex(stops, options.now ?? new Date());
  if (scheduled === -1) {
    return { currentStopIndex: -1, nextStopIndex: -1, lastKnownIndex: stops.length - 1, source: 'timetable' };
  }
  return {
    currentStopIndex: -1,
    nextStopIndex: scheduled,
    lastKnownIndex: scheduled > 0 ? scheduled - 1 : 0,
    source: 'timetable',
  };
}

/**
 * Whether a vehicle is standing at this stop right now with its doors open —
 * the moment the platform edge should light up because people are boarding.
 */
export function isBoardingAt(
  vehicle: Pick<VehiclePosition, 'stop' | 'drst'>,
  stopId: string | null | undefined,
): boolean {
  return vehicle.drst === 1 && sameStop(vehicle.stop, stopId);
}

/**
 * Whether this vehicle is on its way to this stop and has not reached it yet —
 * the feed's own answer, not a guess from position or timetable.
 */
export function isApproaching(
  vehicle: Pick<VehiclePosition, 'stop'> & Partial<Pick<VehiclePosition, 'nextStop'>>,
  stopId: string | null | undefined,
): boolean {
  return sameStop(vehicle.nextStop, stopId) && !sameStop(vehicle.stop, stopId);
}

export { sameStop };
