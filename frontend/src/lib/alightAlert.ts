import type { JourneyItinerary, JourneyLeg, JourneyPlace, VehiclePosition } from '../types';
import { findJourneyVehicle } from './journeyVehicles';
import { isBoardingAt, sameStop } from './nextStop';

/**
 * Telling a rider when to get off.
 *
 * A planned journey already knows the stop you are meant to leave the vehicle
 * at — it is the end of the transit leg you are riding. What it does not do on
 * its own is *say so at the moment it matters*, which is the one thing a rider
 * on a strange line actually needs: the point of asking "where to?" is not
 * having to count stops out of the window.
 *
 * So the leg being ridden is followed against the vehicle running it, and the
 * stop is counted down from the vehicle's own reported next stop rather than
 * from the clock. The clock is the fallback, and is labelled as one: a
 * prediction that says you arrive in ninety seconds is a weaker thing than a
 * tram saying the stop it is running to is yours.
 */

export type AlightPhase =
  /** On board, with stops still to run. */
  | 'riding'
  /** Close enough to gather your things. */
  | 'prepare'
  /** The stop the vehicle is running to is yours. */
  | 'next'
  /** Standing at your stop with the doors open. */
  | 'now'
  /** Your stop is behind the vehicle. */
  | 'passed';

export interface AlightAlert {
  /** Index into `itinerary.legs` of the leg being ridden. */
  legIndex: number;
  stopName: string;
  stopId?: string;
  line: string;
  mode: string;
  phase: AlightPhase;
  /** Stops still to run before yours, or null when only the clock is known. */
  stopsAway: number | null;
  /** Seconds until the leg's arrival, from the prediction. */
  secondsAway: number | null;
  /**
   * `vehicle` — counted off the vehicle's own reported next stop.
   * `timetable` — no vehicle could be matched, so this is the prediction.
   */
  source: 'vehicle' | 'timetable';
  /** One line, fit for a banner or a system notification. */
  message: string;
}

/** Gather your things: two stops by count, five minutes by the clock. */
const PREPARE_STOPS = 2;
const PREPARE_SECONDS = 300;
/** By the clock alone, this close counts as "next". */
const NEXT_SECONDS = 90;
/** Past this much of its arrival, the prediction alone says the stop is behind. */
const PASSED_SECONDS = 60;
/** The leg is dropped entirely once it is this far past arriving. */
const LEG_GRACE_SECONDS = 120;
/** Armed just before the leg departs, so boarding does not have to be timed. */
const BOARD_LEAD_MS = 30_000;

/** The leg's stops in the order it runs them, alighting stop last. */
export function legStops(leg: JourneyLeg): JourneyPlace[] {
  return [leg.from, ...leg.intermediateStops, leg.to];
}

/**
 * Which transit leg the reader is on. A detected ride settles it outright —
 * that vehicle is under them. Otherwise the clock picks the leg that is
 * running, which is a guess about boarding and is treated as one.
 */
export function activeLegIndex(
  itinerary: JourneyItinerary,
  vehicles: VehiclePosition[],
  now: number,
  rideVehicleId?: string | null,
): number | null {
  if (rideVehicleId) {
    const ridden = itinerary.legs.findIndex((leg) =>
      leg.transit && findJourneyVehicle(leg, vehicles, now)?.veh === rideVehicleId);
    if (ridden !== -1) return ridden;
  }
  const running = itinerary.legs.findIndex((leg) =>
    leg.transit && now >= leg.startTime - BOARD_LEAD_MS && now <= leg.endTime + LEG_GRACE_SECONDS * 1000);
  return running === -1 ? null : running;
}

function minutes(seconds: number): number {
  return Math.max(1, Math.round(seconds / 60));
}

function describe(phase: AlightPhase, stop: string, stopsAway: number | null, secondsAway: number | null): string {
  switch (phase) {
    case 'now':
      return `Get off here — ${stop}`;
    case 'next':
      return `Your stop is next — ${stop}`;
    case 'passed':
      return `You have passed ${stop}`;
    default:
      if (stopsAway !== null) {
        return `${stopsAway} ${stopsAway === 1 ? 'stop' : 'stops'} to ${stop}`;
      }
      return secondsAway !== null ? `${minutes(secondsAway)} min to ${stop}` : `Riding to ${stop}`;
  }
}

