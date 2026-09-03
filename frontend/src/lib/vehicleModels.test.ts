import { describe, it, expect } from 'vitest';
import {
  offsetMeters,
  sectionRing,
  vehicleExtrusions,
  vehicleExtrusionCollection,
  vehicleBodyColor,
  vehicleModel,
  VEHICLE_MODELS,
  GLASS_COLOR,
  DOORS_OPEN_COLOR,
  SELECTED_COLOR,
} from './vehicleModels';
import { METRO_ORANGE, TRAIN_PURPLE, BUS_BLUE, TRAM_GREEN, ROUTE_COLORS } from './routeColors';

const HELSINKI: [number, number] = [24.94, 60.17];

// Metres between two lng/lat points, good enough at city scale.
function metersBetween(a: [number, number], b: [number, number]): number {
  const mPerDegLat = 111320;
  const mPerDegLng = mPerDegLat * Math.cos((a[1] * Math.PI) / 180);
  const dx = (b[0] - a[0]) * mPerDegLng;
  const dy = (b[1] - a[1]) * mPerDegLat;
  return Math.hypot(dx, dy);
}

describe('offsetMeters', () => {
  const [lng, lat] = HELSINKI;

  it('moves along the heading and to its right', () => {
    // Facing north: ahead is north, right is east.
    const ahead = offsetMeters(lng, lat, 0, 100, 0);
    expect(ahead[1]).toBeGreaterThan(lat);
    expect(ahead[0]).toBeCloseTo(lng, 6);

    const right = offsetMeters(lng, lat, 0, 0, 100);
    expect(right[0]).toBeGreaterThan(lng);
    expect(right[1]).toBeCloseTo(lat, 6);

    // Facing east: ahead is east, right is south.
    const eastAhead = offsetMeters(lng, lat, 90, 100, 0);
    expect(eastAhead[0]).toBeGreaterThan(lng);
    expect(eastAhead[1]).toBeCloseTo(lat, 6);
    expect(offsetMeters(lng, lat, 90, 0, 100)[1]).toBeLessThan(lat);
  });

  it('offsets by the distance it is given', () => {
    expect(metersBetween(HELSINKI, offsetMeters(lng, lat, 37, 250, 0))).toBeCloseTo(250, 0);
  });
});

describe('sectionRing', () => {
  const [lng, lat] = HELSINKI;

  it('draws a closed ring as long as the section', () => {
    const section = { front: 13.5, back: -13.5, halfWidth: 1.2 };
    const ring = sectionRing(lng, lat, 0, section);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    // Four corners plus the repeated first point.
    expect(ring).toHaveLength(5);
    // Front-right to back-right is the full 27 m body.
    expect(metersBetween(ring[0], ring[1])).toBeCloseTo(27, 0);
  });

  it('chamfers the ends that carry a nose or a tail', () => {
    const flat = sectionRing(lng, lat, 0, { front: 10, back: -10, halfWidth: 1.5 });
    const raked = sectionRing(lng, lat, 0, { front: 10, back: -10, halfWidth: 1.5, nose: 3 });
    expect(raked.length).toBe(flat.length + 2);
  });

  it('widens the ring for the window band', () => {
    const section = { front: 10, back: -10, halfWidth: 1.5 };
    const body = sectionRing(lng, lat, 0, section);
    const glass = sectionRing(lng, lat, 0, section, 0.04);
    // Both flanks move out by the widening, so the body is 8 cm narrower.
    expect(metersBetween(glass[0], glass[3]) - metersBetween(body[0], body[3])).toBeCloseTo(0.08, 2);
  });
});

describe('vehicleExtrusions', () => {
  const base = { veh: 'v1', lng: HELSINKI[0], lat: HELSINKI[1], hdg: 0, desi: '4', doorsOpen: false };

  it('gives the metro its two coupled units', () => {
    const parts = vehicleExtrusions({ ...base, mode: 'metro', desi: 'M1' });
    // Two bodies and a window band around each.
    expect(parts.filter((p) => p.properties.part === 'body')).toHaveLength(2);
    expect(parts.filter((p) => p.properties.part === 'glass')).toHaveLength(2);
    expect(parts.some((p) => p.properties.part === 'roof')).toBe(false);
  });

  it('gives the commuter train a pantograph above its roof', () => {
    const parts = vehicleExtrusions({ ...base, mode: 'train', desi: 'A' });
    const roof = parts.find((p) => p.properties.part === 'roof');
    expect(roof).toBeDefined();
    expect(roof!.properties.base).toBeGreaterThanOrEqual(VEHICLE_MODELS.train.height);
  });

  it('sizes each mode like the real vehicle', () => {
    const length = (mode: string) => {
      const model = vehicleModel(mode);
      const front = Math.max(...model.sections.map((s) => s.front));
      const back = Math.min(...model.sections.map((s) => s.back));
      return front - back;
    };
    expect(length('bus')).toBeLessThan(length('tram'));
    expect(length('tram')).toBeLessThan(length('train'));
    expect(length('train')).toBeLessThan(length('metro'));
  });

  it('colours bodies exactly like the flat icons', () => {
    expect(vehicleBodyColor('bus', '550')).toBe(BUS_BLUE);
    expect(vehicleBodyColor('tram', '4')).toBe(ROUTE_COLORS['4']);
    expect(vehicleBodyColor('tram', '99')).toBe(TRAM_GREEN);
    expect(vehicleBodyColor('metro', 'M9')).toBe(METRO_ORANGE);
    expect(vehicleBodyColor('train', 'Q')).toBe(TRAIN_PURPLE);
  });

  it('turns the window band amber while the doors are open', () => {
    const shut = vehicleExtrusions({ ...base, mode: 'tram' });
    const open = vehicleExtrusions({ ...base, mode: 'tram', doorsOpen: true });
    expect(shut.find((p) => p.properties.part === 'glass')!.properties.color).toBe(GLASS_COLOR);
    expect(open.find((p) => p.properties.part === 'glass')!.properties.color).toBe(DOORS_OPEN_COLOR);
  });

  it('turns a selected vehicle gold', () => {
    const parts = vehicleExtrusions({ ...base, mode: 'tram', selected: true });
    expect(parts.find((p) => p.properties.part === 'body')!.properties.color).toBe(SELECTED_COLOR);
  });

  it('rotates the body with the heading', () => {
    const north = vehicleExtrusions({ ...base, mode: 'tram' })[0].geometry.coordinates[0];
    const east = vehicleExtrusions({ ...base, mode: 'tram', hdg: 90 })[0].geometry.coordinates[0];
    // Nose to the north vs. nose to the east.
    expect(north[0][1]).toBeGreaterThan(base.lat);
    expect(east[0][0]).toBeGreaterThan(base.lng);
  });

  it('collects every vehicle into one FeatureCollection', () => {
    const fc = vehicleExtrusionCollection([
      { ...base, mode: 'tram' },
      { ...base, veh: 'v2', mode: 'metro', desi: 'M2' },
    ]);
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features).toHaveLength(2 + 4);
    expect(new Set(fc.features.map((f) => f.properties.veh))).toEqual(new Set(['v1', 'v2']));
  });
});
