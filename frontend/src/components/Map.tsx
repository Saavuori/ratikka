import React, { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Feature, FeatureCollection } from 'geojson';
import type { VehiclePosition, TripDetailsResponse, JourneyLeg, JourneyEndpoint } from '../types';
import { lerp, lerpAngle, clamp, smoothstep, easeByAccel } from '../lib/lerp';
import { decodePolyline } from '../lib/polyline';
import { getRouteColor, routeColorMatchExpression, ROUTE_COLORS, TRAM_GREEN } from '../lib/routeColors';
import { fetchBikeStations } from '../lib/api';
import type { BikeStationsFeatureCollection } from '../types';

// The gold route segment drawn from a selected vehicle to its next stop relies
// on closest-point matching against the trip polyline, which produced unreliable
// (jumping/back-tracking) paths. Disabled until the matching is made robust. The
// next-stop signpost highlight itself is unaffected and remains enabled.
const HIGHLIGHT_NEXT_STOP_ROUTE = false;

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
  mapTheme: 'light' | 'dark';
  is3D: boolean;
  isFollowing: boolean;
  onDisableFollowing: () => void;
  onMapBearingChange?: (bearing: number) => void;
  showTrams: boolean;
  showBuses: boolean;
  selectedTripDetails: TripDetailsResponse | null;
  journeyLegs?: JourneyLeg[] | null;
  journeyEndpoints?: { from: JourneyEndpoint; to: JourneyEndpoint } | null;
}

