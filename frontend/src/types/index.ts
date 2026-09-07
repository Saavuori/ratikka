export interface VehiclePosition {
  veh: string;
  desi: string;
  lat: number;
  lng: number;
  hdg: number;
  spd: number;
  /** Seconds behind schedule: positive is late, negative is early. */
  dl: number;
  drst: number;
  route: string;
  /**
   * The stop the vehicle is standing at or inside the stop area of. Null for
   * the whole run between two stops — over half the messages a tram sends — so
   * this is never the stop it is heading for. `nextStop` is.
   */
  stop: string | null;
  /**
   * The stop the vehicle is running to, as the feed itself reports it on every
   * message. Null only when the feed names none, `eol` included.
   */
  nextStop?: string | null;
  /** The vehicle has reached the end of its line; there is no next stop. */
  eol?: boolean;
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
  /**
   * The vehicle's newest traffic light priority exchange, from the HFP `tlr`
   * (the vehicle asks a junction for a green) and `tla` (the junction answers)
   * feeds. Absent whenever the vehicle has not asked anything in the last
   * ~25 seconds, which is most vehicles most of the time.
   */
  tlp?: SignalPriority;
}

/**
 * One traffic light priority exchange, as the vehicle and the junction
 * reported it. See backend/internal/mqtt/signal_priority.go.
 */
export interface SignalPriority {
  /**
   * `requesting` — asked, not yet answered; `granted`/`denied` — the junction
   * answered (HFP ACK/NAK); `norequest` — the vehicle reached a junction it is
   * equipped to ask and deliberately did not, with `reason` saying why.
   */
  status: 'requesting' | 'granted' | 'denied' | 'norequest';
  /**
   * Signal junction ID. The same number as the `id` on a traffic-light
   * feature, both being Helsinki's own junction numbering.
   */
  junction?: number;
  signalGroup?: number;
  signalGroupNbr?: number;
  requestId?: number;
  /** What was asked for: NORMAL, DOOR_CLOSE, DOOR_OPEN or ADVANCE. */
  requestType?: string;
  /** Priority level asked for: normal, high, or norequest. */
  level?: string;
  /** Why no request was sent: GLOBAL, AHEAD, LINE or PRIOEXEP. */
  reason?: string;
  /** Attempt sequence number of the current request. */
  attempts?: number;
  /** Radio protocol used: MQTT or KAR-MQTT. */
  protocol?: string;
  /** The vehicle's own timestamp for the newest event in the exchange. */
  ts: number;
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

/** One directional variant of a route: its polyline and which way it runs. */
export interface RoutePatternResponse {
  points: string;
  /** GTFS direction_id (0 or 1); HFP reports the same thing as `dir` "1"/"2". */
  directionId: number;
}

export interface RouteDetailsResponse {
  shortName: string;
  color: string;
  geometries: string[];
  /** The same polylines as `geometries`, carrying their direction. */
  patterns?: RoutePatternResponse[];
  stops: string[];
}

export interface StopInfo {
  gtfsId: string;
  name: string;
  code: string;
  lat: number;
  lon: number;
  platformCode?: string;
}

export interface StopDepartureInfo {
  line: string;
  headsign: string;
  scheduledArrival: string;
  realtimeArrival: string;
  delay: number;
  realtime: boolean;
  tripId: string;
  scheduledDeparture?: string;
  realtimeDeparture?: string;
  scheduledDepartureTime?: number;
  realtimeDepartureTime?: number;
  departureDelay?: number;
  realtimeState?: string;
  /**
   * Trip identity, carried so a departure can be matched to the live vehicle
   * actually serving it rather than guessed at from the line number.
   */
  routeId?: string;
  serviceDate?: string;
  directionId?: number;
  startTimeSeconds?: number;
  mode?: string;
}

export interface StopDetailsResponse {
  stop: StopInfo;
  routes: string[];
  departures: StopDepartureInfo[];
  fetchedAt?: number;
}

/** Next departures from one stop, as the batched arrivals endpoint returns them. */
export interface StopArrivalsEntry {
  gtfsId: string;
  name: string;
  departures: StopDepartureInfo[];
}

export interface StopsArrivalsResponse {
  stops: Record<string, StopArrivalsEntry>;
  fetchedAt?: number;
}

export interface NearbyStop extends StopInfo {
  distance: number;
}

export interface NearbyStopsResponse {
  stops: NearbyStop[];
  fetchedAt?: number;
}

export interface VersionResponse {
  version: string;
  build_date: string;
  git_sha: string;
}

/**
 * Browser-side map keys from `GET /api/v1/config`. Both are public by
 * necessity -- the tile requests are made by the browser -- and both are
 * rate-limited keys rather than billing credentials. `mml_api_key` is empty
 * when the deployment has no National Land Survey key, and the satellite
 * basemap is then not offered at all.
 */
export interface MapConfigResponse {
  digitransit_map_key: string;
  mml_api_key?: string;
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

export interface TrafficLightFeature {
  type: 'Feature';
  geometry: {
    type: 'Point';
    coordinates: [number, number]; // [lon, lat]
  };
  properties: {
    id: number;
    type: 'traffic_light' | 'warning_light';
    junction: string;
  };
}

export interface TrafficLightsFeatureCollection {
  type: 'FeatureCollection';
  features: TrafficLightFeature[];
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
  platformCode?: string;
}

export interface JourneyRoute {
  gtfsId?: string;
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
  tripId?: string;
  legId?: string;
  serviceDate?: string;
  directionId?: number;
  startTimeSeconds?: number;
  scheduledStartTime?: number;
  scheduledEndTime?: number;
  realtime?: boolean;
  departureDelay?: number;
  arrivalDelay?: number;
  realtimeState?: string;
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
  fetchedAt?: number;
}

export interface JourneyPlanOptions {
  date?: string;
  time?: string;
  arriveBy?: boolean;
}

export interface JourneyMonitorResponse {
  legs: (JourneyLeg | null)[];
  fetchedAt?: number;
}

// A resolved point used as journey origin/destination.
export interface JourneyEndpoint {
  name: string;
  lat: number;
  lon: number;
}

/** One day of recorded history, and how many minutes landed in each hour. */
export interface ReplayDayCoverage {
  date: string;
  /** Mode to a 24-entry array of minutes recorded in that hour. */
  hours: Record<string, number[]>;
}

/** What there is to replay: which modes, how far back, and where the gaps are. */
export interface ReplayIndexResponse {
  enabled: boolean;
  modes: string[];
  retentionDays: number;
  /** The server's clock, so the client scrubs against the archive's own now. */
  serverTime: number;
  days: ReplayDayCoverage[] | null;
}

/**
 * A slice of history. The samples carry the same fields as live vehicles, so
 * the map, popups and telemetry panels draw a replayed tram with the code they
 * already use for a running one.
 */
export interface ReplayWindowResponse {
  from: number;
  to: number;
  samples: VehiclePosition[];
  /** The window hit the server's cap and later readings are missing. */
  truncated: boolean;
  scanned: number;
}
