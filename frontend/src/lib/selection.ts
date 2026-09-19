import type { ArrivalFocus } from './stopArrivals';
import type { ModeFlags } from './modes';
import { NO_MODES } from './modes';
import { areTripsEquivalent } from './trip';
import type { VehiclePosition } from '../types';

/** A stop as it is picked: off the map, or from the departures board. */
export interface PickedStop {
  id: string;
  name: string;
  code: string;
  lat?: number;
  lng?: number;
  mode?: string;
  isTrunkStop?: boolean;
  /** Walking distance from the reader's location, metres — nearby stops only. */
  distance?: number;
  /** Start following the next arrival as soon as one can be located. */
  autoTrack?: boolean;
}

/**
 * An open stop, and what its panel has since reported about it. They belong
 * to the stop rather than beside it, so picking anything else lets them go
 * with it instead of leaving the stop's feeds and routes switched on.
 */
export interface StopSelection {
  kind: 'stop';
  stop: PickedStop;
  /** Lines calling at the stop; empty until its departures have loaded. */
  routes: string[];
  /** The optional feeds its departures need for a vehicle to be matched. */
  modes: ModeFlags;
  /** The arrival the map is following, published by the stop panel. */
  arrivalFocus: ArrivalFocus | null;
}

/**
 * The one thing the detail panel is about. Exclusive by construction: picking
 * something is the whole of letting go of whatever was picked before.
 */
export type Selection =
  | { kind: 'vehicle'; vehicle: VehiclePosition }
  /**
   * A trip picked from a timetable before its vehicle has entered the live
   * feed. The placeholder carries the trip for the timetable panel to load;
   * it has no position, so nothing draws or follows it.
   */
  | { kind: 'scheduledTrip'; placeholder: VehiclePosition }
  | StopSelection
  | { kind: 'bikeStation'; station: { id: string; name: string } }
  | { kind: 'junction'; junctionId: number };

export function stopSelection(stop: PickedStop): StopSelection {
  return { kind: 'stop', stop, routes: [], modes: NO_MODES, arrivalFocus: null };
}

/**
 * A trip picked from a timetable: its vehicle if it is already running,
 * otherwise a placeholder the vehicle replaces once it appears.
 */
export function tripSelection(tripId: string, line: string, vehicles: VehiclePosition[]): Selection {
  const vehicle = findTripVehicle(tripId, vehicles);
  if (vehicle) return { kind: 'vehicle', vehicle };
  return {
    kind: 'scheduledTrip',
    placeholder: {
      veh: '0',
      desi: line || '?',
      lat: 0,
      lng: 0,
      hdg: 0,
      spd: 0,
      dl: 0,
      drst: 0,
      route: '',
      stop: null,
      ts: Date.now() / 1000,
      tripId,
      mode: 'tram',
    },
  };
}

/**
 * What is selected, as a key that stays put while the selection itself is
 * updated — a stop's panel reporting its departures, a vehicle moving on.
 */
export function selectionKey(selection: Selection | null): string | null {
  switch (selection?.kind) {
    case undefined:
      return null;
    case 'vehicle':
      return `vehicle:${selection.vehicle.veh}`;
    case 'scheduledTrip':
      return `trip:${selection.placeholder.tripId}`;
    case 'stop':
      return `stop:${selection.stop.id}`;
    case 'bikeStation':
      return `bikeStation:${selection.station.id}`;
    case 'junction':
      return `junction:${selection.junctionId}`;
  }
}

export function findTripVehicle(
  tripId: string | undefined,
  vehicles: VehiclePosition[],
): VehiclePosition | undefined {
  return vehicles.find((vehicle) => areTripsEquivalent(vehicle.tripId, tripId));
}
