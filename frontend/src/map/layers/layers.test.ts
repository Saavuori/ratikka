import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { installMapLayers, type LayerSeed } from './index';

/**
 * The marker art is SVG handed to an `Image` and registered once it decodes.
 * There is no DOM here, so this stands in for one: setting `src` decodes, on a
 * later turn, because the callers assign `onload` after `src` exactly as they
 * would against a real image.
 */
class FakeImage {
  onload: (() => void) | null = null;
  width: number;
  height: number;
  #src = '';
  constructor(width = 0, height = 0) {
    this.width = width;
    this.height = height;
  }
  get src() {
    return this.#src;
  }
  set src(value: string) {
    this.#src = value;
    queueMicrotask(() => this.onload?.());
  }
}

/** Let every pending image "decode". */
const decodeImages = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeAll(() => {
  (globalThis as { Image?: unknown }).Image = FakeImage;
});
afterAll(() => {
  delete (globalThis as { Image?: unknown }).Image;
});

/**
 * A map that records what was installed on it.
 *
 * The layer modules only ever ask a map to add a source, layer or image, and to
 * say whether one is there already, so a recorder covers the whole surface they
 * use. Running the real installer against it checks what a type-check cannot:
 * that every layer is added, in one order, exactly once, anchored to something
 * that exists by the time it is needed.
 */
function recordingMap() {
  const sources = new Map<string, unknown>();
  const layers = new Map<string, { spec: Record<string, unknown>; before?: string }>();
  const images = new Set<string>();
  const order: string[] = [];
  /** Insertions that named a `beforeId` for a layer that was not there yet. */
  const danglingAnchors: Array<[string, string]> = [];

  const map = {
    getSource: (id: string) => sources.get(id),
    addSource: (id: string, spec: unknown) => {
      if (sources.has(id)) throw new Error(`source ${id} added twice`);
      sources.set(id, spec);
    },
    getLayer: (id: string) => layers.get(id),
    addLayer: (spec: Record<string, unknown>, before?: string) => {
      const id = spec.id as string;
      if (layers.has(id)) throw new Error(`layer ${id} added twice`);
      if (before && !layers.has(before)) danglingAnchors.push([id, before]);
      layers.set(id, { spec, before });
      order.push(id);
    },
    hasImage: (id: string) => images.has(id),
    addImage: (id: string) => images.add(id),
    getStyle: () => ({ layers: [...layers.values()].map((l) => l.spec) }),
    setLayoutProperty: () => {},
    setPaintProperty: () => {},
    setFilter: () => {},
  };
  return { map: map as unknown as MapLibreMap, sources, layers, images, order, danglingAnchors };
}

const seed: LayerSeed = {
  theme: 'light',
  is3D: false,
  always3DVehicles: false,
  mmlKey: '',
  journeyVehicleIds: [],
  selectedVehicleId: null,
  bikeStations: null,
  trafficLights: [],
  isCurrent: () => true,
};

describe('installMapLayers', () => {
  it('installs the whole map without an existing style to build on', () => {
    const rec = recordingMap();
    expect(() => installMapLayers(rec.map, seed)).not.toThrow();
    expect(rec.layers.size).toBeGreaterThan(20);
    expect(rec.sources.size).toBeGreaterThan(5);
  });

  it('draws every group: vehicles, routes, stops, bikes, junctions, journey', () => {
    const rec = recordingMap();
    installMapLayers(rec.map, seed);
    const ids = [...rec.layers.keys()];

    for (const expected of [
      'trams-circles',
      'trams-body',
      'trams-labels',
      'trams-selected-layer',
      'vehicles-3d',
      'route-lines-casing',
      'route-lines-layer',
      'stops_tram',
      'stops_metro',
      'stops_train',
      'stops_ferry',
      'stops_signs',
      'journey-walk-layer',
      'journey-transit-layer',
    ]) {
      expect(ids, `${expected} missing`).toContain(expected);
    }
  });

  it('never anchors a layer to one that has not been added yet', () => {
    // MapLibre drops the anchor and appends on top instead, which silently
    // reorders the map. This is the failure a split into modules risks.
    const rec = recordingMap();
    installMapLayers(rec.map, seed);
    expect(rec.danglingAnchors).toEqual([]);
  });

  it('is idempotent: a theme reload re-runs it over the same style', () => {
    const rec = recordingMap();
    installMapLayers(rec.map, seed);
    const after = [...rec.layers.keys()];

    // Adding anything twice throws in the recorder, so a clean second pass is
    // the assertion.
    expect(() => installMapLayers(rec.map, seed)).not.toThrow();
    expect([...rec.layers.keys()]).toEqual(after);
  });

  it('keeps the route ribbons beneath the vehicles', () => {
    const rec = recordingMap();
    installMapLayers(rec.map, seed);
    expect(rec.layers.get('route-lines-casing')?.before).toBe('trams-circles');
    expect(rec.layers.get('route-lines-layer')?.before).toBe('trams-circles');
  });

  it('starts the 3D bodies hidden when the map is not tilted', () => {
    const rec = recordingMap();
    installMapLayers(rec.map, seed);
    const layout = rec.layers.get('vehicles-3d')?.spec.layout as { visibility?: string };
    expect(layout?.visibility).toBe('none');
  });

  it('starts them visible when the map opens already tilted', () => {
    const rec = recordingMap();
    installMapLayers(rec.map, { ...seed, is3D: true });
    const layout = rec.layers.get('vehicles-3d')?.spec.layout as { visibility?: string };
    expect(layout?.visibility).toBe('visible');
  });

  it('seeds the bike source with the stations it already had', () => {
    const rec = recordingMap();
    const bikeStations = {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [24.9, 60.17] as [number, number] },
          properties: {
            stationId: 'A1',
            name: 'Rautatientori',
            bikesAvailable: 3,
            spacesAvailable: 9,
            allowPickup: true,
            allowDropoff: true,
          },
        },
      ],
    };
    installMapLayers(rec.map, { ...seed, bikeStations });
    const src = rec.sources.get('citybike') as { data?: { features?: unknown[] } };
    expect(src?.data?.features).toHaveLength(1);
  });

  it('registers the vehicle marker images once they decode', async () => {
    const rec = recordingMap();
    installMapLayers(rec.map, seed);
    await decodeImages();
    expect(rec.images.size).toBeGreaterThan(10);
  });

  it('skips images whose style went away while they were decoding', async () => {
    // An icon that finishes decoding after a theme swap belongs to a style that
    // no longer exists; registering it would throw inside MapLibre.
    const rec = recordingMap();
    installMapLayers(rec.map, { ...seed, isCurrent: () => false });
    await decodeImages();
    expect(rec.images.size).toBe(0);
    // The layers themselves are still installed — only the late art is dropped.
    expect(rec.layers.size).toBeGreaterThan(20);
  });

  it('builds the same map in the dark theme, plus what that basemap lacks', () => {
    const light = recordingMap();
    installMapLayers(light.map, seed);
    const dark = recordingMap();
    installMapLayers(dark.map, { ...seed, theme: 'dark' });

    // Carto's dark basemap carries no platform polygons, so the dark theme
    // draws its own. Everything else is the same map in the same order.
    const extra = dark.order.filter((id) => !light.order.includes(id));
    expect(extra).toEqual([
      'stop-platform-fill',
      'stop-platform-tactile',
      'stop-platform-kerb',
      'stop-platform-3d',
    ]);
    expect(dark.order.filter((id) => !extra.includes(id))).toEqual(light.order);
  });
});
