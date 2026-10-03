// The rain radar overlay.
//
// The Finnish Meteorological Institute's Finland-wide rain-rate composite
// (`radar_finland_cappi_rate`), drawn as a translucent raster over the ground
// and under the labels, routes, stops and vehicles. It is open data: no key,
// CORS open, a new frame every five minutes.
//
// FMI's WMS will serve "the latest frame" when no time is given, but that
// image comes back with a day-long Cache-Control, so a browser would go on
// showing whichever frame it first saw. Every tile request therefore names its
// frame, and the newest frame is read from the layer's own capabilities
// document (about 12 kB, cached a minute by FMI), whose time dimension
// carries it as its default. A frame FMI has not published yet comes back as
// an XML exception rather than an image, which is why the time is read rather
// than guessed from the clock.

export const RADAR_LAYER_NAME = 'Radar:radar_finland_cappi_rate';

const WMS_BASE = 'https://openwms.fmi.fi/geoserver/Radar/wms';

/** Capabilities for the one layer, not the whole Radar workspace (~400 kB). */
export const RADAR_CAPABILITIES_URL =
  'https://openwms.fmi.fi/geoserver/Radar/radar_finland_cappi_rate/wms?service=WMS&request=GetCapabilities&version=1.3.0';

export const RAIN_RADAR_SOURCE_ID = 'fmi-rain-radar';
export const RAIN_RADAR_LAYER_ID = 'fmi-rain-radar-layer';

/**
 * FMI composes a frame every five minutes but publishes it a few minutes
 * later, at no fixed offset. Checking every two minutes shows a new frame
 * within two minutes of it appearing; the document is 12 kB and FMI caches it.
 */
export const RADAR_POLL_MS = 2 * 60 * 1000;

/**
 * The composite is a 1 km grid, and FMI renders it nearest-neighbour: asked
 * for finer tiles it hands back hard-edged kilometre squares, which at street
 * zoom read as a mosaic rather than weather. At zoom 7 a tile pixel is about
 * 600 m in Helsinki, under one grid cell, and MapLibre's linear upscaling from
 * there turns the cells into soft-edged showers. It also means the whole
 * region is a tile or two per frame.
 */
export const RADAR_MAX_ZOOM = 7;

/** The radar network's coverage, so nothing is asked of FMI for the open sea beyond it. */
export const RADAR_BOUNDS: [number, number, number, number] = [19.0, 59.3, 31.6, 70.1];

export const RADAR_OPACITY = 0.7;

/** FMI open data is CC BY 4.0. Rendered by the map overlay. */
export const RADAR_ATTRIBUTION = '© Ilmatieteen laitos';

/**
 * A GetMap URL for one frame. `{bbox-epsg-3857}` is MapLibre's own token for
 * a tile's Web Mercator extent; WMS 1.3.0 reads EPSG:3857 boxes east/north,
 * which is the order MapLibre writes them in.
 */
export function radarTileUrl(frame: string): string {
  const params = [
    'service=WMS',
    'request=GetMap',
    'version=1.3.0',
    `layers=${RADAR_LAYER_NAME}`,
    'styles=',
    'format=image/png',
    'transparent=true',
    'crs=EPSG:3857',
    'width=256',
    'height=256',
    'bbox={bbox-epsg-3857}',
    `time=${encodeURIComponent(frame)}`,
  ];
  return `${WMS_BASE}?${params.join('&')}`;
}

export interface RadarSourceSpec {
  type: 'raster';
  tiles: string[];
  tileSize: number;
  maxzoom: number;
  bounds: [number, number, number, number];
  attribution: string;
}

export function radarSourceSpec(frame: string): RadarSourceSpec {
  return {
    type: 'raster',
    tiles: [radarTileUrl(frame)],
    tileSize: 256,
    maxzoom: RADAR_MAX_ZOOM,
    bounds: RADAR_BOUNDS,
    attribution: RADAR_ATTRIBUTION,
  };
}

/**
 * The newest frame, from the layer's capabilities: the `default` of its time
 * dimension, e.g. `2026-10-03T12:30:00Z`. Null when the document has no time
 * dimension or its default is not a timestamp — the overlay then keeps the
 * frame it already has rather than asking for one that may not exist.
 */
export function latestRadarFrame(capabilities: string): string | null {
  const tags = capabilities.match(/<Dimension\b[^>]*>/g) ?? [];
  const timeTag = tags.find((tag) => /\bname="time"/.test(tag));
  const frame = timeTag?.match(/\bdefault="([^"]+)"/)?.[1];
  if (!frame || Number.isNaN(Date.parse(frame))) return null;
  return frame;
}

/** The frame's wall-clock time in Helsinki, for the credit line: "15:30". */
export function radarFrameLabel(frame: string): string {
  return new Date(frame).toLocaleTimeString('fi-FI', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Helsinki',
  }).replace('.', ':');
}
