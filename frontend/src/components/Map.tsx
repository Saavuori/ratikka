import React, { useEffect, useRef } from 'react';
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
import {
  getRouteColor,
  routeColorMatchExpression,
  colorMatchExpression,
  METRO_TILE_COLORS,
  TRAIN_TILE_COLORS,
  ROUTE_COLORS,
  METRO_COLORS,
  TRAIN_COLORS,
  TRAM_GREEN,
  METRO_ORANGE,
  TRAIN_PURPLE,
} from '../lib/routeColors';
import { buildTracks, placeOnTracks, pointOnTrack } from '../lib/metroTracks';
import type { MetroTrack, TrackPlacement } from '../lib/metroTracks';
import { assignCorridorSlots, directionalPaths } from '../lib/routeSlots';
import type { RoutePath } from '../lib/routeSlots';
import {
  ROUTE_LINE_WIDTH,
  ROUTE_CASING_WIDTH,
  ROUTE_LINE_OFFSET,
  ROUTE_LINE_OPACITY,
  ROUTE_LINE_SORT_KEY,
} from '../lib/routeLineStyle';
import { fetchBikeStations } from '../lib/api';
import type { BikeStationsFeatureCollection, TrafficLightFeature } from '../types';
import { useTrafficLights } from '../hooks/useTrafficLights';

maplibregl.setWorkerUrl(maplibreWorkerUrl);

// The gold route segment drawn from a selected vehicle to its next stop relies
// on closest-point matching against the trip polyline, which produced unreliable
// (jumping/back-tracking) paths. Disabled until the matching is made robust. The
// next-stop signpost highlight itself is unaffected and remains enabled.
const HIGHLIGHT_NEXT_STOP_ROUTE = false;

// A stop's mode, whichever of the two stop tilesets it came from: the JORE tiles
// the light basemap ships (`mode`) or the Digitransit v3 stops the dark theme
// falls back to (`type`). Both spell the modes the same — TRAM, BUS, SUBWAY,
// RAIL — they just disagree about the property name.
const STOP_MODE: maplibregl.ExpressionSpecification = [
  'to-string',
  ['coalesce', ['get', 'mode'], ['get', 'type'], ''],
];

// Paint expressions for the highlighted route paths live in lib/routeLineStyle,
// where the zoom stops of the offset fan are unit-tested against the style spec.

interface MapProps {
  trams: Record<string, VehiclePosition>;
  selectedTramId: string | null;
  selectedStopId: string | null;
  selectedBikeStationId: string | null;
  selectedStopCoords?: [number, number] | null;
  selectedStopMode?: string | null;
  selectedStopIsTrunk?: boolean;
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
  lineFilters: string[];
  routeGeometries: Record<string, { geometries: string[]; color?: string; stops?: string[] }>;
  // Line number (`desi`) of the currently selected vehicle, if any. Its route
  // path is drawn emphasised while every other highlighted route is dimmed.
  selectedLine?: string | null;
  mapTheme: 'light' | 'dark';
  is3D: boolean;
  isFollowing: boolean;
  onDisableFollowing: () => void;
  onMapBearingChange?: (bearing: number) => void;
  showTrams: boolean;
  showBuses: boolean;
  showMetro: boolean;
  showTrains: boolean;
  selectedTripDetails: TripDetailsResponse | null;
  journeyLegs?: JourneyLeg[] | null;
  journeyEndpoints?: { from: JourneyEndpoint; to: JourneyEndpoint } | null;
}

interface RenderPosition {
  lat: number;
  lng: number;
  hdg: number;
  // Metro only: where this position sits on the line's own track geometry, so
  // the animation can slide a train *along* its tunnel between two snapshots
  // instead of cutting across the ground between them. See lib/metroTracks.
  track?: TrackPlacement;
}

// A metro position is only pulled onto the tracks if it is within this far of
// them. Underground, HFP positions are dead-reckoned and drift by a couple of
// hundred metres; past that the message is more likely stale or bogus than a
// train, and snapping it would invent a confident-looking position.
const METRO_SNAP_MAX_OFFSET = 400;

