import { useCallback, useEffect, useRef, useState } from 'react';
import type { VehiclePosition } from '../types';
import {
  rideEnded,
  rideVerdict,
  updateRideTracks,
  type LocationSample,
  type RideCandidate,
  type RideTrack,
} from '../lib/rideDetection';
import { readStorage, writeStorage } from '../lib/storage';

export type RideStatus =
  /** Not asked for: the phone is not being watched at all. */
  | 'off'
  | 'unavailable'
  | 'denied'
  /** Watching, with nothing yet proven. */
  | 'scanning'
  /** One vehicle fits, but not well enough to claim it without asking. */
  | 'suggesting'
  /** Locked on: the map is riding along. */
  | 'riding';

export const RIDE_STORAGE_KEY = 'rideDetection';

export interface RideDetection {
  status: RideStatus;
  /** The vehicle offered for confirmation, while `status` is `suggesting`. */
  suggestion: RideCandidate | null;
  /** Lines running alongside each other that the evidence cannot separate. */
  ambiguous: string[] | null;
  /** The vehicle being ridden, while `status` is `riding`. */
  rideVehicleId: string | null;
  /** The mode of the ride, so its feed can be kept on. */
  rideMode: string | null;
  error: string;
  start: () => void;
  stop: () => void;
  /** Take the offered vehicle: yes, this is the one I am on. */
  accept: () => void;
  /** Not this one — and do not offer this same run again. */
  dismiss: () => void;
}

/**
 * Watches the reader's own position and works out which live vehicle is
 * carrying them, using the evidence in `lib/rideDetection`.
 *
 * The watch is never started on its own: geolocation costs a permission
 * prompt and a radio, so it begins on a tap and is only resumed unprompted
 * when the reader has both asked for it before and already granted the
 * permission.
 */
export function useRideDetection(vehicles: VehiclePosition[]): RideDetection {
  const [status, setStatus] = useState<RideStatus>('off');
  const [suggestion, setSuggestion] = useState<RideCandidate | null>(null);
  const [ambiguous, setAmbiguous] = useState<string[] | null>(null);
  const [ride, setRide] = useState<{ veh: string; mode: string } | null>(null);
  const [error, setError] = useState('');

  // The watch callback outlives any one render, so the newest feed reaches it
  // through a ref rather than through a closure captured when the watch began.
  const vehiclesRef = useRef(vehicles);
  useEffect(() => { vehiclesRef.current = vehicles; }, [vehicles]);
  const tracksRef = useRef<Map<string, RideTrack>>(new Map());
  const previousRef = useRef<LocationSample | null>(null);
  const rideRef = useRef<{ veh: string; mode: string } | null>(null);
  const suggestionRef = useRef<RideCandidate | null>(null);
  /** Runs the reader has said they are not on, keyed by vehicle and trip. */
  const dismissedRef = useRef<Set<string>>(new Set());
  const watchRef = useRef<number | null>(null);

  const lock = useCallback((candidate: RideCandidate) => {
    const locked = { veh: candidate.veh, mode: candidate.mode };
    rideRef.current = locked;
    suggestionRef.current = null;
    setRide(locked);
    setSuggestion(null);
    setAmbiguous(null);
    setStatus('riding');
  }, []);

  const handleSample = useCallback((position: GeolocationPosition) => {
    const sample: LocationSample = {
      lat: position.coords.latitude,
      lon: position.coords.longitude,
      accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : 100,
      speed: position.coords.speed ?? null,
      ts: Date.now(),
    };
    tracksRef.current = updateRideTracks(tracksRef.current, vehiclesRef.current, sample, previousRef.current);
    previousRef.current = sample;
    setError('');

    const current = rideRef.current;
    if (current) {
      if (!rideEnded(tracksRef.current.get(current.veh), sample.ts)) return;
      // Stepped off, or the vehicle went quiet: back to watching.
      rideRef.current = null;
      setRide(null);
      setStatus('scanning');
      return;
    }

    const verdict = rideVerdict(tracksRef.current, sample.ts);
    if (verdict.kind === 'ambiguous') {
      suggestionRef.current = null;
      setSuggestion(null);
      setAmbiguous(verdict.among);
      setStatus('scanning');
      return;
    }
    setAmbiguous(null);
    if (verdict.kind === 'none' || dismissedRef.current.has(`${verdict.ride.veh}:${verdict.ride.tripId}`)) {
      suggestionRef.current = null;
      setSuggestion(null);
      setStatus('scanning');
      return;
    }
    if (verdict.ride.confidence === 'confirmed') {
      lock(verdict.ride);
      return;
    }
    suggestionRef.current = verdict.ride;
    setSuggestion(verdict.ride);
    setStatus('suggesting');
  }, [lock]);

  const handleError = useCallback((err: GeolocationPositionError) => {
    if (err.code === err.PERMISSION_DENIED) {
      if (watchRef.current !== null) {
        navigator.geolocation.clearWatch(watchRef.current);
        watchRef.current = null;
      }
      writeStorage(RIDE_STORAGE_KEY, 'false');
      setStatus('denied');
      setError('Location permission denied, so the ride cannot be detected.');
      return;
    }
    // A timeout between fixes is ordinary indoors and underground; the watch
    // stays on and the next fix resumes where this one left off.
    setError('Waiting for a position fix.');
  }, []);

  const start = useCallback(() => {
    if (watchRef.current !== null) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setStatus('unavailable');
      setError('Location is unavailable in this browser.');
      return;
    }
    tracksRef.current = new Map();
    previousRef.current = null;
    setError('');
    setStatus('scanning');
    writeStorage(RIDE_STORAGE_KEY, 'true');
    watchRef.current = navigator.geolocation.watchPosition(handleSample, handleError, {
      enableHighAccuracy: true,
      timeout: 20_000,
      maximumAge: 5_000,
    });
  }, [handleSample, handleError]);

  const stop = useCallback(() => {
    if (watchRef.current !== null) {
      navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
    }
    tracksRef.current = new Map();
    previousRef.current = null;
    rideRef.current = null;
    suggestionRef.current = null;
    dismissedRef.current = new Set();
    setRide(null);
    setSuggestion(null);
    setAmbiguous(null);
    setError('');
    setStatus('off');
    writeStorage(RIDE_STORAGE_KEY, 'false');
  }, []);

  const accept = useCallback(() => {
    if (suggestionRef.current) lock(suggestionRef.current);
  }, [lock]);

  const dismiss = useCallback(() => {
    const offered = suggestionRef.current;
    if (offered) dismissedRef.current.add(`${offered.veh}:${offered.tripId}`);
    suggestionRef.current = null;
    setSuggestion(null);
    setStatus('scanning');
  }, []);

  // Resume unprompted only for a reader who asked for this before and has
  // already granted the permission — never as an unexplained location prompt
  // on a page load.
  useEffect(() => {
    if (readStorage(RIDE_STORAGE_KEY) !== 'true') return;
    let cancelled = false;
    navigator.permissions?.query({ name: 'geolocation' })
      .then((permission) => {
        if (!cancelled && permission.state === 'granted') start();
      })
      .catch(() => { /* Permissions API absent: wait for the tap. */ });
    return () => { cancelled = true; };
  }, [start]);

  useEffect(() => () => {
    if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
  }, []);

  return {
    status,
    suggestion,
    ambiguous,
    rideVehicleId: ride?.veh ?? null,
    rideMode: ride?.mode ?? null,
    error,
    start,
    stop,
    accept,
    dismiss,
  };
}
