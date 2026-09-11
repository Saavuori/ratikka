import type {
  JourneyEndpoint,
  JourneyLeg,
  TripDetailsResponse,
  VehiclePosition,
} from '../types';
import type { ArrivalFocus } from '../lib/stopArrivals';
import type { ModeFlags } from '../lib/modes';
import type { MapTheme } from '../lib/stopPlatforms';

/**
 * What the map is told, grouped by what it is about.
 *
 * These were thirty-seven separate props, four of which were one selected stop
 * taken apart at the call site and put back together inside. Grouping them
 * says which inputs belong together, and lets a whole overlay be passed or
 * cleared as one thing.
 */

/** The stop the reader has open, with what the map needs to draw it. */
export interface SelectedStop {
  id: string;
  coords: [number, number] | null;
  /** The stop's GTFS mode, which decides its sign board and disc. */
  mode: string | null;
  /** Trunk-route stops take the orange sign rather than the blue one. */
  isTrunk: boolean;
}

/**
 * What the reader has picked out. App keeps these mutually exclusive — opening
 * one closes the others — but the map does not depend on that.
 */
export interface MapSelection {
  vehicleId: string | null;
  /**
   * Line number (`desi`) of the selected vehicle. Its route path is drawn
   * emphasised while every other highlighted route is dimmed.
   */
  line: string | null;
  tripDetails: TripDetailsResponse | null;
  stop: SelectedStop | null;
  bikeStationId: string | null;
  junctionId: number | null;
}

/** What the map draws, regardless of what is selected. */
export interface MapView {
  theme: MapTheme;
  is3D: boolean;
  always3DVehicles: boolean;
  /** Which vehicle modes the map draws, and with them their stops and routes. */
  modes: ModeFlags;
  showRoutes: boolean;
  /** Lines the reader has narrowed the map to; empty means all of them. */
  lineFilters: string[];
}

/** The planned journey drawn over the map, if there is one. */
export interface JourneyOverlay {
  legs: JourneyLeg[] | null;
  endpoints: { from: JourneyEndpoint; to: JourneyEndpoint } | null;
  /** Vehicles serving the journey, which stay drawn through any filter. */
  vehicleIds: string[];
}

/**
 * The arrival being followed at the selected stop, and the geometry of its
 * trip. Arrival focus is the selected-vehicle highlight run from the other end
 * — a stop and the vehicle coming to it — so it drives the same layers.
 */
export interface ArrivalOverlay {
  focus: ArrivalFocus | null;
  tripDetails: TripDetailsResponse | null;
  /**
   * Stops whose next arrival should be labelled, keyed by unprefixed stop id.
   * Zooming in on a stop is the whole gesture: the sign board appears and what
   * is coming to it appears with it.
   */
  labels: Record<string, { label: string; color: string }>;
}

/** Everything the map hands back to the app. */
export interface MapCallbacks {
  onSelectTram: (tram: VehiclePosition | null) => void;
  onSelectStop: (
    stopId: string,
    name: string,
    code: string,
    lat?: number,
    lng?: number,
    mode?: string,
    isTrunkStop?: boolean
  ) => void;
  onSelectBikeStation: (station: { id: string; name: string } | null) => void;
  /** A signalised junction was picked off the map; null closes the panel. */
  onSelectJunction: (junctionId: number | null) => void;
  onDisableFollowing: () => void;
  onMapBearingChange?: (bearing: number) => void;
  /**
   * Whether the map's own locate control is switched on — including its
   * background state, where the dot keeps up but the camera has been let go.
   * Riding along is only offered to a reader who has already said where they
   * are, so the offer follows this.
   */
  onLocatingChange?: (locating: boolean) => void;
  /**
   * Which stops are close enough to the middle of a zoomed-in view to be worth
   * a label. Reported when the view settles, never per frame.
   */
  onVisibleStopsChange?: (stopIds: string[]) => void;
}

export const NO_SELECTION: MapSelection = {
  vehicleId: null,
  line: null,
  tripDetails: null,
  stop: null,
  bikeStationId: null,
  junctionId: null,
};

export const NO_JOURNEY: JourneyOverlay = {
  legs: null,
  endpoints: null,
  vehicleIds: [],
};

export const NO_ARRIVALS: ArrivalOverlay = {
  focus: null,
  tripDetails: null,
  labels: {},
};
