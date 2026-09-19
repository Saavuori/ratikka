import type * as maplibregl from 'maplibre-gl';
import { BUNCHED_CORAL, GAP_AMBER } from '../../lib/headways';
import { HEADWAY_SOURCE } from '../overlays/headways';

/**
 * The links between bunched vehicles and the stretches of rail in a gap (see
 * overlays/headways). Both sit under the vehicles, which are what the eye
 * should land on, and over the route ribbons, which they run along.
 */
export function installHeadwayLayers(map: maplibregl.Map): void {
  if (!map.getSource(HEADWAY_SOURCE)) {
    map.addSource(HEADWAY_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
  }

  // A gap is where the service is missing, so it is drawn as a broken line:
  // amber dashes along the rails the next vehicle has yet to cover.
  if (!map.getLayer('headway-gap')) {
    map.addLayer({
      id: 'headway-gap',
      type: 'line',
      source: HEADWAY_SOURCE,
      filter: ['==', ['get', 'state'], 'gap'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': GAP_AMBER,
        'line-width': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 16, 5],
        'line-dasharray': [0.6, 1.8],
        'line-opacity': 0.9,
      },
    }, 'trams-circles');
  }

  // A bunch is two vehicles that ought to be minutes apart travelling as one,
  // so they are tied together: a coral bar with a soft glow under it, short
  // enough never to be mistaken for a route.
  if (!map.getLayer('headway-bunched-glow')) {
    map.addLayer({
      id: 'headway-bunched-glow',
      type: 'line',
      source: HEADWAY_SOURCE,
      filter: ['==', ['get', 'state'], 'bunched'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': BUNCHED_CORAL,
        'line-width': ['interpolate', ['linear'], ['zoom'], 11, 10, 16, 20],
        'line-blur': 6,
        'line-opacity': 0.35,
      },
    }, 'trams-circles');
  }
  if (!map.getLayer('headway-bunched')) {
    map.addLayer({
      id: 'headway-bunched',
      type: 'line',
      source: HEADWAY_SOURCE,
      filter: ['==', ['get', 'state'], 'bunched'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': BUNCHED_CORAL,
        'line-width': ['interpolate', ['linear'], ['zoom'], 11, 3, 16, 6],
        'line-opacity': 0.95,
      },
    }, 'trams-circles');
  }
}