interface RenderPosition {
  lat: number;
  lng: number;
  hdg: number;
}

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
  mapTheme,
  is3D,
  isFollowing,
  onDisableFollowing,
  onMapBearingChange,
  showTrams,
  showBuses,
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
  const selectedStopIdRef = useRef<string | null>(selectedStopId);
  const selectedBikeStationIdRef = useRef<string | null>(selectedBikeStationId);
  const lineFiltersRef = useRef<string[]>(lineFilters);
  const showTramsRef = useRef<boolean>(showTrams);
  const showBusesRef = useRef<boolean>(showBuses);
  const is3DRef = useRef<boolean>(is3D);
  const mapThemeRef = useRef<'light' | 'dark'>(mapTheme);
  const isFollowingRef = useRef<boolean>(isFollowing);
  const isInteractingRef = useRef<boolean>(false);
  // Latest live city-bike station GeoJSON, refreshed on an interval. Kept in a
  // ref so a theme/style reload can re-seed the recreated source without
  // waiting for the next fetch.
  const bikeStationsDataRef = useRef<BikeStationsFeatureCollection | null>(null);

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
    is3DRef.current = is3D;
  }, [is3D]);

  useEffect(() => {
    mapThemeRef.current = mapTheme;
  }, [mapTheme]);

  useEffect(() => {
    isFollowingRef.current = isFollowing;
  }, [isFollowing]);

  // Helper to toggle visibility of the HSL background route network. The network
  // uses HSL's mode colours (green trams, blue buses) rather than our per-line
  // palette, and is scoped to just the tram and bus modes: tram routes follow the
  // Trams toggle, bus/trunk routes follow the Buses toggle, and other modes
  // (rail, subway, ferry) are never drawn here. The whole network is the
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
  const otherRouteLayers = [
    'route_ferry',
    'route_subway_case',
    'route_subway',
    'route_subway_underground',
    'route_rail_case',
    'route_rail',
  ];

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
  ] as unknown as maplibregl.LayerSpecification[];

  const ensureBackgroundRouteNetwork = (map: maplibregl.Map) => {
    // Add the JORE routes vector source if the base style doesn't provide it.
    if (!map.getSource('routes')) {
      map.addSource('routes', {
        type: 'vector',
        url: 'https://kartat.hsl.fi/jore/tiles/routes/index.json',
      });
    }

    // Keep the network beneath the highlighted route path and the vehicles.
    const beforeId = map.getLayer('route-lines-layer')
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
    setColor('route_tram', tramColor);
    setColor('route_tram_inner', tramColor);
    setColor('route_lrail', lrailColor);
    setColor('route_lrail_inner', lrailColor);
  };

  const updateRouteVisibility = (
    map: maplibregl.Map,
    show: boolean,
    trams: boolean,
    buses: boolean,
  ) => {
    const setVisible = (layerId: string, visible: boolean) => {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
      }
    };
    tramRouteLayers.forEach((layerId) => setVisible(layerId, show && trams));
    busRouteLayers.forEach((layerId) => setVisible(layerId, show && buses));
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

  // Helper to draw route geometries on the map
  const drawRouteGeometries = (map: maplibregl.Map, geometries: Record<string, { geometries: string[]; color?: string }>) => {
    const source = map.getSource('route-lines') as maplibregl.GeoJSONSource;
    if (!source) return;

    const features: { type: 'Feature'; geometry: { type: 'LineString'; coordinates: [number, number][] }; properties: { line: string; color: string } }[] = [];
    Object.entries(geometries).forEach(([line, data]) => {
      // Colour the highlighted route path by our per-line palette rather than
      // HSL's mode green (which is identical for every tram line).
      const colorHex = getRouteColor(line);

      data.geometries.forEach((poly) => {
        const coords = decodePolyline(poly);
        features.push({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: coords,
          },
          properties: {
            line: line,
            color: colorHex,
          },
        });
      });
    });

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

  // Animation references to run independent of React re-renders
  const prevPositionsRef = useRef<Record<string, RenderPosition>>({});
  const targetPositionsRef = useRef<Record<string, RenderPosition>>({});
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

      const features = Object.entries(targetPositionsRef.current).map(([id, target]) => {
        const prev = prevPositionsRef.current[id] || target;

        const tramInfo = latestTramsRef.current[id];
        const spd = tramInfo?.spd ?? 0;
        const acc = tramInfo?.acc ?? 0;

        // Shape position interpolation by acceleration so the on-screen motion
        // mirrors the physical vehicle: ease-in while accelerating away from a
        // stop, ease-out while braking into one. Heading eases smoothly.
        const tPos = easeByAccel(t, acc);
        const lat = lerp(prev.lat, target.lat, tPos);
        const lng = lerp(prev.lng, target.lng, tPos);
        const hdg = lerpAngle(prev.hdg, target.hdg, smoothstep(t));

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
      // If we already have a previous target, that becomes the start position for the next transition
      const currentPrev = targetPositionsRef.current[id];
      if (currentPrev) {
        newPrev[id] = currentPrev;
      } else {
        newPrev[id] = { lat: tram.lat, lng: tram.lng, hdg: tram.hdg };
      }
      newTarget[id] = { lat: tram.lat, lng: tram.lng, hdg: tram.hdg };
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

    // 6. Motion aura — the floor of the vehicle stack (kept as `trams-circles`
    //    so every other layer's `beforeId` anchor still resolves). A coloured glow
    //    under each vehicle that visualises how it is moving: it grows with speed
    //    (`speedNorm`) and is tinted by acceleration — green while pulling away, red
    //    while braking, mode-neutral while cruising. At a standstill it fades to
    //    nothing (the rear brake lights take over). Tuned to read at a glance:
    //    it snaps to a clearly-visible opacity as soon as a vehicle is moving and a
    //    tighter blur keeps the coloured disc defined rather than washed out.
    if (!map.getLayer('trams-circles')) {
      map.addLayer({
        id: 'trams-circles',
        type: 'circle',
        source: 'trams',
        paint: {
          // Radius is the larger of a zoom-driven "locator" floor and the
          // speed-driven size. Zoomed out the floor keeps every vehicle a solid,
          // findable dot even when stopped/crawling; zoomed in the floor drops
          // away and the aura grows with speed exactly as before.
          'circle-radius': [
            'max',
            ['interpolate', ['linear'], ['zoom'], 11, 9, 13.5, 5, 14.5, 0],
            ['interpolate', ['linear'], ['get', 'speedNorm'], 0, 11, 1, 23],
          ],
          'circle-color': [
            'case',
            ['>', ['get', 'acc'], 0.35], '#22c55e',  // accelerating -> green
            ['<', ['get', 'acc'], -0.35], '#ef4444', // braking -> red
            ['==', ['get', 'mode'], 'bus'], '#38bdf8',
            '#2dd4a7', // tram cruising
          ],
          // Crisper when zoomed out so the locator dot reads as a solid mark,
          // softening back to the diffuse motion glow once zoomed in.
          'circle-blur': ['interpolate', ['linear'], ['zoom'], 11, 0.12, 14.5, 0.4],
          // Opacity is the larger of a zoom-driven visibility floor and the
          // speed-driven fade. The floor makes the aura clearly visible when
          // zoomed out (regardless of speed); it fades to zero as you zoom in,
          // handing back to the original motion fade so a stopped vehicle's aura
          // still disappears (the rear brake lights mark it up close).
          'circle-opacity': [
            'max',
            ['interpolate', ['linear'], ['zoom'], 11, 0.9, 13.5, 0.6, 15, 0.0],
            [
              'interpolate', ['linear'], ['get', 'speedNorm'],
              0, 0.0,
              0.06, 0.45,
              1, 0.62,
            ],
          ],
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
          // Trams: pick the line-tinted body (open/closed variants), falling
          // back to the generic green body for lines outside the palette.
          'icon-image': [
            'case',
            ['==', ['get', 'mode'], 'bus'],
            ['case', ['get', 'doorsOpen'], 'bus-body-open', 'bus-body'],
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
    if (!map.getLayer('route-lines-layer')) {
      map.addLayer({
        id: 'route-lines-layer',
        type: 'line',
        source: 'route-lines',
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': ['coalesce', ['get', 'color'], '#10b981'],
          'line-width': 4.5,
          'line-opacity': 0.75,
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
            ['get', 'mode'],
            'TRAM', 'sign-tram',
            'BUS', 'sign-bus',
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
    drawRouteGeometries(map, routeGeometriesRef.current);

    // Restore any active journey after a style/theme change
    updateJourney(map, journeyLegsRef.current, journeyEndpointsRef.current, false);

    // Hide default bus stops from the vector style
    const busStopLayers = ['stops_bus', 'stops_trunk'];
    busStopLayers.forEach((layerId) => {
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

    // Apply active route visibility and 3D mode setting. The all-routes network
    // shows only while no line filter is active; selecting lines hides it and
    // leaves just those lines' highlighted paths.
    updateRouteVisibility(map, lineFiltersRef.current.length === 0, showTramsRef.current, showBusesRef.current);
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
      'stops_rail'
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
      const mode = feat.properties?.mode || 'TRAM';
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

  // Update route geometries on map
  useEffect(() => {
    const map = mapRef.current;
    if (map && map.getStyle() && map.getSource('route-lines')) {
      drawRouteGeometries(map, routeGeometries);
    }
  }, [routeGeometries]);

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

  // Dynamic Route visibility changes: the all-routes background network is drawn
  // whenever no line filter is active (and respects the per-mode Trams/Buses
  // toggles); selecting specific lines hides it so only those lines' highlighted
  // paths remain.
  useEffect(() => {
    const map = mapRef.current;
    if (map && map.getStyle()) {
      updateRouteVisibility(map, lineFilters.length === 0, showTrams, showBuses);
    }
  }, [lineFilters, showTrams, showBuses]);

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

    if (map.getLayer('stops_signs')) {
      if (signModes.length === 0) {
        map.setFilter('stops_signs', ['==', '1', '2']);
      } else if (activeRoutes.length === 0) {
        map.setFilter('stops_signs', [
          'all',
          ['in', ['get', 'mode'], ['literal', signModes]],
          excludeSelectedStopFilter
        ]);
      } else if (allowedStopIds.length === 0) {
        map.setFilter('stops_signs', ['==', '1', '2']);
      } else {
        map.setFilter('stops_signs', [
          'all',
          ['in', ['get', 'mode'], ['literal', signModes]],
          ['in', ['to-string', ['coalesce', ['get', 'gtfsId'], ['get', 'stopId'], ['get', 'id'], ['id'], '']], ['literal', allowedStopIds]],
          excludeSelectedStopFilter
        ]);
      }
    }
  }, [lineFilters, selectedTramId, trams, routeGeometries, showTrams, showBuses, selectedStopId]);

  return (
    <div className="map-wrapper">
      <div ref={mapContainerRef} className="map-container" />
    </div>
  );
};
