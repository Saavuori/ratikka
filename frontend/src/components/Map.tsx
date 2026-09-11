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
import type { FeatureCollection } from 'geojson';
import type { VehiclePosition, TripDetailsResponse, JourneyLeg, JourneyEndpoint } from '../types';
import type { ModeFlags, TransportMode } from '../lib/modes';
import { createOverlayState, bikeAvailabilityChanged, invalidateOverlays } from '../map/overlays/state';
import type { OverlayState } from '../map/overlays/state';
import { updateStopFurniture, updateBikeFurniture } from '../map/overlays/furniture';
import { updateArrivalLabelStops, drawArrivalLabels, updateSignalPriority } from '../map/overlays/labels';
import type { LabelInputs } from '../map/overlays/labels';
import { drawRouteGeometries, updateJourney } from '../map/overlays/routes';
import {
  createAnimationState,
  rebuildTracks,
  receivePositions,
  setTimeScale,
  startAnimationLoop,
} from '../map/animation';
import type { AnimationState, FrameInputs } from '../map/animation';
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
  STOP_MODE,
  installMapLayers,
  update3DMode,
  updateMetroSignVisibility,
  updateVehicle3DMode,
} from '../map/layers';
import type { ArrivalFocus } from '../lib/stopArrivals';
import {
  snappedLinesInFeed,
} from '../lib/railTracks';
import { useSyncRef } from '../hooks/useSyncRef';
import type { MapTheme } from '../lib/stopPlatforms';
import {
  SATELLITE_ATTRIBUTION,
} from '../lib/satelliteBasemap';
import {
  STOP_FURNITURE_LAYER,
} from '../lib/stopModels';
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
  BIKE_STATION_LAYER,
} from '../lib/bikeStationModels';
import { vehicles3DEnabled } from '../lib/vehicleAnimation';
import { fetchBikeStations, fetchMapConfig } from '../lib/api';
import {
  TRAFFIC_LIGHT_SOURCE,
  TRAFFIC_LIGHT_ICON_LAYER,
  TRAFFIC_LIGHT_SELECTION_LAYER,
} from '../lib/trafficLightModels';
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
  // Cheap signature of what the furniture was last built for, so the `idle`
  // event — which fires on every tile that lands — does no work in the common
  // case where nothing that matters has moved.
  // Name/code/mode for the stops currently carrying furniture, so a click on a
  // shelter can open the same popup a click on its sign would.
  const mapThemeRef = useRef<MapTheme>(mapTheme);
  const isFollowingRef = useRef<boolean>(isFollowing);
  useSyncRef(mapThemeRef, mapTheme);
  useSyncRef(isFollowingRef, isFollowing);
  // Latest live city-bike station GeoJSON, refreshed on an interval. Kept in a
  // ref so a theme/style reload can re-seed the recreated source without
  // waiting for the next fetch.
  const bikeStationsDataRef = useRef<BikeStationsFeatureCollection | null>(null);
  // The 3D racks, tracked the same way as the stop furniture: drawn-or-not, and
  // a signature of what they were last built for.
  // Bumped on every availability refresh, so the rack signature notices new
  // counts arriving under an unmoved view.
  // Latest signalized-junction features (static reference data, shared with
  // the tram popup via useTrafficLights). Kept in a ref for the same reason
  // as bikeStationsDataRef: re-seed the source immediately after a
  // theme/style reload recreates it.
  const trafficLightsDataRef = useRef<TrafficLightFeature[]>([]);
  const trafficLightFeatures = useTrafficLights();
  // Signatures: the junction source is only rebuilt when the set of live
  // exchanges actually changes, not on every positions message.

  const journeyLegsRef = useRef<JourneyLeg[] | null>(journeyLegs);
  const journeyEndpointsRef = useRef<{ from: JourneyEndpoint; to: JourneyEndpoint } | null>(journeyEndpoints);
  useSyncRef(journeyLegsRef, journeyLegs);
  useSyncRef(journeyEndpointsRef, journeyEndpoints);

  /**
   * Everything the animation remembers between frames — glides, dead-reckoning
   * fixes, rail geometry, clocks. A plain object rather than twenty refs: none
   * of it should cause a render, and the loop writes to it sixty times a
   * second. Created once per mount.
   */
  const animationRef = useRef<AnimationState>(createAnimationState(timeScale));
  useEffect(() => {
    setTimeScale(animationRef.current, timeScale);
  }, [timeScale]);
  /**
   * The overlays, bound to the state they keep between updates and the values
   * they read as of now. The plumbing is here once rather than at each of the
   * twenty call sites that rebuild one.
   */
  const overlayRef = useRef<OverlayState>(createOverlayState());
  // Held in a ref, not rebuilt per render: every binding reads only refs, so
  // one closure stays correct forever — and a ref is the one thing
  // `react-hooks/exhaustive-deps` knows is stable, so the effects that call
  // these need not list them.
  const overlaysRef = useRef({
    stopFurniture: (map: maplibregl.Map, theme: MapTheme) =>
      updateStopFurniture(map, theme, overlayRef.current, {
        is3D: is3DRef.current,
        always3DVehicles: always3DVehiclesRef.current,
        stopHighlight: animationRef.current.stopHighlight,
        bikeStations: bikeStationsDataRef.current,
        selectedBikeStationId: selectedBikeStationIdRef.current,
      }),
    bikeFurniture: (map: maplibregl.Map, theme: MapTheme) =>
      updateBikeFurniture(map, theme, overlayRef.current, {
        is3D: is3DRef.current,
        always3DVehicles: always3DVehiclesRef.current,
        stopHighlight: animationRef.current.stopHighlight,
        bikeStations: bikeStationsDataRef.current,
        selectedBikeStationId: selectedBikeStationIdRef.current,
      }),
    arrivalLabelStops: (map: maplibregl.Map) =>
      updateArrivalLabelStops(map, overlayRef.current, labelInputs(), callbacksRef.current.onVisibleStopsChange),
    arrivalLabels: (map: maplibregl.Map) =>
      drawArrivalLabels(map, overlayRef.current, labelInputs()),
    signalPriority: (map: maplibregl.Map) =>
      updateSignalPriority(map, overlayRef.current, labelInputs()),
    routeGeometries: (
      map: maplibregl.Map,
      geometries: Record<string, { geometries: string[]; color?: string }>,
      selectedLine: string | null,
    ) => drawRouteGeometries(map, geometries, selectedLine, overlayRef.current),
  });

  function labelInputs(): LabelInputs {
    return {
      labels: arrivalLabelsRef.current ?? {},
      vehicles: latestTramsRef.current,
      trafficLights: trafficLightsDataRef.current,
    };
  }
  const journeyFitKeyRef = useRef<string>('');


  useEffect(() => {
    animationRef.current.lastSeenStopId = null;
  }, [selectedTramId]);











  // New countdowns arrive every refresh and every second the clock ticks; the
  // set of stops they belong to changes only when the view moves, so this
  // repaints the text without re-querying anything.
  useEffect(() => {
    arrivalLabelsRef.current = arrivalLabels;
    const map = mapRef.current;
    if (map && map.getStyle()) overlaysRef.current.arrivalLabels(map);
  }, [arrivalLabels]);


  // Decoding and de-duplicating a line's patterns is the expensive part of a
  // redraw, and a redraw happens on every selection change — with the whole tram
  // network highlighted that is tens of thousands of points. The result depends
  // only on the polylines themselves, and those arrive as one array per fetch
  // and are never mutated, so caching against the array's identity is enough.



  // Track geometry for every rail line currently in the feed. This is fetched
  // independently of `routeGeometries` (which only covers lines the user has
  // highlighted, because its job is drawing route ribbons): a vehicle is
  // snapped to its rails — and a metro dead-reckoned along them — whether or
  // not its line is highlighted, and hanging that off the highlight state meant
  // the ordinary view with nothing selected had no tracks and therefore no
  // snapping at all. See hooks/useRoutePatterns.
  const snappedLines = useMemo(() => snappedLinesInFeed(trams), [trams]);
  const routePatterns = useRoutePatterns(snappedLines);




  // Rail geometry for the lines being snapped, kept with the animation that
  // snaps them.
  useEffect(() => {
    rebuildTracks(animationRef.current, routePatterns);
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

  // What the loop reads from the app on every frame. Called rather than
  // captured, because the loop outlives the render that started it.
  const readFrame = (): FrameInputs => ({
    vehicles: latestTramsRef.current,
    selectedVehicleId: selectedTramIdRef.current,
    selectedTripDetails: selectedTripDetailsRef.current,
    arrivalFocus: arrivalFocusRef.current,
    arrivalStopCoords: arrivalStopCoordsRef.current,
    theme: mapThemeRef.current,
    is3D: is3DRef.current,
    always3DVehicles: always3DVehiclesRef.current,
    isFollowing: isFollowingRef.current,
  });

  // A new snapshot: work out where every vehicle is gliding to, then refresh
  // the junctions they are talking to from the same message.
  useEffect(() => {
    receivePositions(animationRef.current, trams, lineFilters);
    const map = mapRef.current;
    if (map && map.getStyle()) overlaysRef.current.signalPriority(map);
  }, [trams, lineFilters]);

  // Sync incoming tram data to animation refs


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
    overlaysRef.current.routeGeometries(map, routeGeometriesRef.current, selectedLineRef.current);

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
    // The style reload recreated every source, so whatever the overlays were
    // last built for no longer exists — including the live junction states,
    // which came back off the recreated source.
    invalidateOverlays(overlayRef.current);
    overlaysRef.current.stopFurniture(map, mapThemeRef.current);
    overlaysRef.current.bikeFurniture(map, mapThemeRef.current);
    overlaysRef.current.signalPriority(map);
    overlaysRef.current.arrivalLabelStops(map);

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
      const info = overlayRef.current.stopFurniture.meta[String(stopId)];
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
      overlaysRef.current.stopFurniture(map, mapThemeRef.current);
      overlaysRef.current.bikeFurniture(map, mapThemeRef.current);
      overlaysRef.current.arrivalLabelStops(map);
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
      animationRef.current.interacting = true;
      if (wheelTimeout) clearTimeout(wheelTimeout);
      wheelTimeout = setTimeout(() => {
        animationRef.current.interacting = false;
      }, 800); // Resume tracking 800ms after last scroll tick
    };

    const handleInteractionStart = () => {
      animationRef.current.interacting = true;
    };

    const handleInteractionEnd = () => {
      animationRef.current.interacting = false;
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
    const stopAnimation = startAnimationLoop(map, animationRef.current, readFrame, {
      rebuildFurniture: () => {
        overlaysRef.current.stopFurniture(map, mapThemeRef.current);
        overlaysRef.current.bikeFurniture(map, mapThemeRef.current);
      },
    });

    return () => {
      stopAnimation();
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
        bikeAvailabilityChanged(overlayRef.current);
        if (map && map.getStyle()) overlaysRef.current.bikeFurniture(map, mapThemeRef.current);
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
      overlayRef.current.signalPriority.sig = '';
      overlaysRef.current.signalPriority(map);
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
    overlayRef.current.bikeFurniture.sig = '';
    overlaysRef.current.bikeFurniture(map, mapThemeRef.current);
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
      overlaysRef.current.routeGeometries(map, routeGeometries, selectedLine);
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
      overlayRef.current.stopFurniture.sig = '';
      overlaysRef.current.stopFurniture(map, mapTheme);
      overlayRef.current.bikeFurniture.sig = '';
      overlaysRef.current.bikeFurniture(map, mapTheme);
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
