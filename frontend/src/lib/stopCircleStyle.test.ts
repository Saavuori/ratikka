import { describe, it, expect } from 'vitest';
import { createPropertyExpression, v8 } from '@maplibre/maplibre-gl-style-spec';
import type { StylePropertySpecification } from '@maplibre/maplibre-gl-style-spec';
import {
  STOP_CIRCLE_RADIUS,
  STATION_CIRCLE_RADIUS,
  STOP_CIRCLE_STROKE_WIDTH,
  STOP_CIRCLE_OPACITY,
  STOP_CIRCLE_MIN_ZOOM,
  STATION_CIRCLE_MIN_ZOOM,
  STOP_CIRCLE_FADE_ZOOM,
  BIKE_STATION_MIN_ZOOM,
} from './stopCircleStyle';

const compile = (
  expression: unknown,
  property: 'circle-radius' | 'circle-opacity' | 'circle-stroke-width'
) => {
  const compiled = createPropertyExpression(
    expression,
    property,
    v8.paint_circle[property] as StylePropertySpecification
  );
  if (compiled.result === 'error') throw new Error(String(compiled.value));
  return (zoom: number): number => compiled.value.evaluate({ zoom }, {} as never);
};

describe('stop discs', () => {
  const radius = compile(STOP_CIRCLE_RADIUS, 'circle-radius');
  const stationRadius = compile(STATION_CIRCLE_RADIUS, 'circle-radius');
  const stroke = compile(STOP_CIRCLE_STROKE_WIDTH, 'circle-stroke-width');
  const opacity = compile(STOP_CIRCLE_OPACITY, 'circle-opacity');

  it('appears alongside the city-bike gauges rather than later', () => {
    expect(STOP_CIRCLE_MIN_ZOOM).toBeLessThanOrEqual(BIKE_STATION_MIN_ZOOM);
    expect(STATION_CIRCLE_MIN_ZOOM).toBeLessThanOrEqual(STOP_CIRCLE_MIN_ZOOM);
  });

  it('is a legible dot everywhere the discs are drawn', () => {
    for (const zoom of [STATION_CIRCLE_MIN_ZOOM, STOP_CIRCLE_MIN_ZOOM, 14, 15, STOP_CIRCLE_FADE_ZOOM]) {
      // A stop the size of the old one-pixel dot is not on the map in any way
      // a rider can see; 2.5 px across the whole disc band is the floor.
      expect(radius(zoom)).toBeGreaterThanOrEqual(2.5);
      expect(stationRadius(zoom)).toBeGreaterThan(radius(zoom));
      expect(stroke(zoom)).toBeGreaterThan(0);
    }
  });

  it('stays a dot rather than growing into a blob', () => {
    expect(radius(STOP_CIRCLE_FADE_ZOOM)).toBeLessThanOrEqual(6);
    expect(stationRadius(STOP_CIRCLE_FADE_ZOOM)).toBeLessThanOrEqual(8);
  });

  it('grows with zoom', () => {
    for (const [a, b] of [[12, 13], [13, 15], [15, 15.5]] as const) {
      expect(radius(b)).toBeGreaterThan(radius(a));
      expect(stationRadius(b)).toBeGreaterThan(stationRadius(a));
    }
  });

  it('hands over to the sign boards without a pop', () => {
    expect(opacity(15.0)).toBe(1);
    expect(opacity(STOP_CIRCLE_FADE_ZOOM)).toBe(0);
    expect(opacity(15.25)).toBeGreaterThan(0);
    expect(opacity(15.25)).toBeLessThan(1);
  });
});
