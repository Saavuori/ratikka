import type { LayerSeed } from './seed';
// MapLibre GL 6 is ESM-only and dropped the default export.
import * as maplibregl from 'maplibre-gl';
import {
} from '../routeNetwork';
import {
  SELECTED_COLOR,
} from '../../lib/vehicleModels';
import {
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
} from '../../lib/trafficLightModels';

/** Signalised junctions, and which of them a vehicle is asking a green from. */
export function installTrafficLightLayers(map: maplibregl.Map, seed: LayerSeed): void {
    // Traffic-light junction markers (Helsinki open data, CC BY 4.0 — see
  // the "Waiting at traffic lights" popup badge). This is a static
  // reference layer, so it's populated once from `trafficLightsDataRef`
  // rather than polled like citybike availability.
  if (!map.getSource(TRAFFIC_LIGHT_SOURCE)) {
    map.addSource(TRAFFIC_LIGHT_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: seed.trafficLights },
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
      if (!seed.isCurrent(map)) return;
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
}
