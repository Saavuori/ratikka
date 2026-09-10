import type { LayerSeed } from './seed';
import { applyRouteNetworkColors } from './basemap';
// MapLibre GL 6 is ESM-only and dropped the default export.
import * as maplibregl from 'maplibre-gl';
import {
  ensureBackgroundRouteNetwork,
} from '../routeNetwork';
import {
  ROUTE_LINE_WIDTH,
  ROUTE_CASING_WIDTH,
  ROUTE_CASING_OPACITY,
  ROUTE_LINE_OFFSET,
  ROUTE_LINE_OPACITY,
  ROUTE_LINE_SORT_KEY,
} from '../../lib/routeLineStyle';

/** The highlighted per-line route ribbons, drawn from fetched pattern geometry. */
export function installRouteLayers(map: maplibregl.Map, seed: LayerSeed): void {
  const { theme } = seed;
  // Add Route Lines Source
  if (!map.getSource('route-lines')) {
    map.addSource('route-lines', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [],
      },
    });
  }

  // Add Route Lines Layer (Rendered before trams-circles so it is underneath)
  //
  // Two layers: a casing underneath and the coloured line on top. The
  // casing separates neighbouring ribbons where several lines share a
  // street — without it two adjacent route colours read as one wide band —
  // and keeps a pale route legible against the basemap in either theme.
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
        'line-color': theme === 'light' ? '#ffffff' : '#0b1220',
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
  //  (the dark-matter theme has no `routes` source/layers), so the Settings
  //  "Routes" toggle draws the route lines — and their mode colours — in
  //  both themes. No-op in light mode where style.json already supplies them.
  ensureBackgroundRouteNetwork(map);

  // Tint the tram/light-rail route network per line (palette on `routeIdParsed`)
  // so routes show their own colours instead of a single mode green.
  applyRouteNetworkColors(map);

}