export const Map: React.FC<MapProps> = ({
  trams,
  selectedTramId,
  selectedStopId,
  selectedBikeStationId,
  selectedStopCoords,
  selectedStopMode,
  selectedStopIsTrunk,
  onSelectTram,
  onSelectStop,
  onSelectBikeStation,
  lineFilters,
  routeGeometries,
  selectedLine = null,
  mapTheme,
  is3D,
  isFollowing,
  onDisableFollowing,
  onMapBearingChange,
  showTrams,
  showBuses,
  showMetro,
  showTrains,
  selectedTripDetails,
  journeyLegs = null,
  journeyEndpoints = null,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  const selectedTripDetailsRef = useRef<TripDetailsResponse | null>(selectedTripDetails);

  useEffect(() => {
    selectedTripDetailsRef.current = selectedTripDetails;
  }, [selectedTripDetails]);

  const [apiKey, setApiKey] = React.useState<string | null>(null);
  // MapLibre 6 requires WebGL2 (WebGL 1 support was dropped). Without this the
  // map would just be a blank rectangle on a device that cannot provide it.
  const [webglFailed, setWebglFailed] = React.useState(false);

  useEffect(() => {
    fetch('/api/v1/config')
      .then((res) => res.json())
      .then((data) => {
        setApiKey(data.digitransit_map_key || '');
      })
      .catch((err) => {
        console.error('Failed to fetch map key config:', err);
        setApiKey('');
      });
  }, []);

  // References to keep state fresh in map event handlers and tick loop without closure issues
  const latestTramsRef = useRef<Record<string, VehiclePosition>>(trams);
  const callbacksRef = useRef({ onSelectTram, onSelectStop, onSelectBikeStation, onDisableFollowing, onMapBearingChange });
  const routeGeometriesRef = useRef<Record<string, { geometries: string[]; color?: string; stops?: string[] }>>(routeGeometries);
  const selectedTramIdRef = useRef<string | null>(selectedTramId);
  const selectedLineRef = useRef<string | null>(selectedLine);
  const selectedStopIdRef = useRef<string | null>(selectedStopId);
  const selectedBikeStationIdRef = useRef<string | null>(selectedBikeStationId);
  const lineFiltersRef = useRef<string[]>(lineFilters);
  const showTramsRef = useRef<boolean>(showTrams);
  const showBusesRef = useRef<boolean>(showBuses);
  const showMetroRef = useRef<boolean>(showMetro);
  const showTrainsRef = useRef<boolean>(showTrains);
  const is3DRef = useRef<boolean>(is3D);
  const mapThemeRef = useRef<'light' | 'dark'>(mapTheme);
  const isFollowingRef = useRef<boolean>(isFollowing);
  const isInteractingRef = useRef<boolean>(false);
  // Latest live city-bike station GeoJSON, refreshed on an interval. Kept in a
  // ref so a theme/style reload can re-seed the recreated source without
  // waiting for the next fetch.
  const bikeStationsDataRef = useRef<BikeStationsFeatureCollection | null>(null);
  // Latest signalized-junction features (static reference data, shared with
  // the tram popup via useTrafficLights). Kept in a ref for the same reason
  // as bikeStationsDataRef: re-seed the source immediately after a
  // theme/style reload recreates it.
  const trafficLightsDataRef = useRef<TrafficLightFeature[]>([]);
  const trafficLightFeatures = useTrafficLights();

  const journeyLegsRef = useRef<JourneyLeg[] | null>(journeyLegs);
  const journeyEndpointsRef = useRef<{ from: JourneyEndpoint; to: JourneyEndpoint } | null>(journeyEndpoints);
  const journeyFitKeyRef = useRef<string>('');

  const lastSeenStopIdRef = useRef<string | null>(null);

  useEffect(() => {
    lastSeenStopIdRef.current = null;
  }, [selectedTramId]);

  useEffect(() => {
    latestTramsRef.current = trams;
  }, [trams]);

  useEffect(() => {
    callbacksRef.current = { onSelectTram, onSelectStop, onSelectBikeStation, onDisableFollowing, onMapBearingChange };
  }, [onSelectTram, onSelectStop, onSelectBikeStation, onDisableFollowing, onMapBearingChange]);

  useEffect(() => {
    routeGeometriesRef.current = routeGeometries;
  }, [routeGeometries]);

  useEffect(() => {
    selectedTramIdRef.current = selectedTramId;
  }, [selectedTramId]);

  useEffect(() => {
    selectedLineRef.current = selectedLine;
  }, [selectedLine]);

  useEffect(() => {
    selectedStopIdRef.current = selectedStopId;
  }, [selectedStopId]);

  useEffect(() => {
    selectedBikeStationIdRef.current = selectedBikeStationId;
  }, [selectedBikeStationId]);

  useEffect(() => {
    lineFiltersRef.current = lineFilters;
  }, [lineFilters]);

  useEffect(() => {
    showTramsRef.current = showTrams;
  }, [showTrams]);

  useEffect(() => {
    showBusesRef.current = showBuses;
  }, [showBuses]);

  useEffect(() => {
    showMetroRef.current = showMetro;
  }, [showMetro]);

  useEffect(() => {
    showTrainsRef.current = showTrains;
  }, [showTrains]);

  useEffect(() => {
    is3DRef.current = is3D;
  }, [is3D]);

  useEffect(() => {
    mapThemeRef.current = mapTheme;
  }, [mapTheme]);

  useEffect(() => {
    isFollowingRef.current = isFollowing;
  }, [isFollowing]);

  // Helper to toggle visibility of the HSL background route network. The network
  // uses HSL's mode colours (green trams, blue buses, orange metro, purple
  // trains) rather than our per-line palette, and each mode's layers follow that
  // mode's Settings toggle. Ferries are never drawn here. The whole network is the
  // "show all" state: it is drawn whenever no line filter is active (`show`),
  // and hidden as soon as the user selects specific lines — at which point only
  // those lines' highlighted per-line route paths remain. When `show` is off
  // nothing shows regardless of the mode toggles.
  const tramRouteLayers = [
    'route_tram_case',
    'route_tram',
    'route_tram_inner',
    'route_lrail_case',
    'route_lrail',
    'route_lrail_inner',
  ];
  const busRouteLayers = [
    'route_bus_case',
    'route_bus',
    'route_bus_inner',
    'route_trunk_case',
    'route_trunk',
    'route_trunk_inner',
  ];
  const metroRouteLayers = [
    'route_subway_case',
    'route_subway',
    'route_subway_underground',
  ];
  const trainRouteLayers = [
    'route_rail_case',
    'route_rail',
  ];
  const otherRouteLayers = [
    'route_ferry',
  ];

  // Each background route layer's own (mode/trunk) filter, mirrored from the
  // light `style.json` and the dark-theme recreation in
  // `backgroundRouteNetworkLayers`. Narrowing the network to the selected lines
  // combines the layer's base filter with a `routeIdParsed` line match, so we
  // keep the base filter here to restore "show all of this mode" when no line
  // filter is active.
  const routeLayerBaseFilters: Record<string, maplibregl.FilterSpecification> = {
    route_tram_case: ['==', ['get', 'mode'], 'TRAM'],
    route_tram: ['==', ['get', 'mode'], 'TRAM'],
    route_tram_inner: ['==', ['get', 'mode'], 'TRAM'],
    route_lrail_case: ['==', ['get', 'mode'], 'L_RAIL'],
    route_lrail: ['==', ['get', 'mode'], 'L_RAIL'],
    route_lrail_inner: ['==', ['get', 'mode'], 'L_RAIL'],
    route_bus_case: ['all', ['!=', ['get', 'trunk_route'], '1'], ['==', ['get', 'mode'], 'BUS']],
    route_bus: ['all', ['!=', ['get', 'trunk_route'], '1'], ['==', ['get', 'mode'], 'BUS']],
    route_bus_inner: ['all', ['!=', ['get', 'trunk_route'], '1'], ['==', ['get', 'mode'], 'BUS']],
    route_trunk_case: ['all', ['==', ['get', 'trunk_route'], '1'], ['==', ['get', 'mode'], 'BUS']],
    route_trunk: ['all', ['==', ['get', 'trunk_route'], '1'], ['==', ['get', 'mode'], 'BUS']],
    route_trunk_inner: ['all', ['==', ['get', 'trunk_route'], '1'], ['==', ['get', 'mode'], 'BUS']],
    route_subway_case: ['==', ['get', 'mode'], 'SUBWAY'],
    route_subway: ['==', ['get', 'mode'], 'SUBWAY'],
    route_subway_underground: ['==', ['get', 'mode'], 'SUBWAY'],
    route_rail_case: ['==', ['get', 'mode'], 'RAIL'],
    route_rail: ['==', ['get', 'mode'], 'RAIL'],
  };

  // The HSL background route network (the `routes` vector source + its per-mode
  // line layers) ships only in the light `style.json`. The dark theme loads
  // Carto's dark-matter basemap, which has neither, so the Settings "Routes"
  // toggle used to do nothing there — the route lines never appeared. This
  // recreates that source and the tram/bus/light-rail/trunk layers (matching the
  // style.json definitions, case → main → inner) whenever they are missing, so
  // the network — and its mode colours — show in both themes. Guarded by
  // `getSource`/`getLayer`, it is a no-op in light mode where the style already
  // provides them.
  const backgroundRouteNetworkLayers: maplibregl.LayerSpecification[] = [
    // Trams (green)
    { id: 'route_tram_case', type: 'line', source: 'routes', 'source-layer': 'routes',
      filter: ['==', ['get', 'mode'], 'TRAM'], layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#fff', 'line-width': { stops: [[10, 4], [22, 8]] } } },
    { id: 'route_tram', type: 'line', source: 'routes', 'source-layer': 'routes',
      filter: ['==', ['get', 'mode'], 'TRAM'], layout: { 'line-cap': 'round', 'line-join': 'round', 'line-round-limit': 1 },
      paint: { 'line-color': '#00985F', 'line-width': { stops: [[10, 2], [22, 6]] } } },
    { id: 'route_tram_inner', type: 'line', source: 'routes', 'source-layer': 'routes',
      filter: ['==', ['get', 'mode'], 'TRAM'],
      paint: { 'line-color': '#00bb75', 'line-width': { stops: [[10, 0.5], [22, 2]] } } },
    // Light rail / Raide-Jokeri (teal)
    { id: 'route_lrail_case', type: 'line', source: 'routes', 'source-layer': 'routes',
      filter: ['==', ['get', 'mode'], 'L_RAIL'], layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#fff', 'line-width': { stops: [[10, 4], [22, 8]] } } },
    { id: 'route_lrail', type: 'line', source: 'routes', 'source-layer': 'routes',
      filter: ['==', ['get', 'mode'], 'L_RAIL'], layout: { 'line-cap': 'round', 'line-join': 'round', 'line-round-limit': 1 },
      paint: { 'line-color': '#0098A1', 'line-width': { stops: [[10, 2], [22, 6]] } } },
    { id: 'route_lrail_inner', type: 'line', source: 'routes', 'source-layer': 'routes',
      filter: ['==', ['get', 'mode'], 'L_RAIL'],
      paint: { 'line-color': '#19a2aa', 'line-width': { stops: [[10, 0.5], [22, 2]] } } },
    // Buses (blue)
    { id: 'route_bus_case', type: 'line', source: 'routes', 'source-layer': 'routes',
      filter: ['all', ['!=', ['get', 'trunk_route'], '1'], ['==', ['get', 'mode'], 'BUS']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#fff', 'line-width': { stops: [[10, 4], [22, 8]] } } },
    { id: 'route_bus', type: 'line', source: 'routes', 'source-layer': 'routes',
      filter: ['all', ['!=', ['get', 'trunk_route'], '1'], ['==', ['get', 'mode'], 'BUS']],
      layout: { 'line-cap': 'round', 'line-join': 'round', 'line-round-limit': 1 },
      paint: { 'line-color': '#007ac9', 'line-width': { stops: [[10, 2], [22, 6]] } } },
    { id: 'route_bus_inner', type: 'line', source: 'routes', 'source-layer': 'routes',
      filter: ['all', ['!=', ['get', 'trunk_route'], '1'], ['==', ['get', 'mode'], 'BUS']],
      paint: { 'line-color': '#3395d4', 'line-width': { stops: [[10, 0.5], [22, 2]] } } },
    // Trunk buses (orange)
    { id: 'route_trunk_case', type: 'line', source: 'routes', 'source-layer': 'routes',
      filter: ['all', ['==', ['get', 'trunk_route'], '1'], ['==', ['get', 'mode'], 'BUS']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#fff', 'line-width': { stops: [[10, 4], [22, 8]] } } },
    { id: 'route_trunk', type: 'line', source: 'routes', 'source-layer': 'routes',
      filter: ['all', ['==', ['get', 'trunk_route'], '1'], ['==', ['get', 'mode'], 'BUS']],
      layout: { 'line-cap': 'round', 'line-join': 'round', 'line-round-limit': 1 },
      paint: { 'line-color': '#CA4300', 'line-width': { stops: [[10, 2], [22, 6]] } } },
    { id: 'route_trunk_inner', type: 'line', source: 'routes', 'source-layer': 'routes',
      filter: ['all', ['==', ['get', 'trunk_route'], '1'], ['==', ['get', 'mode'], 'BUS']],
      paint: { 'line-color': '#FF6319', 'line-width': { stops: [[10, 1], [22, 4]] } } },
    // Metro (orange). Drawn wider than the street modes: two lines carry the
    // whole east-west spine, so the network reads as the trunk it is.
    { id: 'route_subway_case', type: 'line', source: 'routes', 'source-layer': 'routes',
      filter: ['==', ['get', 'mode'], 'SUBWAY'], layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#fff', 'line-width': { stops: [[10, 5], [22, 10]] } } },
    { id: 'route_subway', type: 'line', source: 'routes', 'source-layer': 'routes',
      filter: ['==', ['get', 'mode'], 'SUBWAY'], layout: { 'line-cap': 'round', 'line-join': 'round', 'line-round-limit': 1 },
      paint: { 'line-color': '#FF6319', 'line-width': { stops: [[10, 3], [22, 7]] } } },
    // Commuter rail (purple)
    { id: 'route_rail_case', type: 'line', source: 'routes', 'source-layer': 'routes',
      filter: ['==', ['get', 'mode'], 'RAIL'], layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#fff', 'line-width': { stops: [[10, 5], [22, 10]] } } },
    { id: 'route_rail', type: 'line', source: 'routes', 'source-layer': 'routes',
      filter: ['==', ['get', 'mode'], 'RAIL'], layout: { 'line-cap': 'round', 'line-join': 'round', 'line-round-limit': 1 },
      paint: { 'line-color': '#8C4799', 'line-width': { stops: [[10, 3], [22, 7]] } } },
  ] as unknown as maplibregl.LayerSpecification[];

  const ensureBackgroundRouteNetwork = (map: maplibregl.Map) => {
    // Add the JORE routes vector source if the base style doesn't provide it.
    if (!map.getSource('routes')) {
      map.addSource('routes', {
        type: 'vector',
        url: 'https://kartat.hsl.fi/jore/tiles/routes/index.json',
      });
    }

    // Keep the network beneath the highlighted route path (casing included, or
    // the network would draw over it) and the vehicles.
    const beforeId = map.getLayer('route-lines-casing')
      ? 'route-lines-casing'
      : map.getLayer('route-lines-layer')
      ? 'route-lines-layer'
      : map.getLayer('trams-circles')
      ? 'trams-circles'
      : undefined;

    backgroundRouteNetworkLayers.forEach((layer) => {
      if (!map.getLayer(layer.id)) {
        map.addLayer(layer, beforeId);
      }
    });
  };

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

  // The background network and the highlighted route paths must never draw the
  // same line at once. They come from different sources — JORE vector tiles vs.
  // the fetched pattern geometry — and only the highlighted path is offset into
  // its own slot, so a line drawn by both appears twice: once on the street and
  // once beside it, in the same palette colour.
  //
  // `ribbonLines` is what the fetched geometry covers, which is every tram line
  // running — "Show All" highlights them all rather than falling back to the
  // flat mode-coloured tiles, so the map looks the same whether you picked no
  // lines or all of them. The tram tiles are therefore hidden whenever any
  // ribbon is drawn. Buses have no pattern geometry to draw from (the route
  // endpoint is tram-only), so the bus network stays exactly as it was: shown
  // until the user narrows to specific lines.
  //
  //   line filters active → hidden. The highlighted ribbons *are* those routes,
  //     drawn better (per-line offset, casing, selection emphasis).
  //   only a vehicle selected → buses drawn as context, minus that vehicle's
  //     line, faded so the selected route reads first.
  //   nothing selected → trams as ribbons, the bus network at full strength.
  const updateRouteVisibility = (
    map: maplibregl.Map,
    trams: boolean,
    buses: boolean,
    metro: boolean,
    trains: boolean,
    lines: string[],
    selectedLine: string | null,
    ribbonLines: string[] = [],
  ) => {
    const highlighted = lines.length > 0;
    const context = !highlighted && !!selectedLine;
    const ribboned = ribbonLines.length > 0;

    const setVisible = (layerId: string, visible: boolean) => {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
      }
    };
    // `routeIdParsed` is the JORE tiles' friendly line number — the same key as
    // a vehicle's `desi` and our palette — so excluding the selected line is a
    // plain negated match on it.
    const applyLineFilter = (layerId: string) => {
      if (!map.getLayer(layerId)) return;
      const base = routeLayerBaseFilters[layerId];
      if (!base) return;
      if (context) {
        map.setFilter(layerId, [
          'all',
          base,
          ['!', ['in', ['get', 'routeIdParsed'], ['literal', [selectedLine]]]],
        ] as maplibregl.FilterSpecification);
      } else {
        map.setFilter(layerId, base);
      }
      map.setPaintProperty(layerId, 'line-opacity', context ? 0.3 : 1);
    };
    tramRouteLayers.forEach((layerId) => {
      setVisible(layerId, trams && !highlighted && !ribboned);
      applyLineFilter(layerId);
    });
    busRouteLayers.forEach((layerId) => {
      setVisible(layerId, buses && !highlighted);
      applyLineFilter(layerId);
    });
    // Metro and train lines are ribboned like trams (few enough lines to fetch a
    // pattern each), so their tiles give way to the ribbons the same way.
    metroRouteLayers.forEach((layerId) => {
      setVisible(layerId, metro && !highlighted && !ribboned);
      applyLineFilter(layerId);
    });
    trainRouteLayers.forEach((layerId) => {
      setVisible(layerId, trains && !highlighted && !ribboned);
      applyLineFilter(layerId);
    });
    otherRouteLayers.forEach((layerId) => setVisible(layerId, false));
  };

  // Helper to toggle 3D tilt and buildings extrusion
  const update3DMode = (map: maplibregl.Map, active: boolean, theme: 'light' | 'dark') => {
    // 1. Set pitch
    map.easeTo({
      pitch: active ? 45 : 0,
      duration: 800,
    });

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
      if (theme === 'dark') {
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

  // Indexed metro track geometry, per line. Rebuilt only when a line's
  // polylines actually change: indexing walks every point of every pattern.
  const metroTracksRef = useRef<Record<string, MetroTrack[]>>({});
  const metroGeometrySourceRef = useRef<Record<string, string[]>>({});

  useEffect(() => {
    const tracks: Record<string, MetroTrack[]> = {};
    Object.entries(routeGeometries).forEach(([line, data]) => {
      // Metro lines are the only ones we snap to, and they are the only ones
      // named "M<something>" — trams are numbers, trains single letters.
      if (!/^M\d/i.test(line)) return;
      if (metroGeometrySourceRef.current[line] === data.geometries) {
        tracks[line] = metroTracksRef.current[line];
        return;
      }
      metroGeometrySourceRef.current[line] = data.geometries;
      tracks[line] = buildTracks(data.geometries);
    });
    metroTracksRef.current = tracks;
  }, [routeGeometries]);

  /**
   * Pull a reported metro position onto its line's tracks. Returns null when
   * the line's geometry has not loaded yet, or the position is too far off the
   * network to trust — in both cases the caller draws the raw position,
   * exactly as before.
   */
  const placeOnMetroTrack = (tram: VehiclePosition, previous: TrackPlacement | undefined) => {
    const tracks = metroTracksRef.current[tram.desi];
    if (!tracks || tracks.length === 0) return null;
    return placeOnTracks(tram.desi, tracks, tram, previous, {
      maxOffset: METRO_SNAP_MAX_OFFSET,
    });
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
      // Snapshot updates are expected every 1000ms. Clamp delta to 1.0.
      const elapsed = now - lastUpdateRef.current;
      const t = Math.min(elapsed / 1000, 1.0);

      // Adaptive render throttle. Rebuilding every vehicle's GeoJSON feature and
      // pushing it through `setData` is O(n) and, at 60 fps with a full map, it
      // dominates the frame budget and makes the whole animation stutter. The
      // sub-pixel movement between two 1 Hz snapshots is imperceptible when the
      // map is zoomed out, so when there are many vehicles we cap the rebuild
      // rate by load and zoom. Interpolation stays correct (each render still
      // computes the right position for `now`), it just updates less often.
      // Chasing a vehicle is never throttled — that view needs every frame.
      const vehicleCount = Object.keys(targetPositionsRef.current).length;
      const following = !!selectedTramIdRef.current;
      if (!following && vehicleCount > 25) {
        const zoom = map.getZoom();
        const minInterval = vehicleCount > 60
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

      const features = Object.entries(targetPositionsRef.current).map(([id, target]) => {
        const prev = prevPositionsRef.current[id] || target;

        const tramInfo = latestTramsRef.current[id];
        const spd = tramInfo?.spd ?? 0;
        const acc = tramInfo?.acc ?? 0;

        // Shape position interpolation by acceleration so the on-screen motion
        // mirrors the physical vehicle: ease-in while accelerating away from a
        // stop, ease-out while braking into one. Heading eases smoothly.
        const tPos = easeByAccel(t, acc);
        let lat = lerp(prev.lat, target.lat, tPos);
        let lng = lerp(prev.lng, target.lng, tPos);
        let hdg = lerpAngle(prev.hdg, target.hdg, smoothstep(t));
        let renderTrack: TrackPlacement | undefined;

        // A metro train that stayed on the same track between two snapshots is
        // moved *along* it: interpolating arc length and reading the position
        // back off the geometry keeps the train in its tunnel through curves,
        // where interpolating the endpoints would cut straight across them.
        if (
          target.track &&
          prev.track &&
          prev.track.line === target.track.line &&
          prev.track.index === target.track.index
        ) {
          const track = metroTracksRef.current[target.track.line]?.[target.track.index];
          if (track) {
            const distance = lerp(prev.track.distance, target.track.distance, tPos);
            const point = pointOnTrack(track, distance);
            lat = point.lat;
            lng = point.lng;
            // Face along the track. A standing train keeps the heading it had:
            // the tangent alone cannot say which end is the front.
            hdg = target.track.forward ? point.bearing : (point.bearing + 180) % 360;
            renderTrack = { ...target.track, distance };
          }
        } else if (target.track) {
          // No shared track to slide along — the train has only just appeared,
          // or it changed pattern — so this frame falls back to the straight
          // interpolation above. The placement is still carried forward so the
          // next snapshot can resume along-track motion immediately; a line's
          // patterns run within a few metres of each other, so the distance is
          // at most that far out for the one frame it is used.
          renderTrack = target.track;
        }

        rendered[id] = { lat, lng, hdg, track: renderTrack };

        const doorsOpen = tramInfo?.drst === 1;
        // Normalise speed to 0..1 for the aura sizing. Capped low (~8 m/s ≈ 29 km/h)
        // so the aura reaches its full, clearly-visible size at ordinary city-tram
        // cruising speeds rather than only when a vehicle is racing.
        const speedNorm = clamp(spd / 8, 0, 1);

        return {
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
          },
        };
      });

      renderedPositionsRef.current = rendered;

      const source = map.getSource('trams') as maplibregl.GeoJSONSource;
      if (source) {
        source.setData({
          type: 'FeatureCollection',
          features,
        });
      }

      // Update next stop highlight and route line segment
      let selectedVehiclePos: [number, number] | null = null;
      let nextStopCoords: [number, number] | null = null;
      let routeSegmentCoords: [number, number][] = [];

      if (selectedTramIdRef.current && selectedTripDetailsRef.current) {
        const selectedTram = latestTramsRef.current[selectedTramIdRef.current];
        if (selectedTram) {
          const activeFeature = features.find((f) => f.properties.veh === selectedTramIdRef.current);
          if (activeFeature) {
            selectedVehiclePos = activeFeature.geometry.coordinates as [number, number];
          }

          const isStopped = selectedTram.drst === 1;
          const hasExplicitStop = !!selectedTram.stop;
          if (selectedTram.stop) {
            lastSeenStopIdRef.current = selectedTram.stop;
          }
          const stopIdToMatch = selectedTram.stop || lastSeenStopIdRef.current;
          const tripStops = selectedTripDetailsRef.current.stops;

          let lastKnownIndex = -1;
          if (stopIdToMatch) {
            const cleanToMatch = stopIdToMatch.replace(/^HSL:/, '');
            lastKnownIndex = tripStops.findIndex(s => s.gtfsId === stopIdToMatch || s.gtfsId?.replace(/^HSL:/, '') === cleanToMatch);
          }

          let nextStopIndex: number;

          if (lastKnownIndex === -1) {
            // Fallback: Estimate position based on arrival times
            const now = new Date();
            const currentMinutes = now.getHours() * 60 + now.getMinutes();

            nextStopIndex = tripStops.findIndex(stop => {
              const [h, m] = stop.realtimeArrival.split(':').map(Number);
              const stopMinutes = h * 60 + m;
              return stopMinutes >= currentMinutes;
            });
          } else {
            if (hasExplicitStop) {
              if (isStopped) {
                // Doors open: we are currently at lastKnownIndex
                nextStopIndex = lastKnownIndex + 1 < tripStops.length ? lastKnownIndex + 1 : -1;
              } else {
                // Doors closed: physically at/arriving at lastKnownIndex, but doors closed
                nextStopIndex = lastKnownIndex;
              }
            } else {
              // Between stops: we departed lastKnownIndex (which was lastStopId)
              nextStopIndex = lastKnownIndex + 1 < tripStops.length ? lastKnownIndex + 1 : -1;
            }
          }

          if (nextStopIndex !== -1) {
            const matchedStop = tripStops[nextStopIndex];
            nextStopCoords = [matchedStop.lon, matchedStop.lat];

            if (HIGHLIGHT_NEXT_STOP_ROUTE && selectedVehiclePos && selectedTripDetailsRef.current.geometry) {
              const polylineCoords = decodePolyline(selectedTripDetailsRef.current.geometry);

              if (polylineCoords.length > 0) {
                const getClosestPointIndex = (coords: [number, number][], target: [number, number]): number => {
                  let minD = Infinity;
                  let index = 0;
                  for (let i = 0; i < coords.length; i++) {
                    const d = Math.pow(coords[i][0] - target[0], 2) + Math.pow(coords[i][1] - target[1], 2);
                    if (d < minD) {
                      minD = d;
                      index = i;
                    }
                  }
                  return index;
                };

                const idxTram = getClosestPointIndex(polylineCoords, selectedVehiclePos);
                const idxStop = getClosestPointIndex(polylineCoords, nextStopCoords);

                const startIdx = Math.min(idxTram, idxStop);
                const endIdx = Math.max(idxTram, idxStop);
                const slice = polylineCoords.slice(startIdx, endIdx + 1);

                routeSegmentCoords = [selectedVehiclePos, ...slice, nextStopCoords];
              } else {
                routeSegmentCoords = [selectedVehiclePos, nextStopCoords];
              }
            }
          }
        }
      }

      // Update next stop highlight source
      const nextStopSource = map.getSource('next-stop-highlight-source') as maplibregl.GeoJSONSource;
      if (nextStopSource) {
        let nextStopMode = 'TRAM';
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

      // Update route line source
      const routeSource = map.getSource('next-stop-route') as maplibregl.GeoJSONSource;
      if (routeSource) {
        routeSource.setData({
          type: 'FeatureCollection',
          features: routeSegmentCoords.length > 0 ? [{
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: routeSegmentCoords,
            },
            properties: {},
          }] : [],
        });
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

    // Filter trams based on line filters
    const filteredTrams = Object.entries(trams).filter((entry) => {
      const tram = entry[1];
      if (lineFilters.length === 0) return true;
      return lineFilters.includes(tram.desi);
    });

    filteredTrams.forEach(([id, tram]) => {
      const previous = targetPositionsRef.current[id];

      // Metro trains are drawn on their tracks, not where the (largely
      // underground, therefore dead-reckoned) feed claims they are.
      const snapped =
        tram.mode === 'metro' ? placeOnMetroTrack(tram, previous?.track) : null;
      const target: RenderPosition = snapped
        ? { lat: snapped.lat, lng: snapped.lng, hdg: snapped.hdg, track: snapped.track }
        : { lat: tram.lat, lng: tram.lng, hdg: tram.hdg };

      // Start the next glide from what is on screen right now — mid-glide when
      // an update lands early, the last target when it lands on time — so a
      // correction is eased in rather than snapped back to.
      newPrev[id] = renderedPositionsRef.current[id] || previous || target;
      newTarget[id] = target;
    });

    prevPositionsRef.current = newPrev;
    targetPositionsRef.current = newTarget;
    lastUpdateRef.current = now;
  }, [trams, lineFilters]);

  // Setup programmatically created sources, layers, and images
  const interactionsBoundMapRef = useRef<maplibregl.Map | null>(null);
  const setupCustomMapElements = (map: maplibregl.Map) => {
    if (!apiKey) return;

    // 1. Directional vehicle-body markers. Instead of a bare dot + arrow, each
    //    vehicle is a little top-down carriage: a rounded body with a windshield
    //    and a nose nub so heading reads at a glance (the icon rotates to `hdg`).
    //    Trams are sleek (large corner radius, HSL green); buses are boxier (HSL
    //    blue). A "-open" variant swaps the flush side windows for amber door
    //    gaps, shown while the real doors are open (`drst === 1`).
    const registerVehicleImage = (name: string, svg: string) => {
      if (map.hasImage(name)) return;
      const img = new Image(40, 40);
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

    // Create Sign Tram Image if missing
    if (!map.hasImage('sign-tram')) {
      const tramSvg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="42" viewBox="0 0 32 42" fill="none">
          <line x1="16" y1="26" x2="16" y2="40" stroke="#111827" stroke-width="2.5" stroke-linecap="round"/>
          <circle cx="16" cy="14" r="11" fill="#00985f" stroke="#ffffff" stroke-width="2"/>
          <rect x="11.5" y="8" width="9" height="10" rx="1.5" fill="white"/>
          <rect x="12.5" y="9.5" width="7" height="3" fill="#00985f"/>
          <circle cx="13.5" cy="15.2" r="0.8" fill="#00985f"/>
          <circle cx="18.5" cy="15.2" r="0.8" fill="#00985f"/>
          <path d="M16,8 L16,5.5 M13.5,5.5 L18.5,5.5" stroke="white" stroke-width="0.8"/>
        </svg>
      `;
      const tramImg = new Image(32, 42);
      tramImg.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(tramSvg);
      tramImg.onload = () => {
        if (mapRef.current !== map) return;
        if (!map.hasImage('sign-tram')) map.addImage('sign-tram', tramImg);
      };
    }

    // Create Sign Bus Image if missing
    if (!map.hasImage('sign-bus')) {
      const busSvg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="42" viewBox="0 0 32 42" fill="none">
          <line x1="16" y1="26" x2="16" y2="40" stroke="#111827" stroke-width="2.5" stroke-linecap="round"/>
          <circle cx="16" cy="14" r="11" fill="#007ac9" stroke="#ffffff" stroke-width="2"/>
          <rect x="10.5" y="9" width="11" height="9" rx="1.5" fill="white"/>
          <rect x="11.5" y="10.5" width="9" height="3" fill="#007ac9"/>
          <circle cx="12.5" cy="15.7" r="0.8" fill="#007ac9"/>
          <circle cx="19.5" cy="15.7" r="0.8" fill="#007ac9"/>
        </svg>
      `;
      const busImg = new Image(32, 42);
      busImg.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(busSvg);
      busImg.onload = () => {
        if (mapRef.current !== map) return;
        if (!map.hasImage('sign-bus')) map.addImage('sign-bus', busImg);
      };
    }

    // Create Sign Bus Trunk Image if missing
    if (!map.hasImage('sign-bus-trunk')) {
      const busTrunkSvg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="42" viewBox="0 0 32 42" fill="none">
          <line x1="16" y1="26" x2="16" y2="40" stroke="#111827" stroke-width="2.5" stroke-linecap="round"/>
          <circle cx="16" cy="14" r="11" fill="#CA4300" stroke="#ffffff" stroke-width="2"/>
          <rect x="10.5" y="9" width="11" height="9" rx="1.5" fill="white"/>
          <rect x="11.5" y="10.5" width="9" height="3" fill="#CA4300"/>
          <circle cx="12.5" cy="15.7" r="0.8" fill="#CA4300"/>
          <circle cx="19.5" cy="15.7" r="0.8" fill="#CA4300"/>
        </svg>
      `;
      const busTrunkImg = new Image(32, 42);
      busTrunkImg.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(busTrunkSvg);
      busTrunkImg.onload = () => {
        if (!map.hasImage('sign-bus-trunk')) map.addImage('sign-bus-trunk', busTrunkImg);
      };
    }

    // Create Sign Metro Image if missing
    if (!map.hasImage('sign-metro')) {
      const metroSvg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="42" viewBox="0 0 32 42" fill="none">
          <line x1="16" y1="26" x2="16" y2="40" stroke="#111827" stroke-width="2.5" stroke-linecap="round"/>
          <circle cx="16" cy="14" r="11" fill="#FF6319" stroke="#ffffff" stroke-width="2"/>
          <path d="M11 19 L11 9 L16 15.5 L21 9 L21 19" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        </svg>
      `;
      const metroImg = new Image(32, 42);
      metroImg.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(metroSvg);
      metroImg.onload = () => {
        if (mapRef.current !== map) return;
        if (!map.hasImage('sign-metro')) map.addImage('sign-metro', metroImg);
      };
    }

    // Create Sign Train Image if missing
    if (!map.hasImage('sign-train')) {
      const trainSvg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="42" viewBox="0 0 32 42" fill="none">
          <line x1="16" y1="26" x2="16" y2="40" stroke="#111827" stroke-width="2.5" stroke-linecap="round"/>
          <circle cx="16" cy="14" r="11" fill="#8C4799" stroke="#ffffff" stroke-width="2"/>
          <path d="M11.5 11.5 C11.5 9.3 13.5 8 16 8 C18.5 8 20.5 9.3 20.5 11.5 L20.5 17.5 C20.5 18.6 19.6 19.5 18.5 19.5 L13.5 19.5 C12.4 19.5 11.5 18.6 11.5 17.5 Z" fill="white"/>
          <rect x="12.8" y="10.4" width="6.4" height="3.2" rx="0.8" fill="#8C4799"/>
          <circle cx="13.8" cy="16.6" r="0.85" fill="#8C4799"/>
          <circle cx="18.2" cy="16.6" r="0.85" fill="#8C4799"/>
          <path d="M13 20.5 L11.5 22.5 M19 20.5 L20.5 22.5" stroke="white" stroke-width="1.1" stroke-linecap="round"/>
        </svg>
      `;
      const trainImg = new Image(32, 42);
      trainImg.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(trainSvg);
      trainImg.onload = () => {
        if (mapRef.current !== map) return;
        if (!map.hasImage('sign-train')) map.addImage('sign-train', trainImg);
      };
    }

    // Create Sign Metro Selected Image if missing (gold border)
    if (!map.hasImage('sign-metro-selected')) {
      const metroSelectedSvg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="42" viewBox="0 0 32 42" fill="none">
          <line x1="16" y1="26" x2="16" y2="40" stroke="#111827" stroke-width="2.5" stroke-linecap="round"/>
          <circle cx="16" cy="14" r="11" fill="#FF6319" stroke="#fdcb6e" stroke-width="2.8"/>
          <path d="M11 19 L11 9 L16 15.5 L21 9 L21 19" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        </svg>
      `;
      const metroImg = new Image(32, 42);
      metroImg.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(metroSelectedSvg);
      metroImg.onload = () => {
        if (!map.hasImage('sign-metro-selected')) map.addImage('sign-metro-selected', metroImg);
      };
    }

    // Create Sign Train Selected Image if missing (gold border)
    if (!map.hasImage('sign-train-selected')) {
      const trainSelectedSvg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="42" viewBox="0 0 32 42" fill="none">
          <line x1="16" y1="26" x2="16" y2="40" stroke="#111827" stroke-width="2.5" stroke-linecap="round"/>
          <circle cx="16" cy="14" r="11" fill="#8C4799" stroke="#fdcb6e" stroke-width="2.8"/>
          <path d="M11.5 11.5 C11.5 9.3 13.5 8 16 8 C18.5 8 20.5 9.3 20.5 11.5 L20.5 17.5 C20.5 18.6 19.6 19.5 18.5 19.5 L13.5 19.5 C12.4 19.5 11.5 18.6 11.5 17.5 Z" fill="white"/>
          <rect x="12.8" y="10.4" width="6.4" height="3.2" rx="0.8" fill="#8C4799"/>
          <circle cx="13.8" cy="16.6" r="0.85" fill="#8C4799"/>
          <circle cx="18.2" cy="16.6" r="0.85" fill="#8C4799"/>
          <path d="M13 20.5 L11.5 22.5 M19 20.5 L20.5 22.5" stroke="white" stroke-width="1.1" stroke-linecap="round"/>
        </svg>
      `;
      const trainImg = new Image(32, 42);
      trainImg.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(trainSelectedSvg);
      trainImg.onload = () => {
        if (!map.hasImage('sign-train-selected')) map.addImage('sign-train-selected', trainImg);
      };
    }

    // Create Sign Tram Selected Image if missing (gold border)
    if (!map.hasImage('sign-tram-selected')) {
      const tramSelectedSvg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="42" viewBox="0 0 32 42" fill="none">
          <line x1="16" y1="26" x2="16" y2="40" stroke="#111827" stroke-width="2.5" stroke-linecap="round"/>
          <circle cx="16" cy="14" r="11" fill="#00985f" stroke="#fdcb6e" stroke-width="2.8"/>
          <rect x="11.5" y="8" width="9" height="10" rx="1.5" fill="white"/>
          <rect x="12.5" y="9.5" width="7" height="3" fill="#00985f"/>
          <circle cx="13.5" cy="15.2" r="0.8" fill="#00985f"/>
          <circle cx="18.5" cy="15.2" r="0.8" fill="#00985f"/>
          <path d="M16,8 L16,5.5 M13.5,5.5 L18.5,5.5" stroke="white" stroke-width="0.8"/>
        </svg>
      `;
      const tramImg = new Image(32, 42);
      tramImg.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(tramSelectedSvg);
      tramImg.onload = () => {
        if (!map.hasImage('sign-tram-selected')) map.addImage('sign-tram-selected', tramImg);
      };
    }

    // Create Sign Bus Selected Image if missing (gold border)
    if (!map.hasImage('sign-bus-selected')) {
      const busSelectedSvg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="42" viewBox="0 0 32 42" fill="none">
          <line x1="16" y1="26" x2="16" y2="40" stroke="#111827" stroke-width="2.5" stroke-linecap="round"/>
          <circle cx="16" cy="14" r="11" fill="#007ac9" stroke="#fdcb6e" stroke-width="2.8"/>
          <rect x="10.5" y="9" width="11" height="9" rx="1.5" fill="white"/>
          <rect x="11.5" y="10.5" width="9" height="3" fill="#007ac9"/>
          <circle cx="12.5" cy="15.7" r="0.8" fill="#007ac9"/>
          <circle cx="19.5" cy="15.7" r="0.8" fill="#007ac9"/>
        </svg>
      `;
      const busImg = new Image(32, 42);
      busImg.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(busSelectedSvg);
      busImg.onload = () => {
        if (!map.hasImage('sign-bus-selected')) map.addImage('sign-bus-selected', busImg);
      };
    }

    // Create Sign Bus Trunk Selected Image if missing (gold border)
    if (!map.hasImage('sign-bus-trunk-selected')) {
      const busTrunkSelectedSvg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="42" viewBox="0 0 32 42" fill="none">
          <line x1="16" y1="26" x2="16" y2="40" stroke="#111827" stroke-width="2.5" stroke-linecap="round"/>
          <circle cx="16" cy="14" r="11" fill="#CA4300" stroke="#fdcb6e" stroke-width="2.8"/>
          <rect x="10.5" y="9" width="11" height="9" rx="1.5" fill="white"/>
          <rect x="11.5" y="10.5" width="9" height="3" fill="#CA4300"/>
          <circle cx="12.5" cy="15.7" r="0.8" fill="#CA4300"/>
          <circle cx="19.5" cy="15.7" r="0.8" fill="#CA4300"/>
        </svg>
      `;
      const busTrunkImg = new Image(32, 42);
      busTrunkImg.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(busTrunkSelectedSvg);
      busTrunkImg.onload = () => {
        if (!map.hasImage('sign-bus-trunk-selected')) map.addImage('sign-bus-trunk-selected', busTrunkImg);
      };
    }

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
          'line-color': mapThemeRef.current === 'dark' ? '#0b1220' : '#ffffff',
          'line-width': ROUTE_CASING_WIDTH,
          'line-offset': ROUTE_LINE_OFFSET,
          'line-opacity': ['case', ['get', 'dim'], 0.3, 0.85],
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
        filter: ['==', ['get', 'veh'], selectedTramIdRef.current || ''],
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
        minzoom: 13,
        maxzoom: 15.5,
        filter: [
          'all',
          ['!', ['get', 'isTrunkStop']],
          ['match', ['get', 'mode'], 'BUS', true, false]
        ] as maplibregl.FilterSpecification,
        paint: {
          'circle-color': '#007ac9',
          'circle-radius': [
            'interpolate',
            ['exponential', 1.15],
            ['zoom'],
            12, 1,
            22, 24
          ]
        }
      }, 'trams-circles');
    }

    if (!map.getLayer('stops_trunk')) {
      map.addLayer({
        id: 'stops_trunk',
        type: 'circle',
        source: 'stops',
        'source-layer': 'stops',
        minzoom: 13,
        maxzoom: 15.5,
        filter: ['all', ['get', 'isTrunkStop'], ['match', ['get', 'mode'], 'BUS', true, false]] as maplibregl.FilterSpecification,
        paint: {
          'circle-color': '#007ac9',
          'circle-radius': [
            'interpolate',
            ['exponential', 1.15],
            ['zoom'],
            12, 1,
            22, 24
          ]
        }
      }, 'trams-circles');
    }

    if (!map.getLayer('stops_tram')) {
      map.addLayer({
        id: 'stops_tram',
        type: 'circle',
        source: 'stops',
        'source-layer': 'stops',
        minzoom: 13,
        maxzoom: 15.5,
        filter: ['match', ['get', 'mode'], 'TRAM', true, false],
        paint: {
          'circle-color': '#00985f',
          'circle-radius': [
            'interpolate',
            ['exponential', 1.15],
            ['zoom'],
            12, 1,
            22, 24
          ]
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
        minzoom: 12,
        maxzoom: 15.5,
        filter: ['==', STOP_MODE, 'SUBWAY'] as maplibregl.FilterSpecification,
        paint: {
          'circle-color': '#FF6319',
          'circle-radius': [
            'interpolate',
            ['exponential', 1.15],
            ['zoom'],
            12, 2,
            22, 26
          ]
        }
      }, 'trams-circles');
    }

    if (!map.getLayer('stops_train')) {
      map.addLayer({
        id: 'stops_train',
        type: 'circle',
        source: 'stops',
        'source-layer': 'stops',
        minzoom: 12,
        maxzoom: 15.5,
        filter: ['==', STOP_MODE, 'RAIL'] as maplibregl.FilterSpecification,
        paint: {
          'circle-color': '#8C4799',
          'circle-radius': [
            'interpolate',
            ['exponential', 1.15],
            ['zoom'],
            12, 2,
            22, 26
          ]
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
            'sign-bus'
          ],

          'icon-anchor': 'bottom',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-size': [
            'interpolate',
            ['linear'],
            ['zoom'],
            15, 0.8,
            20, 1.2
          ]
        }
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

    // 13. Availability gauge images: a donut whose coloured arc shows how full
    // the station is (bikes / total docks) and whose colour flags scarcity —
    // grey empty, red almost gone, amber middling, green plenty. Rendered once
    // per fill bucket and picked per-station via a data expression below, so the
    // marker reads as an at-a-glance gauge rather than a bare number.
    const gaugeBuckets: Array<{ name: string; fill: number; color: string }> = [
      { name: 'bike-gauge-0', fill: 0, color: '#9ca3af' },   // no bikes left
      { name: 'bike-gauge-1', fill: 0.2, color: '#ef4444' }, // critically low
      { name: 'bike-gauge-2', fill: 0.4, color: '#fcbc19' }, // getting low
      { name: 'bike-gauge-3', fill: 0.6, color: '#fcbc19' }, // moderate
      { name: 'bike-gauge-4', fill: 0.8, color: '#20bf6b' }, // healthy
      { name: 'bike-gauge-5', fill: 1, color: '#20bf6b' },   // plenty / full
    ];
    const gaugeR = 15;
    const gaugeC = 2 * Math.PI * gaugeR;
    for (const b of gaugeBuckets) {
      if (map.hasImage(b.name)) continue;
      const arc = b.fill > 0
        ? `<circle cx="22" cy="22" r="${gaugeR}" fill="none" stroke="${b.color}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${b.fill * gaugeC} ${gaugeC}" transform="rotate(-90 22 22)"/>`
        : '';
      const gaugeSvg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44" fill="none">
          <circle cx="22" cy="22" r="${gaugeR}" fill="none" stroke="#e5e7eb" stroke-width="5"/>
          ${arc}
          <circle cx="22" cy="22" r="11" fill="#ffffff" stroke="${b.color}" stroke-width="1.5"/>
        </svg>
      `;
      const gaugeImg = new Image(44, 44);
      gaugeImg.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(gaugeSvg);
      // pixelRatio 2 keeps the donut crisp; the 44px art displays at ~22 CSS px.
      gaugeImg.onload = ((name: string, img: HTMLImageElement) => () => {
        if (mapRef.current !== map) return;
        if (!map.hasImage(name)) map.addImage(name, img, { pixelRatio: 2 });
      })(b.name, gaugeImg);
    }

    // 14. Citybike gauge layer — one marker per station across all zooms, with
    // the available-bike count in the centre once zoomed in enough to read it.
    if (!map.getLayer('citybike_gauge')) {
      map.addLayer({
        id: 'citybike_gauge',
        type: 'symbol',
        source: 'citybike',
        minzoom: 13,
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
            13, 0.45,
            14, 0.6,
            15.5, 0.85,
            17, 1.05
          ],
          'text-field': ['to-string', ['coalesce', ['get', 'bikesAvailable'], 0]],
          'text-font': ['Gotham Rounded Medium'],
          'text-size': [
            'interpolate',
            ['linear'],
            ['zoom'],
            13, 0,
            13.8, 9,
            16, 12.5
          ],
          'text-allow-overlap': ['step', ['zoom'], false, 15, true],
        },
        paint: {
          'text-color': '#1e293b',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.2,
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

    // 15. Traffic-light junction markers (Helsinki open data, CC BY 4.0 — see
    // the "Waiting at traffic lights" popup badge). This is a static
    // reference layer, so it's populated once from `trafficLightsDataRef`
    // rather than polled like citybike availability.
    if (!map.getSource('traffic-lights')) {
      map.addSource('traffic-lights', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: trafficLightsDataRef.current },
      });
    }

    if (!map.hasImage('traffic-light-icon')) {
      const signalSvg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="24" viewBox="0 0 18 24" fill="none">
          <rect x="4" y="1" width="10" height="17" rx="3" fill="#1f2937" stroke="#ffffff" stroke-width="1.2"/>
          <circle cx="9" cy="5.5" r="2" fill="#ef4444"/>
          <circle cx="9" cy="9.5" r="2" fill="#fcbc19"/>
          <circle cx="9" cy="13.5" r="2" fill="#20bf6b"/>
          <line x1="9" y1="18" x2="9" y2="23" stroke="#1f2937" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      `;
      const signalImg = new Image(18, 24);
      signalImg.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(signalSvg);
      signalImg.onload = () => {
        if (mapRef.current !== map) return;
        if (!map.hasImage('traffic-light-icon')) map.addImage('traffic-light-icon', signalImg, { pixelRatio: 2 });
      };
    }

    if (!map.hasImage('warning-light-icon')) {
      const warningSvg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="24" viewBox="0 0 18 24" fill="none">
          <path d="M9 1.5 L16.5 15.5 A2 2 0 0 1 14.7 18.5 L3.3 18.5 A2 2 0 0 1 1.5 15.5 Z" fill="#fcbc19" stroke="#ffffff" stroke-width="1.2"/>
          <circle cx="9" cy="10" r="1.4" fill="#1f2937"/>
          <rect x="8.2" y="5.5" width="1.6" height="3.5" rx="0.8" fill="#1f2937"/>
          <line x1="9" y1="18.5" x2="9" y2="23" stroke="#1f2937" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      `;
      const warningImg = new Image(18, 24);
      warningImg.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(warningSvg);
      warningImg.onload = () => {
        if (mapRef.current !== map) return;
        if (!map.hasImage('warning-light-icon')) map.addImage('warning-light-icon', warningImg, { pixelRatio: 2 });
      };
    }

    // Street-level only: 557+ points citywide would clutter the overview.
    if (!map.getLayer('traffic-lights-icons')) {
      map.addLayer({
        id: 'traffic-lights-icons',
        type: 'symbol',
        source: 'traffic-lights',
        minzoom: 15,
        layout: {
          'icon-image': [
            'match',
            ['get', 'type'],
            'warning_light', 'warning-light-icon',
            'traffic-light-icon'
          ],
          'icon-anchor': 'bottom',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-size': [
            'interpolate',
            ['linear'],
            ['zoom'],
            15, 0.55,
            18, 0.85
          ]
        },
        paint: {
          'icon-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            15, 0,
            15.5, 1
          ]
        }
      }, 'trams-circles');
    }

    // Source for selected vehicle to next stop route
    if (!map.getSource('next-stop-route')) {
      map.addSource('next-stop-route', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [],
        },
      });
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
            10, 0.5,
            14, 0.8,
            16, 1.0,
            20, 1.5
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
            10, 0.5,
            14, 0.8,
            16, 1.0,
            20, 1.5
          ]
        }
      }, 'trams-circles');
    }

    // Route segment to next stop layer (rendered under trams-circles)
    if (HIGHLIGHT_NEXT_STOP_ROUTE && !map.getLayer('next-stop-route-layer')) {
      map.addLayer({
        id: 'next-stop-route-layer',
        type: 'line',
        source: 'next-stop-route',
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': '#fdcb6e', // gold-yellow matching selection border
          'line-width': 7.5,
          'line-opacity': 0.9,
        },
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
    updateRouteVisibility(
      map,
      showTramsRef.current,
      showBusesRef.current,
      showMetroRef.current,
      showTrainsRef.current,
      lineFiltersRef.current,
      selectedLineRef.current,
      Object.keys(routeGeometriesRef.current),
    );
    update3DMode(map, is3DRef.current, mapThemeRef.current);

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


    // Fade out circle stop layers when zooming in (zoom >= 15.5)
    const circleLayers = [
      'stops_tram',
      'stops_bus',
      'stops_trunk',
      'stops_lrail',
      'stops_subway',
      'stops_ferry',
      'stops_rail',
      'stops_metro',
      'stops_train'
    ];
    circleLayers.forEach((layerId) => {
      if (map.getLayer(layerId)) {
        map.setPaintProperty(layerId, 'circle-opacity', [
          'interpolate',
          ['linear'],
          ['zoom'],
          15.0, 1.0,
          15.5, 0.0
        ]);
      }
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

    // Mouse Hover Effects
    const setCursorPointer = () => (map.getCanvas().style.cursor = 'pointer');
    const resetCursor = () => (map.getCanvas().style.cursor = '');

    map.on('mouseenter', 'trams-body', setCursorPointer);
    map.on('mouseleave', 'trams-body', resetCursor);
    map.on('mouseenter', 'trams-circles', setCursorPointer);
    map.on('mouseleave', 'trams-circles', resetCursor);
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
    map.on('mouseenter', 'citybike_gauge', setCursorPointer);
    map.on('mouseleave', 'citybike_gauge', resetCursor);
  };

  // Initial Map Setup
  useEffect(() => {
    if (apiKey === null) return;
    if (!mapContainerRef.current) return;

    const initialTheme = mapThemeRef.current;
    const initialStyleUrl = initialTheme === 'light'
      ? `${window.location.origin}/style.json`
      : 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

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
    const styleUrl = mapTheme === 'light'
      ? `${window.location.origin}/style.json`
      : 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
    map.setStyle(styleUrl);
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
    const src = map?.getSource('traffic-lights') as maplibregl.GeoJSONSource | undefined;
    if (src && typeof src.setData === 'function') {
      src.setData({ type: 'FeatureCollection', features: trafficLightFeatures } as unknown as FeatureCollection);
    }
  }, [trafficLightFeatures]);

  // Update selection ring filter
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (map.getStyle() && map.getLayer('trams-selected-layer')) {
      map.setFilter('trams-selected-layer', ['==', ['get', 'veh'], selectedTramId || '']);
    } else {
      console.warn('[Map] trams-selected-layer not found');
    }
  }, [selectedTramId]);

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
    journeyLegsRef.current = journeyLegs;
    journeyEndpointsRef.current = journeyEndpoints;

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

  // Dynamic Route visibility changes: the background network respects the
  // per-mode Trams/Buses toggles, gives way to the highlighted ribbons wherever
  // those cover the same mode, and is hidden altogether once the user narrows to
  // specific lines.
  useEffect(() => {
    const map = mapRef.current;
    if (map && map.getStyle()) {
      updateRouteVisibility(
        map,
        showTrams,
        showBuses,
        showMetro,
        showTrains,
        lineFilters,
        selectedLine,
        Object.keys(routeGeometries),
      );
    }
  }, [lineFilters, showTrams, showBuses, showMetro, showTrains, selectedLine, routeGeometries]);

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


    // 1. Tram Stops
    if (map.getLayer('stops_tram')) {
      if (!showTrams) {
        map.setFilter('stops_tram', ['==', '1', '2']);
      } else if (activeRoutes.length === 0) {
        map.setFilter('stops_tram', [
          'all',
          ['==', ['get', 'mode'], 'TRAM'],
          excludeSelectedStopFilter
        ]);
      } else if (allowedStopIds.length === 0) {
        map.setFilter('stops_tram', ['==', '1', '2']);
      } else {
        map.setFilter('stops_tram', [
          'all',
          ['==', ['get', 'mode'], 'TRAM'],
          ['in', ['to-string', ['coalesce', ['get', 'gtfsId'], ['get', 'stopId'], ['get', 'id'], ['id'], '']], ['literal', allowedStopIds]],
          excludeSelectedStopFilter
        ]);
      }
    }

    // 2. Metro and commuter-train stations. Same shape as the tram-stop filter
    //    above: hidden with their mode toggle off, narrowed to the highlighted
    //    lines' stations while a line filter or vehicle selection is active.
    const stationLayers: Array<{ id: string; mode: string; show: boolean }> = [
      { id: 'stops_metro', mode: 'SUBWAY', show: showMetro },
      { id: 'stops_train', mode: 'RAIL', show: showTrains },
    ];
    stationLayers.forEach(({ id, mode, show }) => {
      if (!map.getLayer(id)) return;
      if (!show) {
        map.setFilter(id, ['==', '1', '2']);
      } else if (activeRoutes.length === 0) {
        map.setFilter(id, [
          'all',
          ['==', STOP_MODE, mode],
          excludeSelectedStopFilter
        ]);
      } else if (allowedStopIds.length === 0) {
        map.setFilter(id, ['==', '1', '2']);
      } else {
        map.setFilter(id, [
          'all',
          ['==', STOP_MODE, mode],
          ['in', ['to-string', ['coalesce', ['get', 'gtfsId'], ['get', 'stopId'], ['get', 'id'], ['id'], '']], ['literal', allowedStopIds]],
          excludeSelectedStopFilter
        ]);
      }
    });

    // 3. Bus and Trunk Stop POIs
    const busStopLayers = ['stops_bus', 'stops_trunk'];
    busStopLayers.forEach((layerId) => {
      if (map.getLayer(layerId)) {
        if (!showBuses) {
          map.setLayoutProperty(layerId, 'visibility', 'none');
        } else if (activeRoutes.length === 0) {
          map.setLayoutProperty(layerId, 'visibility', 'visible');
          map.setFilter(layerId, [
            'all',
            ['==', ['get', 'mode'], 'BUS'],
            excludeSelectedStopFilter
          ]);
        } else if (allowedStopIds.length === 0) {
          map.setLayoutProperty(layerId, 'visibility', 'none');
        } else {
          map.setLayoutProperty(layerId, 'visibility', 'visible');
          map.setFilter(layerId, [
            'all',
            ['==', ['get', 'mode'], 'BUS'],
            ['in', ['to-string', ['coalesce', ['get', 'gtfsId'], ['get', 'stopId'], ['get', 'id'], ['id'], '']], ['literal', allowedStopIds]],
            excludeSelectedStopFilter
          ]);
        }
      }
    });

    // 4. Stops Signs Symbol Layer
    const signModes: string[] = [];
    if (showTrams) signModes.push('TRAM');
    if (showBuses) signModes.push('BUS');
    if (showMetro) signModes.push('SUBWAY');
    if (showTrains) signModes.push('RAIL');

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
  }, [lineFilters, selectedTramId, trams, routeGeometries, showTrams, showBuses, showMetro, showTrains, selectedStopId]);

  return (
    <div className="map-wrapper">
      <div ref={mapContainerRef} className="map-container" />
      {webglFailed && (
        <div className="map-unsupported" role="alert">
          <p>This map needs WebGL2, which this browser or device does not support.</p>
        </div>
      )}
    </div>
  );
};
