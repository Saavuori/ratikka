import { BIKE_3D_MIN_ZOOM, BIKE_STATION_LIMIT, BIKE_STATION_SOURCE, bikeStationCollection } from '../../lib/bikeStationModels';
import type { BikeStationState } from '../../lib/bikeStationModels';
import { STOP_3D_MIN_ZOOM, STOP_FURNITURE_LIMIT, STOP_FURNITURE_SOURCE, longestEdgeBearing, nearestLineBearing, pointInRing, stopFurnitureCollection } from '../../lib/stopModels';
import type { StopFurnitureState } from '../../lib/stopModels';
import { PLATFORM_FILL_LAYER } from '../../lib/stopPlatforms';
import { vehicles3DEnabled } from '../../lib/vehicleAnimation';
import type * as maplibregl from 'maplibre-gl';
import type { MapTheme } from '../../lib/stopPlatforms';
import type { OverlayState } from './state';
import type { BikeStationsFeatureCollection } from '../../types';

/** What the furniture is drawn for, as of now. */
export interface FurnitureInputs {
  is3D: boolean;
  always3DVehicles: boolean;
  /** The stop a selected vehicle is heading for, from the animation state. */
  stopHighlight: {
    key: string;
    stopId: string | null;
    boarding: boolean;
    coords: [number, number] | null;
  };
  bikeStations: BikeStationsFeatureCollection | null;
  selectedBikeStationId: string | null;
}

export function updateStopFurniture(
  map: maplibregl.Map,
  theme: MapTheme,
  state: OverlayState,
  live: FurnitureInputs,
) {
  const source = map.getSource(STOP_FURNITURE_SOURCE) as maplibregl.GeoJSONSource | undefined;
  if (!source) return;
  const empty = { type: 'FeatureCollection' as const, features: [] };

  const active =
    vehicles3DEnabled(live.is3D, live.always3DVehicles) &&
    map.getZoom() >= STOP_3D_MIN_ZOOM &&
    map.getLayer('stops_signs') !== undefined;
  if (!active) {
    if (state.stopFurniture.drawn) {
      source.setData(empty);
      state.stopFurniture.drawn = false;
      state.stopFurniture.sig = '';
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
    live.stopHighlight.key,
  ].join('|');
  if (signature === state.stopFurniture.sig) return;
  state.stopFurniture.sig = signature;

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

  const highlightId = live.stopHighlight.stopId?.replace(/^HSL:/, '') ?? null;
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
        boarding: live.stopHighlight.boarding && stopId === highlightId,
      },
      distance: Math.hypot(lng - centre.lng, lat - centre.lat),
    });
  }

  // A dense view can hold hundreds of stops, each several polygons. Nearest
  // to the middle of the screen wins, which is where the eye is.
  stops.sort((a, b) => a.distance - b.distance);
  const states = stops.slice(0, STOP_FURNITURE_LIMIT).map((s) => s.state);
  state.stopFurniture.meta = meta;
  source.setData(stopFurnitureCollection(states, theme));
  state.stopFurniture.drawn = true;
}

// The city-bike counterpart to `updateStopFurniture`: turn the stations the
// gauge layer is drawing into racks of real-metre boxes. Same bookkeeping —
// built from what is on screen, capped, and skipped entirely when nothing
// that matters has moved.
export function updateBikeFurniture(
  map: maplibregl.Map,
  theme: MapTheme,
  state: OverlayState,
  live: FurnitureInputs,
) {
  const source = map.getSource(BIKE_STATION_SOURCE) as maplibregl.GeoJSONSource | undefined;
  if (!source) return;
  const empty = { type: 'FeatureCollection' as const, features: [] };

  const active =
    vehicles3DEnabled(live.is3D, live.always3DVehicles) &&
    map.getZoom() >= BIKE_3D_MIN_ZOOM &&
    map.getLayer('citybike_gauge') !== undefined;
  if (!active) {
    if (state.bikeFurniture.drawn) {
      source.setData(empty);
      state.bikeFurniture.drawn = false;
      state.bikeFurniture.sig = '';
    }
    return;
  }

  const centre = map.getCenter();
  const signature = [
    theme,
    centre.lng.toFixed(4),
    centre.lat.toFixed(4),
    map.getZoom().toFixed(2),
    live.selectedBikeStationId ?? '',
    // Availability is what the rack is made of, so a refresh has to rebuild
    // it even when the view has not moved.
    String(live.bikeStations?.features.length ?? 0),
    state.bikeFurniture.availabilityStamp,
  ].join('|');
  if (signature === state.bikeFurniture.sig) return;
  state.bikeFurniture.sig = signature;

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

  const selectedId = live.selectedBikeStationId ?? null;
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
  state.bikeFurniture.drawn = true;
}