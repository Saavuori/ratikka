import { describe, it, expect } from 'vitest';
import { createPropertyExpression, v8 } from '@maplibre/maplibre-gl-style-spec';
import type { StylePropertySpecification } from '@maplibre/maplibre-gl-style-spec';
import {
  BIKE_GAUGE_BUCKETS,
  bikeGaugeIconSvg,
  bikeStationExtrusions,
  bikeStationCollection,
  acrossFrom,
  RACK,
  DEFAULT_RACK_BEARING,
  BIKE_3D_MIN_ZOOM,
  BIKE_3D_FULL_ZOOM,
  BIKE_3D_FADE_IN,
  BIKE_ICON_FADE_OUT,
  CITYBIKE_YELLOW,
} from './bikeStationModels';
import type { BikeStationState } from './bikeStationModels';
import { SELECTED_COLOR } from './vehicleModels';
import { metersBetween } from './stopModels';

const HELSINKI: [number, number] = [24.94, 60.17];

const station = (over: Partial<BikeStationState> = {}): BikeStationState => ({
  stationId: '001',
  lng: HELSINKI[0],
  lat: HELSINKI[1],
  bikesAvailable: 4,
  spacesAvailable: 6,
  bearing: 0,
  ...over,
});

const partsOf = (s: BikeStationState) =>
  bikeStationExtrusions(s).map((f) => f.properties.part);

describe('bikeGaugeIconSvg', () => {
  it('draws a bicycle, not a numeral', () => {
    const svg = bikeGaugeIconSvg(BIKE_GAUGE_BUCKETS[3]);
    // Two wheels and the disc they sit in.
    expect(svg.match(/<circle/g)?.length).toBeGreaterThanOrEqual(5);
    expect(svg).toContain('<path');
  });

  it('leaves the arc off an empty station rather than drawing a hairline', () => {
    const empty = bikeGaugeIconSvg(BIKE_GAUGE_BUCKETS[0]);
    expect(empty).not.toContain('stroke-dasharray');
    expect(bikeGaugeIconSvg(BIKE_GAUGE_BUCKETS[5])).toContain('stroke-dasharray');
  });

  it('colours the arc and the bicycle from the same scarcity bucket', () => {
    for (const bucket of BIKE_GAUGE_BUCKETS) {
      const svg = bikeGaugeIconSvg(bucket);
      expect(svg.split(bucket.color).length - 1).toBeGreaterThanOrEqual(2);
    }
  });

  it('survives being encoded into a data URI', () => {
    for (const bucket of BIKE_GAUGE_BUCKETS) {
      const uri = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(bikeGaugeIconSvg(bucket));
      expect(uri).not.toContain('#');
      expect(uri.length).toBeLessThan(4000);
    }
  });
});

