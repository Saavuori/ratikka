import type { LayerSeed } from './seed';
// MapLibre GL 6 is ESM-only and dropped the default export.
import * as maplibregl from 'maplibre-gl';
import {
} from '../routeNetwork';
import { ARRIVAL_LABEL_MIN_ZOOM } from '../../lib/stopArrivals';
import {
  FERRY_CYAN,
} from '../../lib/routeColors';
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
} from '../../lib/stopPlatforms';
import type { MapTheme } from '../../lib/stopPlatforms';
import {
  STOP_3D_MIN_ZOOM,
  STOP_3D_FADE_IN,
  STOP_FURNITURE_SOURCE,
  STOP_FURNITURE_LAYER,
} from '../../lib/stopModels';
import {
  STOP_CIRCLE_MIN_ZOOM,
  STATION_CIRCLE_MIN_ZOOM,
  STOP_CIRCLE_FADE_ZOOM,
  STOP_CIRCLE_RADIUS,
  STATION_CIRCLE_RADIUS,
  STOP_CIRCLE_STROKE_WIDTH,
  STOP_CIRCLE_STROKE_COLOR,
  STOP_CIRCLE_OPACITY,
} from '../../lib/stopCircleStyle';
import { vehicles3DEnabled } from '../../lib/vehicleAnimation';

/**
 * A stop's mode, whichever of the two stop tilesets it came from: the JORE
 * tiles the light basemap ships (`mode`) or the Digitransit v3 stops the dark
 * theme falls back to (`type`). Both spell the modes the same — TRAM, BUS,
 * SUBWAY, RAIL — they just disagree about the property name.
 */
export const STOP_MODE: maplibregl.ExpressionSpecification = [
  'to-string',
  ['coalesce', ['get', 'mode'], ['get', 'type'], ''],
];

// The stop next-arrival labels. Their own source and layer, because they are
// the only stop annotation that is neither in the vector tiles nor a colour
// swap on something already drawn.
export const ARRIVAL_LABEL_SOURCE = 'stop-arrival-labels';
export const ARRIVAL_LABEL_LAYER = 'stop-arrival-labels-layer';
// The platform polygons the basemap ships: a stop is not a dot on a kerb but
// a paved island with a kerb (see lib/stopPlatforms). Added under the route
// ribbons so a highlighted line still reads across the platform it serves.
export const ensureStopPlatformLayers = (map: maplibregl.Map, theme: MapTheme) => {
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

export function installStopLayers(map: maplibregl.Map, seed: LayerSeed): void {
  const { theme } = seed;
  // Add HSL Transit Stops Source and Layers if missing (e.g. in dark mode CartoDB basemap)
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
        'text-color': theme === 'light' ? '#1f2937' : '#e5e7eb',
        'text-halo-color': theme === 'light' ? 'rgba(255,255,255,0.9)' : 'rgba(11,18,32,0.9)',
        'text-halo-width': 1.4,
      }
    }, 'trams-circles');
  }

  // 11a. Next-arrival labels above the sign boards. Anchored to its own
  //   GeoJSON source rather than the stop tiles, because the text comes
  //   from the departures feed, not from the tile.
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
        'text-halo-color': theme === 'light' ? 'rgba(255,255,255,0.92)' : 'rgba(11,18,32,0.92)',
        'text-halo-width': 1.6,
      },
    }, 'trams-circles');
  }

  // 11b. Stop platforms lifted out of the basemap, and the 3D furniture that
  //   stands on them (lib/stopPlatforms, lib/stopModels). The platform
  //   layers need the route ribbons to already exist so they can be slid
  //   underneath them, which is why this sits below section 8.
  ensureStopPlatformLayers(map, theme);

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
        visibility: vehicles3DEnabled(seed.is3D, seed.always3DVehicles) ? 'visible' : 'none',
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

}