function byTimetable(leg: JourneyLeg, now: number): { phase: AlightPhase; secondsAway: number } {
  const secondsAway = (leg.endTime - now) / 1000;
  const phase: AlightPhase =
    secondsAway < -PASSED_SECONDS ? 'passed'
      : secondsAway <= NEXT_SECONDS ? 'next'
        : secondsAway <= PREPARE_SECONDS ? 'prepare'
          : 'riding';
  return { phase, secondsAway };
}

/**
 * Where the ride has got to relative to the stop the journey wants left at,
 * or null when no leg of the journey is being ridden.
 */
export function alightAlert(
  itinerary: JourneyItinerary,
  vehicles: VehiclePosition[],
  now: number,
  rideVehicleId?: string | null,
): AlightAlert | null {
  const legIndex = activeLegIndex(itinerary, vehicles, now, rideVehicleId);
  if (legIndex === null) return null;
  const leg = itinerary.legs[legIndex];
  const stops = legStops(leg);
  const stopName = leg.to.name;
  const line = leg.route?.shortName ?? '';
  const common = { legIndex, stopName, stopId: leg.to.stopId, line, mode: leg.mode };

  const vehicle = findJourneyVehicle(leg, vehicles, now);
  const secondsAway = (leg.endTime - now) / 1000;

  if (vehicle) {
    if (isBoardingAt(vehicle, leg.to.stopId)) {
      return {
        ...common, phase: 'now', stopsAway: 0, secondsAway,
        source: 'vehicle', message: describe('now', stopName, 0, secondsAway),
      };
    }
    const nextIndex = stops.findIndex((stop) => sameStop(stop.stopId, vehicle.nextStop));
    if (nextIndex !== -1) {
      // The alighting stop is the last of the leg's own stops, so a stop that
      // is in the list is never behind it: the count cannot go negative.
      const stopsAway = stops.length - 1 - nextIndex;
      const phase: AlightPhase =
        stopsAway === 0 ? 'next' : stopsAway <= PREPARE_STOPS ? 'prepare' : 'riding';
      return {
        ...common, phase, stopsAway,
        secondsAway, source: 'vehicle', message: describe(phase, stopName, stopsAway, secondsAway),
      };
    }
    // The vehicle names a stop this leg does not contain. Before the leg's
    // arrival that is ordinary — it is still working through stops ahead of
    // the boarding point after a re-plan — but at or past the arrival it means
    // the stop is behind: every stop still to come on this leg would be in the
    // list. Saying so beats a countdown to a stop already gone.
    if (secondsAway <= NEXT_SECONDS) {
      return {
        ...common, phase: 'passed', stopsAway: null, secondsAway,
        source: 'vehicle', message: describe('passed', stopName, null, secondsAway),
      };
    }
  }

  // Nothing about the vehicle could be tied to this leg's stops, so the
  // prediction answers — and the display says that is what it is.
  const { phase } = byTimetable(leg, now);
  return {
    ...common, phase, stopsAway: null, secondsAway,
    source: 'timetable', message: describe(phase, stopName, null, secondsAway),
  };
}

/**
 * The phases worth interrupting somebody for. Riding along quietly is not one
 * of them, and neither is a stop already behind the vehicle: an alert that
 * fires after the fact is noise on top of a missed stop.
 */
export function isAlertingPhase(phase: AlightPhase): boolean {
  return phase === 'prepare' || phase === 'next' || phase === 'now';
}

/** What a system notification for this moment says. */
export function alightNotification(alert: AlightAlert): { title: string; body: string } {
  const vehicle = `${alert.mode === 'bus' ? 'Bus' : alert.mode === 'ferry' ? 'Ferry' : 'Line'} ${alert.line}`.trim();
  switch (alert.phase) {
    case 'now':
      return { title: `Get off now — ${alert.stopName}`, body: `${vehicle} is at your stop, doors open.` };
    case 'next':
      return {
        title: `Next stop is yours — ${alert.stopName}`,
        body: alert.source === 'vehicle'
          ? `${vehicle} is running to your stop.`
          : `${vehicle} arrives in about ${minutes(Math.max(0, alert.secondsAway ?? 0))} min.`,
      };
    default:
      return {
        title: alert.message,
        body: `Get ready to leave ${vehicle} at ${alert.stopName}.`,
      };
  }
}
