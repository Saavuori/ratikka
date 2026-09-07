// Stop furniture at real scale, the counterpart to `vehicleModels.ts`.
//
// A stop is a place, not a pin: a raised island or a stretch of kerb, a
// shelter, a pole with a sign board on it. In 3D view the vehicles are already
// extruded boxes measured in ground metres, so a stop drawn as a flat disc is
// the one thing on the map still pretending to be a symbol. These are the same
// kind of boxes, in the same units, so the two read as one scene.
//
// Everything below is in metres on the ground, like the vehicle bodies —
// `along` runs with the stop's bearing (the direction of travel past it),
// `across` is to the right of that bearing, with the kerb side positive.

import { TRAM_GREEN, METRO_ORANGE, TRAIN_PURPLE, BUS_BLUE, FERRY_CYAN } from './routeColors';
import { offsetMeters, patchRing, SELECTED_COLOR, DOORS_OPEN_COLOR, GLASS_COLOR } from './vehicleModels';
import { platformColors, PLATFORM_EXTRUSION_HEIGHT, type MapTheme } from './stopPlatforms';

export type StopMode = 'TRAM' | 'BUS' | 'SUBWAY' | 'RAIL' | 'FERRY';

export interface StopModel {
  /**
   * The pad synthesised when OSM has no platform polygon for this stop — most
   * kerbside bus stops. Where a polygon does exist it is extruded instead and
   * these numbers go unused.
   */
  pad: { length: number; halfWidth: number };
  /** Waiting shelter, or null for modes whose stops are station entrances. */
  shelter: { length: number; depth: number; height: number; glassBase: number } | null;
  /** Pole carrying the sign board. */
  poleHeight: number;
  /** The board itself: width along the bearing, height, and how far up it sits. */
  board: { width: number; height: number; base: number };
  color: string;
}

// A Helsinki tram island is a couple of metres wide and long enough for a 27 m
// Artic to draw up beside it; a kerbside bus stop is shorter and narrower; a
// metro or commuter-rail stop point marks an entrance, so it gets a wider apron
// and a canopy rather than a bus shelter. A ferry quay is longer and wider than
// any of them — a 35 m boat comes alongside it, and the waiting hall at
// Kauppatori and Suomenlinna is a building rather than a bus shelter.
export const STOP_MODELS: Record<StopMode, StopModel> = {
  TRAM: {
    pad: { length: 24, halfWidth: 1.3 },
    shelter: { length: 4.2, depth: 1.5, height: 2.5, glassBase: 0.35 },
    poleHeight: 3.1,
    board: { width: 0.95, height: 0.62, base: 2.35 },
    color: TRAM_GREEN,
  },
  BUS: {
    pad: { length: 14, halfWidth: 1.1 },
    shelter: { length: 3.6, depth: 1.4, height: 2.4, glassBase: 0.35 },
    poleHeight: 3.0,
    board: { width: 0.9, height: 0.6, base: 2.3 },
    color: BUS_BLUE,
  },
  SUBWAY: {
    pad: { length: 18, halfWidth: 3.2 },
    shelter: { length: 6.5, depth: 3.0, height: 3.2, glassBase: 2.6 },
    poleHeight: 3.6,
    board: { width: 1.2, height: 0.8, base: 2.6 },
    color: METRO_ORANGE,
  },
  RAIL: {
    pad: { length: 30, halfWidth: 3.2 },
    shelter: { length: 8, depth: 3.0, height: 3.4, glassBase: 2.8 },
    poleHeight: 3.6,
    board: { width: 1.2, height: 0.8, base: 2.6 },
    color: TRAIN_PURPLE,
  },
  FERRY: {
    pad: { length: 38, halfWidth: 4.0 },
    shelter: { length: 9, depth: 3.4, height: 3.2, glassBase: 1.0 },
    poleHeight: 3.4,
    board: { width: 1.1, height: 0.75, base: 2.5 },
    color: FERRY_CYAN,
  },
};

/** The stop tiles name modes two ways (JORE `mode`, Digitransit `type`). */
export function stopMode(raw: string | null | undefined): StopMode {
  switch ((raw ?? '').toUpperCase()) {
    case 'BUS':
      return 'BUS';
    case 'SUBWAY':
    case 'METRO':
      return 'SUBWAY';
    case 'RAIL':
    case 'TRAIN':
      return 'RAIL';
    case 'FERRY':
      return 'FERRY';
    default:
      return 'TRAM';
  }
}

export function stopModel(mode: string | null | undefined): StopModel {
  return STOP_MODELS[stopMode(mode)];
}

