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
  ensureBackgroundRouteNetwork,
  forgetBaseFilters,
  updateRouteVisibility,
} from '../map/routeNetwork';
import { tripProgress, isBoardingAt } from '../lib/nextStop';
import { ARRIVAL_LABEL_MIN_ZOOM, ARRIVAL_LABEL_STOP_LIMIT } from '../lib/stopArrivals';
import type { ArrivalFocus } from '../lib/stopArrivals';
import {
  getRouteColor,
  routeColorMatchExpression,
  colorMatchExpression,
  METRO_TILE_COLORS,
  TRAIN_TILE_COLORS,
  ROUTE_COLORS,
  METRO_COLORS,
  TRAIN_COLORS,
  FERRY_COLORS,
  TRAM_GREEN,
  METRO_ORANGE,
  TRAIN_PURPLE,
  FERRY_CYAN,
} from '../lib/routeColors';
import {
  FERRY_ICON_SIZE,
  FERRY_LOAD_STEPS,
  ferryIconBucket,
  ferryIconName,
  ferryIconVariants,
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
  ROUTE_LINE_WIDTH,
  ROUTE_CASING_WIDTH,
  ROUTE_CASING_OPACITY,
  ROUTE_LINE_OFFSET,
  ROUTE_LINE_OPACITY,
  ROUTE_LINE_SORT_KEY,
} from '../lib/routeLineStyle';
import {
  vehicleExtrusionCollection,
  VEHICLE_3D_MIN_ZOOM,
  VEHICLE_3D_FULL_ZOOM,
  VEHICLE_3D_FADE_IN,
  VEHICLE_ICON_FADE_OUT,
  SELECTED_COLOR,
} from '../lib/vehicleModels';
import type { BodySpine, VehicleState } from '../lib/vehicleModels';
import {
  PLATFORM_FILTER,
  PLATFORM_FILL_LAYER,
  PLATFORM_KERB_LAYER,
  PLATFORM_TACTILE_LAYER,
  PLATFORM_3D_LAYER,
  STOP_PLATFORM_MIN_ZOOM,
  STOP_TACTILE_MIN_ZOOM,
  platformFillPaint,
  platformKerbPaint,
  platformTactilePaint,
  platformExtrusionPaint,
  platformSourceSpec,
} from '../lib/stopPlatforms';
import type { MapTheme } from '../lib/stopPlatforms';
import {
  SATELLITE_ATTRIBUTION,
  SATELLITE_LAYER_ID,
  SATELLITE_SOURCE_ID,
  satelliteSourceSpec,
  firstLabelLayerId,
  nonLabelLayersAboveSatellite,
} from '../lib/satelliteBasemap';
import {
  stopFurnitureCollection,
  longestEdgeBearing,
  nearestLineBearing,
  pointInRing,
  STOP_3D_MIN_ZOOM,
  STOP_3D_FADE_IN,
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
  BIKE_STATION_MIN_ZOOM,
  BIKE_GAUGE_BUCKETS,
  BIKE_GAUGE_ICON_SIZE,
  bikeGaugeIconSvg,
  bikeStationCollection,
  BIKE_3D_MIN_ZOOM,
  BIKE_3D_FADE_IN,
  BIKE_ICON_FADE_OUT,
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
  trafficLightIconSvg,
  trafficLightIconName,
  warningLightIconSvg,
  TRAFFIC_LIGHT_ICON_VARIANTS,
  TRAFFIC_LIGHT_ICON_WIDTH,
  TRAFFIC_LIGHT_ICON_HEIGHT,
  TRAFFIC_LIGHT_MIN_ZOOM,
  TRAFFIC_LIGHT_ICON_OPACITY,
  TRAFFIC_LIGHT_SOURCE,
  TRAFFIC_LIGHT_ICON_LAYER,
  TRAFFIC_LIGHT_SELECTION_LAYER,
} from '../lib/trafficLightModels';
import type { JunctionPriorityIndex } from '../lib/trafficLightModels';
import type { BikeStationsFeatureCollection, TrafficLightFeature } from '../types';
import { useTrafficLights } from '../hooks/useTrafficLights';
import { useRoutePatterns } from '../hooks/useRoutePatterns';

maplibregl.setWorkerUrl(maplibreWorkerUrl);

/** Carto's dark-matter: the dark theme's basemap, and the labels satellite keeps. */
const DARK_STYLE_URL = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

/**
 * Which vector style a map mode loads. Satellite is the dark style too — the
 * orthophoto is a raster layer added under its labels once it has loaded (see
 * `ensureSatelliteBasemap`), not a style of its own.
 */
const basemapStyleUrl = (theme: MapTheme): string =>
  theme === 'light' ? `${window.location.origin}/style.json` : DARK_STYLE_URL;

// A stop's mode, whichever of the two stop tilesets it came from: the JORE tiles
// the light basemap ships (`mode`) or the Digitransit v3 stops the dark theme
// falls back to (`type`). Both spell the modes the same — TRAM, BUS, SUBWAY,
// RAIL — they just disagree about the property name.
const STOP_MODE: maplibregl.ExpressionSpecification = [
  'to-string',
  ['coalesce', ['get', 'mode'], ['get', 'type'], ''],
];

// The stop next-arrival labels. Their own source and layer, because they are
// the only stop annotation that is neither in the vector tiles nor a colour
// swap on something already drawn.
// The sign-board layer filters on GTFS mode names, in the order the style
// stacks them.
const GTFS_SIGN_MODES: Array<{ mode: TransportMode; gtfs: string }> = [
  { mode: 'tram', gtfs: 'TRAM' },
  { mode: 'bus', gtfs: 'BUS' },
  { mode: 'metro', gtfs: 'SUBWAY' },
  { mode: 'train', gtfs: 'RAIL' },
  { mode: 'ferry', gtfs: 'FERRY' },
];

