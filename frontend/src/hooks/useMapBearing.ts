import { useSyncExternalStore } from 'react';

/**
 * The map's bearing, for the one piece of chrome that turns with it: the
 * heading arrow on the vehicle card.
 *
 * It is a store of its own rather than state in `App` because it changes on
 * every `rotate` event — and while the camera follows a vehicle round a bend,
 * or a reader twists the map with two fingers, that is every animation frame.
 * Held in `App`, each of those frames re-rendered the whole application;
 * here, only the component that reads it does.
 *
 * Kept to whole degrees: the arrow eases between angles with a CSS
 * transition, so a fraction of a degree is invisible and not worth a render.
 */
let bearing = 0;
const listeners = new Set<() => void>();

export function publishMapBearing(next: number): void {
  const rounded = Math.round(next);
  if (rounded === bearing) return;
  bearing = rounded;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getBearing(): number {
  return bearing;
}

export function useMapBearing(): number {
  return useSyncExternalStore(subscribe, getBearing, getBearing);
}
