import { describe, it, expect } from 'vitest';
import { createPropertyExpression, v8 } from '@maplibre/maplibre-gl-style-spec';
import type { StylePropertySpecification } from '@maplibre/maplibre-gl-style-spec';
import {
  sectionRing,
  vehicleExtrusions,
  vehicleExtrusionCollection,
  vehicleBodyColor,
  vehicleModel,
  ferryExtrusions,
  FERRY_MODEL,
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
import { metersBetween, offsetMeters } from './geo';
import { METRO_ORANGE, TRAIN_PURPLE, BUS_BLUE, TRAM_GREEN, FERRY_CYAN, FERRY_COLORS, ROUTE_COLORS } from './routeColors';
import { occupancyColor } from './occupancy';

const HELSINKI: [number, number] = [24.94, 60.17];

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

  describe('articulation', () => {
    // A right-angle corner, the way a tram takes one: the rails run east up to
    // the junction and north out of it. `trackSpine` in lib/railTracks builds
    // the real thing off the route geometry; this is the same contract.
    const corner = (along: number) => {
      if (along >= 0) {
        // Ahead of the centre: up the northbound leg.
        return { ...offsetAt(0, along), hdg: 0 };
      }
      // Behind it: back down the eastbound one.
      return { ...offsetAt(90, -along), hdg: 90 };
    };
    function offsetAt(hdg: number, distance: number) {
      const [lng, lat] = offsetMeters(HELSINKI[0], HELSINKI[1], hdg, distance, 0);
      return { lng, lat };
    }

    it('leaves a vehicle with no path a single rigid body', () => {
      const rigid = vehicleExtrusions({ ...base, mode: 'tram', hdg: 90 });
      const bodies = rigid.filter((p) => p.properties.part === 'body');
      // Every section on one heading: the flanks are all on the same line.
      const lats = bodies.flatMap((b) => b.geometry.coordinates[0].map(([, lat]) => lat));
      expect(Math.max(...lats) - Math.min(...lats)).toBeLessThan(0.00006); // ~6 m, the body's width
    });

    it('bends the sections round a corner instead of ploughing across it', () => {
      const bent = vehicleExtrusions({ ...base, mode: 'tram', hdg: 45, spine: corner });
      const bodies = bent.filter((p) => p.properties.part === 'body');
      expect(bodies).toHaveLength(3);

      // The leading section is up the northbound leg, north and no further
      // east than the corner; the trailing one is back down the eastbound leg.
      const centre = (index: number) => {
        const ring = bodies[index].geometry.coordinates[0];
        const lng = ring.reduce((a, [x]) => a + x, 0) / ring.length;
        const lat = ring.reduce((a, [, y]) => a + y, 0) / ring.length;
        return [lng, lat] as [number, number];
      };
      const [frontLng, frontLat] = centre(0);
      const [backLng, backLat] = centre(2);
      expect(frontLat).toBeGreaterThan(HELSINKI[1]);
      expect(frontLng).toBeCloseTo(HELSINKI[0], 5);
      expect(backLng).toBeGreaterThan(HELSINKI[0]);
      expect(backLat).toBeCloseTo(HELSINKI[1], 5);

      // Bent round the corner the body occupies less ground than its 27 m
      // length — exactly what a rigid box cannot do.
      expect(metersBetween(centre(0), centre(2))).toBeLessThan(24);
      expect(metersBetween(centre(0), centre(2))).toBeGreaterThan(12);
    });

    it('keeps each section its own true length along the path', () => {
      const bent = vehicleExtrusions({ ...base, mode: 'tram', hdg: 45, spine: corner });
      const rigid = vehicleExtrusions({ ...base, mode: 'tram', hdg: 0 });
      const spanOf = (parts: typeof bent, index: number) => {
        const ring = parts.filter((p) => p.properties.part === 'body')[index].geometry.coordinates[0];
        let longest = 0;
        for (const a of ring) for (const b of ring) longest = Math.max(longest, metersBetween(a, b));
        return longest;
      };
      // The leading section runs straight up the northbound leg in both, so
      // articulation must not have stretched or shrunk it.
      expect(spanOf(bent, 0)).toBeCloseTo(spanOf(rigid, 0), 1);
    });

    it('bridges the joint with a gangway that reaches both sections', () => {
      const bent = vehicleExtrusions({ ...base, mode: 'tram', hdg: 45, spine: corner });
      const bodies = bent.filter((p) => p.properties.part === 'body');
      const gangways = bent.filter((p) => p.properties.part === 'gangway');
      expect(gangways).toHaveLength(2);
      // Every gangway corner has to sit against one of the sections it joins.
      // Laid out in a single section's frame instead — which is what a rigid
      // body can get away with — the far end hangs in the air on the outside
      // of the bend, and the tram comes apart at its joints.
      for (const gangway of gangways) {
        for (const corner of gangway.geometry.coordinates[0]) {
          const nearest = Math.min(
            ...bodies.flatMap((b) => b.geometry.coordinates[0].map((p) => metersBetween(p, corner)))
          );
          expect(nearest).toBeLessThan(1.5);
        }
      }
    });

    it('rides the running gear and doors with the section they belong to', () => {
      const bent = vehicleExtrusions({ ...base, mode: 'tram', hdg: 45, spine: corner });
      // The tram's leading bogie sits at +10 m, on the northbound leg; the
      // trailing one at -10 m, on the eastbound leg. Each must be where its own
      // section is, not strung along one rigid heading through the buildings.
      const bogies = bent.filter((p) => p.properties.part === 'bogie');
      const lats = bogies.map((b) => b.geometry.coordinates[0][0][1]);
      const lngs = bogies.map((b) => b.geometry.coordinates[0][0][0]);
      expect(Math.max(...lats)).toBeGreaterThan(HELSINKI[1] + 0.00005);
      expect(Math.max(...lngs)).toBeGreaterThan(HELSINKI[0] + 0.0001);
    });
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

describe('the ferry', () => {
  const boat = {
    veh: 'f1', lng: HELSINKI[0], lat: HELSINKI[1], hdg: 0,
    mode: 'ferry', desi: '19', doorsOpen: false,
  };

  it('is a vessel, not a carriage: no wheels, no bogies, no pantograph', () => {
    const parts = vehicleExtrusions(boat);
    for (const absent of ['wheel', 'wheel-hub', 'bogie', 'pantograph', 'gangway']) {
      expect(parts.filter((p) => p.properties.part === absent)).toHaveLength(0);
    }
    expect(parts.filter((p) => p.properties.part === 'hull').length).toBeGreaterThan(0);
    expect(parts.filter((p) => p.properties.part === 'deckhouse')).toHaveLength(1);
    expect(parts.filter((p) => p.properties.part === 'wheelhouse')).toHaveLength(1);
    expect(parts.filter((p) => p.properties.part === 'funnel')).toHaveLength(1);
  });

  it('is routed through the vessel builder rather than the carriage one', () => {
    expect(vehicleExtrusions(boat)).toEqual(ferryExtrusions(boat));
  });

  it('is a Suomenlinna boat at real scale: about 35 m on an 8.5 m beam', () => {
    const { hull } = FERRY_MODEL;
    expect(hull.front - hull.back).toBeGreaterThan(30);
    expect(hull.front - hull.back).toBeLessThan(40);
    expect(hull.halfWidth * 2).toBeGreaterThan(7);
    expect(hull.halfWidth * 2).toBeLessThan(10);
    // Wider than anything on rails or road, which is what makes it read as a
    // boat from above rather than as an unusually fat tram.
    for (const mode of ['tram', 'bus', 'metro', 'train']) {
      expect(hull.halfWidth).toBeGreaterThan(vehicleModel(mode).sections[0].halfWidth);
    }
  });

  it('takes its line colour, and the mode cyan for a line without one', () => {
    expect(vehicleBodyColor('ferry', '19')).toBe(FERRY_COLORS['19']);
    expect(vehicleBodyColor('ferry', '99')).toBe(FERRY_CYAN);
    const hulls = vehicleExtrusions(boat).filter((p) => p.properties.part === 'hull');
    expect(hulls.some((p) => p.properties.color === FERRY_COLORS['19'])).toBe(true);
  });

  it('fills its deck gauge from the stern forward as the load is reported', () => {
    const lengthOf = (occupancy: number | null) => {
      const parts = ferryExtrusions({ ...boat, occupancy });
      const fill = parts.find((p) => p.properties.part === 'load-fill');
      if (!fill) return 0;
      const lngs = fill.geometry.coordinates[0].map(([lng]) => lng);
      return metersBetween([Math.min(...lngs), HELSINKI[1]], [Math.max(...lngs), HELSINKI[1]]);
    };
    // Heading north, so "along the hull" runs in latitude and the fill's own
    // extent along the boat is what grows; measured across the gauge instead it
    // would be constant. Compare the along-axis extents directly.
    const along = (occupancy: number | null) => {
      const parts = ferryExtrusions({ ...boat, occupancy });
      const fill = parts.find((p) => p.properties.part === 'load-fill');
      if (!fill) return 0;
      const lats = fill.geometry.coordinates[0].map(([, lat]) => lat);
      return metersBetween([HELSINKI[0], Math.min(...lats)], [HELSINKI[0], Math.max(...lats)]);
    };
    expect(lengthOf(0.5)).toBeGreaterThan(0);
    expect(along(0.25)).toBeGreaterThan(0);
    expect(along(0.5)).toBeGreaterThan(along(0.25));
    expect(along(1)).toBeGreaterThan(along(0.5));
    // The gauge never outgrows its own track.
    const gauge = FERRY_MODEL.loadGauge;
    expect(along(1)).toBeLessThanOrEqual(gauge.front - gauge.back + 0.5);
  });

  it('colours the gauge by how full it is', () => {
    const colorAt = (occupancy: number) =>
      ferryExtrusions({ ...boat, occupancy })
        .find((p) => p.properties.part === 'load-fill')!.properties.color;
    expect(colorAt(0.4)).toBe(occupancyColor(0.4));
    expect(colorAt(1)).toBe(occupancyColor(1));
    expect(colorAt(1)).not.toBe(colorAt(0.2));
  });

  it('shows an unreported load as a grey rail, never as an empty deck', () => {
    const unknown = ferryExtrusions({ ...boat, occupancy: null })
      .find((p) => p.properties.part === 'load-fill')!;
    const empty = ferryExtrusions({ ...boat, occupancy: 0 })
      .find((p) => p.properties.part === 'load-fill');
    expect(unknown.properties.color).not.toBe(occupancyColor(0));
    // A boat reported empty has nothing filled in at all, which is a different
    // drawing again from a boat nobody has counted.
    expect(empty).toBeUndefined();
    // Both still get the track, so the gauge is always visibly there.
    expect(ferryExtrusions({ ...boat, occupancy: null })
      .filter((p) => p.properties.part === 'load-track')).toHaveLength(1);
  });

  it('keeps the gauge, hull and saloon when the small furniture is dropped', () => {
    const distant = ferryExtrusions({ ...boat, occupancy: 0.6 }, false);
    const full = ferryExtrusions({ ...boat, occupancy: 0.6 });
    expect(distant.length).toBeLessThan(full.length);
    for (const part of ['hull', 'deckhouse', 'load-track', 'load-fill']) {
      expect(distant.filter((p) => p.properties.part === part))
        .toEqual(full.filter((p) => p.properties.part === part));
    }
    expect(distant.filter((p) => p.properties.part === 'door')).toHaveLength(0);
  });

  it('opens its side ramps on both flanks', () => {
    const shut = ferryExtrusions(boat).filter((p) => p.properties.part === 'doorway');
    const open = ferryExtrusions({ ...boat, doorsOpen: true })
      .filter((p) => p.properties.part === 'doorway');
    expect(shut).toHaveLength(0);
    expect(open).toHaveLength(FERRY_MODEL.doors.length * 2);
  });
});
