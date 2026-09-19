import type * as maplibregl from 'maplibre-gl';
import type { LayerSeed } from './seed';
import { installBasemapLayers } from './basemap';
import { installVehicleLayers } from './vehicles';
import { installRouteLayers } from './routes';
import { installStopLayers } from './stops';
import { installBikeLayers } from './bikes';
import { installTrafficLightLayers } from './trafficLights';

export type { LayerSeed } from './seed';
export { STOP_MODE, ARRIVAL_LABEL_SOURCE, ARRIVAL_LABEL_LAYER } from './stops';
export { update3DMode, updateVehicle3DMode, updateMetroSignVisibility } from './basemap';

/**
 * Install everything the map draws that the base style does not provide: the
 * vehicles, the routes, the stops, the city bikes and the signalised junctions.
 *
 * All of it is built from values passed in rather than read from the component,
 * so this is a plain function of a map and a starting state. That is what lets
 * it live outside the component at all: as a closure over twenty-odd refs it
 * could not, and most of those refs existed to make that closure work.
 *
 * Idempotent per style — every source, layer and image is added only if absent
 * — because a theme swap rebuilds the style and runs this again over the new one.
 *
 * Order matters: the photo basemap goes under the base style's labels, and
 * everything else stacks over both, each group inserting itself relative to a
 * layer an earlier group added.
 */
export function installMapLayers(map: maplibregl.Map, seed: LayerSeed): void {
  installBasemapLayers(map, seed);
  installVehicleLayers(map, seed);
  installRouteLayers(map, seed);
  installStopLayers(map, seed);
  installBikeLayers(map, seed);
  installTrafficLightLayers(map, seed);
}
