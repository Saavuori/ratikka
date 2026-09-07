import { describe, it, expect } from 'vitest';
import { createPropertyExpression, v8 } from '@maplibre/maplibre-gl-style-spec';
import type { StylePropertySpecification } from '@maplibre/maplibre-gl-style-spec';
import {
  STOP_MODELS,
  stopMode,
  stopModel,
  stopExtrusions,
  stopFurnitureCollection,
  bearingBetween,
  metersBetween,
  pointInRing,
  longestEdgeBearing,
  nearestLineBearing,
  acrossFrom,
  STOP_3D_MIN_ZOOM,
  STOP_3D_FULL_ZOOM,
  STOP_3D_FADE_IN,
} from './stopModels';
import type { StopFurnitureState } from './stopModels';
import { SELECTED_COLOR, DOORS_OPEN_COLOR } from './vehicleModels';
import { PLATFORM_EXTRUSION_HEIGHT } from './stopPlatforms';

const HELSINKI: [number, number] = [24.94, 60.17];

const stop = (over: Partial<StopFurnitureState> = {}): StopFurnitureState => ({
  stopId: '1010101',
  lng: HELSINKI[0],
  lat: HELSINKI[1],
  mode: 'TRAM',
  bearing: 0,
  hasPlatform: false,
  ...over,
});

describe('stopMode', () => {
  it('reads both tilesets\' names for the same mode', () => {
    // JORE calls it SUBWAY, a selected vehicle's own mode arrives as METRO.
    expect(stopMode('SUBWAY')).toBe('SUBWAY');
    expect(stopMode('METRO')).toBe('SUBWAY');
    expect(stopMode('RAIL')).toBe('RAIL');
    expect(stopMode('TRAIN')).toBe('RAIL');
    expect(stopMode('bus')).toBe('BUS');
    expect(stopMode('FERRY')).toBe('FERRY');
    expect(stopMode('ferry')).toBe('FERRY');
  });

  it('falls back to tram rather than throwing on an unknown mode', () => {
    expect(stopMode(undefined)).toBe('TRAM');
    expect(stopMode('FUNICULAR')).toBe('TRAM');
    expect(stopModel(null)).toBe(STOP_MODELS.TRAM);
  });
});

describe('stop model dimensions', () => {
  // The furniture is drawn in ground metres, so wrong numbers are not a style
  // slip — they are a stop the size of a building.
  it('keeps every pad long enough for the vehicle that calls at it', () => {
    // An Artic tram is 27 m; the island it serves is a comparable order.
    expect(STOP_MODELS.TRAM.pad.length).toBeGreaterThanOrEqual(18);
    expect(STOP_MODELS.BUS.pad.length).toBeGreaterThanOrEqual(10);
    // Nothing should be wider than a two-lane street.
    for (const model of Object.values(STOP_MODELS)) {
      expect(model.pad.halfWidth).toBeGreaterThan(0.8);
      expect(model.pad.halfWidth).toBeLessThan(5);
    }
  });

  it('keeps shelters and poles at human scale', () => {
    for (const model of Object.values(STOP_MODELS)) {
      expect(model.poleHeight).toBeGreaterThan(2.5);
      expect(model.poleHeight).toBeLessThan(4.5);
      if (model.shelter) {
        expect(model.shelter.height).toBeGreaterThan(2.1);
        expect(model.shelter.height).toBeLessThan(4);
        // A shelter that reaches past the kerb stands in the tram's path.
        expect(model.shelter.depth).toBeLessThanOrEqual(model.pad.halfWidth * 2);
      }
    }
  });

  it('sits the sign board below the top of its pole', () => {
    for (const model of Object.values(STOP_MODELS)) {
      expect(model.board.base + model.board.height).toBeLessThanOrEqual(model.poleHeight);
    }
  });
});