export interface StopFurnitureState {
  stopId: string;
  lng: number;
  lat: number;
  mode: string;
  /**
   * Direction of travel past the stop, degrees clockwise from north, or null
   * when nothing on the map says which way the stop faces. A null bearing
   * means no shelter and a square pad: a shelter placed at a guessed angle is
   * worse than no shelter, because it looks like data.
   */
  bearing: number | null;
  /** True when a real platform polygon already covers this stop. */
  hasPlatform: boolean;
  /** The selected vehicle is heading here next. */
  highlighted?: boolean;
  /** A vehicle is standing at this stop with its doors open. */
  boarding?: boolean;
}

export type StopPart = 'pad' | 'tactile' | 'shelter-glass' | 'shelter-roof' | 'pole' | 'board';

export interface StopExtrusionFeature {
  type: 'Feature';
  geometry: { type: 'Polygon'; coordinates: [number, number][][] };
  properties: {
    stopId: string;
    part: StopPart;
    mode: StopMode;
    color: string;
    base: number;
    top: number;
  };
}

/** A square pad for a stop of unknown orientation, drawn axis-aligned. */
const UNORIENTED_PAD = 3.2;

export function stopExtrusions(stop: StopFurnitureState, theme: MapTheme = 'light'): StopExtrusionFeature[] {
  const model = stopModel(stop.mode);
  const mode = stopMode(stop.mode);
  const palette = platformColors(theme);
  const out: StopExtrusionFeature[] = [];
  const hdg = stop.bearing ?? 0;
  const oriented = stop.bearing !== null;

  const push = (part: StopPart, ring: [number, number][], color: string, base: number, top: number) => {
    out.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [ring] },
      properties: { stopId: stop.stopId, part, mode, color, base, top },
    });
  };
  const patch = (
    part: StopPart,
    along: [number, number],
    across: [number, number],
    color: string,
    base: number,
    top: number,
  ) => push(part, patchRing(stop.lng, stop.lat, hdg, along, across), color, base, top);

  const deck = PLATFORM_EXTRUSION_HEIGHT;

  // 1. The pad. Skipped where OSM already gives this stop a platform polygon —
  //    that polygon is extruded by its own layer, and a synthetic slab on top
  //    of it would only z-fight with the real footprint.
  if (!stop.hasPlatform) {
    const padColor = stop.highlighted ? SELECTED_COLOR : palette.extrusion;
    if (oriented) {
      const { length, halfWidth } = model.pad;
      patch('pad', [-length / 2, length / 2], [-halfWidth, halfWidth], padColor, 0, deck);
    } else {
      patch('pad', [-UNORIENTED_PAD / 2, UNORIENTED_PAD / 2],
        [-UNORIENTED_PAD / 2, UNORIENTED_PAD / 2], padColor, 0, deck);
    }
  }

  // 2. Tactile warning strip along the track edge of an oriented pad — and the
  //    place the boarding cue lands, because it is the edge a passenger stands
  //    at while the doors are open.
  if (oriented && !stop.hasPlatform) {
    const { length, halfWidth } = model.pad;
    patch('tactile', [-length / 2, length / 2], [-halfWidth, -halfWidth + 0.45],
      stop.boarding ? DOORS_OPEN_COLOR : palette.tactile, deck, deck + 0.03);
  }

  // 3. Shelter: a glass box set back from the kerb, with a roof slab over it.
  //    Only where the stop's orientation is known — see StopFurnitureState.
  if (oriented && model.shelter) {
    const s = model.shelter;
    const backEdge = model.pad.halfWidth;
    const front = backEdge - s.depth;
    // Metro and rail get a canopy: the same footprint, but glazed only near
    // the top, so it reads as a roof on posts rather than an enclosed booth.
    patch('shelter-glass', [1.2, 1.2 + s.length], [front, backEdge],
      GLASS_COLOR, deck + s.glassBase, deck + s.height - 0.12);
    patch('shelter-roof', [1.05, 1.35 + s.length], [front - 0.15, backEdge + 0.15],
      stop.highlighted ? SELECTED_COLOR : '#59636f', deck + s.height - 0.12, deck + s.height);
  }

  // 4. Pole and sign board. The board faces across the direction of travel, so
  //    it is readable from the street the way a real one is.
  const poleColor = stop.highlighted ? SELECTED_COLOR : '#4b5563';
  patch('pole', [-0.07, 0.07], [-0.07, 0.07], poleColor, deck, deck + model.poleHeight);
  const b = model.board;
  patch('board', [-b.width / 2, b.width / 2], [-0.05, 0.05],
    stop.highlighted ? SELECTED_COLOR : model.color, deck + b.base, deck + b.base + b.height);

  return out;
}

