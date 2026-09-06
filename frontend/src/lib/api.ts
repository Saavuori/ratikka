import type { TripDetailsResponse, StopDetailsResponse, NearbyStopsResponse, VersionResponse, RouteDetailsResponse, BikeStationDetailsResponse, BikeStationsFeatureCollection, TrafficLightsFeatureCollection, AlertsListResponse, GeocodeResponse, JourneyPlanResponse, JourneyPlanOptions, JourneyMonitorResponse, JourneyEndpoint } from '../types';

const API_BASE = '/api/v1';

export async function fetchTripDetails(tripId: string): Promise<TripDetailsResponse> {
  const res = await fetch(`${API_BASE}/trip/${encodeURIComponent(tripId)}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch trip details: ${res.statusText}`);
  }
  return res.json();
}

export async function fetchStopDetails(stopId: string, departures = 10, signal?: AbortSignal): Promise<StopDetailsResponse> {
  const res = await fetch(`${API_BASE}/stop/${encodeURIComponent(stopId)}?departures=${departures}`, { signal });
  if (!res.ok) {
    throw new Error(`Failed to fetch stop departures: ${res.statusText}`);
  }
  return res.json();
}

export async function fetchNearbyStops(lat: number, lon: number, signal?: AbortSignal): Promise<NearbyStopsResponse> {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon) });
  const res = await fetch(`${API_BASE}/stops/nearby?${params}`, { signal });
  if (!res.ok) {
    throw new Error(`Failed to fetch nearby stops: ${res.statusText}`);
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

export async function fetchRouteDetails(shortName: string): Promise<RouteDetailsResponse> {
  const res = await fetch(`${API_BASE}/route/${encodeURIComponent(shortName)}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch route details: ${res.statusText}`);
  }
  return res.json();
}

export async function fetchBikeStationDetails(stationId: string): Promise<BikeStationDetailsResponse> {
  const res = await fetch(`${API_BASE}/bike-station/${encodeURIComponent(stationId)}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch bike station details: ${res.statusText}`);
  }
  return res.json();
}

/**
 * Fetch every city-bike station with live bike/dock counts as a GeoJSON
 * FeatureCollection, ready to feed straight into a MapLibre source. The counts
 * come from the realtime API (the map's vector tiles carry no availability).
 */
export async function fetchBikeStations(): Promise<BikeStationsFeatureCollection> {
  const res = await fetch(`${API_BASE}/bike-stations`);
  if (!res.ok) {
    throw new Error(`Failed to fetch bike stations: ${res.statusText}`);
  }
  return res.json();
}

/**
 * Fetch every known signalized-junction location in Helsinki (traffic lights
 * + pedestrian/cyclist warning lights) as a GeoJSON FeatureCollection. This is
 * a static reference dataset (Helsinki open data, CC BY 4.0) — fetch once, no
 * polling needed.
 */
export async function fetchTrafficLights(): Promise<TrafficLightsFeatureCollection> {
  const res = await fetch(`${API_BASE}/traffic-lights`);
  if (!res.ok) {
    throw new Error(`Failed to fetch traffic lights: ${res.statusText}`);
  }
  return res.json();
}

export async function fetchAlerts(): Promise<AlertsListResponse> {
  const res = await fetch(`${API_BASE}/alerts`);
  if (!res.ok) {
    throw new Error(`Failed to fetch service alerts: ${res.statusText}`);
  }
  return res.json();
}

/**
 * Search for a destination by free-text. An optional focus point (typically the
 * user's current location) ranks nearby results first.
 */
export async function fetchGeocode(
  text: string,
  focus?: { lat: number; lon: number },
  signal?: AbortSignal
): Promise<GeocodeResponse> {
  const params = new URLSearchParams({ text });
  if (focus) {
    params.set('lat', String(focus.lat));
    params.set('lon', String(focus.lon));
  }
  const res = await fetch(`${API_BASE}/geocode?${params.toString()}`, { signal });
  if (!res.ok) {
    throw new Error(`Failed to search destination: ${res.statusText}`);
  }
  return res.json();
}

/**
 * Plan a journey between two points, returning ranked itineraries with the
 * exact stops the rider would board and alight at.
 */
export async function fetchJourneyPlan(
  from: JourneyEndpoint,
  to: JourneyEndpoint,
  signal?: AbortSignal,
  options: JourneyPlanOptions = {}
): Promise<JourneyPlanResponse> {
  const params = new URLSearchParams({
    fromLat: String(from.lat),
    fromLon: String(from.lon),
    toLat: String(to.lat),
    toLon: String(to.lon),
  });
  if (options.date) params.set('date', options.date);
  if (options.time) params.set('time', options.time);
  if (options.arriveBy !== undefined) params.set('arriveBy', String(options.arriveBy));
  const res = await fetch(`${API_BASE}/plan?${params.toString()}`, { signal });
  if (!res.ok) {
    throw new Error(`Failed to plan journey: ${res.statusText}`);
  }
  return res.json();
}

export async function fetchJourneyMonitor(legIds: string[], signal?: AbortSignal): Promise<JourneyMonitorResponse> {
  const params = new URLSearchParams();
  legIds.forEach((id) => params.append('legId', id));
  const res = await fetch(`${API_BASE}/journey/monitor?${params}`, { signal });
  if (!res.ok) {
    throw new Error(`Failed to refresh journey: ${res.statusText}`);
  }
  return res.json();
}
