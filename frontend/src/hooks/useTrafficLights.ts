import { useEffect, useState } from 'react';
import { fetchTrafficLights } from '../lib/api';
import type { TrafficLightFeature } from '../types';

// Signalized-junction locations are static reference data (server caches them
// 24h) shared by the map layer and the tram popup's "why stopped" badge.
// Memoized at module scope so both consumers trigger exactly one network
// fetch per page load instead of one each.
let cachedFeatures: TrafficLightFeature[] | null = null;
let inflight: Promise<TrafficLightFeature[]> | null = null;

function loadTrafficLights(): Promise<TrafficLightFeature[]> {
  if (cachedFeatures) return Promise.resolve(cachedFeatures);
  if (!inflight) {
    inflight = fetchTrafficLights()
      .then((data) => {
        cachedFeatures = data.features ?? [];
        return cachedFeatures;
      })
      .catch((err) => {
        inflight = null; // allow a retry on the next mount
        throw err;
      });
  }
  return inflight;
}

export function useTrafficLights(): TrafficLightFeature[] {
  const [features, setFeatures] = useState<TrafficLightFeature[]>(cachedFeatures ?? []);

  useEffect(() => {
    let cancelled = false;
    loadTrafficLights()
      .then((data) => {
        if (!cancelled) setFeatures(data);
      })
      .catch((err) => {
        console.error('Failed to fetch traffic-light junction locations', err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return features;
}