describe('stopExtrusions', () => {
  it('draws a pad the length the model says, along the bearing', () => {
    const [feature] = stopExtrusions(stop({ bearing: 90 })).filter((f) => f.properties.part === 'pad');
    const ring = feature.geometry.coordinates[0];
    // Opposite corners of the rectangle: its long side is the pad length.
    const edges = [];
    for (let i = 1; i < ring.length; i++) edges.push(metersBetween(ring[i - 1], ring[i]));
    const longest = Math.max(...edges);
    expect(longest).toBeCloseTo(STOP_MODELS.TRAM.pad.length, 0);
  });

  it('turns the whole assembly with the bearing', () => {
    const north = stopExtrusions(stop({ bearing: 0 }));
    const east = stopExtrusions(stop({ bearing: 90 }));
    const padOf = (features: typeof north) =>
      features.find((f) => f.properties.part === 'pad')!.geometry.coordinates[0];
    // The pad's long axis should follow the bearing, so the two disagree.
    const spread = (ring: [number, number][], axis: 0 | 1) =>
      Math.max(...ring.map((p) => p[axis])) - Math.min(...ring.map((p) => p[axis]));
    expect(spread(padOf(north), 1)).toBeGreaterThan(spread(padOf(north), 0));
    expect(spread(padOf(east), 0)).toBeGreaterThan(spread(padOf(east), 1));
  });

  it('stands the pole and board above the deck, not on the ground', () => {
    const parts = stopExtrusions(stop());
    const pole = parts.find((f) => f.properties.part === 'pole')!;
    const board = parts.find((f) => f.properties.part === 'board')!;
    expect(pole.properties.base).toBeCloseTo(PLATFORM_EXTRUSION_HEIGHT, 5);
    expect(pole.properties.top).toBeGreaterThan(pole.properties.base + 2.5);
    // The board hangs off the pole, so it must be inside the pole's span.
    expect(board.properties.top).toBeLessThanOrEqual(pole.properties.top + 1e-9);
    expect(board.properties.base).toBeGreaterThan(pole.properties.base);
  });

  it('gives every part a positive height', () => {
    for (const mode of ['TRAM', 'BUS', 'SUBWAY', 'RAIL']) {
      for (const feature of stopExtrusions(stop({ mode }))) {
        expect(feature.properties.top).toBeGreaterThan(feature.properties.base);
      }
    }
  });

  it('skips the synthetic pad where a real platform polygon already exists', () => {
    // Otherwise the slab z-fights with the extruded OSM footprint under it.
    const parts = stopExtrusions(stop({ hasPlatform: true }));
    expect(parts.some((f) => f.properties.part === 'pad')).toBe(false);
    expect(parts.some((f) => f.properties.part === 'tactile')).toBe(false);
    // The pole still goes up: the platform has no sign of its own.
    expect(parts.some((f) => f.properties.part === 'pole')).toBe(true);
  });

  it('omits the shelter when the stop\'s orientation is unknown', () => {
    // A shelter at a guessed angle looks like data. A square pad does not.
    const parts = stopExtrusions(stop({ bearing: null }));
    expect(parts.some((f) => f.properties.part.startsWith('shelter'))).toBe(false);
    expect(parts.some((f) => f.properties.part === 'tactile')).toBe(false);
    const pad = parts.find((f) => f.properties.part === 'pad')!;
    const ring = pad.geometry.coordinates[0];
    const edges = [];
    for (let i = 1; i < ring.length; i++) edges.push(metersBetween(ring[i - 1], ring[i]));
    // Square: every edge the same length.
    expect(Math.max(...edges) - Math.min(...edges)).toBeLessThan(0.2);
  });

  it('takes the selection gold when highlighted', () => {
    const parts = stopExtrusions(stop({ highlighted: true }));
    expect(parts.find((f) => f.properties.part === 'board')!.properties.color).toBe(SELECTED_COLOR);
    expect(parts.find((f) => f.properties.part === 'pad')!.properties.color).toBe(SELECTED_COLOR);
  });

  it('lights the platform edge while a vehicle is boarding', () => {
    const idle = stopExtrusions(stop());
    const boarding = stopExtrusions(stop({ boarding: true }));
    expect(boarding.find((f) => f.properties.part === 'tactile')!.properties.color)
      .toBe(DOORS_OPEN_COLOR);
    expect(idle.find((f) => f.properties.part === 'tactile')!.properties.color)
      .not.toBe(DOORS_OPEN_COLOR);
  });

  it('carries the stop id on every part, so a click can resolve it', () => {
    for (const feature of stopExtrusions(stop({ stopId: '1020445' }))) {
      expect(feature.properties.stopId).toBe('1020445');
    }
  });

  it('collects a whole viewport into one feature collection', () => {
    const collection = stopFurnitureCollection([stop(), stop({ stopId: '2' })]);
    expect(collection.type).toBe('FeatureCollection');
    expect(collection.features.length).toBe(stopExtrusions(stop()).length * 2);
  });
});

