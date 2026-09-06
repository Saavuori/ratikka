import { describe, it, expect } from 'vitest';
import {
  createPropertyExpression,
  featureFilter,
  v8,
} from '@maplibre/maplibre-gl-style-spec';
import type { StylePropertySpecification } from '@maplibre/maplibre-gl-style-spec';
import {
  PLATFORM_FILTER,
  PLATFORM_TILE_URL,
  STOP_PLATFORM_MIN_ZOOM,
  STOP_PLATFORM_FULL_ZOOM,
  STOP_TACTILE_MIN_ZOOM,
  PLATFORM_EXTRUSION_HEIGHT,
  platformColors,
  platformFillPaint,
  platformKerbPaint,
  platformTactilePaint,
  platformExtrusionPaint,
  platformSourceSpec,
} from './stopPlatforms';

const THEMES = ['light', 'dark'] as const;

describe('PLATFORM_FILTER', () => {
  // The stop area we are restyling is a polygon in the basemap's own
  // `transportation` layer. Pull in anything else and pedestrian squares and
  // service yards start looking like tram islands.
  const filter = featureFilter(PLATFORM_FILTER as never, 'layers[0].filter');
  const matches = (properties: Record<string, unknown>, type: 1 | 2 | 3 = 3) =>
    filter.filter({ zoom: 16 } as never, { type, properties } as never, undefined as never);

  it('takes platform polygons', () => {
    expect(matches({ class: 'transit', subclass: 'platform' })).toBe(true);
    expect(matches({ class: 'platform' })).toBe(true);
  });

  it('leaves the rest of the pavement alone', () => {
    expect(matches({ class: 'service', subclass: 'pedestrian' })).toBe(false);
    expect(matches({ class: 'path' })).toBe(false);
  });

  it('ignores platform lines and points, which have no area to pave', () => {
    expect(matches({ subclass: 'platform' }, 1)).toBe(false);
    expect(matches({ subclass: 'platform' }, 2)).toBe(false);
  });
});

describe('platform paint', () => {
  const evaluate = (
    expression: unknown,
    property: string,
    spec: StylePropertySpecification,
    zoom: number,
  ): number => {
    const compiled = createPropertyExpression(expression as never, property, spec);
    if (compiled.result === 'error') throw new Error(String(compiled.value));
    return compiled.value.evaluate({ zoom }, {} as never) as number;
  };

  const fillOpacityAt = (theme: 'light' | 'dark', zoom: number) =>
    evaluate(platformFillPaint(theme)['fill-opacity'], 'fill-opacity',
      v8.paint_fill['fill-opacity'] as StylePropertySpecification, zoom);
  const kerbWidthAt = (theme: 'light' | 'dark', zoom: number) =>
    evaluate(platformKerbPaint(theme)['line-width'], 'line-width',
      v8.paint_line['line-width'] as StylePropertySpecification, zoom);
  const tactileOpacityAt = (theme: 'light' | 'dark', zoom: number) =>
    evaluate(platformTactilePaint(theme)['line-opacity'], 'line-opacity',
      v8.paint_line['line-opacity'] as StylePropertySpecification, zoom);

  it('shows nothing at city zoom in either theme', () => {
    // Platform outlines across the whole network is noise, not information.
    for (const theme of THEMES) {
      expect(fillOpacityAt(theme, STOP_PLATFORM_MIN_ZOOM)).toBe(0);
      expect(fillOpacityAt(theme, 12)).toBe(0);
    }
  });

  it('is fully paved by the zoom the stop signs take over at', () => {
    for (const theme of THEMES) {
      expect(fillOpacityAt(theme, STOP_PLATFORM_FULL_ZOOM)).toBeGreaterThan(0.8);
      expect(fillOpacityAt(theme, 19)).toBeGreaterThan(0.8);
    }
  });

  it('grows the kerb with zoom without letting it swallow the platform', () => {
    for (const theme of THEMES) {
      expect(kerbWidthAt(theme, 16)).toBeLessThan(kerbWidthAt(theme, 19));
      // A tram island is ~2.6 m wide; a kerb wider than a few pixels closes it up.
      expect(kerbWidthAt(theme, 20)).toBeLessThanOrEqual(5);
    }
  });

  it('holds the tactile strip back until the platform is a real shape', () => {
    for (const theme of THEMES) {
      expect(tactileOpacityAt(theme, STOP_TACTILE_MIN_ZOOM)).toBe(0);
      expect(tactileOpacityAt(theme, 18)).toBeGreaterThan(0.5);
    }
  });

  it('gives each theme its own palette, all four roles distinct', () => {
    for (const theme of THEMES) {
      const palette = platformColors(theme);
      expect(new Set(Object.values(palette)).size).toBe(4);
    }
    expect(platformColors('light').surface).not.toBe(platformColors('dark').surface);
  });

  it('extrudes to a kerb height, not a building', () => {
    for (const theme of THEMES) {
      const paint = platformExtrusionPaint(theme);
      expect(paint['fill-extrusion-height']).toBe(PLATFORM_EXTRUSION_HEIGHT);
      expect(paint['fill-extrusion-base']).toBe(0);
    }
    // A kerb, in metres. Anything over a step is a wall.
    expect(PLATFORM_EXTRUSION_HEIGHT).toBeGreaterThan(0.1);
    expect(PLATFORM_EXTRUSION_HEIGHT).toBeLessThan(0.5);
  });
});

describe('platformSourceSpec', () => {
  it('reuses the light theme\'s own basemap tiles', () => {
    // They are already loaded; the polygons cost nothing extra there.
    const spec = platformSourceSpec('light');
    expect(spec.source).toBe('vector');
    expect(spec.add).toBeUndefined();
  });

  it('attaches the same tiles to the dark theme, gated to close zoom', () => {
    // Carto's dark-matter carries no guaranteed platform subclass, and a stop
    // area that exists in one theme only is worse than one in neither.
    const spec = platformSourceSpec('dark');
    expect(spec.add?.url).toBe(PLATFORM_TILE_URL);
    expect(spec.add?.id).toBe(spec.source);
    expect(spec.add?.minzoom).toBeGreaterThanOrEqual(13);
  });

  it('reads the same source layer either way', () => {
    expect(platformSourceSpec('light').sourceLayer)
      .toBe(platformSourceSpec('dark').sourceLayer);
  });
});
