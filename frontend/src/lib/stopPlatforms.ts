// The ground a stop stands on.
//
// Helsinki's tram islands, bus laybys and station platforms are already in the
// basemap: OpenMapTiles carries them in the `transportation` layer as polygons
// with `subclass=platform`, and the light style draws them — anonymously, as
// part of `road_service_area`, the same flat grey it gives every pedestrian
// area and service yard. So the shape of the stop is on screen already and
// reads as nothing at all.
//
// These layers lift the platform polygons back out of that: a paved surface, a
// kerb line around it, and the tactile warning strip along its edge. Nothing
// here invents geometry — it is the OSM footprint, restyled.
//
// The polygons carry no HSL mode (OSM does not know a platform is served by
// tram 4), so the surface stays mode-neutral and colour is left to the sign
// and the furniture standing on it.

/**
 * The three basemaps. `satellite` is MML's orthophoto over the same dark
 * vector labels (see lib/satelliteBasemap), so everything the app draws on
 * top of it is styled exactly as it is in the dark theme.
 */
export type MapTheme = 'light' | 'dark' | 'satellite';

/** A MapLibre expression; cast at the call site so this module needs no renderer. */
export type Expression = unknown[];

/**
 * Where the platform surface fades in. Below this the city-scale view is about
 * where the vehicles are, and a rash of pavement outlines only adds noise.
 */
export const STOP_PLATFORM_MIN_ZOOM = 15;
export const STOP_PLATFORM_FULL_ZOOM = 16;
/** The tactile strip is a detail; it waits until the platform is a real shape. */
export const STOP_TACTILE_MIN_ZOOM = 16.5;

/** Kerb height in metres — what the extruded platform stands proud by. */
export const PLATFORM_EXTRUSION_HEIGHT = 0.28;

/**
 * Platform polygons only. `subclass` is the OpenMapTiles field; `class` is
 * checked too because a few renderers promote the subclass, and matching both
 * costs nothing.
 */
export const PLATFORM_FILTER: Expression = [
  'all',
  ['==', ['geometry-type'], 'Polygon'],
  [
    'any',
    ['==', ['get', 'subclass'], 'platform'],
    ['==', ['get', 'class'], 'platform'],
  ],
];

interface PlatformPalette {
  surface: string;
  kerb: string;
  tactile: string;
  extrusion: string;
}

export function platformColors(theme: MapTheme): PlatformPalette {
  return theme === 'light'
    ? { surface: '#e6e0d4', kerb: '#b4a893', tactile: '#c9a227', extrusion: '#ded7c9' }
    : { surface: '#333b45', kerb: '#5b6774', tactile: '#b08a2e', extrusion: '#39424d' };
}

/** Opacity ramp shared by the surface and its kerb, so they arrive together. */
function fade(full: number): Expression {
  return [
    'interpolate', ['linear'], ['zoom'],
    STOP_PLATFORM_MIN_ZOOM, 0,
    STOP_PLATFORM_FULL_ZOOM, full,
  ];
}

export function platformFillPaint(theme: MapTheme) {
  return {
    'fill-color': platformColors(theme).surface,
    'fill-opacity': fade(0.9),
  };
}

/**
 * The kerb. A flat fill reads as paint on the road; an edge around it is what
 * makes the same polygon read as a raised island.
 */
export function platformKerbPaint(theme: MapTheme) {
  return {
    'line-color': platformColors(theme).kerb,
    'line-width': [
      'interpolate', ['exponential', 1.4], ['zoom'],
      STOP_PLATFORM_MIN_ZOOM, 0.6,
      18, 2.4,
      20, 4,
    ] as Expression,
    'line-opacity': fade(1),
  };
}

/**
 * The warning band along the platform edge, at close zoom only.
 *
 * Drawn *under* the kerb line and wider than it, so what shows is a dashed
 * ochre fringe either side of the kerb — the contrasting edge strip a real
 * platform has. Drawing it on the outline at the kerb's own width instead
 * would put one line exactly on top of another, and the strip would simply
 * never be seen.
 */
export function platformTactilePaint(theme: MapTheme) {
  return {
    'line-color': platformColors(theme).tactile,
    'line-width': [
      'interpolate', ['exponential', 1.4], ['zoom'],
      STOP_TACTILE_MIN_ZOOM, 2.4,
      20, 7,
    ] as Expression,
    'line-dasharray': [1.5, 1.2],
    'line-opacity': [
      'interpolate', ['linear'], ['zoom'],
      STOP_TACTILE_MIN_ZOOM, 0,
      17.2, 0.75,
    ] as Expression,
  };
}

/**
 * In 3D the same polygon is extruded to kerb height, so the island gets a face
 * you can see at 45° of pitch rather than a line you have to infer one from.
 */
export function platformExtrusionPaint(theme: MapTheme) {
  return {
    'fill-extrusion-color': platformColors(theme).extrusion,
    'fill-extrusion-height': PLATFORM_EXTRUSION_HEIGHT,
    'fill-extrusion-base': 0,
    'fill-extrusion-opacity': 0.95,
  };
}

/**
 * Which tiles the platform polygons come from.
 *
 * The light theme is our own `style.json` over Digitransit's `hsl-vector-map`,
 * so the polygons are already loaded and cost nothing extra. The dark theme is
 * Carto's dark-matter, which carries its own `transportation` layer — but there
 * is no guarantee it keeps `subclass=platform` through its own generalisation,
 * and a stop area that appears in one theme and not the other is worse than
 * either. So dark mode attaches the same Digitransit source the light theme
 * uses, gated to zoom 14 up: one extra tile request, only when zoomed in, in
 * exchange for both themes drawing identical ground truth. Satellite mode is
 * the dark style underneath, so it takes the same path.
 */
export interface PlatformSourceSpec {
  /** Source id to draw from. */
  source: string;
  sourceLayer: string;
  /** Set when the source has to be added first (dark theme only). */
  add?: { id: string; url: string; minzoom: number };
}

export const PLATFORM_TILE_URL = 'https://api.digitransit.fi/map/v3/hsl-vector-map/index.json';

export function platformSourceSpec(theme: MapTheme): PlatformSourceSpec {
  if (theme === 'light') {
    return { source: 'vector', sourceLayer: 'transportation' };
  }
  return {
    source: 'stop-platform-tiles',
    sourceLayer: 'transportation',
    add: { id: 'stop-platform-tiles', url: PLATFORM_TILE_URL, minzoom: 14 },
  };
}

export const PLATFORM_FILL_LAYER = 'stop-platform-fill';
export const PLATFORM_KERB_LAYER = 'stop-platform-kerb';
export const PLATFORM_TACTILE_LAYER = 'stop-platform-tactile';
export const PLATFORM_3D_LAYER = 'stop-platform-3d';
