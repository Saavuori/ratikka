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
  acc?: number;
  odo?: number;
  loc?: string;
  oper?: number;
  jrn?: number;
  occu?: number;
  dir?: string;
  oday?: string;
  start?: string;
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
  stops: string[];
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

export interface BikeStationFeature {
  type: 'Feature';
  geometry: {
    type: 'Point';
    coordinates: [number, number]; // [lon, lat]
  };
  properties: {
    stationId: string;
    name: string;
    bikesAvailable: number;
    spacesAvailable: number;
    allowPickup: boolean;
    allowDropoff: boolean;
  };
}

export interface BikeStationsFeatureCollection {
  type: 'FeatureCollection';
  features: BikeStationFeature[];
}

export interface AlertEntity {
  type: string; // "Route" or "Stop"
  gtfsId: string;
  shortName?: string;
  mode?: string;
  name?: string;
  code?: string;
}

export interface Alert {
  feed: string;
  severityLevel: 'INFO' | 'WARNING' | 'SEVERE';
  effect: string;
  cause: string;
  headerText: string;
  descriptionText: string;
  url: string;
  startDate: number;
  endDate: number;
  entities: AlertEntity[];
}

export interface AlertsListResponse {
  alerts: Alert[];
}

// --- Destination search & journey planning ---

export interface GeocodeResult {
  id: string;
  name: string;
  label: string;
  locality?: string;
  layer?: string;
  lat: number;
  lon: number;
}

export interface GeocodeResponse {
  results: GeocodeResult[];
}

export interface JourneyPlace {
  name: string;
  lat: number;
  lon: number;
  stopId?: string;
  stopCode?: string;
}

export interface JourneyRoute {
  shortName: string;
  longName: string;
  color: string;
  mode: string;
}

export interface JourneyLeg {
  mode: string;
  transit: boolean;
  duration: number; // seconds
  distance: number; // meters
  startTime: number; // epoch ms
  endTime: number; // epoch ms
  headsign?: string;
  route?: JourneyRoute;
  from: JourneyPlace;
  to: JourneyPlace;
  intermediateStops: JourneyPlace[];
  geometry: string; // encoded polyline
}

export interface JourneyItinerary {
  duration: number; // seconds
  walkDistance: number; // meters
  startTime: number; // epoch ms
  endTime: number; // epoch ms
  transfers: number;
  legs: JourneyLeg[];
}

export interface JourneyPlanResponse {
  itineraries: JourneyItinerary[];
}

// A resolved point used as journey origin/destination.
export interface JourneyEndpoint {
  name: string;
  lat: number;
  lon: number;
}


