import { describe, it, expect } from 'vitest';
import { createPropertyExpression, v8 } from '@maplibre/maplibre-gl-style-spec';
import type { StylePropertySpecification } from '@maplibre/maplibre-gl-style-spec';
import {
  offsetMeters,
  sectionRing,
  vehicleExtrusions,
  vehicleExtrusionCollection,
  vehicleBodyColor,
  vehicleModel,
  VEHICLE_MODELS,
  GLASS_COLOR,
  DOOR_COLOR,
  DOORS_OPEN_COLOR,
  CAB_COLOR,
  SELECTED_COLOR,
  HEADLIGHT_COLOR,
  TAILLIGHT_COLOR,
  BRAKE_LIGHT_COLOR,
  VEHICLE_3D_MIN_ZOOM,
  VEHICLE_3D_FULL_ZOOM,
  VEHICLE_3D_FADE_IN,
  VEHICLE_ICON_FADE_OUT,
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

  it('gives the metro four cars and three visible gangways', () => {
    const parts = vehicleExtrusions({ ...base, mode: 'metro', desi: 'M1' });
    expect(parts.filter((p) => p.properties.part === 'body')).toHaveLength(4);
    expect(parts.filter((p) => p.properties.part === 'glass')).toHaveLength(4);
    expect(parts.filter((p) => p.properties.part === 'gangway')).toHaveLength(3);
    expect(parts.filter((p) => p.properties.part === 'door')).toHaveLength(48);
  });

  it('puts doors on the right for road vehicles and both rail flanks', () => {
    for (const mode of ['tram', 'bus', 'train', 'metro']) {
      const parts = vehicleExtrusions({ ...base, mode });
      expect(parts.filter((p) => p.properties.part === 'door')).toHaveLength(
        vehicleModel(mode).doors.length * vehicleModel(mode).doorSides.length * 2
      );
      const doors = parts.filter((p) => p.properties.part === 'door');
      if (mode === 'bus' || mode === 'tram') {
        expect(doors.every((p) => p.geometry.coordinates[0].every(([lng]) => lng > base.lng))).toBe(true);
      } else {
        expect(doors.some((p) => p.geometry.coordinates[0].every(([lng]) => lng < base.lng))).toBe(true);
      }
    }
  });

  it('lays a cab patch on the roof at each driving end', () => {
    const tram = vehicleExtrusions({ ...base, mode: 'tram' }).filter((p) => p.properties.part === 'cab');
    const bus = vehicleExtrusions({ ...base, mode: 'bus' }).filter((p) => p.properties.part === 'cab');
    // The representative Helsinki tram is single-ended, like the bus.
    expect(tram).toHaveLength(1);
    expect(bus).toHaveLength(1);
    expect(tram[0].properties.color).toBe(CAB_COLOR);
    // On the roof, not inside the body.
    expect(tram[0].properties.base).toBeGreaterThanOrEqual(VEHICLE_MODELS.tram.height);
  });

  it('gives the commuter train a pantograph above its roof', () => {
    const parts = vehicleExtrusions({ ...base, mode: 'train', desi: 'A' });
    const roof = parts.find((p) => p.properties.part === 'pantograph');
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

  it('slides the leaves apart and uncovers the doorway when the doors open', () => {
    const shut = vehicleExtrusions({ ...base, mode: 'tram' });
    const open = vehicleExtrusions({ ...base, mode: 'tram', doorsOpen: true });

    // The leaves keep their own colour either way — it is the movement, and the
    // doorway it uncovers, that says the doors are open.
    expect(shut.every((p) => p.properties.part !== 'door' || p.properties.color === DOOR_COLOR)).toBe(true);
    expect(open.every((p) => p.properties.part !== 'door' || p.properties.color === DOOR_COLOR)).toBe(true);

    // A doorway exists only while the doors are open, and it is the amber one.
    expect(shut.some((p) => p.properties.part === 'doorway')).toBe(false);
    const doorways = open.filter((p) => p.properties.part === 'doorway');
    expect(doorways).toHaveLength(vehicleModel('tram').doors.length);
    expect(doorways[0].properties.color).toBe(DOORS_OPEN_COLOR);

    // And the leaves really move: no leaf is where it was when shut.
    const ring = (parts: typeof shut) =>
      parts.filter((p) => p.properties.part === 'door').map((p) => JSON.stringify(p.geometry.coordinates));
    expect(ring(open).some((r) => ring(shut).includes(r))).toBe(false);

    expect(open.find((p) => p.properties.part === 'glass')!.properties.color).toBe(GLASS_COLOR);
  });

  it('keeps parted leaves within their own straight body section, never in a joint or nose', () => {
    for (const mode of ['tram', 'bus', 'train', 'metro']) {
      const model = vehicleModel(mode);
      for (const d of model.doors) {
        const s = model.sections.find((s) => d >= s.back && d <= s.front)!;
        expect(d - model.doorWidth).toBeGreaterThan(s.back + (s.tail ?? 0));
        expect(d + model.doorWidth).toBeLessThan(s.front - (s.nose ?? 0));
      }
    }
  });

  it('animates door leaves continuously and clamps progress with compatible fallback', () => {
    for (const mode of Object.keys(VEHICLE_MODELS)) {
      const state = { ...base, mode };
      const shut = vehicleExtrusions(state);
      const open = vehicleExtrusions({ ...state, doorsOpen: true });
      expect(vehicleExtrusions({ ...state, doorProgress: -1 })).toEqual(shut);
      expect(vehicleExtrusions({ ...state, doorProgress: 2 })).toEqual(open);
      expect(vehicleExtrusions({ ...state, doorProgress: NaN })).toEqual(shut);
      expect(vehicleExtrusions({ ...state, doorsOpen: true, doorProgress: Infinity })).toEqual(open);
      expect(vehicleExtrusions({ ...state, doorsOpen: true, doorProgress: 0 })).toEqual(shut);
      const doorLat = (parts: typeof shut) => parts.find((p) => p.properties.part === 'door')!.geometry.coordinates[0][0][1];
      const halfway = vehicleExtrusions({ ...state, doorProgress: 0.5 });
      expect(doorLat(halfway)).toBeCloseTo((doorLat(shut) + doorLat(open)) / 2, 10);
    }
  });

  it('models articulated bodies, pillars, running gear and roof equipment at ground scale', () => {
    const expected = { tram: [3, 27], bus: [1, 12.5], train: [4, 75], metro: [4, 89] };
    for (const [mode, [sections, length]] of Object.entries(expected)) {
      const model = vehicleModel(mode);
      const parts = vehicleExtrusions({ ...base, mode, doorsOpen: true });
      expect(model.sections).toHaveLength(sections);
      expect(model.sections[0].front - model.sections.at(-1)!.back).toBe(length);
      for (const part of ['pillar', 'bogie', 'wheel', 'hvac', 'headlight', 'taillight']) {
        expect(parts.some((p) => p.properties.part === part)).toBe(true);
      }
      expect(parts.filter((p) => p.properties.part === 'gangway')).toHaveLength(sections - 1);
      expect(parts.some((p) => p.properties.part === 'pantograph')).toBe(mode === 'tram' || mode === 'train');
      for (const feature of parts) {
        const ring = feature.geometry.coordinates[0];
        expect(ring[0]).toEqual(ring.at(-1));
        expect(ring.flat().every(Number.isFinite)).toBe(true);
        expect(feature.properties.top).toBeGreaterThan(feature.properties.base);
        expect(feature.properties.base).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('mounts head and tail lights outside the end faces and distinguishes inferred braking from rail tails', () => {
    for (const mode of Object.keys(VEHICLE_MODELS)) {
      const normal = vehicleExtrusions({ ...base, mode });
      const braking = vehicleExtrusions({ ...base, mode, braking: true });
      expect(vehicleExtrusions({ ...base, mode, braking: false })).toEqual(normal);
      const headlights = normal.filter((p) => p.properties.part === 'headlight');
      const tails = normal.filter((p) => p.properties.part === 'taillight');
      expect(headlights).toHaveLength(2);
      expect(tails).toHaveLength(2);
      const model = vehicleModel(mode);
      const front = offsetMeters(base.lng, base.lat, 0, model.sections[0].front, 0)[1];
      const back = offsetMeters(base.lng, base.lat, 0, model.sections.at(-1)!.back, 0)[1];
      expect(headlights.every((p) => p.geometry.coordinates[0].every(([, lat]) => lat > front))).toBe(true);
      expect(tails.every((p) => p.geometry.coordinates[0].every(([, lat]) => lat < back))).toBe(true);
      expect(headlights.every((p) => p.properties.color === HEADLIGHT_COLOR)).toBe(true);
      expect(tails.every((p) => p.properties.color === TAILLIGHT_COLOR)).toBe(true);
      expect(braking.filter((p) => p.properties.part === 'taillight')
        .every((p) => p.properties.color === (mode === 'bus' || mode === 'tram' ? BRAKE_LIGHT_COLOR : TAILLIGHT_COLOR))).toBe(true);
      expect(normal.some((p) => p.properties.part === 'brake-indicator')).toBe(false);
      expect(braking.filter((p) => p.properties.part === 'brake-indicator')).toHaveLength(1);
    }
  });

  it('uses a safe representative tram for unknown modes', () => {
    expect(vehicleModel(undefined)).toBe(VEHICLE_MODELS.tram);
    expect(vehicleModel('unknown')).toBe(VEHICLE_MODELS.tram);
    expect(vehicleExtrusions({ ...base, mode: 'unknown' })).toEqual(vehicleExtrusions({ ...base, mode: 'tram' }));
  });

  it('turns a selected vehicle gold', () => {
    const parts = vehicleExtrusions({ ...base, mode: 'tram', selected: true });
    expect(parts.find((p) => p.properties.part === 'body')!.properties.color).toBe(SELECTED_COLOR);
  });

  describe('3D zoom fades', () => {
    it('validates actual MapLibre paint expressions and swaps icons for bodies at zooms 13–14', () => {
      const fade = createPropertyExpression(VEHICLE_3D_FADE_IN, 'fill-extrusion-opacity',
        v8['paint_fill-extrusion']['fill-extrusion-opacity'] as StylePropertySpecification);
      const icons = createPropertyExpression(VEHICLE_ICON_FADE_OUT, 'icon-opacity',
        v8.paint_symbol['icon-opacity'] as StylePropertySpecification);
      if (fade.result === 'error' || icons.result === 'error') throw new Error('Invalid fade expression');
      expect(VEHICLE_3D_MIN_ZOOM).toBe(13);
      expect(VEHICLE_3D_FULL_ZOOM).toBe(14);
      for (const [zoom, expected] of [[12, 0], [13, 0], [13.5, 0.5], [14, 1], [18, 1]]) {
        expect(fade.value.evaluate({ zoom })).toBe(expected);
        expect(icons.value.evaluate({ zoom })).toBe(1 - expected);
      }
    });
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
    expect(fc.features).toHaveLength(
      vehicleExtrusions({ ...base, mode: 'tram' }).length +
        vehicleExtrusions({ ...base, veh: 'v2', mode: 'metro', desi: 'M2' }).length
    );
    expect(new Set(fc.features.map((f) => f.properties.veh))).toEqual(new Set(['v1', 'v2']));
  });

  it('omits distant sub-pixel details without changing body scale, colour or live cues', () => {
    for (const mode of Object.keys(VEHICLE_MODELS)) {
      const v = { ...base, mode, braking: true, doorProgress: 0.5, selected: true };
      const full = vehicleExtrusionCollection([v]).features;
      const distant = vehicleExtrusionCollection([v], false).features;
      expect(distant.length).toBeLessThan(full.length * 0.5);
      const omitted = new Set(['pillar', 'bogie', 'wheel', 'wheel-hub', 'hvac', 'pantograph', 'door', 'doorway']);
      expect(distant.some((p) => omitted.has(p.properties.part))).toBe(false);
      for (const part of ['body', 'glass', 'gangway', 'cab', 'headlight', 'taillight', 'brake-indicator']) {
        expect(distant.filter((p) => p.properties.part === part))
          .toEqual(full.filter((p) => p.properties.part === part));
      }
      const normal = { ...v, selected: false };
      expect(vehicleExtrusionCollection([normal], false).features.filter((p) => p.properties.part === 'body'))
        .toEqual(vehicleExtrusionCollection([normal]).features.filter((p) => p.properties.part === 'body'));
    }
  });
});
