export interface VehiclePosition {
  veh: string;
  desi: string;
  lat: number;
  lng: number;
  hdg: number;
  spd: number;
  dl: number;
  drst: number;
  route: string;
  stop: string | null;
  ts: number;
  tripId: string;
  mode: string;
}

export interface PositionsMessage {
  type: 'positions';
  timestamp: string;
  vehicles: Record<string, VehiclePosition>;
  count: number;
}

export interface RouteResponse {
  shortName: string;
  longName: string;
  color: string;
}

export interface StopArrival {
  gtfsId?: string;
  name: string;
  code: string;
  lat: number;
  lon: number;
  scheduledArrival: string;
  realtimeArrival: string;
  delay: number;
  realtime: boolean;
}

export interface TripDetailsResponse {
  tripId: string;
  route: RouteResponse;
  headsign: string;
  stops: StopArrival[];
  geometry?: string;
}

export interface RouteDetailsResponse {
  shortName: string;
  color: string;
  geometries: string[];
}

export interface StopInfo {
  gtfsId: string;
  name: string;
  code: string;
  lat: number;
  lon: number;
}

export interface StopDepartureInfo {
  line: string;
  headsign: string;
  scheduledArrival: string;
  realtimeArrival: string;
  delay: number;
  realtime: boolean;
  tripId: string;
}

export interface StopDetailsResponse {
  stop: StopInfo;
  routes: string[];
  departures: StopDepartureInfo[];
}

export interface VersionResponse {
  version: string;
  build_date: string;
  git_sha: string;
}

export interface BikeStationDetailsResponse {
  stationId: string;
  name: string;
  allowPickup: boolean;
  allowDropoff: boolean;
  bikesAvailable: number;
  spacesAvailable: number;
}

