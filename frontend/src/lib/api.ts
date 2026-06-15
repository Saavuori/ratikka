import type { TripDetailsResponse, StopDetailsResponse, VersionResponse } from '../types';

const API_BASE = '/api/v1';

export async function fetchTripDetails(tripId: string): Promise<TripDetailsResponse> {
  const res = await fetch(`${API_BASE}/trip/${encodeURIComponent(tripId)}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch trip details: ${res.statusText}`);
  }
  return res.json();
}

export async function fetchStopDetails(stopId: string, departures = 10): Promise<StopDetailsResponse> {
  const res = await fetch(`${API_BASE}/stop/${encodeURIComponent(stopId)}?departures=${departures}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch stop departures: ${res.statusText}`);
  }
  return res.json();
}

export async function fetchVersionInfo(): Promise<VersionResponse> {
  const res = await fetch(`${API_BASE}/version`);
  if (!res.ok) {
    throw new Error(`Failed to fetch version info: ${res.statusText}`);
  }
  return res.json();
}
