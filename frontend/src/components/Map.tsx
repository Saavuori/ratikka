import React, { useEffect, useMemo, useRef } from 'react';
// MapLibre GL 6 is ESM-only and dropped the default export.
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// v6 splits the tile-parsing worker into its own chunk and locates it with
// `new URL(\`./${name}\`, import.meta.url)` -- a template literal, which no
// bundler can analyse statically. Vite therefore emits no worker chunk, the
// request 404s into the SPA's index.html fallback, and the worker dies while
// constructing. Nothing throws: the main thread still fetches every TileJSON
// and the sprite, so the console stays clean, but no vector tile is ever
// parsed and the map paints nothing. Handing MapLibre a URL Vite *did* emit
// is what makes v6 render.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { Feature, FeatureCollection } from 'geojson';
import type { VehiclePosition, TripDetailsResponse, JourneyLeg, JourneyEndpoint } from '../types';
import { lerp, lerpAngle, clamp, smoothstep, easeByAccel } from '../lib/lerp';
import { decodePolyline } from '../lib/polyline';
import type { ModeFlags, TransportMode } from '../lib/modes';
import type {
  ArrivalOverlay,
  JourneyOverlay,
  MapCallbacks,
  MapSelection,
  MapView,
} from '../map/props';
import {
  forgetBaseFilters,
  updateRouteVisibility,
} from '../map/routeNetwork';
import {
  ARRIVAL_LABEL_SOURCE,
  STOP_MODE,
  installMapLayers,
  update3DMode,
  updateMetroSignVisibility,
  updateVehicle3DMode,
} from '../map/layers';
import { tripProgress, isBoardingAt } from '../lib/nextStop';
import { ARRIVAL_LABEL_MIN_ZOOM, ARRIVAL_LABEL_STOP_LIMIT } from '../lib/stopArrivals';
import type { ArrivalFocus } from '../lib/stopArrivals';
import {
  getRouteColor,
} from '../lib/routeColors';
import {
  ferryIconBucket,
} from '../lib/ferryIcon';
import { occupancyFraction } from '../lib/occupancy';
import {
  buildPatternTracks,
  distanceBetween,
  hfpDirectionId,
  isHelsinkiCentralStationZone,
  isSnappedMode,
  orientOnTracks,
  placeOnTracks,
  pointOnTrack,
  snappedLinesInFeed,
  trackSpine,
} from '../lib/railTracks';
import { advanceAlongHeading } from '../lib/geo';
import { useSyncRef } from '../hooks/useSyncRef';
import {
  glideFraction,
  hasMoved,
  predictedAdvance,
  reckonLimits,
} from '../lib/deadReckon';
import type { ReckonLimits } from '../lib/deadReckon';
import type { PlaceOptions, RailTrack, TrackPlacement } from '../lib/railTracks';
import { assignCorridorSlots, directionalPaths } from '../lib/routeSlots';
import type { RoutePath } from '../lib/routeSlots';
import {
  vehicleExtrusionCollection,
  VEHICLE_3D_MIN_ZOOM,
} from '../lib/vehicleModels';
import type { BodySpine, VehicleState } from '../lib/vehicleModels';
import {
  PLATFORM_FILL_LAYER,
} from '../lib/stopPlatforms';
import type { MapTheme } from '../lib/stopPlatforms';
import {
  SATELLITE_ATTRIBUTION,
} from '../lib/satelliteBasemap';
import {
  stopFurnitureCollection,
  longestEdgeBearing,
  nearestLineBearing,
  pointInRing,
  STOP_3D_MIN_ZOOM,
  STOP_FURNITURE_LIMIT,
  STOP_FURNITURE_SOURCE,
  STOP_FURNITURE_LAYER,
} from '../lib/stopModels';
import type { StopFurnitureState } from '../lib/stopModels';
import {
  STOP_CIRCLE_MIN_ZOOM,
  STATION_CIRCLE_MIN_ZOOM,
  STOP_CIRCLE_FADE_ZOOM,
  STOP_CIRCLE_RADIUS,
  STATION_CIRCLE_RADIUS,
  STOP_CIRCLE_STROKE_WIDTH,
  STOP_CIRCLE_STROKE_COLOR,
  STOP_CIRCLE_OPACITY,
  STOP_CIRCLE_LAYERS,
  STATION_CIRCLE_LAYERS,
} from '../lib/stopCircleStyle';
import {
  bikeStationCollection,
  BIKE_3D_MIN_ZOOM,
  BIKE_STATION_LIMIT,
  BIKE_STATION_SOURCE,
  BIKE_STATION_LAYER,
} from '../lib/bikeStationModels';
import type { BikeStationState } from '../lib/bikeStationModels';
import { advanceDoors, isVehicleBraking, vehicles3DEnabled } from '../lib/vehicleAnimation';
import type { DoorAnimation } from '../lib/vehicleAnimation';
import { fetchBikeStations, fetchMapConfig } from '../lib/api';
import {
  signalPriorityIndex,
  TRAFFIC_LIGHT_SOURCE,
  TRAFFIC_LIGHT_ICON_LAYER,
  TRAFFIC_LIGHT_SELECTION_LAYER,
} from '../lib/trafficLightModels';
import type { JunctionPriorityIndex } from '../lib/trafficLightModels';
import type { BikeStationsFeatureCollection, TrafficLightFeature } from '../types';
import { useTrafficLights } from '../hooks/useTrafficLights';
import { useRoutePatterns } from '../hooks/useRoutePatterns';

maplibregl.setWorkerUrl(maplibreWorkerUrl);

// The sign-board layer filters on GTFS mode names, in the order the style
// stacks them.
const GTFS_SIGN_MODES: Array<{ mode: TransportMode; gtfs: string }> = [
  { mode: 'tram', gtfs: 'TRAM' },
  { mode: 'bus', gtfs: 'BUS' },
  { mode: 'metro', gtfs: 'SUBWAY' },
  { mode: 'train', gtfs: 'RAIL' },
  { mode: 'ferry', gtfs: 'FERRY' },
];

/** Carto's dark-matter: the dark theme's basemap, and the labels satellite keeps. */
const DARK_STYLE_URL = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

/**
 * Which vector style a map mode loads. Satellite is the dark style too — the
 * orthophoto is a raster layer added under its labels once it has loaded (see
 * `ensureSatelliteBasemap`), not a style of its own.
 */
const basemapStyleUrl = (theme: MapTheme): string =>
  theme === 'light' ? `${window.location.origin}/style.json` : DARK_STYLE_URL;



// Paint expressions for the highlighted route paths live in lib/routeLineStyle,
// where the zoom stops of the offset fan are unit-tested against the style spec.

interface MapProps {
  /** The vehicles to draw, live or replayed. */
  trams: Record<string, VehiclePosition>;
  /** Fetched pattern geometry per line, drawn as the highlighted ribbons. */
  routeGeometries: Record<string, { geometries: string[]; color?: string; stops?: string[] }>;
  selection: MapSelection;
  view: MapView;
  journey: JourneyOverlay;
  arrivals: ArrivalOverlay;
  callbacks: MapCallbacks;
  /** Whether the camera is tracking the selected vehicle. */
  isFollowing: boolean;
  /**
   * How many seconds of history a second of wall clock covers. One while the
   * live feed is playing, and the replay speed while history is.
   *
   * Everything the animation does with distance — carrying a vehicle forward
   * on its own speed and acceleration, deciding a step is too large to be real
   * — is measured in seconds of *history*, while the glide between two
   * snapshots is measured on the wall clock. At one times these are the same
   * number and this changes nothing. At sixty times a snapshot arrives every
   * eighth of a second carrying eight seconds of travel, and a map told only
   * the wall figure would conclude that every vehicle on it had teleported.
   */
  timeScale?: number;
}

// One vehicle in the GeoJSON collection the map's icon layers read. Named so
// the per-frame rebuild can push into a typed array rather than mapping over
// every vehicle in the feed and throwing most of the result away.
interface VehicleFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: {
    veh: string;
    desi: string;
    hdg: number;
    stopped: boolean;
    mode: string;
    spd: number;
    acc: number;
    speedNorm: number;
    doorsOpen: boolean;
    /**
     * Which load step the vessel is reporting, as an index into
     * `OCCUPANCY_BUCKETS`; -1 for every mode that does not measure occupancy and
     * for a ferry whose counter is silent. The vehicle-body layer matches on it
     * to pick the marker with the right deck gauge.
     */
    occuBucket: number;
  };
}

interface RenderPosition {
  lat: number;
  lng: number;
  hdg: number;
  // Rail modes only: where this position sits on the line's own track
  // geometry, so the animation can slide a vehicle *along* its rails between
  // two snapshots instead of cutting across the ground between them, and so an
  // articulated body can be bent along them. See lib/railTracks.
  track?: TrackPlacement;
}

// A metro position is only pulled onto the tracks if it is within this far of
// them. Underground, HFP positions are dead-reckoned and drift by a couple of
// hundred metres; past that the message is more likely stale or bogus than a
// train, and snapping it would invent a confident-looking position.
const METRO_SNAP_MAX_OFFSET = 400;

// A tram is pulled onto its rails only from this close. Its GPS is ordinary
// street-level GPS — good to some tens of metres, worse between tall buildings
// — so this has to cover the error without covering the next street: past 35 m
// the nearest rail is as likely to be a different line's as this tram's own,
// and a tram genuinely off its route (a diversion, a depot run, a replacement
// working) should be drawn where it says it is rather than dragged onto rails
// it is not using.
const TRAM_SNAP_MAX_OFFSET = 35;

// Commuter-train GPS is better than metro odometry, but still cannot identify
// parallel railway tracks. Keep the match conservative outside station throats.
const TRAIN_SNAP_MAX_OFFSET = 80;

// How far the rails may be for a train inside Helsinki Central to be *turned* by
// them without being moved onto them. Wider than the snap above on purpose:
// nothing is being asserted about which of the station's tracks the train is on,
// only about which way that whole fan of tracks runs, and the fan is some
// hundred metres wide. Metres.
const TRAIN_ORIENT_MAX_OFFSET = 150;

// How much closer another pattern has to be before a tram is moved onto it.
// The two directions of a tram line are one carriageway apart, so the margin
// that keeps a metro train on its (all but coincident) pattern would instead
// pin a tram to whichever rail it first snapped to. Metres.
const TRAM_TRACK_SWITCH_MARGIN = 4;

// How much slack the junction test allows around where a tram is expected to
// have got to, on top of the distance its own reported speed accounts for.
// Wide enough that ordinary running, a late snapshot and a stretch of standing
// still all stay inside it; far narrower than the distance between two passes
// of the same junction, which is what it exists to tell apart. Metres.
const TRAM_CONTINUITY_SLACK = 40;

// The last position report from a vehicle that actually said something new,
// kept so the animation can carry it forward until the next one.
//
// Every mode needs this, for two different reasons.
//
// A metro's HFP messages arrive every second like everything else's, but only
// their timestamp moves at that rate: the coordinate and speed are held and
// refreshed in steps of a few seconds. Measured on the live feed, 74% of
// consecutive messages between stations repeat the previous coordinate exactly,
// and 96% of them do at a platform — so a train stands still for about three
// seconds and then arrives some fifty metres further down the line. That is what
// makes a metro look stuck and then lurch, and it is why the timestamp cannot be
// what marks a new report: it ticks either way.
//
// A tram, bus or commuter train does report a fresh coordinate every second, so
// it never looks stuck — but drawn by gliding to the newest report it is always
// a full second behind, and every report lands a second of travel away and has
// to be tugged in. On the captured feed that tug is 9.6 m for a tram, 13.1 m for
// a bus and 32.6 m for a train at the ninetieth percentile. Anchoring here and
// aiming the glide at the end of the window instead cuts it to 0.6, 1.1 and
// 2.2 m. See lib/deadReckon.
interface VehicleFix {
  // HFP timestamp and coordinates of the last message whose *coordinate* was
  // new. The coordinate is what tells a fresh position from a repeat of the one
  // we already have; `ts` moves every second regardless.
  ts: number;
  lat: number;
  lng: number;
  // Wall clock (performance.now()) when the report first reached us. Ages are
  // measured against this rather than against `ts`, so a client whose clock
  // disagrees with HSL's by a few seconds still predicts correctly.
  seenAt: number;
  // Speed and acceleration the vehicle reported, which is what is integrated.
  spd: number;
  acc: number;
  // Reported heading, which is the direction a surface vehicle is carried in.
  // A metro ignores it and follows its track instead.
  hdg: number;
  // How far and how fast this mode may be predicted.
  limits: ReckonLimits;
  // Metro only: where the report put the train on the network.
  track?: TrackPlacement;
}

// How the current glide window should be shaped: by the speed profile the
// vehicle is actually predicted to follow, rather than by a generic easing
// curve. `ageStart` is how old the underlying report already was when the
// window opened, so a window that opens into a gap in the feed is animated at
// the speed the vehicle has by then rather than the speed it last reported.
interface Glide {
  spd: number;
  acc: number;
  ageStart: number;
  limits: ReckonLimits;
}

