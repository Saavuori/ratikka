import { ARRIVAL_LABEL_MIN_ZOOM, ARRIVAL_LABEL_STOP_LIMIT } from '../../lib/stopArrivals';
import { TRAFFIC_LIGHT_SOURCE, signalPriorityIndex } from '../../lib/trafficLightModels';
import { ARRIVAL_LABEL_SOURCE } from '../layers';
import type { FeatureCollection } from 'geojson';
import type * as maplibregl from 'maplibre-gl';
import type { OverlayState } from './state';
import type { Feature } from 'geojson';
import type { TrafficLightFeature, VehiclePosition } from '../../types';

/** What the labels and the junction markers are drawn from, as of now. */
export interface LabelInputs {
  /** Next-arrival text and colour per unprefixed stop id. */
  labels: Record<string, { label: string; color: string }>;
  vehicles: Record<string, VehiclePosition>;
  trafficLights: TrafficLightFeature[];
}

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
export function updateArrivalLabelStops(
  map: maplibregl.Map,
  state: OverlayState,
  live: LabelInputs,
  onVisibleStopsChange?: (stopIds: string[]) => void,
) {
  const gated = map.getZoom() < ARRIVAL_LABEL_MIN_ZOOM || !map.getLayer('stops_signs');
  if (gated) {
    if (state.arrivalLabels.stops.length > 0 || state.arrivalLabels.sig !== '') {
      state.arrivalLabels.stops = [];
      state.arrivalLabels.sig = '';
      drawArrivalLabels(map, state, live);
      onVisibleStopsChange?.([]);
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
  state.arrivalLabels.stops = nearest.map(({ stopId, lng, lat }) => ({ stopId, lng, lat }));
  drawArrivalLabels(map, state, live);
  if (signature !== state.arrivalLabels.sig) {
    state.arrivalLabels.sig = signature;
    onVisibleStopsChange?.(nearest.map((stop) => stop.stopId));
  }
}

/** Paint the labels for whichever visible stops have an arrival to show. */
export function drawArrivalLabels(map: maplibregl.Map, state: OverlayState, live: LabelInputs) {
  const source = map.getSource(ARRIVAL_LABEL_SOURCE) as maplibregl.GeoJSONSource | undefined;
  if (!source) return;
  const labels = live.labels ?? {};
  const features: Feature[] = [];
  for (const stop of state.arrivalLabels.stops) {
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
}

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
export function updateSignalPriority(map: maplibregl.Map, state: OverlayState, live: LabelInputs) {
  const priorities = signalPriorityIndex(Object.values(live.vehicles));
  const signature = Array.from(priorities.entries())
    .map(([junction, a]) => `${junction}:${a.vehicles.map((v) => `${v.status}:${v.veh}`).join(',')}`)
    .sort()
    .join('|');
  if (signature === state.signalPriority.sig) return;
  state.signalPriority.sig = signature;

  const source = map.getSource(TRAFFIC_LIGHT_SOURCE) as maplibregl.GeoJSONSource | undefined;
  if (source && typeof source.setData === 'function') {
    source.setData({
      type: 'FeatureCollection',
      features: live.trafficLights.map((feature) => {
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
}