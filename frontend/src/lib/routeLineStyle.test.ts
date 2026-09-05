import { describe, it, expect } from 'vitest';
import { createPropertyExpression, v8 } from '@maplibre/maplibre-gl-style-spec';
import type { StylePropertySpecification } from '@maplibre/maplibre-gl-style-spec';
import {
  ROUTE_LINE_OFFSET, MAX_SLOT, ROUTE_LINE_WIDTH, ROUTE_CASING_WIDTH,
  ROUTE_LINE_OPACITY, ROUTE_CASING_OPACITY,
} from './routeLineStyle';

describe('route visual hierarchy', () => {
  const compile = (expression: unknown, property: 'line-width' | 'line-opacity') => {
    const compiled = createPropertyExpression(
      expression,
      property,
      v8.paint_line[property] as StylePropertySpecification
    );
    if (compiled.result === 'error') throw new Error(String(compiled.value));
    return (zoom: number, selected: boolean, dim: boolean): number =>
      compiled.value.evaluate({ zoom }, { properties: { selected, dim } } as never);
  };
  const width = compile(ROUTE_LINE_WIDTH, 'line-width');
  const casing = compile(ROUTE_CASING_WIDTH, 'line-width');
  const opacity = compile(ROUTE_LINE_OPACITY, 'line-opacity');
  const casingOpacity = compile(ROUTE_CASING_OPACITY, 'line-opacity');

  it('keeps context slimmer than ordinary routes and the selected route', () => {
    for (const zoom of [8, 10, 11.5, 13, 14.5, 16, 20]) {
      expect(width(zoom, false, true)).toBeGreaterThan(0);
      expect(width(zoom, false, true)).toBeLessThan(width(zoom, false, false));
      expect(width(zoom, false, false)).toBeLessThan(width(zoom, true, false));
      expect(width(zoom, false, false)).toBeGreaterThanOrEqual(1.8);
      expect(width(zoom, false, false)).toBeLessThanOrEqual(3);
      expect(width(zoom, true, false)).toBeLessThanOrEqual(5);
    }
  });

  it('keeps outlines narrow in every selection state', () => {
    for (const zoom of [8, 10, 11.5, 13, 14.5, 16, 20]) {
      for (const [selected, dim] of [[false, false], [false, true], [true, false]]) {
        const outline = casing(zoom, selected, dim) - width(zoom, selected, dim);
        expect(outline).toBeGreaterThan(0);
        expect(outline).toBeLessThanOrEqual(2);
      }
    }
  });

  it('fades context and its casing while keeping route colours distinct', () => {
    expect(opacity(13, false, true)).toBeLessThanOrEqual(0.3);
    expect(opacity(13, false, false)).toBeGreaterThanOrEqual(0.9);
    expect(opacity(13, true, false)).toBe(1);
    expect(casingOpacity(13, false, true)).toBeLessThan(opacity(13, false, true));
    expect(casingOpacity(13, false, true)).toBeLessThan(casingOpacity(13, false, false));
    expect(casingOpacity(13, false, false)).toBeLessThan(casingOpacity(13, true, false));
  });
});

// `line-offset` is a pixel offset, so how far a fanned route sits from the
// street it represents is fixed on screen and therefore *grows on the ground*
// as the map zooms out. Left unbounded that put routes a block off their street
// at city zoom, out over the water. These are the two properties that keep it
// honest, checked through MapLibre's own expression evaluator rather than by
// reading the literal — the zoom stops interpolate, so the value between them
// is not something eyeballing the array tells you.
describe('ROUTE_LINE_OFFSET', () => {
  // The real `line-offset` spec, so the expression is compiled exactly as
  // MapLibre compiles it when the layer is added.
  const compiled = createPropertyExpression(
    ROUTE_LINE_OFFSET,
    'line-offset',
    v8.paint_line['line-offset'] as StylePropertySpecification
  );
  if (compiled.result === 'error') throw new Error(String(compiled.value));

  const offsetAt = (zoom: number, offsetIndex: number): number =>
    compiled.value.evaluate({ zoom }, { properties: { offsetIndex } } as never);

  it('collapses the fan onto the true geometry when zoomed out', () => {
    // The whole-city view: the streets a fan separates cannot be told apart at
    // this scale, so the only honest place for a route is where it runs.
    for (const zoom of [0, 8, 10, 11]) {
      expect(offsetAt(zoom, MAX_SLOT)).toBe(0);
      expect(offsetAt(zoom, -MAX_SLOT)).toBe(0);
    }
  });

  it('keeps the outermost ribbon within a street width of its route', () => {
    // ~25 px is a street at these zooms; beyond that the ribbon stops reading
    // as "this route, nudged aside" and starts looking like a different street.
    for (const zoom of [12, 13, 14, 15, 16, 18, 22]) {
      expect(Math.abs(offsetAt(zoom, MAX_SLOT))).toBeLessThanOrEqual(25);
    }
  });

  it('keeps the outermost ribbon within a street of *ground* at every zoom', () => {
    // The check above is in pixels, which is not the property that broke: a
    // fixed pixel offset is a growing metre offset on the way out. Web-Mercator
    // ground resolution at Helsinki's latitude, so the bound is in metres of
    // real map — a ribbon further off than this is reading as another street.
    const metresPerPixel = (zoom: number) =>
      (156543.03392 * Math.cos((60.17 * Math.PI) / 180)) / 2 ** zoom;

    for (const zoom of [12, 13, 14, 15, 16, 18]) {
      const metres = Math.abs(offsetAt(zoom, MAX_SLOT)) * metresPerPixel(zoom);
      expect(metres).toBeLessThanOrEqual(50);
    }
  });

  it('fans symmetrically either side of the true geometry', () => {
    expect(offsetAt(16, 2)).toBe(-offsetAt(16, -2));
    expect(offsetAt(16, 0)).toBe(0);
  });

  it('separates neighbouring slots more the closer you look', () => {
    const spacing = (zoom: number) => offsetAt(zoom, 1) - offsetAt(zoom, 0);
    expect(spacing(13)).toBeGreaterThan(spacing(12));
    expect(spacing(16)).toBeGreaterThan(spacing(13));
  });
});
