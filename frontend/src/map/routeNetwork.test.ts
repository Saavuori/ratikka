import { describe, expect, it } from 'vitest';
import type { Map as MapLibreMap } from 'maplibre-gl';
import {
  NETWORK_BANDS,
  RIBBON_LAYERS,
  backgroundNetworkLayers,
  bandLayerIds,
  forgetBaseFilters,
  updateRouteVisibility,
  type RouteVisibility,
} from './routeNetwork';

/**
 * A map stub that remembers what was set on it. Only the handful of methods
 * this module calls are implemented; a layer is "present" if it was seeded.
 */
function fakeMap(seed: Record<string, unknown> = {}) {
  const filters = new Map<string, unknown>(Object.entries(seed));
  const visibility = new Map<string, string>();
  const opacity = new Map<string, number>();
  const map = {
    getLayer: (id: string) => (filters.has(id) ? { id } : undefined),
    getFilter: (id: string) => filters.get(id),
    setFilter: (id: string, f: unknown) => filters.set(id, f),
    setLayoutProperty: (id: string, _k: string, v: string) => visibility.set(id, v),
    setPaintProperty: (id: string, k: string, v: number) => {
      if (k === 'line-opacity') opacity.set(id, v);
    },
  };
  return { map: map as unknown as MapLibreMap, filters, visibility, opacity };
}

const view = (over: Partial<RouteVisibility> = {}): RouteVisibility => ({
  modes: { tram: true, bus: true, metro: true, train: true, ferry: true },
  lines: [],
  selectedLine: null,
  ribbonLines: [],
  routes: true,
  ...over,
});

describe('backgroundNetworkLayers', () => {
  const layers = backgroundNetworkLayers();
  const ids = layers.map((l) => l.id);

  it('builds case, line and inner for a banded mode, in that order', () => {
    expect(ids.filter((id) => id.startsWith('route_tram'))).toEqual([
      'route_tram_case',
      'route_tram',
      'route_tram_inner',
    ]);
  });

  it('recreates the ferry crossing the dark theme used to be missing', () => {
    // The mode toggle addressed a layer that only the light style built, so
    // switching ferries on in dark mode did nothing.
    expect(ids).toContain('route_ferry');
  });

  it('draws every band from the JORE routes tiles', () => {
    for (const layer of layers) {
      expect(layer).toMatchObject({ source: 'routes', 'source-layer': 'routes' });
    }
  });

  it('gives the spine modes no inner core', () => {
    expect(ids).not.toContain('route_subway_inner');
    expect(ids).not.toContain('route_rail_inner');
  });

  it('covers exactly the bands in the table', () => {
    const fromTable = NETWORK_BANDS.flatMap(bandLayerIds)
      // The underground segment exists only in the light style.
      .filter((id) => id !== 'route_subway_underground');
    expect(new Set(ids)).toEqual(new Set(fromTable));
  });
});

describe('updateRouteVisibility', () => {
  const allLayerIds = NETWORK_BANDS.flatMap(bandLayerIds);
  const seedAll = () =>
    Object.fromEntries([...allLayerIds, ...RIBBON_LAYERS].map((id) => [id, undefined]));

  it('hides ribboned bands once ribbons are drawn, and leaves buses up', () => {
    const { map, visibility } = fakeMap(seedAll());
    updateRouteVisibility(map, view({ ribbonLines: ['4'] }));

    expect(visibility.get('route_tram')).toBe('none');
    expect(visibility.get('route_subway')).toBe('none');
    expect(visibility.get('route_rail')).toBe('none');
    expect(visibility.get('route_bus')).toBe('visible');
    expect(visibility.get('route_trunk')).toBe('visible');
    expect(visibility.get('route_ferry')).toBe('visible');
  });

  it('hides everything route-shaped when the routes switch is off', () => {
    const { map, visibility } = fakeMap(seedAll());
    updateRouteVisibility(map, view({ routes: false }));

    for (const id of [...allLayerIds, ...RIBBON_LAYERS]) {
      expect(visibility.get(id)).toBe('none');
    }
  });

  it('follows each mode toggle', () => {
    const { map, visibility } = fakeMap(seedAll());
    updateRouteVisibility(
      map,
      view({ modes: { tram: true, bus: false, metro: false, train: false, ferry: false } })
    );

    expect(visibility.get('route_tram')).toBe('visible');
    // Light rail is toggled with the trams.
    expect(visibility.get('route_lrail')).toBe('visible');
    expect(visibility.get('route_bus')).toBe('none');
    expect(visibility.get('route_ferry')).toBe('none');
  });

  it('hides the tiles entirely when the reader has filtered to lines', () => {
    const { map, visibility } = fakeMap(seedAll());
    updateRouteVisibility(map, view({ lines: ['4', '7'] }));

    expect(visibility.get('route_tram')).toBe('none');
    expect(visibility.get('route_bus')).toBe('none');
    // The ribbons are those routes, drawn better.
    expect(visibility.get('route-lines-layer')).toBe('visible');
  });
});

