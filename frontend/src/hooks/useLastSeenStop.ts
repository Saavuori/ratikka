import { useState } from 'react';
import type { VehiclePosition } from '../types';

type StopReport = Pick<VehiclePosition, 'stop' | 'tripId'>;

/** The last stop named on a trip: what `useLastSeenStop` remembers. */
export interface SeenStop {
  tripId: string;
  stopId: string | null;
}

/**
 * What a new report makes of the remembered stop. The same object comes back
 * when nothing has changed, which is what tells the hook not to set state.
 */
export function nextSeenStop(seen: SeenStop, vehicle: StopReport): SeenStop {
  const newTrip = seen.tripId !== vehicle.tripId;
  if (!newTrip && (!vehicle.stop || vehicle.stop === seen.stopId)) return seen;
  return { tripId: vehicle.tripId, stopId: vehicle.stop || (newTrip ? null : seen.stopId) };
}

/**
 * The most recent stop a vehicle reported standing at on its current trip.
 *
 * `stop` is only set while the vehicle is at a stop, and empty between stops,
 * so progress along the trip would flicker back to "unknown" every time it
 * pulls away. This keeps the last one it named until it names another — and
 * forgets it when the vehicle starts a new trip, where a stop from the last
 * one says nothing about how far along this one it is.
 *
 * Held as state adjusted during render (React's derived-state pattern), not
 * synced in an effect, so the render that sees a new stop already uses it.
 */
export function useLastSeenStop(vehicle: StopReport): string | null {
  const [seen, setSeen] = useState<SeenStop>(() => ({ tripId: vehicle.tripId, stopId: vehicle.stop || null }));
  const next = nextSeenStop(seen, vehicle);
  if (next !== seen) setSeen(next);
  return next.stopId;
}
