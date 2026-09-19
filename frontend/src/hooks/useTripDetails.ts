import { useEffect, useState } from 'react';
import { fetchTripDetails } from '../lib/api';
import type { TripDetailsResponse } from '../types';

export interface TripDetails {
  details: TripDetailsResponse | null;
  loading: boolean;
  error: string | null;
}

/** What one fetch settled on, and which trip it was for. */
interface Loaded {
  tripId: string | null;
  details: TripDetailsResponse | null;
  error: string | null;
}

const NOTHING: Loaded = { tripId: null, details: null, error: null };

/**
 * The timetable behind a running journey: the stops it calls at and when it is
 * due at each.
 *
 * Fetched once per trip and held until the selection moves to a different one,
 * so following a vehicle along its route is one request rather than one per
 * position message. A fetch still in flight when the selection changes is
 * abandoned rather than allowed to overwrite the newer one.
 *
 * The result carries the trip it was loaded for, so a selection that has moved
 * on reads as "nothing yet" without the effect having to clear it first —
 * which is what the answer for the new trip actually is, and what stops a
 * stale timetable being shown for a second against the wrong vehicle.
 */
export function useTripDetails(tripId: string | null | undefined): TripDetails {
  const [loaded, setLoaded] = useState<Loaded>(NOTHING);

  useEffect(() => {
    if (!tripId) return;

    let active = true;
    fetchTripDetails(tripId)
      .then((details) => {
        if (active) setLoaded({ tripId, details, error: null });
      })
      .catch((err) => {
        if (!active) return;
        console.error('Failed to fetch trip details:', err);
        setLoaded({ tripId, details: null, error: 'Failed to load trip timetable' });
      });

    return () => {
      active = false;
    };
  }, [tripId]);

  const current = loaded.tripId === (tripId ?? null) ? loaded : NOTHING;
  return {
    details: current.details,
    error: current.error,
    loading: Boolean(tripId) && current.details === null && current.error === null,
  };
}