const ARRIVAL_LABEL_SOURCE = 'stop-arrival-labels';
const ARRIVAL_LABEL_LAYER = 'stop-arrival-labels-layer';

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

  // Tint the tram / light-rail route network by our per-line palette instead of
  // HSL's single mode green, so a line's route on the map reads in the same
  // colour as its vehicles and badges. The JORE routes tiles expose the friendly
  // line number as `routeIdParsed` (e.g. "4", "6T", "15"), which is exactly the
  // key our palette uses, so a `match` on it colours each line; any line missing
  // from the palette falls back to the mode colour (so a null/absent property is
  // a no-op, never a regression). The white casing layers stay white, and buses
  // keep their mode blue.
  const applyRouteNetworkColors = (map: maplibregl.Map) => {
    const tramColor = routeColorMatchExpression('routeIdParsed', TRAM_GREEN) as unknown as maplibregl.DataDrivenPropertyValueSpecification<string>;
    const lrailColor = routeColorMatchExpression('routeIdParsed', '#0098A1') as unknown as maplibregl.DataDrivenPropertyValueSpecification<string>;
    const setColor = (layerId: string, color: maplibregl.DataDrivenPropertyValueSpecification<string>) => {
      if (map.getLayer(layerId)) {
        map.setPaintProperty(layerId, 'line-color', color);
      }
    };
    const metroColor = colorMatchExpression('routeIdParsed', METRO_TILE_COLORS, METRO_ORANGE) as unknown as maplibregl.DataDrivenPropertyValueSpecification<string>;
    const trainColor = colorMatchExpression('routeIdParsed', TRAIN_TILE_COLORS, TRAIN_PURPLE) as unknown as maplibregl.DataDrivenPropertyValueSpecification<string>;
    setColor('route_tram', tramColor);
    setColor('route_tram_inner', tramColor);
    setColor('route_lrail', lrailColor);
    setColor('route_lrail_inner', lrailColor);
    setColor('route_subway', metroColor);
    setColor('route_rail', trainColor);
  };

  // The basemap's own metro furniture: the orange "M" entrance pins (with their
  // letter and wheelchair badges) and the named station terminal icons. They are
  // part of the vector style rather than anything we draw, so nothing tied them
  // to the Metro toggle — turning metro off left a city centre still stacked
  // with M signs. They belong to the mode, so they follow it.
  const METRO_SIGN_LAYERS = [
    'subway-entrance_icon',
    'subway-entrance_letter',
    'subway-entrance_accessibility',
    'icon_subway-station',
  ];

  const updateMetroSignVisibility = (map: maplibregl.Map, metro: boolean) => {
    METRO_SIGN_LAYERS.forEach((layerId) => {
      // Absent in the dark theme, which loads Carto's basemap instead.
      if (!map.getLayer(layerId)) return;
      map.setLayoutProperty(layerId, 'visibility', metro ? 'visible' : 'none');
    });
  };

  // Helper to toggle 3D tilt and buildings extrusion
  const update3DMode = (map: maplibregl.Map, active: boolean, theme: MapTheme) => {
    // 1. Set pitch
    map.easeTo({
      pitch: active ? 45 : 0,
      duration: 800,
    });

    // 1b. The platform kerb face. Flat, the polygon is already drawn as a
    //     surface with an outline; tilted, it needs a side to stand on.
    if (map.getLayer(PLATFORM_3D_LAYER)) {
      map.setLayoutProperty(PLATFORM_3D_LAYER, 'visibility', active ? 'visible' : 'none');
    }

    // 2. Toggle light-mode built-in 3D buildings
    if (map.getLayer('building_3d')) {
      map.setLayoutProperty('building_3d', 'visibility', active ? 'visible' : 'none');
    }
    if (map.getLayer('building')) {
      map.setLayoutProperty('building', 'visibility', active ? 'none' : 'visible');
    }
    if (map.getLayer('building_shadow')) {
      map.setLayoutProperty('building_shadow', 'visibility', active ? 'none' : 'visible');
    }

    // 3. Toggle dark-mode programmatic 3D buildings
    const custom3DId = 'custom-3d-buildings';
    if (active) {
      // Satellite rides on the same dark vector style, so it needs the same
      // programmatic buildings -- neither style ships `building_3d`.
      if (theme !== 'light') {
        if (!map.getLayer(custom3DId)) {
          if (map.getSource('carto')) {
            map.addLayer({
              id: custom3DId,
              source: 'carto',
              'source-layer': 'building',
              type: 'fill-extrusion',
              paint: {
                'fill-extrusion-color': '#2a2d30',
                'fill-extrusion-height': ['coalesce', ['get', 'render_height'], ['get', 'height'], 15],
                'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0],
                'fill-extrusion-opacity': 0.85,
              },
            });
          }
        } else {
          map.setLayoutProperty(custom3DId, 'visibility', 'visible');
        }
      } else {
        // In light mode, hide custom dark mode buildings
        if (map.getLayer(custom3DId)) {
          map.setLayoutProperty(custom3DId, 'visibility', 'none');
        }
      }
    } else {
      // If inactive, hide both light-mode and custom 3D buildings
      if (map.getLayer('building_3d')) {
        map.setLayoutProperty('building_3d', 'visibility', 'none');
      }
      if (map.getLayer(custom3DId)) {
        map.setLayoutProperty(custom3DId, 'visibility', 'none');
      }
    }
  };

  // The orthophoto basemap, slid under the dark style's labels (see
  // lib/satelliteBasemap). Every other mode is a no-op here; the style itself
  // is recreated on a theme change, so nothing has to be torn down.
  const ensureSatelliteBasemap = (map: maplibregl.Map, theme: MapTheme) => {
    if (theme !== 'satellite') return;
    if (!map.getSource(SATELLITE_SOURCE_ID)) {
      map.addSource(
        SATELLITE_SOURCE_ID,
        satelliteSourceSpec(mmlKeyRef.current) as maplibregl.RasterSourceSpecification,
      );
    }
    const layers = map.getStyle()?.layers;
    if (!map.getLayer(SATELLITE_LAYER_ID)) {
      map.addLayer(
        { id: SATELLITE_LAYER_ID, type: 'raster', source: SATELLITE_SOURCE_ID },
        firstLabelLayerId(layers),
      );
    }
    // Whatever the vector style would still draw over the photo -- late road
    // casings, building fills -- is the map's guess at what the photo shows.
    nonLabelLayersAboveSatellite(layers).forEach((layerId) => {
      if (layerId === SATELLITE_LAYER_ID) return;
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', 'none');
    });
  };

  // Stop platforms: the OSM footprint the basemap already carries, restyled as
  // a paved island with a kerb (see lib/stopPlatforms). Added under the route
  // ribbons so a highlighted line still reads across the platform it serves.
  const ensureStopPlatformLayers = (map: maplibregl.Map, theme: MapTheme) => {
    const spec = platformSourceSpec(theme);
    if (spec.add && !map.getSource(spec.add.id)) {
      // The dark basemap is Carto's, which carries no guaranteed platform
      // subclass — so the same Digitransit tiles the light theme uses are
      // attached here, gated to close zoom. transformRequest adds the key.
      map.addSource(spec.add.id, {
        type: 'vector',
        url: spec.add.url,
        minzoom: spec.add.minzoom,
      });
    }
    if (!map.getSource(spec.source)) return;

    const below = map.getLayer('route-lines-casing')
      ? 'route-lines-casing'
      : map.getLayer('trams-circles') ? 'trams-circles' : undefined;
    const base = {
      source: spec.source,
      'source-layer': spec.sourceLayer,
      minzoom: STOP_PLATFORM_MIN_ZOOM,
      filter: PLATFORM_FILTER as maplibregl.FilterSpecification,
    };

    if (!map.getLayer(PLATFORM_FILL_LAYER)) {
      map.addLayer({
        id: PLATFORM_FILL_LAYER, type: 'fill', ...base,
        paint: platformFillPaint(theme) as maplibregl.FillLayerSpecification['paint'],
      }, below);
    }
    if (!map.getLayer(PLATFORM_TACTILE_LAYER)) {
      map.addLayer({
        id: PLATFORM_TACTILE_LAYER, type: 'line', ...base,
        minzoom: STOP_TACTILE_MIN_ZOOM,
        layout: { 'line-join': 'round' },
        paint: platformTactilePaint(theme) as maplibregl.LineLayerSpecification['paint'],
      }, below);
    }
    if (!map.getLayer(PLATFORM_KERB_LAYER)) {
      map.addLayer({
        id: PLATFORM_KERB_LAYER, type: 'line', ...base,
        layout: { 'line-join': 'round' },
        paint: platformKerbPaint(theme) as maplibregl.LineLayerSpecification['paint'],
      }, below);
    }
    // The 3D face of the same polygon, shown only while the map is tilted.
    if (!map.getLayer(PLATFORM_3D_LAYER)) {
      map.addLayer({
        id: PLATFORM_3D_LAYER, type: 'fill-extrusion', ...base,
        minzoom: STOP_3D_MIN_ZOOM,
        layout: { visibility: 'none' },
        paint: platformExtrusionPaint(theme) as maplibregl.FillExtrusionLayerSpecification['paint'],
      }, below);
    }
  };

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

  // Vehicle visibility is independent of pitch/buildings, including on style reload.
  const updateVehicle3DMode = (map: maplibregl.Map, active: boolean) => {
    if (map.getLayer('vehicles-3d')) {
      map.setLayoutProperty('vehicles-3d', 'visibility', active ? 'visible' : 'none');
    }
    // Stop furniture follows the vehicles: both are real-scale bodies, and a
    // shelter without a tram beside it (or the reverse) reads as a mistake.
    if (map.getLayer(STOP_FURNITURE_LAYER)) {
      map.setLayoutProperty(STOP_FURNITURE_LAYER, 'visibility', active ? 'visible' : 'none');
    }
    // City-bike racks are furniture too, and the flat gauge only hands over to
    // one when there is a rack under it to hand over to.
    if (map.getLayer(BIKE_STATION_LAYER)) {
      map.setLayoutProperty(BIKE_STATION_LAYER, 'visibility', active ? 'visible' : 'none');
    }
    // A traffic light is the exception: the junction marker is the same object
    // in 2D and in 3D, so it neither hides nor fades when the city stands up.
    if (map.getLayer('citybike_gauge')) {
      map.setPaintProperty('citybike_gauge', 'icon-opacity',
        (active ? BIKE_ICON_FADE_OUT : 1) as maplibregl.DataDrivenPropertyValueSpecification<number>);
    }
    if (map.getLayer('trams-body')) {
      map.setPaintProperty('trams-body', 'icon-opacity', (active ? VEHICLE_ICON_FADE_OUT : 1) as maplibregl.DataDrivenPropertyValueSpecification<number>);
    }
    if (map.getLayer('trams-brake')) {
      const brakeOpacity = [
        'case',
        ['any', ['get', 'stopped'], ['<', ['get', 'acc'], -0.35]],
        1,
        0,
      ];
      // Zoom expressions must be top-level, not nested inside the braking case.
      const opacity = active
        ? ['interpolate', ['linear'], ['zoom'],
          VEHICLE_3D_MIN_ZOOM, brakeOpacity, VEHICLE_3D_FULL_ZOOM, 0]
        : brakeOpacity;
      map.setPaintProperty('trams-brake', 'icon-opacity', opacity as unknown as maplibregl.DataDrivenPropertyValueSpecification<number>);
    }
  };

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

  // The `icon-image` sub-expression for one ferry hull colour: pick the marker
  // for the reported load step, open or shut. Written out here because it is
  // fourteen images per line and the layer definition is unreadable inline.
  const ferryBucketMatch = (line: string): unknown[] => {
    const byBucket = (open: boolean): unknown[] => [
      'match',
      ['get', 'occuBucket'],
      ...FERRY_LOAD_STEPS.flatMap((bucket) => [bucket, ferryIconName(bucket, open, line)]),
      ferryIconName(-1, open, line),
    ];
    return ['case', ['get', 'doorsOpen'], byBucket(true), byBucket(false)];
  };

  // Setup programmatically created sources, layers, and images
  const interactionsBoundMapRef = useRef<maplibregl.Map | null>(null);
  const setupCustomMapElements = (map: maplibregl.Map) => {
    if (!apiKey) return;

    // 0. The photo basemap, before anything else is added: it goes *under* the
    //    base style's labels, and everything below is added on top of both.
    ensureSatelliteBasemap(map, mapThemeRef.current);

    // 1. Directional vehicle-body markers. Instead of a bare dot + arrow, each
    //    vehicle is a little top-down carriage: a rounded body with a windshield
    //    and a nose nub so heading reads at a glance (the icon rotates to `hdg`).
    //    Trams are sleek (large corner radius, HSL green); buses are boxier (HSL
    //    blue). A "-open" variant swaps the flush side windows for amber door
    //    gaps, shown while the real doors are open (`drst === 1`).
    const registerVehicleImage = (name: string, svg: string, size = 40) => {
      if (map.hasImage(name)) return;
      const img = new Image(size, size);
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      // pixelRatio 2 keeps the body crisp on retina; the 40px art shows at ~20 CSS px
      // before the layer's zoom-based icon-size scaling.
      img.onload = () => {
        // The image decodes async; the map may have been removed meanwhile.
        if (mapRef.current !== map) return;
        if (!map.hasImage(name)) map.addImage(name, img, { pixelRatio: 2 });
      };
    };

    // The tram carriage is tinted by its line colour (see lib/routeColors).
    // Window/door/shadow accents use neutral tones so any hue reads cleanly.
    const tramBody = (open: boolean, color: string = TRAM_GREEN) => `
      <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40" fill="none">
        <path d="M20 3.2 L24 8.4 L16 8.4 Z" fill="${color}" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round"/>
        <rect x="12.5" y="7.5" width="15" height="26" rx="6.5" fill="${color}" stroke="#ffffff" stroke-width="2"/>
        <rect x="15" y="10" width="10" height="4.6" rx="2" fill="rgba(255,255,255,0.9)"/>
        ${open
          ? `<rect x="11.9" y="18.4" width="4.4" height="7.6" rx="1.3" fill="#ffb020" stroke="#ffffff" stroke-width="0.7"/>
             <rect x="23.7" y="18.4" width="4.4" height="7.6" rx="1.3" fill="#ffb020" stroke="#ffffff" stroke-width="0.7"/>`
          : `<rect x="14.7" y="17.5" width="4" height="9" rx="1.2" fill="rgba(0,0,0,0.4)"/>
             <rect x="21.3" y="17.5" width="4" height="9" rx="1.2" fill="rgba(0,0,0,0.4)"/>`}
        <rect x="15" y="29" width="10" height="3" rx="1.5" fill="rgba(0,0,0,0.3)"/>
      </svg>
    `;

    const busBody = (open: boolean) => `
      <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40" fill="none">
        <path d="M20 3.2 L24.6 8.4 L15.4 8.4 Z" fill="#0984e3" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round"/>
        <rect x="12" y="7.5" width="16" height="26" rx="4" fill="#0984e3" stroke="#ffffff" stroke-width="2"/>
        <rect x="14.5" y="10" width="11" height="4.6" rx="1.5" fill="#dbeeff"/>
        ${open
          ? `<rect x="11.4" y="18.4" width="4.4" height="7.6" rx="1.1" fill="#ffb020" stroke="#ffffff" stroke-width="0.7"/>
             <rect x="24.2" y="18.4" width="4.4" height="7.6" rx="1.1" fill="#ffb020" stroke="#ffffff" stroke-width="0.7"/>`
          : `<rect x="14.3" y="17.5" width="4.2" height="9" rx="1.1" fill="#08355c" opacity="0.5"/>
             <rect x="21.5" y="17.5" width="4.2" height="9" rx="1.1" fill="#08355c" opacity="0.5"/>`}
        <rect x="14.5" y="29" width="11" height="3" rx="1.2" fill="#08355c" opacity="0.35"/>
      </svg>
    `;

    // Metro: a coupled pair of units, drawn as what it is — one long, flat-
    // fronted train split across the middle by the coupling gap between its two
    // halves, in HSL's metro orange with the white bands the M-stock carries.
    // The seam and the doubled length are the cue that reads at a glance:
    // nothing else on the map is shaped like this. Both ends get a cab
    // windshield, because a metro train has a driver's cab at each end and
    // reverses at the terminus rather than turning around — the leading one is
    // brighter, so the direction of travel still reads.
    const metroBody = (open: boolean, color: string = METRO_ORANGE) => `
      <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40" fill="none">
        <rect x="12.4" y="2.6" width="15.2" height="34.8" rx="3.2" fill="${color}" stroke="#ffffff" stroke-width="2"/>
        <rect x="14.6" y="4.6" width="10.8" height="4.2" rx="1.1" fill="rgba(255,255,255,0.95)"/>
        <rect x="14.6" y="31.2" width="10.8" height="3.6" rx="1" fill="rgba(255,255,255,0.55)"/>
        <rect x="12.4" y="16.4" width="15.2" height="1.5" fill="rgba(255,255,255,0.85)"/>
        <rect x="12.4" y="19" width="15.2" height="2" fill="rgba(0,0,0,0.55)"/>
        <rect x="12.4" y="22.1" width="15.2" height="1.5" fill="rgba(255,255,255,0.85)"/>
        ${open
          ? `<rect x="11.7" y="10.6" width="4.6" height="4.6" rx="1" fill="#ffb020" stroke="#ffffff" stroke-width="0.7"/>
             <rect x="23.7" y="10.6" width="4.6" height="4.6" rx="1" fill="#ffb020" stroke="#ffffff" stroke-width="0.7"/>
             <rect x="11.7" y="25" width="4.6" height="4.6" rx="1" fill="#ffb020" stroke="#ffffff" stroke-width="0.7"/>
             <rect x="23.7" y="25" width="4.6" height="4.6" rx="1" fill="#ffb020" stroke="#ffffff" stroke-width="0.7"/>`
          : `<rect x="13.4" y="10.4" width="4.2" height="5" rx="0.9" fill="rgba(0,0,0,0.42)"/>
             <rect x="22.4" y="10.4" width="4.2" height="5" rx="0.9" fill="rgba(0,0,0,0.42)"/>
             <rect x="13.4" y="24.8" width="4.2" height="5" rx="0.9" fill="rgba(0,0,0,0.42)"/>
             <rect x="22.4" y="24.8" width="4.2" height="5" rx="0.9" fill="rgba(0,0,0,0.42)"/>`}
      </svg>
    `;

    // Commuter train: the longest body of the set, in HSL's commuter purple,
    // with a slanted nose — a Sm-series unit seen from above.
    const trainBody = (open: boolean, color: string = TRAIN_PURPLE) => `
      <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40" fill="none">
        <path d="M20 1.8 L25.2 7.8 L14.8 7.8 Z" fill="${color}" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round"/>
        <path d="M13 11 C13 8.4 15.9 6.6 20 6.6 C24.1 6.6 27 8.4 27 11 L27 33 C27 34.7 25.7 36 24 36 L16 36 C14.3 36 13 34.7 13 33 Z" fill="${color}" stroke="#ffffff" stroke-width="2"/>
        <rect x="15" y="9.6" width="10" height="4.4" rx="1.4" fill="rgba(255,255,255,0.92)"/>
        ${open
          ? `<rect x="12.4" y="19.2" width="4.4" height="8" rx="1.1" fill="#ffb020" stroke="#ffffff" stroke-width="0.7"/>
             <rect x="23.2" y="19.2" width="4.4" height="8" rx="1.1" fill="#ffb020" stroke="#ffffff" stroke-width="0.7"/>`
          : `<rect x="14.8" y="18.4" width="4.2" height="9.6" rx="1" fill="rgba(0,0,0,0.42)"/>
             <rect x="21" y="18.4" width="4.2" height="9.6" rx="1" fill="rgba(0,0,0,0.42)"/>`}
        <rect x="15" y="31" width="10" height="3" rx="1.2" fill="rgba(0,0,0,0.3)"/>
      </svg>
    `;

    // Generic (unknown-line) tram bodies fall back to HSL green.
    registerVehicleImage('tram-body', tramBody(false));
    registerVehicleImage('tram-body-open', tramBody(true));
    // One tinted body per known line so each route is distinguishable on the map.
    Object.entries(ROUTE_COLORS).forEach(([line, color]) => {
      registerVehicleImage(`tram-body-${line}`, tramBody(false, color));
      registerVehicleImage(`tram-body-${line}-open`, tramBody(true, color));
    });
    registerVehicleImage('bus-body', busBody(false));
    registerVehicleImage('bus-body-open', busBody(true));
    // Metro and commuter trains get the same per-line tinting as trams: few
    // lines, so every one of them has a curated colour.
    registerVehicleImage('metro-body', metroBody(false));
    registerVehicleImage('metro-body-open', metroBody(true));
    Object.entries(METRO_COLORS).forEach(([line, color]) => {
      registerVehicleImage(`metro-body-${line}`, metroBody(false, color));
      registerVehicleImage(`metro-body-${line}-open`, metroBody(true, color));
    });
    registerVehicleImage('train-body', trainBody(false));
    registerVehicleImage('train-body-open', trainBody(true));
    Object.entries(TRAIN_COLORS).forEach(([line, color]) => {
      registerVehicleImage(`train-body-${line}`, trainBody(false, color));
      registerVehicleImage(`train-body-${line}-open`, trainBody(true, color));
    });
    // Ferries. The vessel art lives in `lib/ferryIcon` rather than inline here,
    // because unlike the four carriages it carries live data: there is one
    // marker per load step (and one for a vessel with no count reported), open
    // and shut, per hull colour. `trams-body` picks between them from the
    // `occuBucket` property below, so a boat's deck gauge fills on the map as
    // the feed reports it filling.
    ferryIconVariants().forEach(({ name, svg }) => {
      registerVehicleImage(name, svg, FERRY_ICON_SIZE);
    });

    // Rear brake lights: two red lamps on a transparent 40x40 canvas, positioned
    // at the tail of the carriage (bottom of the art). Drawn on top of the body
    // and rotated with `hdg`, so the lamps always sit on the vehicle's rear.
    // Each lamp is a hot core inside two softer red glows (no SVG filters — the
    // rest of the icon set fakes glow with stacked opacities the same way).
    const brakeLights = `
      <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40" fill="none">
        <circle cx="16" cy="30.6" r="3.7" fill="#ff1f1f" opacity="0.30"/>
        <circle cx="16" cy="30.6" r="2.1" fill="#ff2d2d" opacity="0.8"/>
        <circle cx="16" cy="30.6" r="1.15" fill="#ff8a8a"/>
        <circle cx="24" cy="30.6" r="3.7" fill="#ff1f1f" opacity="0.30"/>
        <circle cx="24" cy="30.6" r="2.1" fill="#ff2d2d" opacity="0.8"/>
        <circle cx="24" cy="30.6" r="1.15" fill="#ff8a8a"/>
      </svg>
    `;
    registerVehicleImage('brake-lights', brakeLights);

    // 2. Create Selected Tram Highlight Image
    if (!map.hasImage('tram-selected')) {
      const selectedSvg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44" fill="none">
          <circle cx="22" cy="22" r="18" stroke="#fdcb6e" stroke-width="4" fill="none"/>
        </svg>
      `;
      const selectedImg = new Image(44, 44);
      selectedImg.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(selectedSvg);
      selectedImg.onload = () => {
        if (mapRef.current !== map) return;
        if (!map.hasImage('tram-selected')) map.addImage('tram-selected', selectedImg);
      };
    }

    // Stop signs. Not a road sign on a stick: HSL's kerbside furniture is a
    // rectangular board on a pole, and drawing it that way is most of what
    // makes a stop read as a stop rather than as a map pin. Each is a board in
    // the mode's colour with a white pictogram, a pole below it and a contact
    // shadow at the foot, so the sign looks planted rather than floating.
    //
    // Every variant is the same art with a different board colour and glyph;
    // the "-selected" pair swaps the white border for the gold of the
    // selection ring. Drawn at 2x and registered with pixelRatio 2, so the
    // board's edges and the glyph stay crisp when zoomed in.
    const SIGN_W = 44;
    const SIGN_H = 62;
    const signGlyphs: Record<string, (color: string) => string> = {
      // A tram: body with a pantograph stub, destination window and two lamps.
      tram: (color) => `
        <path d="M22 7.5 L22 5 M18.6 5 L25.4 5" stroke="#ffffff" stroke-width="1.4" stroke-linecap="round"/>
        <rect x="15.6" y="7.6" width="12.8" height="17" rx="3" fill="#ffffff"/>
        <rect x="17.4" y="9.6" width="9.2" height="4.6" rx="1" fill="${color}"/>
        <circle cx="18.6" cy="19.4" r="1.15" fill="${color}"/>
        <circle cx="25.4" cy="19.4" r="1.15" fill="${color}"/>
        <path d="M18.2 24.6 L16.6 27 M25.8 24.6 L27.4 27" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round"/>
      `,
      // A bus: boxier than the tram, windscreen band and two wheels.
      bus: (color) => `
        <rect x="14.4" y="8.4" width="15.2" height="15.4" rx="2.6" fill="#ffffff"/>
        <rect x="16.2" y="10.4" width="11.6" height="4.4" rx="1" fill="${color}"/>
        <circle cx="18.1" cy="19.6" r="1.2" fill="${color}"/>
        <circle cx="25.9" cy="19.6" r="1.2" fill="${color}"/>
        <rect x="16.4" y="23.8" width="3" height="2.4" rx="1" fill="#ffffff"/>
        <rect x="24.6" y="23.8" width="3" height="2.4" rx="1" fill="#ffffff"/>
      `,
      // The metro's M.
      metro: () => `
        <path d="M15 25 L15 8 L22 17.4 L29 8 L29 25" stroke="#ffffff" stroke-width="3.2"
              stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      `,
      // A ferry quay: a vessel bow-on above its own reflection in the water.
      ferry: (color) => `
        <path d="M22 6.6 C24.6 8.6 26.2 11 26.8 13.8 L26.8 18.4
                 C26.8 20 25.6 21.2 24 21.2 L20 21.2
                 C18.4 21.2 17.2 20 17.2 18.4 L17.2 13.8
                 C17.8 11 19.4 8.6 22 6.6 Z" fill="#ffffff"/>
        <rect x="19.2" y="11.4" width="5.6" height="3.4" rx="1" fill="${color}"/>
        <path d="M13.4 24.2 C15.6 25.8 17.8 25.8 20 24.2 C22.2 25.8 24.4 25.8 26.6 24.2
                 C28 23.2 29.4 23.4 30.6 24.6" stroke="#ffffff" stroke-width="1.6"
              stroke-linecap="round" fill="none"/>
      `,
      // A commuter train: rounded cab roof, windscreen, lamps and rails below.
      train: (color) => `
        <path d="M15.4 12.6 C15.4 9.2 18.4 7.4 22 7.4 C25.6 7.4 28.6 9.2 28.6 12.6
                 L28.6 21.6 C28.6 23.2 27.4 24.4 25.8 24.4 L18.2 24.4
                 C16.6 24.4 15.4 23.2 15.4 21.6 Z" fill="#ffffff"/>
        <rect x="17.4" y="11" width="9.2" height="4.6" rx="1.2" fill="${color}"/>
        <circle cx="18.7" cy="20.4" r="1.2" fill="${color}"/>
        <circle cx="25.3" cy="20.4" r="1.2" fill="${color}"/>
        <path d="M18 24.6 L16.2 27.2 M26 24.6 L27.8 27.2" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round"/>
      `,
    };

    const registerStopSign = (name: string, glyph: keyof typeof signGlyphs, color: string, selected: boolean) => {
      if (map.hasImage(name)) return;
      const border = selected ? '#fdcb6e' : '#ffffff';
      const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="${SIGN_W}" height="${SIGN_H}" viewBox="0 0 ${SIGN_W} ${SIGN_H}" fill="none">
          <ellipse cx="22" cy="58.4" rx="7.6" ry="2.4" fill="rgba(15,23,42,0.28)"/>
          <rect x="20.2" y="30" width="3.6" height="28.4" rx="1.6" fill="#4b5563"/>
          <rect x="20.2" y="30" width="1.3" height="28.4" fill="#6b7684"/>
          <rect x="3.4" y="3.4" width="37.2" height="29.2" rx="4.4" fill="${color}"
                stroke="${border}" stroke-width="${selected ? 3.4 : 2.6}"/>
          ${signGlyphs[glyph](color)}
        </svg>
      `;
      const img = new Image(SIGN_W, SIGN_H);
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      img.onload = () => {
        if (mapRef.current !== map) return;
        if (!map.hasImage(name)) map.addImage(name, img, { pixelRatio: 2 });
      };
    };

    ([
      ['sign-tram', 'tram', TRAM_GREEN],
      ['sign-bus', 'bus', '#007ac9'],
      ['sign-bus-trunk', 'bus', '#CA4300'],
      ['sign-metro', 'metro', METRO_ORANGE],
      ['sign-train', 'train', TRAIN_PURPLE],
      ['sign-ferry', 'ferry', FERRY_CYAN],
    ] as Array<[string, keyof typeof signGlyphs, string]>).forEach(([name, glyph, color]) => {
      registerStopSign(name, glyph, color, false);
      registerStopSign(`${name}-selected`, glyph, color, true);
    });

    // 3. Add Live Trams Source (GeoJSON)
    if (!map.getSource('trams')) {
      map.addSource('trams', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [],
        },
      });
    }

    // 5. Add Route Lines Source
    if (!map.getSource('route-lines')) {
      map.addSource('route-lines', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [],
        },
      });
    }

    // 6. Vehicle base circle — the floor of the vehicle stack. It is kept as
    //    `trams-circles` for two reasons even though the motion aura it used to
    //    draw is gone: it is the `beforeId` anchor every other custom layer is
    //    inserted before, and it is the (invisible) tap/click hit-target for a
    //    vehicle, extending the target beyond the body icon (the body is the
    //    primary target; both are bound in the interaction setup below). It is
    //    fully transparent, so no coloured glow is drawn under vehicles — the
    //    heading/state is read from the carriage body and the rear brake lights.
    if (!map.getLayer('trams-circles')) {
      map.addLayer({
        id: 'trams-circles',
        type: 'circle',
        source: 'trams',
        paint: {
          // A modest zoom-scaled radius keeps vehicles easy to tap; opacity 0
          // means it only ever acts as a hit-target, never a visible mark.
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 11, 17, 20],
          'circle-opacity': 0,
        },
      });
    }

    // 6b. (The stopped cue is no longer a glow under the vehicle — it is the rear
    //     brake-lights layer added on top of the body in section 7b below.)

    // 7. Directional vehicle body (on top of the aura + pulse). Rotates to `hdg`
    //    and swaps to the doors-open art while the doors are open.
    if (!map.getLayer('trams-body')) {
      map.addLayer({
        id: 'trams-body',
        type: 'symbol',
        source: 'trams',
        layout: {
          // Body art per mode, then per line: each of trams, metro and trains
          // picks the line-tinted body (open/closed variants), falling back to
          // its generic mode-coloured body for lines outside the palette.
          'icon-image': [
            'case',
            ['==', ['get', 'mode'], 'bus'],
            ['case', ['get', 'doorsOpen'], 'bus-body-open', 'bus-body'],
            ['==', ['get', 'mode'], 'metro'],
            ['case', ['get', 'doorsOpen'],
              ['match', ['get', 'desi'],
                ...Object.keys(METRO_COLORS).flatMap((l) => [l, `metro-body-${l}-open`]),
                'metro-body-open'],
              ['match', ['get', 'desi'],
                ...Object.keys(METRO_COLORS).flatMap((l) => [l, `metro-body-${l}`]),
                'metro-body']],
            ['==', ['get', 'mode'], 'train'],
            ['case', ['get', 'doorsOpen'],
              ['match', ['get', 'desi'],
                ...Object.keys(TRAIN_COLORS).flatMap((l) => [l, `train-body-${l}-open`]),
                'train-body-open'],
              ['match', ['get', 'desi'],
                ...Object.keys(TRAIN_COLORS).flatMap((l) => [l, `train-body-${l}`]),
                'train-body']],
            // Ferries branch on the load step as well as the line, so the deck
            // gauge on the marker tracks what the vessel is reporting. -1 is
            // "no count", which draws the grey track rather than an empty deck.
            ['==', ['get', 'mode'], 'ferry'],
            ['match', ['get', 'desi'],
              ...Object.keys(FERRY_COLORS).flatMap((line) => [
                line,
                ferryBucketMatch(line),
              ]),
              ferryBucketMatch('')],
            ['get', 'doorsOpen'],
            ['match', ['get', 'desi'],
              ...Object.keys(ROUTE_COLORS).flatMap((l) => [l, `tram-body-${l}-open`]),
              'tram-body-open'],
            ['match', ['get', 'desi'],
              ...Object.keys(ROUTE_COLORS).flatMap((l) => [l, `tram-body-${l}`]),
              'tram-body'],
          ] as unknown as maplibregl.DataDrivenPropertyValueSpecification<string>,
          'icon-rotate': ['get', 'hdg'],
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-size': [
            'interpolate', ['linear'], ['zoom'],
            12, 1.3,
            14, 1.55,
            17, 2.0,
          ],
        },
      });
    }

    // 7b. Rear brake lights — the stopped/braking cue, replacing the old coral
    //     glow. Two red tail lamps drawn on TOP of the body (the lamps sit inside
    //     the carriage footprint, so a layer under the body would hide them) and
    //     rotated with `hdg` at the exact icon-size of the body, so they stay
    //     pinned to the vehicle's rear at every zoom. They light while the vehicle
    //     is `stopped` (waiting at a light, in traffic, at a terminus, or with
    //     doors open) and also while it is braking hard (`acc < -0.35`, the same
    //     threshold that turns the motion aura red), so they glow on the way into
    //     a stop and stay lit through it — just like real brake lights. Off (and
    //     placement-free) the instant the vehicle is moving without braking.
    if (!map.getLayer('trams-brake')) {
      map.addLayer({
        id: 'trams-brake',
        type: 'symbol',
        source: 'trams',
        layout: {
          'icon-image': 'brake-lights',
          'icon-rotate': ['get', 'hdg'],
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-size': [
            'interpolate', ['linear'], ['zoom'],
            12, 1.3,
            14, 1.55,
            17, 2.0,
          ],
        },
        paint: {
          'icon-opacity': [
            'case',
            ['any', ['get', 'stopped'], ['<', ['get', 'acc'], -0.35]], 1,
            0,
          ],
        },
      });
    }

    // 7c. Detailed 3D vehicle bodies at real vehicle scale (lib/vehicleModels).
    //     Colour, height and base come from each part's feature.
    //     Populated only while models are enabled (see the animation loop), and faded in
    //     across the same zooms the flat icons fade out over, so the swap between
    //     the two is a crossfade rather than a pop.
    if (!map.getSource('vehicles-3d')) {
      map.addSource('vehicles-3d', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
    }
    if (!map.getLayer('vehicles-3d')) {
      map.addLayer({
        id: 'vehicles-3d',
        type: 'fill-extrusion',
        source: 'vehicles-3d',
        minzoom: VEHICLE_3D_MIN_ZOOM,
        layout: { visibility: vehicles3DEnabled(is3DRef.current, always3DVehiclesRef.current) ? 'visible' : 'none' },
        paint: {
          'fill-extrusion-color': ['get', 'color'],
          'fill-extrusion-height': ['get', 'top'],
          'fill-extrusion-base': ['get', 'base'],
          'fill-extrusion-opacity': VEHICLE_3D_FADE_IN as maplibregl.PropertyValueSpecification<number>,
        },
      });
    }

    // 8. Add Route Lines Layer (Rendered before trams-circles so it is underneath)
    //
    //    Two layers: a casing underneath and the coloured line on top. The
    //    casing separates neighbouring ribbons where several lines share a
    //    street — without it two adjacent route colours read as one wide band —
    //    and keeps a pale route legible against the basemap in either theme.
    if (!map.getLayer('route-lines-casing')) {
      map.addLayer({
        id: 'route-lines-casing',
        type: 'line',
        source: 'route-lines',
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
          'line-sort-key': ROUTE_LINE_SORT_KEY,
        },
        paint: {
          'line-color': mapThemeRef.current === 'light' ? '#ffffff' : '#0b1220',
          'line-width': ROUTE_CASING_WIDTH,
          'line-offset': ROUTE_LINE_OFFSET,
          'line-opacity': ROUTE_CASING_OPACITY,
        },
      }, 'trams-circles');
    }

    if (!map.getLayer('route-lines-layer')) {
      map.addLayer({
        id: 'route-lines-layer',
        type: 'line',
        source: 'route-lines',
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
          'line-sort-key': ROUTE_LINE_SORT_KEY,
        },
        paint: {
          'line-color': ['coalesce', ['get', 'color'], '#10b981'],
          'line-width': ROUTE_LINE_WIDTH,
          // Fan overlapping routes out into parallel ribbons (see
          // drawRouteGeometries) so their colours never blend.
          'line-offset': ROUTE_LINE_OFFSET,
          'line-opacity': ROUTE_LINE_OPACITY,
        },
      }, 'trams-circles');
    }

    // 8b. Recreate the HSL background route network when the base style lacks it
    //     (the dark-matter theme has no `routes` source/layers), so the Settings
    //     "Routes" toggle draws the route lines — and their mode colours — in
    //     both themes. No-op in light mode where style.json already supplies them.
    ensureBackgroundRouteNetwork(map);

    // Tint the tram/light-rail route network per line (palette on `routeIdParsed`)
    // so routes show their own colours instead of a single mode green.
    applyRouteNetworkColors(map);

    // 9. Add Tram Text Label Layer (on top of arrows/circles)
    if (!map.getLayer('trams-labels')) {
      map.addLayer({
        id: 'trams-labels',
        type: 'symbol',
        source: 'trams',
        layout: {
          'text-field': '{desi}',
          'text-font': ['Gotham Rounded Medium'],
          'text-size': 12,
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: {
          'text-color': '#ffffff',
          // Dark halo keeps the line number legible over the body's windows
          // and the lighter windshield band.
          'text-halo-color': 'rgba(15, 23, 42, 0.65)',
          'text-halo-width': 1.1,
        },
      });
    }

    // 10. Add Selection Highlight Ring (circle style, rendered under labels, on top of circles)
    if (!map.getLayer('trams-selected-layer')) {
      map.addLayer({
        id: 'trams-selected-layer',
        type: 'circle',
        source: 'trams',
        paint: {
          'circle-radius': 20,
          'circle-color': 'rgba(253, 203, 110, 0.15)',
          'circle-stroke-color': '#fdcb6e',
          'circle-stroke-width': 3,
        },
        filter: ['in', ['get', 'veh'], ['literal', [...journeyVehicleIdsRef.current, selectedTramIdRef.current || '']]],
      }, 'trams-labels');
    }

    // 11. Add HSL Transit Stops Source and Layers if missing (e.g. in dark mode CartoDB basemap)
    if (!map.getSource('stops')) {
      map.addSource('stops', {
        type: 'vector',
        tiles: [
          'https://api.digitransit.fi/map/v3/hsl/fi/stops/{z}/{x}/{y}.pbf',
        ],
        minzoom: 13,
        maxzoom: 16,
      });
    }

    if (!map.getLayer('stops_bus')) {
      map.addLayer({
        id: 'stops_bus',
        type: 'circle',
        source: 'stops',
        'source-layer': 'stops',
        minzoom: STOP_CIRCLE_MIN_ZOOM,
        maxzoom: STOP_CIRCLE_FADE_ZOOM,
        filter: [
          'all',
          ['!', ['get', 'isTrunkStop']],
          ['match', ['get', 'mode'], 'BUS', true, false]
        ] as maplibregl.FilterSpecification,
        paint: {
          'circle-color': '#007ac9',
          'circle-radius': STOP_CIRCLE_RADIUS,
          'circle-stroke-color': STOP_CIRCLE_STROKE_COLOR,
          'circle-stroke-width': STOP_CIRCLE_STROKE_WIDTH,
          'circle-opacity': STOP_CIRCLE_OPACITY,
          'circle-stroke-opacity': STOP_CIRCLE_OPACITY
        }
      }, 'trams-circles');
    }

    if (!map.getLayer('stops_trunk')) {
      map.addLayer({
        id: 'stops_trunk',
        type: 'circle',
        source: 'stops',
        'source-layer': 'stops',
        minzoom: STOP_CIRCLE_MIN_ZOOM,
        maxzoom: STOP_CIRCLE_FADE_ZOOM,
        filter: ['all', ['get', 'isTrunkStop'], ['match', ['get', 'mode'], 'BUS', true, false]] as maplibregl.FilterSpecification,
        paint: {
          'circle-color': '#007ac9',
          'circle-radius': STOP_CIRCLE_RADIUS,
          'circle-stroke-color': STOP_CIRCLE_STROKE_COLOR,
          'circle-stroke-width': STOP_CIRCLE_STROKE_WIDTH,
          'circle-opacity': STOP_CIRCLE_OPACITY,
          'circle-stroke-opacity': STOP_CIRCLE_OPACITY
        }
      }, 'trams-circles');
    }

    if (!map.getLayer('stops_tram')) {
      map.addLayer({
        id: 'stops_tram',
        type: 'circle',
        source: 'stops',
        'source-layer': 'stops',
        minzoom: STOP_CIRCLE_MIN_ZOOM,
        maxzoom: STOP_CIRCLE_FADE_ZOOM,
        filter: ['match', ['get', 'mode'], 'TRAM', true, false],
        paint: {
          'circle-color': '#00985f',
          'circle-radius': STOP_CIRCLE_RADIUS,
          'circle-stroke-color': STOP_CIRCLE_STROKE_COLOR,
          'circle-stroke-width': STOP_CIRCLE_STROKE_WIDTH,
          'circle-opacity': STOP_CIRCLE_OPACITY,
          'circle-stroke-opacity': STOP_CIRCLE_OPACITY
        }
      }, 'trams-circles');
    }

    // Ferry quays, recreated for the themes whose basemap has no `stops_ferry`
    // of its own — the same guard every other stop layer here uses. A
    // street-stop-sized disc rather than a station one: a quay is one berth on
    // one pier, not a concourse.
    if (!map.getLayer('stops_ferry')) {
      map.addLayer({
        id: 'stops_ferry',
        type: 'circle',
        source: 'stops',
        'source-layer': 'stops',
        minzoom: STOP_CIRCLE_MIN_ZOOM,
        maxzoom: STOP_CIRCLE_FADE_ZOOM,
        filter: ['==', STOP_MODE, 'FERRY'] as maplibregl.FilterSpecification,
        paint: {
          'circle-color': FERRY_CYAN,
          'circle-radius': STOP_CIRCLE_RADIUS,
          'circle-stroke-color': STOP_CIRCLE_STROKE_COLOR,
          'circle-stroke-width': STOP_CIRCLE_STROKE_WIDTH,
          'circle-opacity': STOP_CIRCLE_OPACITY,
          'circle-stroke-opacity': STOP_CIRCLE_OPACITY
        }
      }, 'trams-circles');
    }

    // Metro and commuter-train stations, drawn a touch larger than street stops
    // because a station serves a whole neighbourhood, not one kerbside. The two
    // stop tilesets in play name the mode differently — JORE (light theme) calls
    // it `mode`, Digitransit's v3 stops (the dark-theme fallback source) call it
    // `type` — so every station filter reads whichever of the two is present.
    if (!map.getLayer('stops_metro')) {
      map.addLayer({
        id: 'stops_metro',
        type: 'circle',
        source: 'stops',
        'source-layer': 'stops',
        minzoom: STATION_CIRCLE_MIN_ZOOM,
        maxzoom: STOP_CIRCLE_FADE_ZOOM,
        filter: ['==', STOP_MODE, 'SUBWAY'] as maplibregl.FilterSpecification,
        paint: {
          'circle-color': '#FF6319',
          'circle-radius': STATION_CIRCLE_RADIUS,
          'circle-stroke-color': STOP_CIRCLE_STROKE_COLOR,
          'circle-stroke-width': STOP_CIRCLE_STROKE_WIDTH,
          'circle-opacity': STOP_CIRCLE_OPACITY,
          'circle-stroke-opacity': STOP_CIRCLE_OPACITY
        }
      }, 'trams-circles');
    }

    if (!map.getLayer('stops_train')) {
      map.addLayer({
        id: 'stops_train',
        type: 'circle',
        source: 'stops',
        'source-layer': 'stops',
        minzoom: STATION_CIRCLE_MIN_ZOOM,
        maxzoom: STOP_CIRCLE_FADE_ZOOM,
        filter: ['==', STOP_MODE, 'RAIL'] as maplibregl.FilterSpecification,
        paint: {
          'circle-color': '#8C4799',
          'circle-radius': STATION_CIRCLE_RADIUS,
          'circle-stroke-color': STOP_CIRCLE_STROKE_COLOR,
          'circle-stroke-width': STOP_CIRCLE_STROKE_WIDTH,
          'circle-opacity': STOP_CIRCLE_OPACITY,
          'circle-stroke-opacity': STOP_CIRCLE_OPACITY
        }
      }, 'trams-circles');
    }

    // Stops Signs (Pole + Sign symbol layer, visible from zoom 15.5 onwards)
    if (!map.getLayer('stops_signs')) {
      map.addLayer({
        id: 'stops_signs',
        type: 'symbol',
        source: 'stops',
        'source-layer': 'stops',
        minzoom: 15.5,
        layout: {
          'icon-image': [
            'match',
            STOP_MODE,
            'TRAM', 'sign-tram',
            'BUS', 'sign-bus',
            'SUBWAY', 'sign-metro',
            'RAIL', 'sign-train',
            'FERRY', 'sign-ferry',
            'sign-bus'
          ],

          'icon-anchor': 'bottom',
          'icon-allow-overlap': true,
          // Placement is no longer ignored: the sign boards are much wider than
          // the discs they replace, and the stop labels below have to be able
          // to step out of their way.
          'icon-ignore-placement': false,
          'icon-size': [
            'interpolate',
            ['linear'],
            ['zoom'],
            15.5, 1.0,
            17, 1.3,
            20, 1.8
          ],
          // The stop's own name, once there is room to read it. Optional, so a
          // sign is never dropped for want of space for its label.
          'text-field': [
            'step',
            ['zoom'],
            '',
            17, ['coalesce', ['get', 'name'], ['get', 'nameFi'], ''],
          ],
          // Same stack the vehicle and bike labels use, so stop names sit in
          // the app's own typeface rather than the basemap's.
          'text-font': ['Gotham Rounded Book'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 17, 11, 20, 14],
          'text-anchor': 'top',
          'text-offset': [0, 0.4],
          'text-optional': true,
          'text-max-width': 9,
        },
        paint: {
          'text-color': mapThemeRef.current === 'light' ? '#1f2937' : '#e5e7eb',
          'text-halo-color': mapThemeRef.current === 'light' ? 'rgba(255,255,255,0.9)' : 'rgba(11,18,32,0.9)',
          'text-halo-width': 1.4,
        }
      }, 'trams-circles');
    }

    // 11a. Next-arrival labels above the sign boards. Anchored to its own
    //      GeoJSON source rather than the stop tiles, because the text comes
    //      from the departures feed, not from the tile.
    if (!map.getSource(ARRIVAL_LABEL_SOURCE)) {
      map.addSource(ARRIVAL_LABEL_SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
    }
    if (!map.getLayer(ARRIVAL_LABEL_LAYER)) {
      map.addLayer({
        id: ARRIVAL_LABEL_LAYER,
        type: 'symbol',
        source: ARRIVAL_LABEL_SOURCE,
        minzoom: ARRIVAL_LABEL_MIN_ZOOM,
        layout: {
          'text-field': ['get', 'label'],
          'text-font': ['Gotham Rounded Medium'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 15.5, 11, 20, 15],
          // Above the sign board, which is itself bottom-anchored on the stop.
          'text-anchor': 'bottom',
          'text-offset': [0, -2.6],
          'text-allow-overlap': false,
          'text-padding': 3,
          'text-max-width': 12,
        },
        paint: {
          'text-color': ['get', 'color'],
          'text-halo-color': mapThemeRef.current === 'light' ? 'rgba(255,255,255,0.92)' : 'rgba(11,18,32,0.92)',
          'text-halo-width': 1.6,
        },
      }, 'trams-circles');
    }

    // 11b. Stop platforms lifted out of the basemap, and the 3D furniture that
    //      stands on them (lib/stopPlatforms, lib/stopModels). The platform
    //      layers need the route ribbons to already exist so they can be slid
    //      underneath them, which is why this sits below section 8.
    ensureStopPlatformLayers(map, mapThemeRef.current);

    if (!map.getSource(STOP_FURNITURE_SOURCE)) {
      map.addSource(STOP_FURNITURE_SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
    }
    if (!map.getLayer(STOP_FURNITURE_LAYER)) {
      map.addLayer({
        id: STOP_FURNITURE_LAYER,
        type: 'fill-extrusion',
        source: STOP_FURNITURE_SOURCE,
        minzoom: STOP_3D_MIN_ZOOM,
        layout: {
          visibility: vehicles3DEnabled(is3DRef.current, always3DVehiclesRef.current) ? 'visible' : 'none',
        },
        paint: {
          'fill-extrusion-color': ['get', 'color'],
          'fill-extrusion-height': ['get', 'top'],
          'fill-extrusion-base': ['get', 'base'],
          'fill-extrusion-opacity': STOP_3D_FADE_IN as maplibregl.PropertyValueSpecification<number>,
        },
      }, map.getLayer('vehicles-3d') ? 'vehicles-3d' : undefined);
    }

    // The pulse under the stop a selected vehicle is heading for. Radius and
    // opacity are animated from the same clock as the vehicles (see the tick).
    if (!map.getSource('stop-pulse')) {
      map.addSource('stop-pulse', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
    }
    if (!map.getLayer('stop-pulse-ring')) {
      map.addLayer({
        id: 'stop-pulse-ring',
        type: 'circle',
        source: 'stop-pulse',
        paint: {
          'circle-radius': 14,
          'circle-color': 'rgba(253, 203, 110, 0.18)',
          'circle-opacity': 0.25,
          'circle-stroke-color': '#fdcb6e',
          'circle-stroke-width': 2,
          'circle-stroke-opacity': 0.8,
        },
      }, 'trams-circles');
    }

    // 12. Add Citybike Source (live availability, served by our own backend).
    //
    // The Digitransit vector tiles carry no live bike/dock counts, so the map is
    // driven from GET /api/v1/bike-stations instead. `bikeStationsDataRef` holds
    // the most recent payload so a style/theme reload can re-seed the source
    // immediately rather than blanking until the next refresh.
    if (!map.getSource('citybike')) {
      map.addSource('citybike', {
        type: 'geojson',
        data: bikeStationsDataRef.current || { type: 'FeatureCollection', features: [] },
      });
    }

    // 13. Availability gauge images: a bicycle in a disc, ringed by an arc
    // showing how full the station is and coloured for scarcity — grey empty,
    // red almost gone, amber middling, green plenty. The bicycle is what makes
    // the marker name itself; the ring is what makes it worth reading. Rendered
    // once per fill bucket and picked per-station by the expression below.
    for (const bucket of BIKE_GAUGE_BUCKETS) {
      if (map.hasImage(bucket.name)) continue;
      const gaugeImg = new Image(BIKE_GAUGE_ICON_SIZE, BIKE_GAUGE_ICON_SIZE);
      gaugeImg.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(bikeGaugeIconSvg(bucket));
      // pixelRatio 2 keeps the wheels crisp; the 48px art displays at ~24 CSS px.
      gaugeImg.onload = ((name: string, img: HTMLImageElement) => () => {
        if (mapRef.current !== map) return;
        if (!map.hasImage(name)) map.addImage(name, img, { pixelRatio: 2 });
      })(bucket.name, gaugeImg);
    }

    // 14. Citybike gauge layer — one marker per station across all zooms, with
    // the available-bike count in the centre once zoomed in enough to read it.
    if (!map.getLayer('citybike_gauge')) {
      map.addLayer({
        id: 'citybike_gauge',
        type: 'symbol',
        source: 'citybike',
        minzoom: BIKE_STATION_MIN_ZOOM,
        layout: {
          'icon-image': [
            'let',
            'bikes', ['to-number', ['coalesce', ['get', 'bikesAvailable'], 0]],
            'spaces', ['to-number', ['coalesce', ['get', 'spacesAvailable'], 0]],
            [
              'case',
              ['<=', ['var', 'bikes'], 0], 'bike-gauge-0',
              [
                'step',
                ['/', ['var', 'bikes'], ['max', ['+', ['var', 'bikes'], ['var', 'spaces']], 1]],
                'bike-gauge-1',
                0.2, 'bike-gauge-2',
                0.4, 'bike-gauge-3',
                0.6, 'bike-gauge-4',
                0.8, 'bike-gauge-5'
              ]
            ]
          ],
          'icon-anchor': 'center',
          // Declutter the overview; show every station once markers are legible.
          'icon-allow-overlap': ['step', ['zoom'], false, 15, true],
          'icon-size': [
            'interpolate',
            ['linear'],
            ['zoom'],
            13, 0.42,
            14, 0.58,
            15.5, 0.82,
            17, 1.0
          ],
          // The count sits under the marker now that the bicycle has the
          // middle of the disc. Below the icon it also keeps its size as the
          // icon shrinks, which is where a numeral inside the ring used to go.
          'text-field': ['to-string', ['coalesce', ['get', 'bikesAvailable'], 0]],
          'text-anchor': 'top',
          'text-offset': [0, 0.75],
          'text-font': ['Gotham Rounded Medium'],
          'text-size': [
            'interpolate',
            ['linear'],
            ['zoom'],
            13, 0,
            13.8, 10,
            16, 13
          ],
          'text-allow-overlap': ['step', ['zoom'], false, 15, true],
        },
        paint: {
          'text-color': '#1e293b',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.6,
          'icon-opacity': BIKE_ICON_FADE_OUT as maplibregl.DataDrivenPropertyValueSpecification<number>,
          // Fade the numbers in so the wide overview stays clean.
          'text-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            13, 0,
            13.8, 1
          ]
        }
      });
    }

    // 14b. City-bike racks in 3D. The gauge above summarises a station in one
    // ring; this draws it — an apron, a dock per dock, a bike per bike and the
    // terminal at the end — in the same real metres as the vehicles and the
    // stop shelters, so up close the availability is simply the thing you see.
    if (!map.getSource(BIKE_STATION_SOURCE)) {
      map.addSource(BIKE_STATION_SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
    }
    if (!map.getLayer(BIKE_STATION_LAYER)) {
      map.addLayer({
        id: BIKE_STATION_LAYER,
        type: 'fill-extrusion',
        source: BIKE_STATION_SOURCE,
        minzoom: BIKE_3D_MIN_ZOOM,
        layout: {
          visibility: vehicles3DEnabled(is3DRef.current, always3DVehiclesRef.current) ? 'visible' : 'none',
        },
        paint: {
          'fill-extrusion-color': ['get', 'color'],
          'fill-extrusion-height': ['get', 'top'],
          'fill-extrusion-base': ['get', 'base'],
          'fill-extrusion-opacity': BIKE_3D_FADE_IN as maplibregl.PropertyValueSpecification<number>,
        },
      }, map.getLayer('vehicles-3d') ? 'vehicles-3d' : undefined);
    }

    // 15. Traffic-light junction markers (Helsinki open data, CC BY 4.0 — see
    // the "Waiting at traffic lights" popup badge). This is a static
    // reference layer, so it's populated once from `trafficLightsDataRef`
    // rather than polled like citybike availability.
    if (!map.getSource(TRAFFIC_LIGHT_SOURCE)) {
      map.addSource(TRAFFIC_LIGHT_SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: trafficLightsDataRef.current },
      });
    }

    // One image per priority state, so the marker can be lit by an expression
    // rather than rebuilt: the junction the tram is asking shows the lens it
    // asked for, everything else shows a signal standing dark.
    const registerSignalIcon = (name: string, svg: string) => {
      if (map.hasImage(name)) return;
      const img = new Image(TRAFFIC_LIGHT_ICON_WIDTH, TRAFFIC_LIGHT_ICON_HEIGHT);
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      img.onload = () => {
        if (mapRef.current !== map) return;
        if (!map.hasImage(name)) map.addImage(name, img, { pixelRatio: 2 });
      };
    };

    for (const variant of TRAFFIC_LIGHT_ICON_VARIANTS) {
      registerSignalIcon(trafficLightIconName(variant), trafficLightIconSvg(variant));
    }
    registerSignalIcon('warning-light-icon', warningLightIconSvg());

    // Street-level only: 557+ points citywide would clutter the overview.
    if (!map.getLayer(TRAFFIC_LIGHT_ICON_LAYER)) {
      map.addLayer({
        id: TRAFFIC_LIGHT_ICON_LAYER,
        type: 'symbol',
        source: TRAFFIC_LIGHT_SOURCE,
        minzoom: TRAFFIC_LIGHT_MIN_ZOOM,
        layout: {
          'icon-image': [
            'case',
            ['==', ['get', 'type'], 'warning_light'], 'warning-light-icon',
            [
              'match',
              ['coalesce', ['get', 'priority'], 'idle'],
              'requesting', trafficLightIconName('requesting'),
              'granted', trafficLightIconName('granted'),
              'denied', trafficLightIconName('denied'),
              trafficLightIconName('idle'),
            ],
          ],
          'icon-anchor': 'bottom',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          // A junction with a live request is drawn a size up, so the state
          // reads before the colour does.
          'icon-size': [
            'interpolate',
            ['linear'],
            ['zoom'],
            15, ['case', ['has', 'priority'], 0.62, 0.5],
            18, ['case', ['has', 'priority'], 0.95, 0.78],
          ],
          // Signals do not fight the stops and vehicles for placement, but a
          // junction being asked for a green sorts above the ones that are not.
          'symbol-sort-key': ['case', ['has', 'priority'], 0, 1],
        },
        paint: {
          'icon-opacity': TRAFFIC_LIGHT_ICON_OPACITY as maplibregl.DataDrivenPropertyValueSpecification<number>,
        }
      }, 'trams-circles');
    }

    // The selection ring, under the markers. A junction is picked out the way a
    // stop or a vehicle is — with the gold — but the marker itself cannot carry
    // it: its colours are the lenses, and recolouring those to mean "selected"
    // would overwrite the one thing the marker exists to say.
    if (!map.getLayer(TRAFFIC_LIGHT_SELECTION_LAYER)) {
      map.addLayer({
        id: TRAFFIC_LIGHT_SELECTION_LAYER,
        type: 'circle',
        source: TRAFFIC_LIGHT_SOURCE,
        minzoom: TRAFFIC_LIGHT_MIN_ZOOM,
        filter: ['==', ['get', 'id'], -1],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, 9, 18, 15],
          'circle-color': 'rgba(253, 203, 110, 0.12)',
          'circle-stroke-color': SELECTED_COLOR,
          'circle-stroke-width': 2,
          'circle-opacity': TRAFFIC_LIGHT_ICON_OPACITY as maplibregl.DataDrivenPropertyValueSpecification<number>,
          'circle-stroke-opacity': TRAFFIC_LIGHT_ICON_OPACITY as maplibregl.DataDrivenPropertyValueSpecification<number>,
        },
      }, TRAFFIC_LIGHT_ICON_LAYER);
    }

    // Source for selected stop (to remain visible when zoomed out)
    if (!map.getSource('selected-stop-source')) {
      map.addSource('selected-stop-source', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [],
        },
      });
    }

    // Source for selected vehicle next stop highlight
    if (!map.getSource('next-stop-highlight-source')) {
      map.addSource('next-stop-highlight-source', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [],
        },
      });
    }

    // Selected stop icon (visible at all zoom levels, uses the selected gold-outlined icon and scales dynamically)
    if (!map.getLayer('selected-stop-icon')) {
      map.addLayer({
        id: 'selected-stop-icon',
        type: 'symbol',
        source: 'selected-stop-source',
        layout: {
          'icon-image': [
            'match',
            ['get', 'mode'],
            'TRAM', 'sign-tram-selected',
            'BUS', 'sign-bus-selected',
            // The stop tiles say SUBWAY/RAIL; a selected vehicle's own mode
            // arrives as METRO/TRAIN. Both name the same sign.
            'SUBWAY', 'sign-metro-selected',
            'METRO', 'sign-metro-selected',
            'RAIL', 'sign-train-selected',
            'TRAIN', 'sign-train-selected',
            'sign-bus-selected'
          ],

          'icon-anchor': 'bottom',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-size': [
            'interpolate',
            ['linear'],
            ['zoom'],
            10, 0.7,
            14, 1.1,
            16, 1.4,
            20, 2.1
          ]
        }
      }, 'trams-circles');
    }


    // Selected bike station highlight halo layer. Sits directly under the gauge
    // marker (which is centre-anchored), so the halo is centred on it too.
    if (!map.getLayer('citybike-selected-highlight')) {
      map.addLayer({
        id: 'citybike-selected-highlight',
        type: 'circle',
        source: 'citybike',
        paint: {
          'circle-radius': [
            'interpolate',
            ['exponential', 1.15],
            ['zoom'],
            12, 12,
            22, 42
          ],
          'circle-color': 'rgba(253, 203, 110, 0.25)', // glowing gold halo
          'circle-stroke-color': '#fdcb6e',
          'circle-stroke-width': 3.5,
        },
        filter: ['==', ['to-string', ['coalesce', ['get', 'stationId'], ['get', 'id'], '']], '']
      }, 'citybike_gauge');
    }

    // Next stop highlight symbol layer (follows same highlight practice as selected stop)
    if (!map.getLayer('next-stop-icon')) {
      map.addLayer({
        id: 'next-stop-icon',
        type: 'symbol',
        source: 'next-stop-highlight-source',
        layout: {
          'icon-image': [
            'match',
            ['get', 'mode'],
            'TRAM', 'sign-tram-selected',
            'BUS', 'sign-bus-selected',
            // The stop tiles say SUBWAY/RAIL; a selected vehicle's own mode
            // arrives as METRO/TRAIN. Both name the same sign.
            'SUBWAY', 'sign-metro-selected',
            'METRO', 'sign-metro-selected',
            'RAIL', 'sign-train-selected',
            'TRAIN', 'sign-train-selected',
            'sign-bus-selected'
          ],
          'icon-anchor': 'bottom',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-size': [
            'interpolate',
            ['linear'],
            ['zoom'],
            10, 0.7,
            14, 1.1,
            16, 1.4,
            20, 2.1
          ]
        }
      }, 'trams-circles');
    }

    // --- Journey planner sources & layers ---
    if (!map.getSource('journey-lines')) {
      map.addSource('journey-lines', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
    }
    if (!map.getSource('journey-stops')) {
      map.addSource('journey-stops', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
    }
    if (!map.getSource('journey-endpoints')) {
      map.addSource('journey-endpoints', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
    }

    // Walk legs: dashed grey casing rendered beneath transit legs
    if (!map.getLayer('journey-walk-layer')) {
      map.addLayer({
        id: 'journey-walk-layer',
        type: 'line',
        source: 'journey-lines',
        filter: ['!', ['get', 'transit']] as maplibregl.FilterSpecification,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#94a3b8',
          'line-width': 4,
          'line-opacity': 0.85,
          'line-dasharray': [1.5, 1.5],
        },
      }, 'trams-circles');
    }

    // Transit legs: solid, coloured by route
    if (!map.getLayer('journey-transit-layer')) {
      map.addLayer({
        id: 'journey-transit-layer',
        type: 'line',
        source: 'journey-lines',
        filter: ['get', 'transit'] as maplibregl.FilterSpecification,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': ['coalesce', ['get', 'color'], '#00985f'],
          'line-width': 6,
          'line-opacity': 0.9,
        },
      }, 'trams-circles');
    }

    // Highlighted journey stops (board / alight / transfer / via)
    if (!map.getLayer('journey-stops-layer')) {
      map.addLayer({
        id: 'journey-stops-layer',
        type: 'circle',
        source: 'journey-stops',
        paint: {
          'circle-radius': [
            'match',
            ['get', 'kind'],
            'board', 7,
            'alight', 7,
            'transfer', 6,
            4,
          ],
          'circle-color': [
            'match',
            ['get', 'kind'],
            'board', '#00b894',
            'alight', '#e17055',
            'transfer', '#fdcb6e',
            '#ffffff',
          ],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': [
            'match',
            ['get', 'kind'],
            'via', 1.5,
            2.5,
          ],
        },
      }, 'trams-circles');
    }

    // Origin & destination pin markers (sit above the highlighted stops)
    if (!map.getLayer('journey-endpoints-layer')) {
      map.addLayer({
        id: 'journey-endpoints-layer',
        type: 'circle',
        source: 'journey-endpoints',
        paint: {
          'circle-radius': 9,
          'circle-color': [
            'match',
            ['get', 'role'],
            'origin', '#00b894',
            'destination', '#e17055',
            '#0984e3',
          ],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 3.5,
        },
      }, 'trams-circles');
    }

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
