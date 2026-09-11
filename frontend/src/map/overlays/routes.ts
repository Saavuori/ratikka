import { decodePolyline } from '../../lib/polyline';
import { getRouteColor } from '../../lib/routeColors';
import { assignCorridorSlots, directionalPaths } from '../../lib/routeSlots';
import type { RoutePath } from '../../lib/routeSlots';
import type { JourneyEndpoint, JourneyLeg } from '../../types';
import type { Feature } from 'geojson';
import * as maplibregl from 'maplibre-gl';
import type { OverlayState } from './state';
function routePathsOf(
  line: string,
  src: string[],
  state: OverlayState,
): [number, number][][] {
  const cached = state.routePaths[line];
  if (cached && cached.src === src) return cached.paths;
  const paths = directionalPaths(src.map((poly) => decodePolyline(poly)));
  state.routePaths[line] = { src, paths };
  return paths;
}

// Helper to draw route geometries on the map.
//
// Lines sharing a street are fanned out into parallel ribbons via a per-feature
// offset slot (see lib/routeSlots) instead of being stacked pixel-on-pixel,
// where their colours used to blend into a muddy third colour. The selected
// vehicle's line keeps slot 0 — it stays on the true geometry while the others
// are pushed aside — and is drawn wider, opaque and on top, with the rest
// dimmed.
export function drawRouteGeometries(
  map: maplibregl.Map,
  geometries: Record<string, { geometries: string[]; color?: string }>,
  selectedLine: string | null,
  state: OverlayState,
) {
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
    routePathsOf(line, geometries[line].geometries, state).forEach((coords) =>
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
}

// Render a planned journey: coloured transit legs, dashed walk legs, the
// origin/destination markers, and highlighted board/alight/transfer/via stops.
export function updateJourney(
  map: maplibregl.Map,
  legs: JourneyLeg[] | null,
  endpoints: { from: JourneyEndpoint; to: JourneyEndpoint } | null,
  fitBounds: boolean
) {
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
}