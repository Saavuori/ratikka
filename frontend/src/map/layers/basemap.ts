import type { LayerSeed } from './seed';
// MapLibre GL 6 is ESM-only and dropped the default export.
import * as maplibregl from 'maplibre-gl';
import {
} from '../routeNetwork';
import {
  routeColorMatchExpression,
  colorMatchExpression,
  METRO_TILE_COLORS,
  TRAIN_TILE_COLORS,
  TRAM_GREEN,
  METRO_ORANGE,
  TRAIN_PURPLE,
} from '../../lib/routeColors';
import {
  VEHICLE_3D_MIN_ZOOM,
  VEHICLE_3D_FULL_ZOOM,
  VEHICLE_ICON_FADE_OUT,
} from '../../lib/vehicleModels';
import {
  PLATFORM_3D_LAYER,
} from '../../lib/stopPlatforms';
import type { MapTheme } from '../../lib/stopPlatforms';
import {
  SATELLITE_LAYER_ID,
  SATELLITE_SOURCE_ID,
  satelliteSourceSpec,
  firstLabelLayerId,
  nonLabelLayersAboveSatellite,
} from '../../lib/satelliteBasemap';
import {
  STOP_FURNITURE_LAYER,
} from '../../lib/stopModels';
import {
  BIKE_ICON_FADE_OUT,
  BIKE_STATION_LAYER,
} from '../../lib/bikeStationModels';

const METRO_SIGN_LAYERS = [
  'subway-entrance_icon',
  'subway-entrance_letter',
  'subway-entrance_accessibility',
  'icon_subway-station',
];

// lib/satelliteBasemap). Every other mode is a no-op here; the style itself
// is recreated on a theme change, so nothing has to be torn down.
export const ensureSatelliteBasemap = (map: maplibregl.Map, theme: MapTheme, mmlKey: string) => {
  if (theme !== 'satellite') return;
  if (!map.getSource(SATELLITE_SOURCE_ID)) {
    map.addSource(
      SATELLITE_SOURCE_ID,
      satelliteSourceSpec(mmlKey) as maplibregl.RasterSourceSpecification,
    );
  }
  const layers = map.getStyle()?.layers;
  if (!map.getLayer(SATELLITE_LAYER_ID)) {
    map.addLayer(
      { id: SATELLITE_LAYER_ID, type: 'raster', source: SATELLITE_SOURCE_ID },
      firstLabelLayerId(layers),
    );
  }
  // Whatever the vector style would still draw over the photo -- late road
  // casings, building fills -- is the map's guess at what the photo shows.
  nonLabelLayersAboveSatellite(layers).forEach((layerId) => {
    if (layerId === SATELLITE_LAYER_ID) return;
    if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', 'none');
  });
};

// HSL's single mode green, so a line's route on the map reads in the same
// colour as its vehicles and badges. The JORE routes tiles expose the friendly
// line number as `routeIdParsed` (e.g. "4", "6T", "15"), which is exactly the
// key our palette uses, so a `match` on it colours each line; any line missing
// from the palette falls back to the mode colour (so a null/absent property is
// a no-op, never a regression). The white casing layers stay white, and buses
// keep their mode blue.
export const applyRouteNetworkColors = (map: maplibregl.Map) => {
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

export const update3DMode = (map: maplibregl.Map, active: boolean, theme: MapTheme) => {
  // Set pitch
  map.easeTo({
    pitch: active ? 45 : 0,
    duration: 800,
  });

  // 1b. The platform kerb face. Flat, the polygon is already drawn as a
  //  surface with an outline; tilted, it needs a side to stand on.
  if (map.getLayer(PLATFORM_3D_LAYER)) {
    map.setLayoutProperty(PLATFORM_3D_LAYER, 'visibility', active ? 'visible' : 'none');
  }

  // Toggle light-mode built-in 3D buildings
  if (map.getLayer('building_3d')) {
    map.setLayoutProperty('building_3d', 'visibility', active ? 'visible' : 'none');
  }
  if (map.getLayer('building')) {
    map.setLayoutProperty('building', 'visibility', active ? 'none' : 'visible');
  }
  if (map.getLayer('building_shadow')) {
    map.setLayoutProperty('building_shadow', 'visibility', active ? 'none' : 'visible');
  }

  // Toggle dark-mode programmatic 3D buildings
  const custom3DId = 'custom-3d-buildings';
  if (active) {
    // Satellite rides on the same dark vector style, so it needs the same
    // programmatic buildings -- neither style ships `building_3d`.
    if (theme !== 'light') {
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

export const updateVehicle3DMode = (map: maplibregl.Map, active: boolean) => {
  if (map.getLayer('vehicles-3d')) {
    map.setLayoutProperty('vehicles-3d', 'visibility', active ? 'visible' : 'none');
  }
  // Stop furniture follows the vehicles: both are real-scale bodies, and a
  // shelter without a tram beside it (or the reverse) reads as a mistake.
  if (map.getLayer(STOP_FURNITURE_LAYER)) {
    map.setLayoutProperty(STOP_FURNITURE_LAYER, 'visibility', active ? 'visible' : 'none');
  }
  // City-bike racks are furniture too, and the flat gauge only hands over to
  // one when there is a rack under it to hand over to.
  if (map.getLayer(BIKE_STATION_LAYER)) {
    map.setLayoutProperty(BIKE_STATION_LAYER, 'visibility', active ? 'visible' : 'none');
  }
  // A traffic light is the exception: the junction marker is the same object
  // in 2D and in 3D, so it neither hides nor fades when the city stands up.
  if (map.getLayer('citybike_gauge')) {
    map.setPaintProperty('citybike_gauge', 'icon-opacity',
      (active ? BIKE_ICON_FADE_OUT : 1) as maplibregl.DataDrivenPropertyValueSpecification<number>);
  }
  if (map.getLayer('trams-body')) {
    map.setPaintProperty('trams-body', 'icon-opacity', (active ? VEHICLE_ICON_FADE_OUT : 1) as maplibregl.DataDrivenPropertyValueSpecification<number>);
  }
  if (map.getLayer('trams-brake')) {
    const brakeOpacity = [
      'case',
      ['any', ['get', 'stopped'], ['<', ['get', 'acc'], -0.35]],
      1,
      0,
    ];
    // Zoom expressions must be top-level, not nested inside the braking case.
    const opacity = active
      ? ['interpolate', ['linear'], ['zoom'],
        VEHICLE_3D_MIN_ZOOM, brakeOpacity, VEHICLE_3D_FULL_ZOOM, 0]
      : brakeOpacity;
    map.setPaintProperty('trams-brake', 'icon-opacity', opacity as unknown as maplibregl.DataDrivenPropertyValueSpecification<number>);
  }
};

export const updateMetroSignVisibility = (map: maplibregl.Map, metro: boolean) => {
  METRO_SIGN_LAYERS.forEach((layerId) => {
    // Absent in the dark theme, which loads Carto's basemap instead.
    if (!map.getLayer(layerId)) return;
    map.setLayoutProperty(layerId, 'visibility', metro ? 'visible' : 'none');
  });
};

/** The ground the rest is drawn on: orthophotos, tilt, and the route network's colours. */
export function installBasemapLayers(map: maplibregl.Map, seed: LayerSeed): void {
  const { theme } = seed;
  // The photo basemap, before anything else is added: it goes *under* the
  // base style's labels, and everything below is added on top of both.
  ensureSatelliteBasemap(map, theme, seed.mmlKey);

}