describe('base filters', () => {
  it("narrows a layer using the style's own filter, not an assumed one", () => {
    // The light style draws the metro from a separate source filtered on
    // whether the segment runs underground. Narrowing has to keep that.
    const underground = ['==', ['get', 'underground'], 'true'];
    const { map, filters } = fakeMap({ route_subway_underground: underground });

    updateRouteVisibility(map, view({ selectedLine: 'M1' }));

    expect(filters.get('route_subway_underground')).toEqual([
      'all',
      underground,
      ['!', ['in', ['get', 'routeIdParsed'], ['literal', ['M1']]]],
    ]);
  });

  it('restores the original filter when nothing is selected', () => {
    const original = ['==', ['get', 'mode'], 'TRAM'];
    const { map, filters } = fakeMap({ route_tram: original });

    updateRouteVisibility(map, view({ selectedLine: '4' }));
    expect(filters.get('route_tram')).not.toEqual(original);

    updateRouteVisibility(map, view());
    expect(filters.get('route_tram')).toEqual(original);
  });

  it('narrows a layer that had no filter, and restores it to none', () => {
    // Commuter rail in the light style: its source is only rail, so it ships
    // without a filter at all.
    const { map, filters } = fakeMap({ route_rail: undefined });

    updateRouteVisibility(map, view({ selectedLine: 'E' }));
    expect(filters.get('route_rail')).toEqual([
      '!',
      ['in', ['get', 'routeIdParsed'], ['literal', ['E']]],
    ]);

    updateRouteVisibility(map, view());
    expect(filters.get('route_rail')).toBeNull();
  });

  it('leaves the single ferry crossing unnarrowed', () => {
    const original = ['==', ['get', 'mode'], 'FERRY'];
    const { map, filters } = fakeMap({ route_ferry: original });

    updateRouteVisibility(map, view({ selectedLine: '19' }));

    expect(filters.get('route_ferry')).toEqual(original);
  });

  it('fades the network down while a vehicle is selected', () => {
    const { map, opacity } = fakeMap({ route_tram: ['==', ['get', 'mode'], 'TRAM'] });

    updateRouteVisibility(map, view({ selectedLine: '4' }));
    expect(opacity.get('route_tram')).toBe(0.3);

    updateRouteVisibility(map, view());
    expect(opacity.get('route_tram')).toBe(1);
  });

  it('re-reads the base after a style reload replaces the layers', () => {
    const { map, filters } = fakeMap({ route_tram: ['==', ['get', 'mode'], 'TRAM'] });
    updateRouteVisibility(map, view());

    // A theme switch swaps the style: same layer id, different filter.
    const rebuilt = ['==', ['get', 'kind'], 'tram'];
    filters.set('route_tram', rebuilt);
    forgetBaseFilters(map);

    updateRouteVisibility(map, view({ selectedLine: '4' }));
    expect(filters.get('route_tram')).toEqual([
      'all',
      rebuilt,
      ['!', ['in', ['get', 'routeIdParsed'], ['literal', ['4']]]],
    ]);
  });
});