describe('placement helpers', () => {
  it('measures bearings clockwise from north', () => {
    // `acrossFrom` steps to the right of the heading, so heading north puts
    // the point due east, and heading east puts it due south.
    expect(bearingBetween(HELSINKI, acrossFrom(...HELSINKI, 0, 50))).toBeCloseTo(90, 0);
    expect(bearingBetween(HELSINKI, acrossFrom(...HELSINKI, 90, 50))).toBeCloseTo(180, 0);
    expect(bearingBetween(HELSINKI, acrossFrom(...HELSINKI, 180, 50))).toBeCloseTo(270, 0);
  });

  it('finds a point inside a platform ring and rejects one outside', () => {
    const ring: [number, number][] = [
      [24.9390, 60.1695], [24.9410, 60.1695], [24.9410, 60.1705], [24.9390, 60.1705], [24.9390, 60.1695],
    ];
    expect(pointInRing([24.9400, 60.1700], ring)).toBe(true);
    expect(pointInRing([24.9380, 60.1700], ring)).toBe(false);
  });

  it('reads a platform\'s long axis off its longest edge', () => {
    // A 40 m x 3 m island running east-west: the long axis is the direction of
    // travel, whichever way round the ring happens to be wound.
    const west: [number, number] = [24.9390, 60.1700];
    const east: [number, number] = [24.9397, 60.1700];
    const ring: [number, number][] = [
      west, east,
      acrossFrom(east[0], east[1], 90, 3),
      acrossFrom(west[0], west[1], 90, 3),
      west,
    ];
    const bearing = longestEdgeBearing(ring)!;
    expect([bearing, (bearing + 180) % 360].some((b) => Math.abs(b - 90) < 2)).toBe(true);
  });

  it('refuses a bearing from a ring too small to have a long axis', () => {
    const tiny: [number, number][] = [
      [24.9400, 60.1700], [24.94001, 60.1700], [24.94001, 60.17001], [24.9400, 60.1700],
    ];
    expect(longestEdgeBearing(tiny)).toBeNull();
  });

  it('takes the bearing of the route line running past the stop', () => {
    const line: [number, number][] = [
      acrossFrom(HELSINKI[0], HELSINKI[1], 0, -60),
      acrossFrom(HELSINKI[0], HELSINKI[1], 0, 60),
    ];
    // The line runs east-west 0 m from the stop, so it is the one it serves.
    const bearing = nearestLineBearing(HELSINKI, [line])!;
    expect([bearing, (bearing + 180) % 360].some((b) => Math.abs(b - 90) < 2)).toBe(true);
  });

  it('ignores a line too far away to be this stop\'s', () => {
    const far: [number, number][] = [
      acrossFrom(HELSINKI[0], HELSINKI[1], 90, 200),
      acrossFrom(HELSINKI[0], HELSINKI[1], 90, 260),
    ];
    expect(nearestLineBearing(HELSINKI, [far])).toBeNull();
  });
});

describe('STOP_3D_FADE_IN', () => {
  // Compiled through MapLibre's own evaluator, as with the route offsets: the
  // stops between the zoom stops are interpolated, not literals in the array.
  const compiled = createPropertyExpression(
    STOP_3D_FADE_IN,
    'fill-extrusion-opacity',
    v8['paint_fill-extrusion']['fill-extrusion-opacity'] as StylePropertySpecification,
  );
  if (compiled.result === 'error') throw new Error(String(compiled.value));
  const opacityAt = (zoom: number): number => compiled.value.evaluate({ zoom }, {} as never);

  it('draws nothing until the furniture is worth drawing', () => {
    // Below this a shelter is sub-pixel; extruding it just costs frames.
    expect(opacityAt(STOP_3D_MIN_ZOOM)).toBe(0);
    expect(opacityAt(STOP_3D_MIN_ZOOM - 2)).toBe(0);
  });

  it('fades in rather than popping', () => {
    const middle = (STOP_3D_MIN_ZOOM + STOP_3D_FULL_ZOOM) / 2;
    expect(opacityAt(middle)).toBeGreaterThan(0);
    expect(opacityAt(middle)).toBeLessThan(opacityAt(STOP_3D_FULL_ZOOM));
  });

  it('is solid once zoomed in', () => {
    expect(opacityAt(STOP_3D_FULL_ZOOM)).toBeGreaterThan(0.9);
    expect(opacityAt(20)).toBeGreaterThan(0.9);
  });
});
