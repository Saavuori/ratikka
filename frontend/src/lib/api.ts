import type { MapConfigResponse, TripDetailsResponse, StopDetailsResponse, NearbyStopsResponse, StopsArrivalsResponse, VersionResponse, RouteDetailsResponse, BikeStationDetailsResponse, BikeStationsFeatureCollection, TrafficLightsFeatureCollection, AlertsListResponse, GeocodeResponse, JourneyPlanResponse, JourneyPlanOptions, JourneyMonitorResponse, JourneyEndpoint } from '../types';

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

/**
 * Next departures for several stops in one request. The map labels every stop
 * in view once it is zoomed in, and a request per stop would be a request per
 * stop on every refresh. The backend caps the batch, so pass the stops that
 * matter most first.
 */
export async function fetchStopsArrivals(stopIds: string[], signal?: AbortSignal): Promise<StopsArrivalsResponse> {
  const params = new URLSearchParams();
  stopIds.forEach((id) => params.append('id', id));
  const res = await fetch(`${API_BASE}/stops/arrivals?${params}`, { signal });
  if (!res.ok) {
    throw new Error(`Failed to fetch stop arrivals: ${res.statusText}`);
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

/**
 * The map keys, fetched once per page load. Both the map and the view toggles
 * need them -- the map to sign its tile requests, the toggles to know whether
 * the satellite basemap can be offered -- so the in-flight promise is shared
 * rather than the request being made twice. A failure resolves to no keys at
 * all: the map then draws what needs no key, which is what it did before.
 */
let mapConfigPromise: Promise<MapConfigResponse> | null = null;

export function fetchMapConfig(): Promise<MapConfigResponse> {
  if (!mapConfigPromise) {
    mapConfigPromise = fetch(`${API_BASE}/config`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch map config: ${res.statusText}`);
        return res.json() as Promise<MapConfigResponse>;
      })
      .catch((err) => {
        console.error('Failed to fetch map key config:', err);
        return { digitransit_map_key: '', mml_api_key: '' };
      });
  }
  return mapConfigPromise;
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
