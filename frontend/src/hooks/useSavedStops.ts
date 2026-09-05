import { useSyncExternalStore } from 'react';
import type { StopInfo } from '../types';
import { MAX_SAVED_STOPS, parseSavedStops } from '../lib/departures';
import { readStorage, writeStorage } from '../lib/storage';

const STORAGE_KEY = 'hsl-live-saved-stops';
const empty: StopInfo[] = [];
let saved: StopInfo[] | undefined;
const listeners = new Set<() => void>();

export function getSavedStops(): StopInfo[] {
  return saved ??= parseSavedStops(readStorage(STORAGE_KEY));
}

function notify() {
  listeners.forEach((listener) => listener());
}

function onStorage(event: StorageEvent) {
  if (event.key !== STORAGE_KEY && event.key !== null) return;
  saved = parseSavedStops(event.newValue);
  notify();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('storage', onStorage);
  };
}

export function toggleSavedStop(stop: StopInfo) {
  const current = getSavedStops();
  if (current.some((item) => item.gtfsId === stop.gtfsId)) {
    saved = current.filter((item) => item.gtfsId !== stop.gtfsId);
  } else {
    if (current.length >= MAX_SAVED_STOPS) return;
    saved = parseSavedStops(JSON.stringify([...current, stop]));
  }
  writeStorage(STORAGE_KEY, JSON.stringify(saved));
  notify();
}

export function useSavedStops() {
  const savedStops = useSyncExternalStore(subscribe, getSavedStops, () => empty);
  return { savedStops, toggleStop: toggleSavedStop };
}