export function stopFurnitureCollection(stops: StopFurnitureState[], theme: MapTheme = 'light') {
  return {
    type: 'FeatureCollection' as const,
    features: stops.flatMap((s) => stopExtrusions(s, theme)),
  };
}

// --- Placement helpers -----------------------------------------------------
//
// Nothing in the stop tiles says which way a stop faces, so the bearing is read
// off geometry that is already on the map: the platform polygon the stop sits
// in, or failing that the route line running past it.

const EARTH_RADIUS = 6378137;
const RAD = Math.PI / 180;

/** Metres between two lng/lat points, flat-earth over the few hundred that matter. */
export function metersBetween(a: [number, number], b: [number, number]): number {
  const lat = ((a[1] + b[1]) / 2) * RAD;
  const x = (b[0] - a[0]) * RAD * Math.cos(lat) * EARTH_RADIUS;
  const y = (b[1] - a[1]) * RAD * EARTH_RADIUS;
  return Math.hypot(x, y);
}

/** Bearing from a to b, degrees clockwise from north. */
export function bearingBetween(a: [number, number], b: [number, number]): number {
  const lat = ((a[1] + b[1]) / 2) * RAD;
  const east = (b[0] - a[0]) * Math.cos(lat);
  const north = b[1] - a[1];
  const deg = Math.atan2(east, north) / RAD;
  return (deg + 360) % 360;
}

/** Ray casting, in lng/lat. Rings from vector tiles are already closed. */
export function pointInRing(point: [number, number], ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const straddles = yi > point[1] !== yj > point[1];
    if (straddles && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * The bearing of a platform's long axis, taken as its longest edge. Platform
 * polygons are near-rectangles laid alongside the track, so the longest edge is
 * the direction of travel — and unlike a fitted axis it cannot be thrown off by
 * a chamfered corner.
 */
export function longestEdgeBearing(ring: [number, number][]): number | null {
  let best = 0;
  let bearing: number | null = null;
  for (let i = 1; i < ring.length; i++) {
    const length = metersBetween(ring[i - 1], ring[i]);
    if (length > best) {
      best = length;
      bearing = bearingBetween(ring[i - 1], ring[i]);
    }
  }
  return best >= 3 ? bearing : null;
}

/**
 * Bearing of the nearest route-line segment within `maxMeters`, for stops with
 * no platform polygon of their own. Returns null when nothing runs close
 * enough to be the line this stop serves.
 */
export function nearestLineBearing(
  point: [number, number],
  lines: [number, number][][],
  maxMeters = 25,
): number | null {
  let bestDistance = maxMeters;
  let bearing: number | null = null;
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const distance = distanceToSegment(point, line[i - 1], line[i]);
      if (distance < bestDistance) {
        bestDistance = distance;
        bearing = bearingBetween(line[i - 1], line[i]);
      }
    }
  }
  return bearing;
}

function distanceToSegment(p: [number, number], a: [number, number], b: [number, number]): number {
  const lat = a[1] * RAD;
  const toXY = (q: [number, number]): [number, number] => [
    (q[0] - a[0]) * RAD * Math.cos(lat) * EARTH_RADIUS,
    (q[1] - a[1]) * RAD * EARTH_RADIUS,
  ];
  const [px, py] = toXY(p);
  const [bx, by] = toXY(b);
  const lengthSq = bx * bx + by * by;
  if (lengthSq === 0) return Math.hypot(px, py);
  const t = Math.max(0, Math.min(1, (px * bx + py * by) / lengthSq));
  return Math.hypot(px - bx * t, py - by * t);
}

/** Point `metres` to the right of `bearing` from a stop — used by the tests. */
export function acrossFrom(
  lng: number,
  lat: number,
  bearing: number,
  metres: number,
): [number, number] {
  return offsetMeters(lng, lat, bearing, 0, metres);
}

// Furniture is real-scale like the vehicle bodies, so it only starts to read
// once a metre is worth a pixel. It fades in over the band where the flat sign
// icons have taken over from the circles, so the stop gains a body rather than
// swapping one symbol for another.
export const STOP_3D_MIN_ZOOM = 15.5;
export const STOP_3D_FULL_ZOOM = 16.4;

export const STOP_3D_FADE_IN: unknown[] = [
  'interpolate', ['linear'], ['zoom'],
  STOP_3D_MIN_ZOOM, 0,
  STOP_3D_FULL_ZOOM, 0.95,
];

/** Cap on how many stops get furniture at once, so a wide view stays cheap. */
export const STOP_FURNITURE_LIMIT = 140;

export const STOP_FURNITURE_SOURCE = 'stop-furniture';
export const STOP_FURNITURE_LAYER = 'stop-furniture-3d';
