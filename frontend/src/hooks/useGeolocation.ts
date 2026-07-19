import { useState, useCallback, useRef } from 'react';

export type GeoStatus = 'idle' | 'locating' | 'granted' | 'denied' | 'unavailable';

export interface GeoCoords {
  lat: number;
  lon: number;
}

/**
 * Thin wrapper around the browser Geolocation API. Call `request()` to (re)fetch
 * the current position; the promise resolves with coordinates or rejects on
 * error. Status is exposed for lightweight UI feedback.
 */
export function useGeolocation() {
  const [coords, setCoords] = useState<GeoCoords | null>(null);
  const [status, setStatus] = useState<GeoStatus>('idle');
  const inFlightRef = useRef<Promise<GeoCoords> | null>(null);

  const request = useCallback((): Promise<GeoCoords> => {
    if (inFlightRef.current) return inFlightRef.current;

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setStatus('unavailable');
      return Promise.reject(new Error('Geolocation is not available'));
    }

    setStatus('locating');
    const promise = new Promise<GeoCoords>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const next = { lat: pos.coords.latitude, lon: pos.coords.longitude };
          setCoords(next);
          setStatus('granted');
          resolve(next);
        },
        (err) => {
          setStatus(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable');
          reject(err);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
      );
    });

    inFlightRef.current = promise.finally(() => {
      inFlightRef.current = null;
    });
    return inFlightRef.current;
  }, []);

  return { coords, status, request };
}