export const Map: React.FC<MapProps> = ({
  trams,
  routeGeometries,
  selection,
  view,
  journey,
  arrivals,
  callbacks,
  isFollowing,
  timeScale = 1,
}) => {
  // Unpacked under the names the body has always used, so grouping the props
  // is a change at the boundary and nowhere else.
  const {
    vehicleId: selectedTramId,
    line: selectedLine,
    tripDetails: selectedTripDetails,
    stop: selectedStop,
    bikeStationId: selectedBikeStationId,
    junctionId: selectedJunctionId,
  } = selection;
  const selectedStopId = selectedStop?.id ?? null;
  const selectedStopCoords = selectedStop?.coords ?? null;
  const selectedStopMode = selectedStop?.mode ?? null;
  const selectedStopIsTrunk = selectedStop?.isTrunk ?? false;
  const { theme: mapTheme, is3D, always3DVehicles, modes, showRoutes, lineFilters } = view;
  const { legs: journeyLegs, endpoints: journeyEndpoints, vehicleIds: journeyVehicleIds } = journey;
  const {
    focus: arrivalFocus,
    tripDetails: arrivalTripDetails,
    labels: arrivalLabels,
  } = arrivals;
  const {
    onSelectTram,
    onSelectStop,
    onSelectBikeStation,
    onSelectJunction,
    onDisableFollowing,
    onMapBearingChange,
    onLocatingChange,
    onVisibleStopsChange,
  } = callbacks;

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  const selectedTripDetailsRef = useRef<TripDetailsResponse | null>(selectedTripDetails);
  useSyncRef(selectedTripDetailsRef, selectedTripDetails);

  const arrivalLabelsRef = useRef(arrivalLabels);
  const arrivalLabelStopsRef = useRef<Array<{ stopId: string; lng: number; lat: number }>>([]);
  const arrivalLabelSigRef = useRef<string>('');
  const arrivalFocusRef = useRef<ArrivalFocus | null>(arrivalFocus);
  const arrivalTripDetailsRef = useRef<TripDetailsResponse | null>(arrivalTripDetails);
  const arrivalStopCoordsRef = useRef<[number, number] | null>(selectedStopCoords ?? null);
  useSyncRef(arrivalFocusRef, arrivalFocus);
  useSyncRef(arrivalTripDetailsRef, arrivalTripDetails);
  useSyncRef(arrivalStopCoordsRef, selectedStopCoords ?? null);

  const [apiKey, setApiKey] = React.useState<string | null>(null);
  // MapLibre 6 requires WebGL2 (WebGL 1 support was dropped). Without this the
  // map would just be a blank rectangle on a device that cannot provide it.
  const [webglFailed, setWebglFailed] = React.useState(false);

  // The MML key only signs orthophoto tile requests, so it is kept in a ref:
  // the satellite layer is built inside a `style.load` handler bound once, and
  // the key is known before the map is created either way (the Digitransit key
  // it arrives with is what gates that).
  const mmlKeyRef = useRef<string>('');

  useEffect(() => {
    fetchMapConfig().then((data) => {
      mmlKeyRef.current = data.mml_api_key || '';
      setApiKey(data.digitransit_map_key || '');
    });
  }, []);

  // References to keep state fresh in map event handlers and tick loop without closure issues
  const latestTramsRef = useRef<Record<string, VehiclePosition>>(trams);
  const callbacksRef = useRef({ onSelectTram, onSelectStop, onSelectBikeStation, onSelectJunction, onDisableFollowing, onMapBearingChange, onLocatingChange, onVisibleStopsChange });
  const routeGeometriesRef = useRef<Record<string, { geometries: string[]; color?: string; stops?: string[] }>>(routeGeometries);
  const selectedTramIdRef = useRef<string | null>(selectedTramId);
  const journeyVehicleIdsRef = useRef<string[]>(journeyVehicleIds);
  const selectedLineRef = useRef<string | null>(selectedLine);
  const selectedBikeStationIdRef = useRef<string | null>(selectedBikeStationId);
  const lineFiltersRef = useRef<string[]>(lineFilters);
  const modesRef = useRef<ModeFlags>(modes);
  const showRoutesRef = useRef<boolean>(showRoutes);
  const is3DRef = useRef<boolean>(is3D);
  const always3DVehiclesRef = useRef<boolean>(always3DVehicles);
  useSyncRef(latestTramsRef, trams);
  useSyncRef(callbacksRef, { onSelectTram, onSelectStop, onSelectBikeStation, onSelectJunction, onDisableFollowing, onMapBearingChange, onLocatingChange, onVisibleStopsChange });
  useSyncRef(routeGeometriesRef, routeGeometries);
  useSyncRef(selectedTramIdRef, selectedTramId);
  useSyncRef(journeyVehicleIdsRef, journeyVehicleIds);
  useSyncRef(selectedLineRef, selectedLine);
  useSyncRef(selectedBikeStationIdRef, selectedBikeStationId);
  useSyncRef(lineFiltersRef, lineFilters);
  useSyncRef(modesRef, modes);
  useSyncRef(showRoutesRef, showRoutes);
  useSyncRef(is3DRef, is3D);
  useSyncRef(always3DVehiclesRef, always3DVehicles);
  const doorAnimationsRef = useRef<Record<string, DoorAnimation>>({});
  // Whether the 3D source currently holds bodies, so it is emptied exactly once
  // when 3D is switched off or the view zooms back out.
  const vehicles3dDrawnRef = useRef<boolean>(false);
  const stopFurnitureDrawnRef = useRef<boolean>(false);
  // Cheap signature of what the furniture was last built for, so the `idle`
  // event — which fires on every tile that lands — does no work in the common
  // case where nothing that matters has moved.
  const stopFurnitureSigRef = useRef<string>('');
  // Name/code/mode for the stops currently carrying furniture, so a click on a
  // shelter can open the same popup a click on its sign would.
  const stopFurnitureMetaRef = useRef<Record<string, { name: string; code: string; mode: string }>>({});
  // The stop a selected vehicle is heading for, and whether it is boarding
  // there right now. Keyed so the furniture is only rebuilt when it changes.
  const stopHighlightRef = useRef<{
    key: string;
    stopId: string | null;
    boarding: boolean;
    coords: [number, number] | null;
  }>({ key: '', stopId: null, boarding: false, coords: null });
  const mapThemeRef = useRef<MapTheme>(mapTheme);
  const isFollowingRef = useRef<boolean>(isFollowing);
  useSyncRef(mapThemeRef, mapTheme);
  useSyncRef(isFollowingRef, isFollowing);
  const isInteractingRef = useRef<boolean>(false);
  // Latest live city-bike station GeoJSON, refreshed on an interval. Kept in a
  // ref so a theme/style reload can re-seed the recreated source without
  // waiting for the next fetch.
  const bikeStationsDataRef = useRef<BikeStationsFeatureCollection | null>(null);
  // The 3D racks, tracked the same way as the stop furniture: drawn-or-not, and
  // a signature of what they were last built for.
  const bikeFurnitureDrawnRef = useRef<boolean>(false);
  const bikeFurnitureSigRef = useRef<string>('');
  // Bumped on every availability refresh, so the rack signature notices new
  // counts arriving under an unmoved view.
  const bikeAvailabilityStampRef = useRef<number>(0);
  // Latest signalized-junction features (static reference data, shared with
  // the tram popup via useTrafficLights). Kept in a ref for the same reason
  // as bikeStationsDataRef: re-seed the source immediately after a
  // theme/style reload recreates it.
  const trafficLightsDataRef = useRef<TrafficLightFeature[]>([]);
  const trafficLightFeatures = useTrafficLights();
  // Which junctions a vehicle is currently asking for a green, folded from the
  // `tlp` field on the positions. Kept as a ref because it is read while
  // building the markers, which is not a render.
  const junctionPrioritiesRef = useRef<JunctionPriorityIndex>(new globalThis.Map());
  // Signatures: the junction source is only rebuilt when the set of live
  // exchanges actually changes, not on every positions message.
  const junctionPrioritySigRef = useRef<string>('');

  const journeyLegsRef = useRef<JourneyLeg[] | null>(journeyLegs);
  const journeyEndpointsRef = useRef<{ from: JourneyEndpoint; to: JourneyEndpoint } | null>(journeyEndpoints);
  useSyncRef(journeyLegsRef, journeyLegs);
  useSyncRef(journeyEndpointsRef, journeyEndpoints);
  const journeyFitKeyRef = useRef<string>('');

  const lastSeenStopIdRef = useRef<string | null>(null);

  useEffect(() => {
    lastSeenStopIdRef.current = null;
  }, [selectedTramId]);






  /**
   * Rebuild the 3D stop furniture for what is on screen.
   *
   * Nothing in the stop tiles says which way a stop faces, so the bearing is
   * read off geometry already drawn: the platform polygon the stop stands in
   * (its long axis runs with the track), or failing that the nearest route
   * line. A stop with neither gets a square pad and a pole and no shelter —
   * furniture at a guessed angle would read as data when it is a guess.
   *
   * Runs on view changes rather than per frame: the geometry only moves when
   * the map does, and querying rendered features is far too heavy for 60fps.
   */
  /**
   * Which stops are close enough to the middle of a zoomed-in view to earn a
   * next-arrival label, reported up so their departures can be fetched.
   *
   * Below the sign-board zoom this reports nothing: a city-wide view holds
   * hundreds of stops, every one of them a departure lookup, and a label on
   * each would be unreadable even if it were free.
   */
  const updateArrivalLabelStops = (map: maplibregl.Map) => {
    const gated = map.getZoom() < ARRIVAL_LABEL_MIN_ZOOM || !map.getLayer('stops_signs');
    if (gated) {
      if (arrivalLabelStopsRef.current.length > 0 || arrivalLabelSigRef.current !== '') {
        arrivalLabelStopsRef.current = [];
        arrivalLabelSigRef.current = '';
        drawArrivalLabels(map);
        callbacksRef.current.onVisibleStopsChange?.([]);
      }
      return;
    }

    const centre = map.getCenter();
    const seen = new Set<string>();
    const stops: Array<{ stopId: string; lng: number; lat: number; distance: number }> = [];
    // Same source as the 3D furniture: whatever `stops_signs` is drawing, so
    // labels inherit the mode toggles and route filters already applied to it.
    for (const feature of map.queryRenderedFeatures({ layers: ['stops_signs'] })) {
      if (feature.geometry.type !== 'Point') continue;
      const properties = feature.properties ?? {};
      const rawId = properties.gtfsId ?? properties.stopId ?? properties.id ?? feature.id;
      if (rawId === undefined || rawId === null) continue;
      const stopId = String(rawId).replace(/^HSL:/, '');
      if (!stopId || seen.has(stopId)) continue;
      seen.add(stopId);
      const [lng, lat] = feature.geometry.coordinates as [number, number];
      stops.push({ stopId, lng, lat, distance: Math.hypot(lng - centre.lng, lat - centre.lat) });
    }
    stops.sort((a, b) => a.distance - b.distance);
    const nearest = stops.slice(0, ARRIVAL_LABEL_STOP_LIMIT);

    // The positions move with every pan; the *set* of stops is what drives a
    // refetch, so only that goes into the signature.
    const signature = nearest.map((stop) => stop.stopId).join(',');
    arrivalLabelStopsRef.current = nearest.map(({ stopId, lng, lat }) => ({ stopId, lng, lat }));
    drawArrivalLabels(map);
    if (signature !== arrivalLabelSigRef.current) {
      arrivalLabelSigRef.current = signature;
      callbacksRef.current.onVisibleStopsChange?.(nearest.map((stop) => stop.stopId));
    }
  };

  /** Paint the labels for whichever visible stops have an arrival to show. */
  const drawArrivalLabels = (map: maplibregl.Map) => {
    const source = map.getSource(ARRIVAL_LABEL_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    const labels = arrivalLabelsRef.current ?? {};
    const features: Feature[] = [];
    for (const stop of arrivalLabelStopsRef.current) {
      const entry = labels[stop.stopId];
      // No arrival, no label. An empty badge over a stop reads as "nothing
      // runs here", which is a different claim from "we do not know yet".
      if (!entry) continue;
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [stop.lng, stop.lat] },
        properties: { label: entry.label, color: entry.color },
      });
    }
    source.setData({ type: 'FeatureCollection', features });
  };

  const updateStopFurniture = (map: maplibregl.Map, theme: MapTheme) => {
    const source = map.getSource(STOP_FURNITURE_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    const empty = { type: 'FeatureCollection' as const, features: [] };

    const active =
      vehicles3DEnabled(is3DRef.current, always3DVehiclesRef.current) &&
      map.getZoom() >= STOP_3D_MIN_ZOOM &&
      map.getLayer('stops_signs') !== undefined;
    if (!active) {
      if (stopFurnitureDrawnRef.current) {
        source.setData(empty);
        stopFurnitureDrawnRef.current = false;
        stopFurnitureSigRef.current = '';
      }
      return;
    }

    const centre = map.getCenter();
    const signature = [
      theme,
      centre.lng.toFixed(4),
      centre.lat.toFixed(4),
      map.getZoom().toFixed(2),
      map.getBearing().toFixed(0),
      stopHighlightRef.current.key,
    ].join('|');
    if (signature === stopFurnitureSigRef.current) return;
    stopFurnitureSigRef.current = signature;

    // The visible stops are whatever `stops_signs` is drawing, so the furniture
    // inherits the mode toggles and route filters already applied to it.
    const stopFeatures = map.queryRenderedFeatures({ layers: ['stops_signs'] });

    const platformRings: [number, number][][] = [];
    if (map.getLayer(PLATFORM_FILL_LAYER)) {
      for (const feature of map.queryRenderedFeatures({ layers: [PLATFORM_FILL_LAYER] })) {
        const geometry = feature.geometry;
        if (geometry.type === 'Polygon') {
          platformRings.push(geometry.coordinates[0] as [number, number][]);
        } else if (geometry.type === 'MultiPolygon') {
          for (const polygon of geometry.coordinates) {
            platformRings.push(polygon[0] as [number, number][]);
          }
        }
      }
    }

    const routeLines: [number, number][][] = [];
    if (map.getLayer('route-lines-layer')) {
      for (const feature of map.queryRenderedFeatures({ layers: ['route-lines-layer'] })) {
        const geometry = feature.geometry;
        if (geometry.type === 'LineString') {
          routeLines.push(geometry.coordinates as [number, number][]);
        } else if (geometry.type === 'MultiLineString') {
          for (const line of geometry.coordinates) routeLines.push(line as [number, number][]);
        }
      }
    }

    const highlightId = stopHighlightRef.current.stopId?.replace(/^HSL:/, '') ?? null;
    const seen = new Set<string>();
    const meta: Record<string, { name: string; code: string; mode: string }> = {};
    const stops: Array<{ state: StopFurnitureState; distance: number }> = [];

    for (const feature of stopFeatures) {
      if (feature.geometry.type !== 'Point') continue;
      const properties = feature.properties ?? {};
      const rawId = properties.gtfsId ?? properties.stopId ?? properties.id ?? feature.id;
      if (rawId === undefined || rawId === null) continue;
      const stopId = String(rawId).replace(/^HSL:/, '');
      if (seen.has(stopId)) continue;
      seen.add(stopId);

      const [lng, lat] = feature.geometry.coordinates as [number, number];
      meta[stopId] = {
        name: String(properties.name ?? properties.nameFi ?? 'Unknown Stop'),
        code: String(properties.code ?? properties.shortId ?? ''),
        mode: String(properties.mode ?? properties.type ?? 'TRAM'),
      };
      let bearing: number | null = null;
      let hasPlatform = false;
      for (const ring of platformRings) {
        if (pointInRing([lng, lat], ring)) {
          hasPlatform = true;
          bearing = longestEdgeBearing(ring);
          break;
        }
      }
      if (bearing === null) {
        bearing = nearestLineBearing([lng, lat], routeLines);
      }

      stops.push({
        state: {
          stopId,
          lng,
          lat,
          mode: String(properties.mode ?? properties.type ?? 'TRAM'),
          bearing,
          hasPlatform,
          highlighted: highlightId !== null && stopId === highlightId,
          boarding: stopHighlightRef.current.boarding && stopId === highlightId,
        },
        distance: Math.hypot(lng - centre.lng, lat - centre.lat),
      });
    }

    // A dense view can hold hundreds of stops, each several polygons. Nearest
    // to the middle of the screen wins, which is where the eye is.
    stops.sort((a, b) => a.distance - b.distance);
    const states = stops.slice(0, STOP_FURNITURE_LIMIT).map((s) => s.state);
    stopFurnitureMetaRef.current = meta;
    source.setData(stopFurnitureCollection(states, theme));
    stopFurnitureDrawnRef.current = true;
  };

  // The city-bike counterpart to `updateStopFurniture`: turn the stations the
  // gauge layer is drawing into racks of real-metre boxes. Same bookkeeping —
  // built from what is on screen, capped, and skipped entirely when nothing
  // that matters has moved.
  const updateBikeFurniture = (map: maplibregl.Map, theme: MapTheme) => {
    const source = map.getSource(BIKE_STATION_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    const empty = { type: 'FeatureCollection' as const, features: [] };

    const active =
      vehicles3DEnabled(is3DRef.current, always3DVehiclesRef.current) &&
      map.getZoom() >= BIKE_3D_MIN_ZOOM &&
      map.getLayer('citybike_gauge') !== undefined;
    if (!active) {
      if (bikeFurnitureDrawnRef.current) {
        source.setData(empty);
        bikeFurnitureDrawnRef.current = false;
        bikeFurnitureSigRef.current = '';
      }
      return;
    }

    const centre = map.getCenter();
    const signature = [
      theme,
      centre.lng.toFixed(4),
      centre.lat.toFixed(4),
      map.getZoom().toFixed(2),
      selectedBikeStationIdRef.current ?? '',
      // Availability is what the rack is made of, so a refresh has to rebuild
      // it even when the view has not moved.
      String(bikeStationsDataRef.current?.features.length ?? 0),
      bikeAvailabilityStampRef.current,
    ].join('|');
    if (signature === bikeFurnitureSigRef.current) return;
    bikeFurnitureSigRef.current = signature;

    // Route lines give the rack its orientation where one runs past: stations
    // sit along streets, and the tram or bus line in the street is the only
    // thing on this map that knows which way the street goes.
    const routeLines: [number, number][][] = [];
    if (map.getLayer('route-lines-layer')) {
      for (const feature of map.queryRenderedFeatures({ layers: ['route-lines-layer'] })) {
        const geometry = feature.geometry;
        if (geometry.type === 'LineString') {
          routeLines.push(geometry.coordinates as [number, number][]);
        } else if (geometry.type === 'MultiLineString') {
          for (const line of geometry.coordinates) routeLines.push(line as [number, number][]);
        }
      }
    }

    const selectedId = selectedBikeStationIdRef.current ?? null;
    const seen = new Set<string>();
    const stations: Array<{ state: BikeStationState; distance: number }> = [];
    for (const feature of map.queryRenderedFeatures({ layers: ['citybike_gauge'] })) {
      if (feature.geometry.type !== 'Point') continue;
      const properties = feature.properties ?? {};
      const stationId = String(properties.stationId ?? properties.id ?? '');
      if (!stationId || seen.has(stationId)) continue;
      seen.add(stationId);
      const [lng, lat] = feature.geometry.coordinates as [number, number];
      stations.push({
        state: {
          stationId,
          lng,
          lat,
          bikesAvailable: Number(properties.bikesAvailable ?? 0),
          spacesAvailable: Number(properties.spacesAvailable ?? 0),
          bearing: nearestLineBearing([lng, lat], routeLines, 40),
          highlighted: selectedId !== null && stationId === selectedId,
        },
        distance: Math.hypot(lng - centre.lng, lat - centre.lat),
      });
    }

    stations.sort((a, b) => a.distance - b.distance);
    source.setData(bikeStationCollection(
      stations.slice(0, BIKE_STATION_LIMIT).map((s) => s.state),
      theme,
    ));
    bikeFurnitureDrawnRef.current = true;
  };

  // Fold the priority exchanges the vehicles are reporting onto the junctions
  // they name, and paint the result into the junction source.
  //
  // Every vehicle carries its own exchange on its position (see the backend's
  // signal_priority.go), so the join is done here rather than over a second
  // stream: the junction ID a tram reports is Helsinki's own junction number,
  // which is the `id` these features already have. The source is only rebuilt
  // when the set of live exchanges changes — a few times a minute, against the
  // once a second positions arrive — because it means re-materialising 550-odd
  // features.
  const updateSignalPriority = (map: maplibregl.Map) => {
    const priorities = signalPriorityIndex(Object.values(latestTramsRef.current));
    const signature = Array.from(priorities.entries())
      .map(([junction, a]) => `${junction}:${a.vehicles.map((v) => `${v.status}:${v.veh}`).join(',')}`)
      .sort()
      .join('|');
    if (signature === junctionPrioritySigRef.current) return;
    junctionPrioritySigRef.current = signature;
    junctionPrioritiesRef.current = priorities;

    const source = map.getSource(TRAFFIC_LIGHT_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (source && typeof source.setData === 'function') {
      source.setData({
        type: 'FeatureCollection',
        features: trafficLightsDataRef.current.map((feature) => {
          const live = priorities.get(feature.properties.id);
          // `norequest` is a vehicle deciding not to ask; it lights nothing,
          // so it must not put a `priority` key on the feature either — the
          // icon size and sort key both key off the presence of one.
          if (!live || live.status === 'norequest') return feature;
          return {
            ...feature,
            properties: {
              ...feature.properties,
              priority: live.status,
              // The lines in the exchange, so the marker's own tooltip and the
              // junction panel do not each have to go back to the vehicles.
              priorityDesi: live.vehicles.map((v) => v.desi).join(', '),
              priorityCount: live.vehicles.length,
            },
          };
        }),
      } as unknown as FeatureCollection);
    }
  };

  // New countdowns arrive every refresh and every second the clock ticks; the
  // set of stops they belong to changes only when the view moves, so this
  // repaints the text without re-querying anything.
  useEffect(() => {
    arrivalLabelsRef.current = arrivalLabels;
    const map = mapRef.current;
    if (map && map.getStyle()) drawArrivalLabels(map);
  }, [arrivalLabels]);


  // Decoding and de-duplicating a line's patterns is the expensive part of a
  // redraw, and a redraw happens on every selection change — with the whole tram
  // network highlighted that is tens of thousands of points. The result depends
  // only on the polylines themselves, and those arrive as one array per fetch
  // and are never mutated, so caching against the array's identity is enough.
  const routePathsCacheRef = useRef<Record<string, { src: string[]; paths: [number, number][][] }>>({});
  const routePathsOf = (line: string, src: string[]): [number, number][][] => {
    const cached = routePathsCacheRef.current[line];
    if (cached && cached.src === src) return cached.paths;
    const paths = directionalPaths(src.map((poly) => decodePolyline(poly)));
    routePathsCacheRef.current[line] = { src, paths };
    return paths;
  };

  // Helper to draw route geometries on the map.
  //
  // Lines sharing a street are fanned out into parallel ribbons via a per-feature
  // offset slot (see lib/routeSlots) instead of being stacked pixel-on-pixel,
  // where their colours used to blend into a muddy third colour. The selected
  // vehicle's line keeps slot 0 — it stays on the true geometry while the others
  // are pushed aside — and is drawn wider, opaque and on top, with the rest
  // dimmed.
  const drawRouteGeometries = (
    map: maplibregl.Map,
    geometries: Record<string, { geometries: string[]; color?: string }>,
    selectedLine: string | null,
  ) => {
    const source = map.getSource('route-lines') as maplibregl.GeoJSONSource;
    if (!source) return;

    const lines = Object.keys(geometries);
    const hasSelection = !!selectedLine && lines.includes(selectedLine);

    const paths: RoutePath[] = [];
    lines.forEach((line) => {
      // The API returns one polyline per pattern — each direction, plus short
      // turns and branch variants — and the backend dedupes on the raw string,
      // which no two of them ever share. What survives is one path per direction
      // of travel plus any real branches: the repeats and short turns would only
      // be drawn on top of what is already there, but the return leg is the
      // other track and has to stay, or every vehicle running that way is drawn
      // beside the line instead of on it.
      routePathsOf(line, geometries[line].geometries).forEach((coords) =>
        paths.push({ line, coords })
      );
    });

    const features = assignCorridorSlots(paths, selectedLine).map(({ line, coords, slot }) => ({
      type: 'Feature' as const,
      geometry: {
        type: 'LineString' as const,
        coordinates: coords,
      },
      properties: {
        line,
        // Colour the highlighted route path by our per-line palette rather than
        // HSL's mode green (which is identical for every tram line).
        color: getRouteColor(line),
        offsetIndex: slot,
        selected: line === selectedLine,
        dim: hasSelection && line !== selectedLine,
      },
    }));

    source.setData({
      type: 'FeatureCollection',
      features,
    });
  };

  // Render a planned journey: coloured transit legs, dashed walk legs, the
  // origin/destination markers, and highlighted board/alight/transfer/via stops.
  const updateJourney = (
    map: maplibregl.Map,
    legs: JourneyLeg[] | null,
    endpoints: { from: JourneyEndpoint; to: JourneyEndpoint } | null,
    fitBounds: boolean
  ) => {
    const lineSource = map.getSource('journey-lines') as maplibregl.GeoJSONSource | undefined;
    const stopSource = map.getSource('journey-stops') as maplibregl.GeoJSONSource | undefined;
    const endpointSource = map.getSource('journey-endpoints') as maplibregl.GeoJSONSource | undefined;
    if (!lineSource || !stopSource || !endpointSource) return;

    if (!legs || legs.length === 0) {
      const empty = { type: 'FeatureCollection' as const, features: [] };
      lineSource.setData(empty);
      stopSource.setData(empty);
      endpointSource.setData(empty);
      return;
    }

    const lineFeatures: Feature[] = [];
    const allCoords: [number, number][] = [];

    legs.forEach((leg) => {
      const coords = leg.geometry ? decodePolyline(leg.geometry) : [];
      coords.forEach((c) => allCoords.push(c));
      if (coords.length >= 2) {
        const color = leg.transit
          ? getRouteColor(leg.route?.shortName)
          : '#94a3b8';
        lineFeatures.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: coords },
          properties: { transit: leg.transit, color },
        });
      }
    });

    // Collect highlighted stops with a priority so transfer/board/alight win
    // over plain "via" stops sharing the same location.
    const priority: Record<string, number> = { board: 4, alight: 4, transfer: 3, via: 1 };
    const stopByKey: Record<string, { lat: number; lon: number; name: string; kind: string }> = {};
    const addStop = (lat: number, lon: number, name: string, kind: string) => {
      if (lat === 0 && lon === 0) return;
      const key = `${lat.toFixed(5)},${lon.toFixed(5)}`;
      const existing = stopByKey[key];
      if (!existing || priority[kind] > priority[existing.kind]) {
        stopByKey[key] = { lat, lon, name, kind };
      }
    };

    const transitLegs = legs.filter((l) => l.transit);
    transitLegs.forEach((leg, i) => {
      const boardKind = i === 0 ? 'board' : 'transfer';
      const alightKind = i === transitLegs.length - 1 ? 'alight' : 'transfer';
      addStop(leg.from.lat, leg.from.lon, leg.from.name, boardKind);
      addStop(leg.to.lat, leg.to.lon, leg.to.name, alightKind);
      leg.intermediateStops.forEach((s) => addStop(s.lat, s.lon, s.name, 'via'));
    });

    const stopFeatures: Feature[] = Object.values(stopByKey).map((s) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
      properties: { kind: s.kind, name: s.name },
    }));

    const endpointFeatures: Feature[] = [];
    if (endpoints) {
      endpointFeatures.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [endpoints.from.lon, endpoints.from.lat] },
        properties: { role: 'origin' },
      });
      endpointFeatures.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [endpoints.to.lon, endpoints.to.lat] },
        properties: { role: 'destination' },
      });
      allCoords.push([endpoints.from.lon, endpoints.from.lat]);
      allCoords.push([endpoints.to.lon, endpoints.to.lat]);
    }

    lineSource.setData({ type: 'FeatureCollection', features: lineFeatures });
    stopSource.setData({ type: 'FeatureCollection', features: stopFeatures });
    endpointSource.setData({ type: 'FeatureCollection', features: endpointFeatures });

    if (fitBounds && allCoords.length >= 2) {
      const bounds = allCoords.reduce(
        (b, c) => b.extend(c),
        new maplibregl.LngLatBounds(allCoords[0], allCoords[0])
      );
      map.fitBounds(bounds, { padding: { top: 90, bottom: 90, left: 60, right: 60 }, maxZoom: 16, duration: 700 });
    }
  };

  // Track geometry for every rail line currently in the feed. This is fetched
  // independently of `routeGeometries` (which only covers lines the user has
  // highlighted, because its job is drawing route ribbons): a vehicle is
  // snapped to its rails — and a metro dead-reckoned along them — whether or
  // not its line is highlighted, and hanging that off the highlight state meant
  // the ordinary view with nothing selected had no tracks and therefore no
  // snapping at all. See hooks/useRoutePatterns.
  const snappedLines = useMemo(() => snappedLinesInFeed(trams), [trams]);
  const routePatterns = useRoutePatterns(snappedLines);

  // Indexed track geometry, per line. Rebuilt only when a line's polylines
  // actually change: indexing walks every point of every pattern.
  const tracksRef = useRef<Record<string, RailTrack[]>>({});
  const patternSourceRef = useRef<Record<string, unknown>>({});

  useEffect(() => {
    const tracks: Record<string, RailTrack[]> = {};
    Object.entries(routePatterns).forEach(([line, patterns]) => {
      if (!patterns || patterns.length === 0) return;
      if (patternSourceRef.current[line] === patterns) {
        tracks[line] = tracksRef.current[line];
        return;
      }
      patternSourceRef.current[line] = patterns;
      tracks[line] = buildPatternTracks(patterns);
    });
    tracksRef.current = tracks;
  }, [routePatterns]);

  /**
   * Pull a reported position onto its line's rails. Returns null when the line
   * has no geometry yet, the mode is not one that runs on known geometry, or
   * the position is too far off the network to trust — in all three cases the
   * caller draws the raw position, exactly as before.
   *
   * The two snapped modes are snapped for opposite reasons, so they are given
   * different licence. A metro is underground and its position is odometry
   * rather than GPS, so it is dragged as much as 400 m and its own reported
   * heading is not evidence of anything. A tram's position is ordinary
   * street-level GPS, only tens of metres out — but its two directions run on
   * their own rails a few metres apart, so the question is not *where* it is
   * but *which* of a pair of tracks it is on. That is answered by the journey's
   * direction from the feed, and where the feed omits it, by whether the rails
   * run the way the tram is heading.
   */
  const placeOnRails = (
    tram: VehiclePosition,
    previous: TrackPlacement | undefined,
    // How long the previous placement has had to go stale, in seconds. It sets
    // how far along the route the vehicle may have got since, which is what the
    // junction test is measured against.
    age: number,
  ) => {
    if (!isSnappedMode(tram.mode)) return null;
    const tracks = tracksRef.current[tram.desi];
    if (!tracks || tracks.length === 0) return null;

    // Helsinki Central has twenty-odd platform tracks and reversing movements
    // inside one compact area, and which platform a train is standing at is not
    // something its route polyline knows. Until Fintraffic track events are
    // integrated, the reported position is more honest than a route-polyline
    // guess there — but the *heading* is not a guess at all, because every track
    // in the throat runs parallel to every other, so the polyline's bearing is
    // the bearing of whichever track the train is really on. Turning the train
    // without moving it is what stops a 75 m body lying diagonally across the
    // station's tracks on whatever heading the last GPS fix that moved reported.
    if (tram.mode === 'train' && isHelsinkiCentralStationZone(tram.lng, tram.lat)) {
      return orientOnTracks(tracks, tram, {
        maxOffset: TRAIN_ORIENT_MAX_OFFSET,
        direction: hfpDirectionId(tram.dir),
        heading: tram.hdg,
      });
    }

    if (tram.mode === 'metro') {
      return placeOnTracks(tram.desi, tracks, tram, previous, {
        maxOffset: METRO_SNAP_MAX_OFFSET,
      });
    }

    if (tram.mode === 'train') {
      const travelled = Math.abs(tram.spd ?? 0) * Math.max(age, 0);
      return placeOnTracks(tram.desi, tracks, tram, previous, {
        maxOffset: TRAIN_SNAP_MAX_OFFSET,
        direction: hfpDirectionId(tram.dir),
        heading: tram.hdg,
        expectedAdvance: travelled,
        continuityWindow: travelled + 100,
      });
    }

    // How far the tram can have gone since it was last placed, from the speed
    // it reported. The window is that plus a fixed allowance, so a tram running
    // normally always finds itself inside it and only a fix somewhere else on
    // the route falls out.
    const travelled = Math.abs(tram.spd ?? 0) * Math.max(age, 0);
    const options: PlaceOptions = {
      maxOffset: TRAM_SNAP_MAX_OFFSET,
      direction: hfpDirectionId(tram.dir),
      heading: tram.hdg,
      // The pair of tracks is only metres apart, so the hysteresis that holds a
      // metro on its pattern would instead pin a tram to the wrong rail of the
      // two. Just wide enough to absorb GPS jitter along one track, not wide
      // enough to hold it on the other.
      switchMargin: TRAM_TRACK_SWITCH_MARGIN,
      expectedAdvance: travelled,
      continuityWindow: TRAM_CONTINUITY_SLACK + travelled,
    };
    return placeOnTracks(tram.desi, tracks, tram, previous, options);
  };

  // Dead-reckoning state, per vehicle: the last real report, and the speed
  // profile the current glide window follows.
  const fixRef = useRef<Record<string, VehicleFix>>({});
  const glideRef = useRef<Record<string, Glide>>({});

  // How long the current glide window is, in seconds. Snapshots are broadcast
  // once a second, so this is normally 1 — but a tab that was throttled, a
  // stalled connection or a hiccup in the backend can stretch the gap, and a
  // window that assumes 1 s regardless finishes early and leaves every vehicle
  // standing still until the next snapshot lands. Measured from the snapshots
  // themselves and clamped either side of a second: shorter than 0.7 s is
  // indistinguishable from a jump, and past 2.5 s the feed is broken rather
  // than slow, so the vehicles should stop rather than be flung onward.
  const windowSecRef = useRef<number>(1);
  // The same window measured in seconds of history rather than of wall clock.
  // Identical to windowSecRef at one times; see the `timeScale` prop.
  const dataWindowSecRef = useRef<number>(1);
  // Read inside the animation frame and the snapshot effect, which must not be
  // torn down and rebuilt when the playback speed changes.
  const timeScaleRef = useRef<number>(timeScale);
  useSyncRef(timeScaleRef, timeScale);
  // How many seconds of *history* the current window carries. At one times this
  // is the window itself; at two hundred and forty times a window an eighth of
  // a second long carries half a minute of travel, which is what the teleport
  // guard has to be measured against.
  const stepSecRef = useRef<number>(1);
  const MIN_WINDOW_SEC = 0.7;
  const MAX_WINDOW_SEC = 2.5;
  // The floor above exists because the live feed speaks once a second and a
  // window measured shorter than that is a hiccup, not a cadence. A fast replay
  // genuinely does deliver a snapshot every eighth of a second, and holding it
  // to seven tenths would mean every glide is cut off at a fifth of its length
  // by the next one — vehicles crawling a step behind the map and then jumping
  // to catch up, which is exactly what a fast timelapse looked like. So at
  // speed the floor is only there to keep the division below finite.
  const MIN_REPLAY_WINDOW_SEC = 0.03;

  /**
   * Where a vehicle should be drawn at the end of the current glide window,
   * given a report that is already `age` seconds old and has not been followed
   * by another.
   *
   * This is the whole of the accuracy story. Aiming at the reported position
   * draws the vehicle where it *was* when it last spoke, which by the time the
   * window closes is a second and a half of travel in the past; aiming here
   * draws it where its own speed and acceleration say it will be. A gap in the
   * feed is then simply a longer `age`, animated at the speed the vehicle has
   * by then, instead of a freeze and a lurch.
   *
   * A metro is carried along the very track it was last seen on, because it has
   * rails and we have their geometry — which keeps it inside its tunnel through
   * curves where a straight line would cut across them. Everything else runs
   * along the heading it reported.
   *
   * Returns null when there is nothing to carry it along: no motion predicted,
   * the metro pattern geometry went away, or the prediction horizon has passed
   * and the last known point is the honest answer again.
   */
  const predictPosition = (fix: VehicleFix, age: number): RenderPosition | null => {
    const advance = predictedAdvance(
      fix.spd,
      fix.acc,
      0,
      age + dataWindowSecRef.current,
      fix.limits
    );
    if (advance <= 0) return null;

    if (fix.track) {
      const track = tracksRef.current[fix.track.line]?.[fix.track.index];
      if (!track) return null;
      // `distance` is arc length along the pattern polyline; a train running
      // against that polyline's own direction covers it backwards.
      const distance = fix.track.distance + (fix.track.forward ? advance : -advance);
      const point = pointOnTrack(track, distance);
      return {
        lat: point.lat,
        lng: point.lng,
        hdg: fix.track.forward ? point.bearing : (point.bearing + 180) % 360,
        track: { ...fix.track, distance },
      };
    }

    const moved = advanceAlongHeading(fix.lat, fix.lng, fix.hdg, advance);
    return { lat: moved.lat, lng: moved.lng, hdg: fix.hdg };
  };

  // Animation references to run independent of React re-renders
  const prevPositionsRef = useRef<Record<string, RenderPosition>>({});
  const targetPositionsRef = useRef<Record<string, RenderPosition>>({});
  // What was actually drawn on the last frame. A new snapshot interpolates from
  // here rather than from the previous *target*, so a correction that arrives
  // mid-glide is eased in from where the vehicle currently is instead of
  // yanking it back to where the last snapshot ended.
  const renderedPositionsRef = useRef<Record<string, RenderPosition>>({});
  const lastUpdateRef = useRef<number>(0);
  // Wall-clock of the last vehicle-feature rebuild, used to adaptively throttle
  // the (O(n)) per-frame rebuild when the map is crowded (see tickFrame).
  const lastRenderRef = useRef<number>(0);
  // How many vehicles were in view on the last rebuild, which is what the
  // render throttle is scaled by.
  const visibleCountRef = useRef<number>(0);
  const animationFrameRef = useRef<number | null>(null);

  // Interpolation and GeoJSON updates loop
  function startAnimationLoop() {
    const tick = () => {
      // This loop is the sole driver of vehicle movement: an uncaught throw
      // (e.g. malformed trip data) must not stop the next frame from being
      // scheduled, or every vehicle would freeze for the rest of the session.
      try {
        tickFrame();
      } catch (err) {
        console.error('Vehicle animation frame failed', err);
      }
      animationFrameRef.current = requestAnimationFrame(tick);
    };

    const tickFrame = () => {
      const map = mapRef.current;
      if (!map || !map.getSource('trams')) {
        return;
      }

      const now = performance.now();
      // How far through the current glide window we are. The window is as long
      // as the gap between the last two snapshots (normally a second), so a late
      // snapshot stretches the glide instead of leaving the vehicles standing
      // still waiting for it.
      const elapsed = now - lastUpdateRef.current;
      const t = Math.min(elapsed / 1000 / windowSecRef.current, 1.0);

      // Only what is on screen is drawn. Rebuilding a vehicle's GeoJSON feature
      // and pushing the collection through `setData` is O(n), and with buses on
      // the feed carries several hundred vehicles of which a few dozen are ever
      // in view — so the whole cost of the crowd used to be paid at the zoom
      // where the crowd is invisible anyway. Padded by a comfortable margin so a
      // vehicle is already in the collection before it reaches the edge, and
      // recomputed every frame so panning brings them in.
      //
      // Interpolated positions are still computed for every vehicle, in and out
      // of view: that keeps `rendered` complete, so a vehicle panned back into
      // view resumes its glide instead of restarting it.
      const bounds = map.getBounds();
      const padLng = (bounds.getEast() - bounds.getWest()) * 0.25;
      const padLat = (bounds.getNorth() - bounds.getSouth()) * 0.25;
      const west = bounds.getWest() - padLng;
      const east = bounds.getEast() + padLng;
      const south = bounds.getSouth() - padLat;
      const north = bounds.getNorth() + padLat;

      // Adaptive render throttle. At 60 fps with a full map the rebuild
      // dominates the frame budget and makes the whole animation stutter, and
      // the sub-pixel movement between two 1 Hz snapshots is imperceptible when
      // the map is zoomed out — so when a lot of vehicles are *visible* the
      // rebuild rate is capped. It is the visible count that matters, not the
      // size of the feed: switching buses on used to drop a close-in view of
      // three trams to ten frames a second because of several hundred vehicles
      // nowhere near the screen. Interpolation stays correct (each render still
      // computes the right position for `now`), it just updates less often.
      // Chasing a vehicle is never throttled — that view needs every frame.
      const visibleCount = visibleCountRef.current;
      const following = !!selectedTramIdRef.current;
      if (!following && visibleCount > 25) {
        const zoom = map.getZoom();
        const minInterval = visibleCount > 60
          ? (zoom < 13.5 ? 100 : 50)
          : (zoom < 13.5 ? 66 : 33);
        if (now - lastRenderRef.current < minInterval) {
          return;
        }
      }
      lastRenderRef.current = now;

      // Rebuilt from scratch each frame so vehicles that left the feed do not
      // linger in it.
      const rendered: Record<string, RenderPosition> = {};
      let visible = 0;

      const features: VehicleFeature[] = [];
      // The path each vehicle's body follows this frame, for the ones being
      // drawn along their rails. Filled here rather than in the 3D block below
      // because it is only honest on the frames where the drawn position came
      // off the track itself: on the one frame after a vehicle changes pattern
      // the position is a plain interpolation, and bending the body to a track
      // the vehicle is not being drawn on would tear it away from its own icon.
      const spines: Record<string, BodySpine> = {};
      Object.entries(targetPositionsRef.current).forEach(([id, target]) => {
        const prev = prevPositionsRef.current[id] || target;

        const tramInfo = latestTramsRef.current[id];
        const spd = tramInfo?.spd ?? 0;
        const acc = tramInfo?.acc ?? 0;

        // Shape position interpolation by acceleration so the on-screen motion
        // mirrors the physical vehicle: ease-in while accelerating away from a
        // stop, ease-out while braking into one. Heading eases smoothly.
        //
        // A vehicle with a dead-reckoning anchor has something better than an
        // easing curve to follow: the speed profile its own readings imply,
        // which is also what placed this window's target. Using it here means
        // the vehicle covers the window at the rate it is actually predicted to
        // travel — and that a window opened into a gap in the feed is animated
        // with the speed it has by then, not the speed it had when it last
        // spoke. `easeByAccel` remains the fallback for a vehicle with no
        // anchor: one that has only just appeared, or a metro too far off its
        // tracks to place.
        //
        // None of that shaping survives a fast replay, though, and it should
        // not: past a couple of seconds of history per window the two ends of
        // the glide are both *measured* positions, several hundred metres
        // apart, and the honest way between them is a straight constant-rate
        // line. Easing one in and out of every one of eight windows a second
        // would make the whole city pulse.
        const longStep = stepSecRef.current > MAX_WINDOW_SEC;
        const glide = glideRef.current[id];
        const tPos = longStep
          ? t
          : glide
            ? glideFraction(
                glide.spd,
                glide.acc,
                glide.ageStart,
                t,
                glide.limits,
                stepSecRef.current
              )
            : easeByAccel(t, acc);
        let lat = lerp(prev.lat, target.lat, tPos);
        let lng = lerp(prev.lng, target.lng, tPos);
        let hdg = lerpAngle(prev.hdg, target.hdg, longStep ? t : smoothstep(t));
        let renderTrack: TrackPlacement | undefined;

        // A rail vehicle that stayed on the same track between two snapshots is
        // moved *along* it: interpolating arc length and reading the position
        // back off the geometry keeps a train in its tunnel and a tram on its
        // rails through curves, where interpolating the endpoints would cut
        // straight across them.
        if (
          target.track &&
          prev.track &&
          prev.track.line === target.track.line &&
          prev.track.index === target.track.index
        ) {
          const track = tracksRef.current[target.track.line]?.[target.track.index];
          if (track) {
            const distance = lerp(prev.track.distance, target.track.distance, tPos);
            const point = pointOnTrack(track, distance);
            lat = point.lat;
            lng = point.lng;
            // Face along the track. A standing vehicle keeps the heading it
            // had: the tangent alone cannot say which end is the front.
            hdg = target.track.forward ? point.bearing : (point.bearing + 180) % 360;
            renderTrack = { ...target.track, distance };
            spines[id] = trackSpine(track, distance, target.track.forward);
          }
        } else if (target.track) {
          // No shared track to slide along — the vehicle has only just
          // appeared, or it changed pattern — so this frame falls back to the
          // straight interpolation above. The placement is still carried forward so the
          // next snapshot can resume along-track motion immediately; a line's
          // patterns run within a few metres of each other, so the distance is
          // at most that far out for the one frame it is used.
          renderTrack = target.track;
        }

        rendered[id] = { lat, lng, hdg, track: renderTrack };

        // Off-screen vehicles keep their interpolated position but are not put
        // in the collection. The selected one always is, whatever the viewport
        // says: the popup, the next-stop highlight and the follow camera all
        // read its feature from here.
        const onScreen = lng >= west && lng <= east && lat >= south && lat <= north;
        if (onScreen) visible++;
        if (!onScreen && id !== selectedTramIdRef.current) return;

        const doorsOpen = tramInfo?.drst === 1;
        // Normalise speed to 0..1 for the aura sizing. Capped low (~8 m/s ≈ 29 km/h)
        // so the aura reaches its full, clearly-visible size at ordinary city-tram
        // cruising speeds rather than only when a vehicle is racing.
        const speedNorm = clamp(spd / 8, 0, 1);
        // Passenger load, where the mode measures it — which today is the ferry
        // and nothing else. See lib/occupancy.
        const load = occupancyFraction(tramInfo?.mode, tramInfo?.occu);

        features.push({
          type: 'Feature' as const,
          geometry: {
            type: 'Point' as const,
            coordinates: [lng, lat],
          },
          properties: {
            veh: id,
            desi: tramInfo?.desi || '',
            hdg: hdg,
            stopped: doorsOpen || spd === 0,
            mode: tramInfo?.mode || 'tram',
            spd: spd,
            acc: acc,
            speedNorm: speedNorm,
            doorsOpen: doorsOpen,
            occuBucket: ferryIconBucket(load),
          },
        });
      });

      renderedPositionsRef.current = rendered;
      visibleCountRef.current = visible;

      const source = map.getSource('trams') as maplibregl.GeoJSONSource;
      if (source) {
        source.setData({
          type: 'FeatureCollection',
          features,
        });
      }

      // 3D bodies from the same interpolated positions the flat icons use.
      // Built only while models are enabled and the view is close enough
      // for the layer to draw: extruding every vehicle is several polygons each,
      // and there is no point paying for it to render nothing.
      const source3d = map.getSource('vehicles-3d') as maplibregl.GeoJSONSource | undefined;
      if (source3d) {
        const draw3d = vehicles3DEnabled(is3DRef.current, always3DVehiclesRef.current) &&
          map.getZoom() >= VEHICLE_3D_MIN_ZOOM;
        if (draw3d || vehicles3dDrawnRef.current) {
          // A detailed body has many polygons, against one point for the flat icon,
          // so only what is actually on screen is built. Padded by a body length
          // so a train is not clipped as it enters the view.
          const bounds = draw3d ? map.getBounds().toArray() : null;
          const pad = 0.0012;
          const onScreen = (lng: number, lat: number) =>
            !bounds ||
            (lng >= bounds[0][0] - pad && lng <= bounds[1][0] + pad &&
             lat >= bounds[0][1] - pad && lat <= bounds[1][1] + pad);
          const doorAnimations: Record<string, DoorAnimation> = {};
          const states: VehicleState[] = draw3d
            ? features
                .filter((f) => onScreen(f.geometry.coordinates[0], f.geometry.coordinates[1]))
                .map((f) => {
                  const id = f.properties.veh;
                  const telemetry = latestTramsRef.current[id];
                  const doors = advanceDoors(doorAnimationsRef.current[id], f.properties.doorsOpen, now);
                  doorAnimations[id] = doors;
                  return {
                    veh: f.properties.veh,
                    lng: f.geometry.coordinates[0],
                    lat: f.geometry.coordinates[1],
                    hdg: f.properties.hdg,
                    mode: f.properties.mode,
                    desi: f.properties.desi,
                    doorsOpen: f.properties.doorsOpen,
                    doorProgress: doors.progress,
                    braking: isVehicleBraking(telemetry?.spd, telemetry?.acc, f.properties.doorsOpen),
                    selected: f.properties.veh === selectedTramIdRef.current,
                    // The ferry's 3D deck gauge reads the same number the flat
                    // marker's does, so the two never disagree at the zoom
                    // where they cross over.
                    occupancy: occupancyFraction(telemetry?.mode, telemetry?.occu),
                    // A vehicle being drawn along its rails is *built* along
                    // them too: each rigid section of the body sits at its own
                    // point on the track, so an articulated tram bends through
                    // a corner instead of ploughing across it. One with no path
                    // (a bus, or a tram off its route) stays a rigid box on its
                    // single heading, exactly as before.
                    spine: spines[id],
                  };
                })
            : [];
          doorAnimationsRef.current = doorAnimations;
          source3d.setData(vehicleExtrusionCollection(states, map.getZoom() >= 16));
          vehicles3dDrawnRef.current = draw3d;
        }
      }

      // Update the next-stop highlight. Whether a vehicle is selected decides
      // which end the highlight is read from, below.
      let vehicleSelected = false;
      let nextStopCoords: [number, number] | null = null;
      let nextStopId: string | null = null;
      let nextStopBoarding = false;

      if (selectedTramIdRef.current && selectedTripDetailsRef.current) {
        const selectedTram = latestTramsRef.current[selectedTramIdRef.current];
        if (selectedTram) {
          vehicleSelected = features.some((f) => f.properties.veh === selectedTramIdRef.current);

          if (selectedTram.stop) {
            lastSeenStopIdRef.current = selectedTram.stop;
          }
          const tripStops = selectedTripDetailsRef.current.stops;
          const { nextStopIndex } = tripProgress(selectedTram, tripStops, {
            lastSeenStopId: lastSeenStopIdRef.current,
          });

          if (nextStopIndex !== -1) {
            const matchedStop = tripStops[nextStopIndex];
            nextStopCoords = [matchedStop.lon, matchedStop.lat];
            nextStopId = matchedStop.gtfsId ?? null;
            // Doors open at the stop we are pointing at: the platform edge
            // lights up while passengers are actually boarding.
            nextStopBoarding = isBoardingAt(selectedTram, nextStopId);
          }
        }
      }

      // Arrival focus: the same highlight, read from the stop's end. There is
      // no vehicle selected in this mode (App keeps the two exclusive), so the
      // stop is the one the reader is walking to and the vehicle is whichever
      // one is bringing the next departure to it.
      const focus = arrivalFocusRef.current;
      let focusVehicleMode: string | null = null;
      if (!vehicleSelected && focus) {
        const focusStopCoords = arrivalStopCoordsRef.current;
        const focusFeature = features.find((f) => f.properties.veh === focus.vehicleId);
        if (focusFeature && focusStopCoords) {
          focusVehicleMode = focusFeature.properties.mode;
          nextStopCoords = focusStopCoords;
          nextStopId = focus.stopId;
          // Doors open at the stop being watched: it is boarding right now.
          nextStopBoarding = latestTramsRef.current[focus.vehicleId]?.drst === 1;
        }
      }

      // Update next stop highlight source
      const nextStopSource = map.getSource('next-stop-highlight-source') as maplibregl.GeoJSONSource;
      if (nextStopSource) {
        let nextStopMode = focusVehicleMode ? focusVehicleMode.toUpperCase() : 'TRAM';
        if (selectedTramIdRef.current) {
          const selectedTram = latestTramsRef.current[selectedTramIdRef.current];
          if (selectedTram && selectedTram.mode) {
            nextStopMode = selectedTram.mode.toUpperCase();
          }
        }
        nextStopSource.setData({
          type: 'FeatureCollection',
          features: nextStopCoords ? [{
            type: 'Feature',
            geometry: {
              type: 'Point',
              coordinates: nextStopCoords,
            },
            properties: {
              mode: nextStopMode,
            },
          }] : [],
        });
      }

      // Phase 4 liveness: the stop a selected vehicle is heading for takes the
      // gold of the selection ring across its furniture, and pulses. Rebuilding
      // the furniture is only worth it when the highlight actually changed.
      const highlightKey = `${nextStopId ?? ''}|${nextStopBoarding}`;
      if (highlightKey !== stopHighlightRef.current.key) {
        stopHighlightRef.current = {
          key: highlightKey,
          stopId: nextStopId,
          boarding: nextStopBoarding,
          coords: nextStopCoords,
        };
        const pulseSource = map.getSource('stop-pulse') as maplibregl.GeoJSONSource | undefined;
        if (pulseSource) {
          pulseSource.setData({
            type: 'FeatureCollection',
            features: nextStopCoords ? [{
              type: 'Feature',
              geometry: { type: 'Point', coordinates: nextStopCoords },
              properties: {},
            }] : [],
          });
        }
        updateStopFurniture(map, mapThemeRef.current);
        updateBikeFurniture(map, mapThemeRef.current);
      }
      // The pulse itself, driven off the same clock as the vehicles so the two
      // beat together rather than drifting apart.
      if (map.getLayer('stop-pulse-ring') && stopHighlightRef.current.coords) {
        const phase = (now % 1600) / 1600;
        map.setPaintProperty('stop-pulse-ring', 'circle-radius', 14 + 16 * phase);
        map.setPaintProperty('stop-pulse-ring', 'circle-opacity', 0.28 * (1 - phase));
        map.setPaintProperty('stop-pulse-ring', 'circle-stroke-opacity', 0.9 * (1 - phase));
      }

      // Smooth camera tracking
      if (isFollowingRef.current && selectedTramIdRef.current) {
        const activeFeature = features.find((f) => f.properties.veh === selectedTramIdRef.current);
        if (activeFeature && !isInteractingRef.current) {
          const [lng, lat] = activeFeature.geometry.coordinates;
          const hdg = activeFeature.properties.hdg;
          map.jumpTo({
            center: [lng, lat],
            bearing: hdg,
          });
        }
      }
    };

    animationFrameRef.current = requestAnimationFrame(tick);
  }

  // Sync incoming tram data to animation refs
  useEffect(() => {
    const now = performance.now();
    const newPrev: Record<string, RenderPosition> = {};
    const newTarget: Record<string, RenderPosition> = {};

    // How long this glide window gets. The backend broadcasts once a second, so
    // the gap between two snapshots is what the next window has to cover —
    // measuring it rather than assuming a second keeps the vehicles moving at
    // the right rate when the feed is late, instead of arriving early and
    // standing still until it catches up.
    if (lastUpdateRef.current > 0) {
      const wallSec = (now - lastUpdateRef.current) / 1000;
      const scale = Math.max(timeScaleRef.current, 0.1);
      const floor = scale > 1 ? MIN_REPLAY_WINDOW_SEC : MIN_WINDOW_SEC;
      windowSecRef.current = clamp(wallSec, floor, MAX_WINDOW_SEC);
      // The travel this window covers, which at speed is the step the replay
      // advanced by rather than the sliver of wall clock it took.
      stepSecRef.current = windowSecRef.current * scale;
      // Prediction is still bounded by MAX_WINDOW_SEC: a fast replay may hand
      // over eight seconds of travel at a time, but carrying a vehicle eight
      // seconds forward on a stale speed invents more than it draws. Nor is it
      // ever carried further than the window itself covers.
      dataWindowSecRef.current = clamp(
        Math.min(stepSecRef.current, MAX_WINDOW_SEC),
        MIN_WINDOW_SEC,
        MAX_WINDOW_SEC
      );
    }

    // Filter trams based on line filters
    const filteredTrams = Object.entries(trams).filter((entry) => {
      const tram = entry[1];
      if (lineFilters.length === 0) return true;
      return lineFilters.includes(tram.desi);
    });

    const newFixes: Record<string, VehicleFix> = {};
    const newGlides: Record<string, Glide> = {};

    filteredTrams.forEach(([id, tram]) => {
      const previous = targetPositionsRef.current[id];
      const fix = fixRef.current[id];
      const limits = reckonLimits(tram.mode);

      // Which way along the track a train is running is judged by comparing this
      // report with the one before it — so the comparison has to be against the
      // last *reported* placement, not against the last target. The target is
      // normally a prediction that has deliberately run ahead of the feed, and a
      // new report measured against it reads as travel backwards: the train
      // turns round, and the next prediction carries it back down its own track
      // until the following report turns it round again.
      const previousPlacement: TrackPlacement | undefined = fix?.track ?? previous?.track;

      // Rail vehicles are drawn on their rails, not where the feed claims they
      // are: a metro because its underground position is dead-reckoned and
      // drifts out of its tunnel, a tram because its position cannot tell the
      // two tracks of a street apart and its journey's direction can.
      //
      // How stale the placement being continued from is — the age of the anchor
      // it came from, or one snapshot when the vehicle has only a target — sets
      // how far along its route the vehicle may have got since.
      const placementAge = fix
        ? ((now - fix.seenAt) / 1000) * Math.max(timeScaleRef.current, 0.1)
        : dataWindowSecRef.current;
      const snapped = placeOnRails(tram, previousPlacement, placementAge);
      let target: RenderPosition = snapped
        ? { lat: snapped.lat, lng: snapped.lng, hdg: snapped.hdg, track: snapped.track }
        : { lat: tram.lat, lng: tram.lng, hdg: tram.hdg };

      // Only a new *coordinate* is a new report. A metro repeats its position
      // for seconds at a time while the timestamp keeps ticking, so testing the
      // timestamp — as this once did — re-anchored the train on its own stale
      // position every second and left the prediction below with nothing to do.
      // Surface vehicles repeat a coordinate too, about a fifth of the time,
      // and for them it almost always means what it looks like: standing still.
      // Either way the anchor should only move when the vehicle does.
      const moved = hasMoved(fix, tram);
      // A metro that could not be snapped — no geometry yet, or too far off the
      // network to trust — carries no anchor: its raw reported position is
      // drawn, and the next successful snap starts a fresh one. A tram is
      // anchored either way: unlike the metro its raw position is a real GPS
      // fix, so it is worth dead-reckoning from whether or not it snapped.
      const anchorable = tram.mode !== 'metro' || !!snapped;

      if (anchorable && moved) {
        // A real report: it becomes the new anchor everything is predicted
        // from, and this window animates the correction into it.
        newFixes[id] = {
          ts: tram.ts,
          lat: tram.lat,
          lng: tram.lng,
          seenAt: now,
          spd: tram.spd ?? 0,
          acc: tram.acc ?? 0,
          hdg: tram.hdg,
          limits,
          track: snapped?.track,
        };
        newGlides[id] = { spd: tram.spd ?? 0, acc: tram.acc ?? 0, ageStart: 0, limits };

        // Aim at where the vehicle will be at the *end* of this window rather
        // than at the report itself. Targeting the bare report would draw it a
        // whole window behind and step it back by the travel already drawn for
        // it, so every report landed as a small reversal — once a second on
        // every vehicle on the map.
        const projected = predictPosition(newFixes[id], 0);
        if (projected) {
          target = projected;
        }
      } else if (anchorable && fix) {
        // The coordinate stood still. Carry the vehicle on at the speed it last
        // reported, and keep the anchor so the next real position corrects a few
        // metres of prediction error rather than landing as a jump. One that has
        // genuinely stopped reported zero and therefore stays put; one whose
        // message froze mid-journey is carried for its mode's horizon and then
        // holds, which past that horizon is what it is most likely doing anyway.
        newFixes[id] = fix;
        const age = ((now - fix.seenAt) / 1000) * Math.max(timeScaleRef.current, 0.1);
        const predicted = predictPosition(fix, age);
        if (predicted) {
          target = predicted;
        }
        newGlides[id] = { spd: fix.spd, acc: fix.acc, ageStart: age, limits: fix.limits };
      }

      // Start the next glide from what is on screen right now — mid-glide when
      // an update lands early, the last target when it lands on time — so a
      // correction is eased in rather than snapped back to.
      const from = renderedPositionsRef.current[id] || previous || target;

      // Unless gliding there would be a lie. The feed does occasionally fling a
      // coordinate right across the city — single steps implying 427 km/h for a
      // tram, 1198 for a bus and 2867 for a train all appear in a five-minute
      // capture — and a smooth glide renders one of those as a vehicle
      // sprinting down a street it was never on. Past a plainly impossible
      // speed the honest drawing is a jump: the vehicle is simply somewhere
      // else now.
      //
      // Four times the mode's top speed is where that line sits, and the metro
      // is what puts it there rather than the surface modes. A metro's
      // coordinate is held for seconds and then arrives fifty metres on, so its
      // ordinary steps are large by construction: at twice top speed this would
      // fire on 96% of them and snap away the very corrections the metro's
      // dead reckoning exists to smooth. At four times it fires on 0.4% of
      // metro steps, 0.04% of tram steps, 0.02% of train steps and no bus step
      // at all — the outliers, and nothing else.
      // Measured against the history the window covers, not against the wall
      // clock it took: at sixty times a perfectly ordinary tram moves eight
      // seconds' worth between snapshots, and a guard sized for one second
      // would call every one of those a teleport and snap it into place —
      // turning the whole replay into a slideshow.
      const leap =
        distanceBetween(from, target) >
        limits.maxSpeed * 4 * Math.max(stepSecRef.current, MIN_WINDOW_SEC);
      newPrev[id] = leap ? target : from;
      newTarget[id] = target;
    });

    prevPositionsRef.current = newPrev;
    targetPositionsRef.current = newTarget;
    // Rebuilt rather than mutated, so a vehicle that left the feed does not keep
    // being predicted forward forever.
    fixRef.current = newFixes;
    glideRef.current = newGlides;
    lastUpdateRef.current = now;

    // Every vehicle carries its own traffic light priority exchange, so the
    // junctions it is talking to are refreshed from the same message the
    // positions came in on. The signature check inside makes this a no-op
    // unless a request or an answer actually changed.
    const map = mapRef.current;
    if (map && map.getStyle()) updateSignalPriority(map);
  }, [trams, lineFilters]);


  // Setup programmatically created sources, layers, and images
  const interactionsBoundMapRef = useRef<maplibregl.Map | null>(null);
  const setupCustomMapElements = (map: maplibregl.Map) => {
    if (!apiKey) return;

    installMapLayers(map, {
      theme: mapThemeRef.current,
      is3D: is3DRef.current,
      always3DVehicles: always3DVehiclesRef.current,
      mmlKey: mmlKeyRef.current,
      journeyVehicleIds: journeyVehicleIdsRef.current,
      selectedVehicleId: selectedTramIdRef.current,
      bikeStations: bikeStationsDataRef.current,
      trafficLights: trafficLightsDataRef.current,
      isCurrent: (candidate) => mapRef.current === candidate,
    });

    // Draw route geometries now that style and layer are loaded
    drawRouteGeometries(map, routeGeometriesRef.current, selectedLineRef.current);

    // Restore any active journey after a style/theme change
    updateJourney(map, journeyLegsRef.current, journeyEndpointsRef.current, false);

    // Hide default bus stops from the vector style, and the style's own metro /
    // commuter-rail station layers — those are drawn by our stops_metro and
    // stops_train layers instead, which follow the Metro and Trains toggles.
    const busStopLayers = ['stops_bus', 'stops_trunk'];
    busStopLayers.forEach((layerId) => {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, 'visibility', 'none');
      }
    });
    ['stops_subway', 'stops_rail'].forEach((layerId) => {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, 'visibility', 'none');
      }
    });

    // Apply stops route filters to built-in vector stops
    if (map.getLayer('stops_tram') || map.getLayer('stops_case')) {
      const activeRoutes = [...lineFilters];
      const selectedTram = selectedTramIdRef.current ? latestTramsRef.current[selectedTramIdRef.current] : null;
      if (selectedTram && !activeRoutes.includes(selectedTram.desi)) {
        activeRoutes.push(selectedTram.desi);
      }
      const allowedStopIdsSet = new Set<string>();
      activeRoutes.forEach((line) => {
        const routeData = routeGeometriesRef.current[line];
        if (routeData && routeData.stops) {
          routeData.stops.forEach((id) => {
            allowedStopIdsSet.add(id);
            allowedStopIdsSet.add(id.replace(/^HSL:/, ''));
          });
        }
      });
      const allowedStopIds = Array.from(allowedStopIdsSet);

      if (map.getLayer('stops_tram')) {
        if (activeRoutes.length === 0) {
          map.setFilter('stops_tram', ['==', ['get', 'mode'], 'TRAM']);
        } else {
          map.setFilter('stops_tram', [
            'all',
            ['==', ['get', 'mode'], 'TRAM'],
            ['in', ['to-string', ['coalesce', ['get', 'gtfsId'], ['get', 'stopId'], ['get', 'id'], ['id'], '']], ['literal', allowedStopIds]]
          ] as maplibregl.FilterSpecification);
        }
      }
    }

    // Apply active route visibility and 3D mode setting. With no line filter the
    // whole network shows; selecting lines narrows it to just those routes.
    updateRouteVisibility(map, {
      modes: modesRef.current,
      lines: lineFiltersRef.current,
      selectedLine: selectedLineRef.current,
      ribbonLines: Object.keys(routeGeometriesRef.current),
      routes: showRoutesRef.current,
    });
    updateMetroSignVisibility(map, modesRef.current.metro);
    update3DMode(map, is3DRef.current, mapThemeRef.current);
    updateVehicle3DMode(map, vehicles3DEnabled(is3DRef.current, always3DVehiclesRef.current));
    // The style reload recreated every source, so whatever the furniture was
    // last built for no longer exists.
    stopFurnitureSigRef.current = '';
    updateStopFurniture(map, mapThemeRef.current);
    bikeFurnitureSigRef.current = '';
    updateBikeFurniture(map, mapThemeRef.current);
    // The recreated junction source came back without the live states on it.
    junctionPrioritySigRef.current = '';
    updateSignalPriority(map);
    arrivalLabelSigRef.current = '';
    updateArrivalLabelStops(map);

    // Hide white casing layers
    const casingLayers = ['stops_case', 'stops_rail_case', 'stops_hub', 'stops_rail_hub'];
    casingLayers.forEach((layerId) => {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, 'visibility', 'none');
      }
    });

    // Ensure all bus stops (including trunk stops) render in blue color in light theme
    if (map.getLayer('stops_trunk')) {
      map.setPaintProperty('stops_trunk', 'circle-color', '#007ac9');
    }


    // Give the stop discs the same treatment in both themes. In the light theme
    // most of these layers come from the HSL vector style itself, with a radius
    // ramp built for a style whose stops stay discs all the way in — it puts a
    // one-pixel dot on the map across the whole band where we draw discs, which
    // is a stop that is there but cannot be seen. The ramp below is scoped to
    // that band, so a stop reads as a marker next to the city-bike gauges, and
    // the discs still fade out as the sign boards take over at 15.5.
    const applyStopCircleStyle = (layerId: string, radius: typeof STOP_CIRCLE_RADIUS, minzoom: number) => {
      if (!map.getLayer(layerId)) return;
      map.setLayerZoomRange(layerId, minzoom, STOP_CIRCLE_FADE_ZOOM);
      map.setPaintProperty(layerId, 'circle-radius', radius);
      map.setPaintProperty(layerId, 'circle-stroke-color', STOP_CIRCLE_STROKE_COLOR);
      map.setPaintProperty(layerId, 'circle-stroke-width', STOP_CIRCLE_STROKE_WIDTH);
      map.setPaintProperty(layerId, 'circle-opacity', STOP_CIRCLE_OPACITY);
      map.setPaintProperty(layerId, 'circle-stroke-opacity', STOP_CIRCLE_OPACITY);
    };
    STOP_CIRCLE_LAYERS.forEach((layerId) => {
      applyStopCircleStyle(layerId, STOP_CIRCLE_RADIUS, STOP_CIRCLE_MIN_ZOOM);
    });
    STATION_CIRCLE_LAYERS.forEach((layerId) => {
      applyStopCircleStyle(layerId, STATION_CIRCLE_RADIUS, STATION_CIRCLE_MIN_ZOOM);
    });


    // Register all layer-specific interactions once per map instance. MapLibre
    // layer events are delegated by layer id, so they survive style/theme
    // swaps — re-binding on every style.load would stack duplicate handlers.
    if (interactionsBoundMapRef.current === map) return;
    interactionsBoundMapRef.current = map;

    const handleTramClick = (e: maplibregl.MapLayerMouseEvent) => {
      if (!e.features || e.features.length === 0) return;
      const feat = e.features[0];
      const vehId = feat.properties?.veh;
      const matchingTram = latestTramsRef.current[vehId];
      if (matchingTram) {
        callbacksRef.current.onSelectTram(matchingTram);
      }
    };
    // The body symbol is the primary hit target; the aura circle is often
    // faint/zero-opacity for stationary vehicles, so bind both.
    map.on('click', 'trams-body', handleTramClick);
    map.on('click', 'trams-circles', handleTramClick);
    map.on('click', 'vehicles-3d', handleTramClick);

    const handleStopClick = (e: maplibregl.MapLayerMouseEvent) => {
      if (!e.features || e.features.length === 0) return;
      const feat = e.features[0];
      // Support both Digitransit tile properties (gtfsId, name, code)
      // and JORE tile properties (stopId, nameFi, shortId)
      const rawId = feat.properties?.gtfsId || feat.properties?.stopId || feat.properties?.id || feat.id;
      const name = feat.properties?.name || feat.properties?.nameFi || 'Unknown Stop';
      const code = feat.properties?.code || feat.properties?.shortId || '';

      const coordinates = feat.geometry.type === 'Point' ? feat.geometry.coordinates : undefined;
      const lng = coordinates ? coordinates[0] : undefined;
      const lat = coordinates ? coordinates[1] : undefined;
      // JORE tiles call it `mode`, Digitransit v3 stops call it `type`.
      const mode = feat.properties?.mode || feat.properties?.type || 'TRAM';
      const isTrunkStop = feat.properties?.isTrunkStop === true || feat.properties?.isTrunkStop === 'true';

      if (rawId) {
        let stopId = rawId.toString();
        if (!stopId.startsWith('HSL:')) {
          stopId = 'HSL:' + stopId;
        }
        callbacksRef.current.onSelectStop(stopId, name, code, lat, lng, mode, isTrunkStop);
      }
    };

    map.on('click', 'stops_tram', handleStopClick);
    map.on('click', 'stops_metro', handleStopClick);
    map.on('click', 'stops_train', handleStopClick);
    map.on('click', 'stops_bus', handleStopClick);
    map.on('click', 'stops_trunk', handleStopClick);
    map.on('click', 'stops_signs', handleStopClick);

    // A click on the 3D furniture opens the same popup as its sign. The
    // extrusions carry only a stop id, so the rest comes from the meta table
    // built alongside them.
    map.on('click', STOP_FURNITURE_LAYER, (e: maplibregl.MapLayerMouseEvent) => {
      const stopId = e.features?.[0]?.properties?.stopId;
      if (!stopId) return;
      const info = stopFurnitureMetaRef.current[String(stopId)];
      if (!info) return;
      callbacksRef.current.onSelectStop(
        `HSL:${stopId}`, info.name, info.code, e.lngLat.lat, e.lngLat.lng, info.mode, false,
      );
    });

    const handleBikeClick = (e: maplibregl.MapLayerMouseEvent) => {
      if (!e.features || e.features.length === 0) return;
      const feat = e.features[0];
      const stationId = feat.properties?.id || feat.properties?.stationId;
      const name = feat.properties?.name || 'Bike Station';
      if (stationId) {
        callbacksRef.current.onSelectBikeStation({ id: stationId, name });
      }
    };

    map.on('click', 'citybike_gauge', handleBikeClick);

    // Up close the rack is the station, so clicking one opens the same panel.
    // The name lives in the availability payload rather than in the extrusion
    // properties, which carry only what the geometry needs.
    map.on('click', BIKE_STATION_LAYER, (e: maplibregl.MapLayerMouseEvent) => {
      if (!e.features || e.features.length === 0) return;
      const stationId = e.features[0].properties?.stationId;
      if (!stationId) return;
      const id = String(stationId);
      const known = bikeStationsDataRef.current?.features
        .find((f) => f.properties.stationId === id);
      callbacksRef.current.onSelectBikeStation({ id, name: known?.properties.name || 'Bike Station' });
    });

    // A junction is a thing you can select, because the exchange it is having
    // has two sides: the vehicle panel says what this tram is asking, and the
    // junction panel says who is asking *this crossing* and who it has
    const handleJunctionClick = (e: maplibregl.MapLayerMouseEvent) => {
      const raw = e.features?.[0]?.properties?.id;
      const junctionId = Number(raw);
      if (!Number.isFinite(junctionId)) return;
      callbacksRef.current.onSelectJunction(junctionId);
    };

    map.on('click', TRAFFIC_LIGHT_ICON_LAYER, handleJunctionClick);

    // Mouse Hover Effects
    const setCursorPointer = () => (map.getCanvas().style.cursor = 'pointer');
    const resetCursor = () => (map.getCanvas().style.cursor = '');

    map.on('mouseenter', 'trams-body', setCursorPointer);
    map.on('mouseleave', 'trams-body', resetCursor);
    map.on('mouseenter', 'trams-circles', setCursorPointer);
    map.on('mouseleave', 'trams-circles', resetCursor);
    map.on('mouseenter', 'vehicles-3d', setCursorPointer);
    map.on('mouseleave', 'vehicles-3d', resetCursor);
    map.on('mouseenter', 'stops_tram', setCursorPointer);
    map.on('mouseleave', 'stops_tram', resetCursor);
    map.on('mouseenter', 'stops_metro', setCursorPointer);
    map.on('mouseleave', 'stops_metro', resetCursor);
    map.on('mouseenter', 'stops_train', setCursorPointer);
    map.on('mouseleave', 'stops_train', resetCursor);
    map.on('mouseenter', 'stops_bus', setCursorPointer);
    map.on('mouseleave', 'stops_bus', resetCursor);
    map.on('mouseenter', 'stops_trunk', setCursorPointer);
    map.on('mouseleave', 'stops_trunk', resetCursor);
    map.on('mouseenter', 'stops_signs', setCursorPointer);
    map.on('mouseleave', 'stops_signs', resetCursor);
    map.on('mouseenter', STOP_FURNITURE_LAYER, setCursorPointer);
    map.on('mouseleave', STOP_FURNITURE_LAYER, resetCursor);
    map.on('mouseenter', 'citybike_gauge', setCursorPointer);
    map.on('mouseleave', 'citybike_gauge', resetCursor);
    map.on('mouseenter', BIKE_STATION_LAYER, setCursorPointer);
    map.on('mouseleave', BIKE_STATION_LAYER, resetCursor);
    map.on('mouseenter', TRAFFIC_LIGHT_ICON_LAYER, setCursorPointer);
    map.on('mouseleave', TRAFFIC_LIGHT_ICON_LAYER, resetCursor);

    // Stop furniture is rebuilt when the view settles, not per frame. `idle`
    // rather than `moveend` because the platform polygons it orients itself
    // from arrive with the tiles, which land after the move has ended.
    const rebuildFurniture = () => {
      updateStopFurniture(map, mapThemeRef.current);
      updateBikeFurniture(map, mapThemeRef.current);
      updateArrivalLabelStops(map);
    };
    map.on('moveend', rebuildFurniture);
    map.on('idle', rebuildFurniture);
  };

  // Initial Map Setup
  useEffect(() => {
    if (apiKey === null) return;
    if (!mapContainerRef.current) return;

    const initialStyleUrl = basemapStyleUrl(mapThemeRef.current);

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: initialStyleUrl,
      center: [24.9414, 60.1699], // Helsinki center
      zoom: 14,
      maxZoom: 18,
      minZoom: 10,
      attributionControl: false,
      transformRequest: (url: string) => {
        if (url.includes('digitransit.fi')) {
          const separator = url.includes('?') ? '&' : '?';
          return {
            url: `${url}${separator}digitransit-subscription-key=${apiKey}`,
          };
        }
        return { url };
      },
    });

    mapRef.current = map;

    // Test hook. scripts/verify-map-renders.mjs sets __mlProbe before the app
    // boots so it can read isStyleLoaded()/areTilesLoaded() back out -- the
    // signals that were false the whole time v0.46.0 was shipping a blank map.
    // Without the flag this is a no-op, so nothing is exposed in production.
    const probe = window as unknown as { __mlProbe?: boolean; __mlMap?: maplibregl.Map };
    if (probe.__mlProbe) probe.__mlMap = map;

    // MapLibre reports a failed WebGL2 context as a map `error` event rather
    // than by throwing, so without a listener the failure is entirely silent.
    map.on('error', (e) => {
      const message = e?.error?.message ?? '';
      if (/webgl/i.test(message)) {
        setWebglFailed(true);
      }
      console.error('MapLibre error:', message || e);
    });

    // Add GeolocateControl for mobile/user self-location tracking
    const geolocate = new maplibregl.GeolocateControl({
      positionOptions: {
        enableHighAccuracy: true,
      },
      trackUserLocation: true,
      showUserLocation: true,
    });
    map.addControl(geolocate, 'bottom-right');

    // Report whether the control is on, so the rest of the app can follow it.
    // The control's own events do not answer that question on their own:
    // `trackuserlocationend` fires both when it is switched off and when a pan
    // drops it into the background, where it is still very much on. What it
    // does keep truthful is the button, so the button is what is read — every
    // state change writes those classes before the event that announces it.
    const locatingNow = () => {
      const button = map.getContainer().querySelector('.maplibregl-ctrl-geolocate');
      if (!button) return false;
      return ['active', 'background', 'waiting', 'active-error', 'background-error']
        .some((state) => button.classList.contains(`maplibregl-ctrl-geolocate-${state}`));
    };
    const reportLocating = () => callbacksRef.current.onLocatingChange?.(locatingNow());
    geolocate.on('trackuserlocationstart', reportLocating);
    geolocate.on('trackuserlocationend', reportLocating);
    geolocate.on('userlocationfocus', reportLocating);
    geolocate.on('userlocationlostfocus', reportLocating);
    geolocate.on('geolocate', reportLocating);
    geolocate.on('error', reportLocating);

    map.on('style.load', () => {
      setupCustomMapElements(map);
    });

    // Disable follow mode on drag
    map.on('dragstart', () => {
      callbacksRef.current.onDisableFollowing();
    });

    // Handle zoom, rotate, and pitch start/end events via direct DOM events on the container.
    // This immediately stops the 60fps centering loop from fighting with user interaction.
    const mapContainer = mapContainerRef.current;
    let wheelTimeout: ReturnType<typeof setTimeout> | null = null;

    const handleWheel = () => {
      isInteractingRef.current = true;
      if (wheelTimeout) clearTimeout(wheelTimeout);
      wheelTimeout = setTimeout(() => {
        isInteractingRef.current = false;
      }, 800); // Resume tracking 800ms after last scroll tick
    };

    const handleInteractionStart = () => {
      isInteractingRef.current = true;
    };

    const handleInteractionEnd = () => {
      isInteractingRef.current = false;
    };

    if (mapContainer) {
      mapContainer.addEventListener('wheel', handleWheel, { passive: true });
      mapContainer.addEventListener('mousedown', handleInteractionStart);
      mapContainer.addEventListener('touchstart', handleInteractionStart, { passive: true });
    }
    window.addEventListener('mouseup', handleInteractionEnd);
    window.addEventListener('touchend', handleInteractionEnd);

    // Report initial bearing and listen to map rotate events
    if (onMapBearingChange) {
      onMapBearingChange(map.getBearing());
    }
    map.on('rotate', () => {
      if (callbacksRef.current.onMapBearingChange) {
        callbacksRef.current.onMapBearingChange(map.getBearing());
      }
    });

    // Start interpolation tick loop
    startAnimationLoop();

    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (wheelTimeout) clearTimeout(wheelTimeout);
      if (mapContainer) {
        mapContainer.removeEventListener('wheel', handleWheel);
        mapContainer.removeEventListener('mousedown', handleInteractionStart);
        mapContainer.removeEventListener('touchstart', handleInteractionStart);
      }
      window.removeEventListener('mouseup', handleInteractionEnd);
      window.removeEventListener('touchend', handleInteractionEnd);
      if (mapRef.current === map) mapRef.current = null;
      if (interactionsBoundMapRef.current === map) interactionsBoundMapRef.current = null;
      map.remove();
    };
  }, [apiKey]);

  // Handle map style (theme) changes dynamically
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // The new style brings its own layers, so the filters captured from the
    // outgoing one no longer describe them.
    forgetBaseFilters(map);
    map.setStyle(basemapStyleUrl(mapTheme));
  }, [mapTheme]);

  // Poll live city-bike availability and feed it into the 'citybike' source.
  // Cached ~20s server-side, so a 30s client refresh keeps counts fresh without
  // hammering the upstream API. The latest payload is stashed in a ref so a
  // theme/style reload can re-seed the recreated source right away.
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const data = await fetchBikeStations();
        if (cancelled) return;
        bikeStationsDataRef.current = data;
        const map = mapRef.current;
        const src = map?.getSource('citybike') as maplibregl.GeoJSONSource | undefined;
        if (src && typeof src.setData === 'function') {
          src.setData(data as unknown as FeatureCollection);
        }
        // New counts mean new racks, even if nobody has touched the map.
        bikeAvailabilityStampRef.current += 1;
        if (map && map.getStyle()) updateBikeFurniture(map, mapThemeRef.current);
      } catch (err) {
        // Transient upstream/network failures just leave the last good data in
        // place; the next tick retries.
        console.error('Failed to refresh bike station availability', err);
      }
    };

    load();
    const timer = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // Feed signalized-junction locations (from the shared useTrafficLights
  // hook) into the 'traffic-lights' source once they arrive. This is static
  // reference data with nothing to poll for, unlike bike availability above.
  useEffect(() => {
    if (trafficLightFeatures.length === 0) return;
    trafficLightsDataRef.current = trafficLightFeatures;
    const map = mapRef.current;
    const src = map?.getSource(TRAFFIC_LIGHT_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (src && typeof src.setData === 'function') {
      src.setData({ type: 'FeatureCollection', features: trafficLightFeatures } as unknown as FeatureCollection);
    }
    // The junctions have only just arrived, so whatever priority state was
    // already in hand has never been painted onto them.
    if (map && map.getStyle()) {
      junctionPrioritySigRef.current = '';
      updateSignalPriority(map);
    }
  }, [trafficLightFeatures]);

  // The selected junction takes the gold on its ring.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getStyle()) return;
    if (map.getLayer(TRAFFIC_LIGHT_SELECTION_LAYER)) {
      map.setFilter(TRAFFIC_LIGHT_SELECTION_LAYER,
        ['==', ['get', 'id'], selectedJunctionId ?? -1]);
    }
  }, [selectedJunctionId]);

  // Update selection ring filter
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (map.getStyle() && map.getLayer('trams-selected-layer')) {
      map.setFilter('trams-selected-layer', ['in', ['get', 'veh'], ['literal', [...journeyVehicleIds, selectedTramId || '']]]);
    } else {
      console.warn('[Map] trams-selected-layer not found');
    }
  }, [selectedTramId, journeyVehicleIds]);

  // Frame the arrival: the vehicle and the stop it is coming to, both on
  // screen at once. Done once when the focus changes rather than on every
  // position tick — a camera that re-frames each second is unusable to
  // someone walking, and the point is a glance, not a chase.
  const arrivalFocusKey = arrivalFocus ? `${arrivalFocus.stopId}|${arrivalFocus.vehicleId}` : null;
  useEffect(() => {
    const map = mapRef.current;
    const focused = arrivalFocusRef.current;
    if (!map || !map.getStyle() || !arrivalFocusKey || !focused) return;
    const vehicle = latestTramsRef.current[focused.vehicleId];
    const stop = arrivalStopCoordsRef.current;
    if (!vehicle || !stop || !Number.isFinite(vehicle.lat) || !Number.isFinite(vehicle.lng)) return;
    map.fitBounds(
      [
        [Math.min(vehicle.lng, stop[0]), Math.min(vehicle.lat, stop[1])],
        [Math.max(vehicle.lng, stop[0]), Math.max(vehicle.lat, stop[1])],
      ],
      { padding: 96, maxZoom: 16, duration: 900 },
    );
  }, [arrivalFocusKey]);

  // Update selected stop data source dynamically
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getStyle()) return;

    const source = map.getSource('selected-stop-source') as maplibregl.GeoJSONSource;
    if (!source) return;

    if (!selectedStopId || !selectedStopCoords) {
      source.setData({
        type: 'FeatureCollection',
        features: [],
      });
      return;
    }

    source.setData({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: selectedStopCoords,
          },
          properties: {
            id: selectedStopId,
            mode: selectedStopMode || 'TRAM',
            isTrunkStop: selectedStopIsTrunk || false,
          },
        },
      ],
    });
  }, [selectedStopId, selectedStopCoords, selectedStopMode, selectedStopIsTrunk]);

  // Update selected bike station highlight filter
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getStyle()) return;

    if (map.getLayer('citybike-selected-highlight')) {
      const rawId = selectedBikeStationId || '';
      if (rawId === '') {
        map.setFilter('citybike-selected-highlight', ['==', ['to-string', ['coalesce', ['get', 'stationId'], ['get', 'id'], '']], '']);
      } else {
        map.setFilter('citybike-selected-highlight', [
          'match',
          ['to-string', ['coalesce', ['get', 'stationId'], ['get', 'id'], '']],
          [rawId],
          true,
          false
        ]);
      }
    }
    // The selected station's rack is drawn in the highlight colour, so it has
    // to be rebuilt when the selection moves.
    bikeFurnitureSigRef.current = '';
    updateBikeFurniture(map, mapThemeRef.current);
  }, [selectedBikeStationId]);


  // Center, orient and tilt map on selected tram
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedTramId) return;

    const selectedTram = latestTramsRef.current[selectedTramId];
    if (selectedTram) {
      const easeOptions: maplibregl.EaseToOptions = {
        center: [selectedTram.lng, selectedTram.lat],
        duration: 500,
        zoom: Math.max(map.getZoom(), 16),
      };

      if (isFollowing) {
        easeOptions.bearing = selectedTram.hdg;
        easeOptions.pitch = 55;
      }

      map.easeTo(easeOptions);
    }
  }, [selectedTramId, isFollowing]);

  // Update route geometries on map. Redrawn on selection change too: which line
  // is selected decides the offset slots, the widths and what gets dimmed.
  useEffect(() => {
    const map = mapRef.current;
    if (map && map.getStyle() && map.getSource('route-lines')) {
      drawRouteGeometries(map, routeGeometries, selectedLine);
    }
  }, [routeGeometries, selectedLine]);

  // Update planned journey rendering. Fit the camera only when the journey
  // itself changes (not on unrelated re-renders) to avoid fighting the user.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getStyle() || !map.getSource('journey-lines')) return;

    const fitKey = journeyLegs && journeyLegs.length > 0
      ? `${journeyLegs.length}:${journeyLegs[0].geometry?.slice(0, 12)}:${journeyLegs[journeyLegs.length - 1].geometry?.slice(-12)}`
      : '';
    const shouldFit = fitKey !== '' && fitKey !== journeyFitKeyRef.current;
    journeyFitKeyRef.current = fitKey;

    updateJourney(map, journeyLegs, journeyEndpoints, shouldFit);
  }, [journeyLegs, journeyEndpoints]);

  // Dynamic 3D Mode changes
  useEffect(() => {
    const map = mapRef.current;
    if (map && map.getStyle()) {
      update3DMode(map, is3D, mapTheme);
    }
  }, [is3D, mapTheme]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && map.getStyle()) {
      updateVehicle3DMode(map, vehicles3DEnabled(is3D, always3DVehicles));
      stopFurnitureSigRef.current = '';
      updateStopFurniture(map, mapTheme);
      bikeFurnitureSigRef.current = '';
      updateBikeFurniture(map, mapTheme);
    }
  }, [is3D, always3DVehicles, mapTheme]);

  // Dynamic Route visibility changes: the background network respects the
  // per-mode Trams/Buses toggles, gives way to the highlighted ribbons wherever
  // those cover the same mode, and is hidden altogether once the user narrows to
  // specific lines — or whenever the route-lines switch is off, which hides the
  // ribbons with it.
  useEffect(() => {
    const map = mapRef.current;
    if (map && map.getStyle()) {
      updateRouteVisibility(map, {
        modes,
        lines: lineFilters,
        selectedLine,
        ribbonLines: Object.keys(routeGeometries),
        routes: showRoutes,
      });
      updateMetroSignVisibility(map, modes.metro);
    }
  }, [lineFilters, modes, showRoutes, selectedLine, routeGeometries]);

  // Dynamic Stop Route Filtering
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getStyle()) return;

    // Build the list of active lines we want to show stops for
    const activeRoutes = [...lineFilters];
    const selectedTram = selectedTramId ? trams[selectedTramId] : null;
    if (selectedTram && !activeRoutes.includes(selectedTram.desi)) {
      activeRoutes.push(selectedTram.desi);
    }

    const allowedStopIdsSet = new Set<string>();
    activeRoutes.forEach((line) => {
      const routeData = routeGeometries[line];
      if (routeData && routeData.stops) {
        routeData.stops.forEach((id) => {
          allowedStopIdsSet.add(id);
          allowedStopIdsSet.add(id.replace(/^HSL:/, ''));
        });
      }
    });
    const allowedStopIds = Array.from(allowedStopIdsSet);

    const cleanStopId = selectedStopId ? selectedStopId.replace(/^HSL:/, '') : '';
    const excludeSelectedStopFilter: maplibregl.ExpressionSpecification = selectedStopId
      ? [
          '!',
          [
            'any',
            ['in', ['to-string', ['coalesce', ['get', 'gtfsId'], ['get', 'stopId'], ['get', 'id'], ['id'], '']], ['literal', [selectedStopId, cleanStopId]]],
            ['==', ['to-string', ['id']], selectedStopId],
            ['==', ['to-string', ['id']], cleanStopId]
          ]
        ]
      : ['literal', true]; // Always true when no stop is selected


    // Stops follow their mode's toggle, and narrow to the highlighted lines'
    // stops while a line filter or vehicle selection is active. Disc size is
    // not settled here — a quay takes the street-stop radius and a station the
    // larger one, both from where the layers are styled.
    //
    // The bus layers are hidden by visibility rather than by an impossible
    // filter: they are the only ones the style also draws at other zooms.
    const stopLayers: Array<{
      id: string;
      match: maplibregl.ExpressionSpecification;
      show: boolean;
      hideWith?: 'visibility';
    }> = [
      { id: 'stops_tram', match: ['==', ['get', 'mode'], 'TRAM'], show: modes.tram },
      { id: 'stops_metro', match: ['==', STOP_MODE, 'SUBWAY'], show: modes.metro },
      { id: 'stops_train', match: ['==', STOP_MODE, 'RAIL'], show: modes.train },
      { id: 'stops_ferry', match: ['==', STOP_MODE, 'FERRY'], show: modes.ferry },
      { id: 'stops_bus', match: ['==', ['get', 'mode'], 'BUS'], show: modes.bus, hideWith: 'visibility' },
      { id: 'stops_trunk', match: ['==', ['get', 'mode'], 'BUS'], show: modes.bus, hideWith: 'visibility' },
    ];

    const NOTHING: maplibregl.FilterSpecification = ['==', '1', '2'];

    for (const { id, match, show, hideWith } of stopLayers) {
      if (!map.getLayer(id)) continue;
      // Narrowed to specific lines, but none of their stops are in view: there
      // is nothing to draw, which is not the same as the mode being off.
      const narrowedToNothing = activeRoutes.length > 0 && allowedStopIds.length === 0;
      const visible = show && !narrowedToNothing;

      if (hideWith === 'visibility') {
        map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
        if (!visible) continue;
      } else if (!visible) {
        map.setFilter(id, NOTHING);
        continue;
      }

      const clauses: maplibregl.ExpressionSpecification[] = [match];
      if (activeRoutes.length > 0) {
        clauses.push([
          'in',
          ['to-string', ['coalesce', ['get', 'gtfsId'], ['get', 'stopId'], ['get', 'id'], ['id'], '']],
          ['literal', allowedStopIds],
        ]);
      }
      clauses.push(excludeSelectedStopFilter as maplibregl.ExpressionSpecification);
      map.setFilter(id, ['all', ...clauses]);
    }

    // 4. Stops Signs Symbol Layer
    const signModes = GTFS_SIGN_MODES.filter(({ mode }) => modes[mode]).map(({ gtfs }) => gtfs);

    if (map.getLayer('stops_signs')) {
      if (signModes.length === 0) {
        map.setFilter('stops_signs', ['==', '1', '2']);
      } else if (activeRoutes.length === 0) {
        map.setFilter('stops_signs', [
          'all',
          ['in', STOP_MODE, ['literal', signModes]],
          excludeSelectedStopFilter
        ]);
      } else if (allowedStopIds.length === 0) {
        map.setFilter('stops_signs', ['==', '1', '2']);
      } else {
        map.setFilter('stops_signs', [
          'all',
          ['in', STOP_MODE, ['literal', signModes]],
          ['in', ['to-string', ['coalesce', ['get', 'gtfsId'], ['get', 'stopId'], ['get', 'id'], ['id'], '']], ['literal', allowedStopIds]],
          excludeSelectedStopFilter
        ]);
      }
    }
  }, [lineFilters, selectedTramId, trams, routeGeometries, modes, selectedStopId]);

  return (
    <div className="map-wrapper">
      <div ref={mapContainerRef} className="map-container" />
      {/* The orthophotos are open data, and open data comes with a credit. */}
      {mapTheme === 'satellite' && (
        <div className="map-attribution">{SATELLITE_ATTRIBUTION}</div>
      )}
      {webglFailed && (
        <div className="map-unsupported" role="alert">
          <p>This map needs WebGL2, which this browser or device does not support.</p>
        </div>
      )}
    </div>
  );
};
