import type { LayerSeed } from './seed';
// MapLibre GL 6 is ESM-only and dropped the default export.
import * as maplibregl from 'maplibre-gl';
import {
  BIKE_STATION_MIN_ZOOM,
  BIKE_GAUGE_BUCKETS,
  BIKE_GAUGE_ICON_SIZE,
  bikeGaugeIconSvg,
  BIKE_3D_MIN_ZOOM,
  BIKE_3D_FADE_IN,
  BIKE_ICON_FADE_OUT,
  BIKE_STATION_SOURCE,
  BIKE_STATION_LAYER,
} from '../../lib/bikeStationModels';
import { vehicles3DEnabled } from '../../lib/vehicleAnimation';

/** City-bike stations: the live availability gauge, flat and extruded. */
export function installBikeLayers(map: maplibregl.Map, seed: LayerSeed): void {
  // Add Citybike Source (live availability, served by our own backend).
  //
  // The Digitransit vector tiles carry no live bike/dock counts, so the map is
  // driven from GET /api/v1/bike-stations instead. `bikeStationsDataRef` holds
  // the most recent payload so a style/theme reload can re-seed the source
  // immediately rather than blanking until the next refresh.
  if (!map.getSource('citybike')) {
    map.addSource('citybike', {
      type: 'geojson',
      data: seed.bikeStations || { type: 'FeatureCollection', features: [] },
    });
  }

  // Availability gauge images: a bicycle in a disc, ringed by an arc
  // showing how full the station is and coloured for scarcity — grey empty,
  // red almost gone, amber middling, green plenty. The bicycle is what makes
  // the marker name itself; the ring is what makes it worth reading. Rendered
  // once per fill bucket and picked per-station by the expression below.
  for (const bucket of BIKE_GAUGE_BUCKETS) {
    if (map.hasImage(bucket.name)) continue;
    const gaugeImg = new Image(BIKE_GAUGE_ICON_SIZE, BIKE_GAUGE_ICON_SIZE);
    gaugeImg.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(bikeGaugeIconSvg(bucket));
    // pixelRatio 2 keeps the wheels crisp; the 48px art displays at ~24 CSS px.
    gaugeImg.onload = ((name: string, img: HTMLImageElement) => () => {
      if (!seed.isCurrent(map)) return;
      if (!map.hasImage(name)) map.addImage(name, img, { pixelRatio: 2 });
    })(bucket.name, gaugeImg);
  }

  // Citybike gauge layer — one marker per station across all zooms, with
  // the available-bike count in the centre once zoomed in enough to read it.
  if (!map.getLayer('citybike_gauge')) {
    map.addLayer({
      id: 'citybike_gauge',
      type: 'symbol',
      source: 'citybike',
      minzoom: BIKE_STATION_MIN_ZOOM,
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
          13, 0.42,
          14, 0.58,
          15.5, 0.82,
          17, 1.0
        ],
        // The count sits under the marker now that the bicycle has the
        // middle of the disc. Below the icon it also keeps its size as the
        // icon shrinks, which is where a numeral inside the ring used to go.
        'text-field': ['to-string', ['coalesce', ['get', 'bikesAvailable'], 0]],
        'text-anchor': 'top',
        'text-offset': [0, 0.75],
        'text-font': ['Gotham Rounded Medium'],
        'text-size': [
          'interpolate',
          ['linear'],
          ['zoom'],
          13, 0,
          13.8, 10,
          16, 13
        ],
        'text-allow-overlap': ['step', ['zoom'], false, 15, true],
      },
      paint: {
        'text-color': '#1e293b',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.6,
        'icon-opacity': BIKE_ICON_FADE_OUT as maplibregl.DataDrivenPropertyValueSpecification<number>,
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

  // 14b. City-bike racks in 3D. The gauge above summarises a station in one
  // ring; this draws it — an apron, a dock per dock, a bike per bike and the
  // terminal at the end — in the same real metres as the vehicles and the
  // stop shelters, so up close the availability is simply the thing you see.
  if (!map.getSource(BIKE_STATION_SOURCE)) {
    map.addSource(BIKE_STATION_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
  }
  if (!map.getLayer(BIKE_STATION_LAYER)) {
    map.addLayer({
      id: BIKE_STATION_LAYER,
      type: 'fill-extrusion',
      source: BIKE_STATION_SOURCE,
      minzoom: BIKE_3D_MIN_ZOOM,
      layout: {
        visibility: vehicles3DEnabled(seed.is3D, seed.always3DVehicles) ? 'visible' : 'none',
      },
      paint: {
        'fill-extrusion-color': ['get', 'color'],
        'fill-extrusion-height': ['get', 'top'],
        'fill-extrusion-base': ['get', 'base'],
        'fill-extrusion-opacity': BIKE_3D_FADE_IN as maplibregl.PropertyValueSpecification<number>,
      },
    }, map.getLayer('vehicles-3d') ? 'vehicles-3d' : undefined);
  }

}