describe('bikeStationExtrusions', () => {
  it('draws a dock per dock and a bike per bike', () => {
    const parts = partsOf(station({ bikesAvailable: 3, spacesAvailable: 5 }));
    expect(parts.filter((p) => p === 'dock')).toHaveLength(8);
    // Two wheels, a frame and a handlebar for each of the three bikes.
    expect(parts.filter((p) => p === 'wheel')).toHaveLength(6);
    expect(parts.filter((p) => p === 'frame')).toHaveLength(3);
    expect(parts.filter((p) => p === 'bar')).toHaveLength(3);
  });

  it('shows an empty station as empty docks', () => {
    const parts = partsOf(station({ bikesAvailable: 0, spacesAvailable: 9 }));
    expect(parts.filter((p) => p === 'dock')).toHaveLength(9);
    expect(parts).not.toContain('frame');
  });

  it('shows a full station as a full rack', () => {
    const parts = partsOf(station({ bikesAvailable: 7, spacesAvailable: 0 }));
    expect(parts.filter((p) => p === 'frame')).toHaveLength(7);
    expect(parts.filter((p) => p === 'dock')).toHaveLength(7);
  });

  it('still stands a rack up when the counts are unknown', () => {
    const parts = partsOf(station({ bikesAvailable: 0, spacesAvailable: 0 }));
    expect(parts.filter((p) => p === 'dock').length).toBeGreaterThanOrEqual(4);
    expect(parts).toContain('terminal');
    expect(parts).toContain('sign');
  });

  it('caps a huge station so a dense view stays cheap', () => {
    const parts = partsOf(station({ bikesAvailable: 40, spacesAvailable: 40 }));
    expect(parts.filter((p) => p === 'dock')).toHaveLength(RACK.maxDocks);
    expect(parts.filter((p) => p === 'frame')).toHaveLength(RACK.maxBikes);
  });

  it('ignores negative or fractional counts from a bad payload', () => {
    const parts = partsOf(station({ bikesAvailable: -3, spacesAvailable: 4.7 }));
    expect(parts).not.toContain('frame');
    expect(parts.filter((p) => p === 'dock')).toHaveLength(4);
  });

  it('paints the bikes and the sign gold when the station is selected', () => {
    const plain = bikeStationExtrusions(station());
    const picked = bikeStationExtrusions(station({ highlighted: true }));
    const colorOf = (features: typeof plain, part: string) =>
      features.find((f) => f.properties.part === part)!.properties.color;
    expect(colorOf(plain, 'frame')).toBe(CITYBIKE_YELLOW);
    expect(colorOf(picked, 'frame')).toBe(SELECTED_COLOR);
    expect(colorOf(picked, 'sign')).toBe(SELECTED_COLOR);
  });

  it('keeps every box above the ground and below the terminal', () => {
    for (const f of bikeStationExtrusions(station())) {
      expect(f.properties.base).toBeGreaterThanOrEqual(0);
      expect(f.properties.top).toBeGreaterThan(f.properties.base);
      expect(f.properties.top).toBeLessThanOrEqual(RACK.apronHeight + RACK.terminal.height);
    }
  });

  it('closes every ring, as GeoJSON polygons must be', () => {
    for (const f of bikeStationExtrusions(station())) {
      const ring = f.geometry.coordinates[0];
      expect(ring[0]).toEqual(ring[ring.length - 1]);
      expect(ring.length).toBeGreaterThanOrEqual(5);
    }
  });

  it('builds the rack at real metre scale', () => {
    const apron = bikeStationExtrusions(station({ bikesAvailable: 5, spacesAvailable: 5 }))
      .find((f) => f.properties.part === 'apron')!;
    const ring = apron.geometry.coordinates[0];
    // The apron is the rack's docks end to end, plus a margin at either end.
    const expected = 9 * RACK.dockPitch + 2 * RACK.apronMargin;
    const longest = Math.max(
      metersBetween(ring[0], ring[1]),
      metersBetween(ring[1], ring[2]),
    );
    expect(longest).toBeCloseTo(expected, 1);
  });

  it('turns the whole rack with its bearing', () => {
    const east = bikeStationExtrusions(station({ bearing: 90 }))
      .find((f) => f.properties.part === 'rail')!;
    const north = bikeStationExtrusions(station({ bearing: 0 }))
      .find((f) => f.properties.part === 'rail')!;
    const spanLng = (f: typeof east) => {
      const xs = f.geometry.coordinates[0].map((c) => c[0]);
      return Math.max(...xs) - Math.min(...xs);
    };
    // A rail running east-west is wide in longitude; the same rail running
    // north-south is not.
    expect(spanLng(east)).toBeGreaterThan(spanLng(north) * 10);
  });

  it('falls back to a fixed bearing rather than dropping an unoriented rack', () => {
    const guessed = bikeStationExtrusions(station({ bearing: null }));
    const fixed = bikeStationExtrusions(station({ bearing: DEFAULT_RACK_BEARING }));
    expect(guessed).toEqual(fixed);
  });

  it('collects a whole screenful into one FeatureCollection', () => {
    const collection = bikeStationCollection([station(), station({ stationId: '002' })]);
    expect(collection.type).toBe('FeatureCollection');
    expect(new Set(collection.features.map((f) => f.properties.stationId)))
      .toEqual(new Set(['001', '002']));
  });

  it('places a bike nose-out from the rail', () => {
    const wheels = bikeStationExtrusions(station({ bikesAvailable: 1, spacesAvailable: 5 }))
      .filter((f) => f.properties.part === 'wheel');
    expect(wheels).toHaveLength(2);
    const centre = (f: (typeof wheels)[number]): [number, number] => {
      const ring = f.geometry.coordinates[0].slice(0, -1);
      return [
        ring.reduce((a, c) => a + c[0], 0) / ring.length,
        ring.reduce((a, c) => a + c[1], 0) / ring.length,
      ];
    };
    // The two axles sit a wheelbase apart, both out from the same dock.
    expect(metersBetween(centre(wheels[0]), centre(wheels[1])))
      .toBeCloseTo(RACK.bike.wheelbase, 1);
    // And both wheels stand out on the same side of the rail, not straddling it.
    const out = acrossFrom(HELSINKI[0], HELSINKI[1], 0, 3);
    const back = acrossFrom(HELSINKI[0], HELSINKI[1], 0, -3);
    for (const wheel of wheels) {
      expect(metersBetween(out, centre(wheel)))
        .toBeLessThan(metersBetween(back, centre(wheel)));
    }
  });
});

describe('zoom ramps', () => {
  const evaluate = (expression: unknown, zoom: number) => {
    const spec = v8['paint_fill-extrusion']['fill-extrusion-opacity'] as StylePropertySpecification;
    const compiled = createPropertyExpression(expression, 'fill-extrusion-opacity', spec);
    if (compiled.result === 'error') throw new Error('invalid expression');
    return compiled.value.evaluate({ zoom }, {} as never);
  };

  it('fades the racks in over the band where a metre is worth a pixel', () => {
    expect(evaluate(BIKE_3D_FADE_IN, BIKE_3D_MIN_ZOOM)).toBe(0);
    expect(evaluate(BIKE_3D_FADE_IN, BIKE_3D_FULL_ZOOM)).toBeGreaterThan(0.9);
  });

  it('hands the flat marker over to the rack rather than stacking the two', () => {
    expect(evaluate(BIKE_ICON_FADE_OUT, BIKE_3D_MIN_ZOOM - 1)).toBe(1);
    expect(evaluate(BIKE_ICON_FADE_OUT, BIKE_3D_FULL_ZOOM)).toBe(0);
  });
});
