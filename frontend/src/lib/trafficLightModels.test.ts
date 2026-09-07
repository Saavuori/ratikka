import { describe, it, expect } from 'vitest';
import { createPropertyExpression, v8 } from '@maplibre/maplibre-gl-style-spec';
import type { StylePropertySpecification } from '@maplibre/maplibre-gl-style-spec';
import {
  signalPriorityIndex,
  priorityAccent,
  describeSignalPriority,
  describeRequestType,
  trafficLightIconSvg,
  trafficLightIconName,
  warningLightIconSvg,
  trafficLightExtrusions,
  trafficLightCollection,
  trafficLightStates,
  SIGNAL,
  SIGNAL_RED,
  SIGNAL_AMBER,
  SIGNAL_GREEN,
  TRAFFIC_LIGHT_ICON_VARIANTS,
  TRAFFIC_LIGHT_MIN_ZOOM,
  TRAFFIC_LIGHT_FULL_ZOOM,
  TRAFFIC_LIGHT_3D_MIN_ZOOM,
  TRAFFIC_LIGHT_3D_FULL_ZOOM,
  TRAFFIC_LIGHT_3D_FADE_IN,
  TRAFFIC_LIGHT_ICON_OPACITY,
  TRAFFIC_LIGHT_ICON_OPACITY_3D,
} from './trafficLightModels';
import type { TrafficLightState } from './trafficLightModels';
import { metersBetween } from './stopModels';
import type { VehiclePosition, TrafficLightFeature, SignalPriority } from '../types';

const HELSINKI: [number, number] = [24.94, 60.17];

const vehicle = (over: Partial<VehiclePosition> = {}): VehiclePosition => ({
  veh: '0040-407',
  desi: '10B',
  lat: HELSINKI[1],
  lng: HELSINKI[0],
  hdg: 132,
  spd: 4.9,
  dl: 0,
  drst: 0,
  route: '1010B',
  stop: null,
  ts: 1788721718,
  tripId: '',
  mode: 'tram',
  ...over,
});

const tlp = (over: Partial<SignalPriority> = {}): SignalPriority => ({
  status: 'requesting',
  junction: 75,
  ts: 1788721718,
  ...over,
});

const light = (over: Partial<TrafficLightState> = {}): TrafficLightState => ({
  junctionId: 75,
  lng: HELSINKI[0],
  lat: HELSINKI[1],
  kind: 'traffic_light',
  bearing: 0,
  ...over,
});

const partsOf = (s: TrafficLightState) =>
  trafficLightExtrusions(s).map((f) => f.properties.part);

describe('signalPriorityIndex', () => {
  it('keys the exchanges by the junction the vehicle named', () => {
    const index = signalPriorityIndex([
      vehicle({ tlp: tlp({ junction: 75 }) }),
      vehicle({ veh: '0040-408', desi: '3', tlp: tlp({ junction: 80, status: 'granted' }) }),
    ]);
    expect(index.get(75)?.desi).toBe('10B');
    expect(index.get(80)?.status).toBe('granted');
  });

  it('ignores vehicles with nothing to report', () => {
    expect(signalPriorityIndex([vehicle(), vehicle({ tlp: tlp({ junction: undefined }) })]).size)
      .toBe(0);
  });

  it('lets an answered request outrank one still waiting at the same junction', () => {
    const index = signalPriorityIndex([
      vehicle({ veh: 'a', tlp: tlp({ status: 'requesting', ts: 20 }) }),
      vehicle({ veh: 'b', tlp: tlp({ status: 'granted', ts: 10 }) }),
    ]);
    expect(index.get(75)?.status).toBe('granted');
    expect(index.get(75)?.veh).toBe('b');
  });

  it('breaks a tie between equal states on the newer one', () => {
    const index = signalPriorityIndex([
      vehicle({ veh: 'old', tlp: tlp({ ts: 10 }) }),
      vehicle({ veh: 'new', tlp: tlp({ ts: 20 }) }),
    ]);
    expect(index.get(75)?.veh).toBe('new');
  });
});

describe('priorityAccent', () => {
  it('lights the lens the state means', () => {
    expect(priorityAccent('requesting')).toBe(SIGNAL_AMBER);
    expect(priorityAccent('granted')).toBe(SIGNAL_GREEN);
    expect(priorityAccent('denied')).toBe(SIGNAL_RED);
  });

  it('lights nothing for a vehicle that decided not to ask', () => {
    expect(priorityAccent('norequest')).toBeNull();
    expect(priorityAccent(null)).toBeNull();
  });
});

describe('describeSignalPriority', () => {
  it('names the junction when there is one', () => {
    expect(describeSignalPriority(tlp())).toBe('Requesting traffic light priority at junction 75');
    expect(describeSignalPriority(tlp({ status: 'granted' })))
      .toBe('Traffic light priority granted at junction 75');
    expect(describeSignalPriority(tlp({ status: 'denied' })))
      .toBe('Traffic light priority refused at junction 75');
  });

  it('carries the reason a request was withheld', () => {
    expect(describeSignalPriority(tlp({ status: 'norequest', reason: 'PRIOEXEP' })))
      .toContain('PRIOEXEP');
  });

  it('says nothing about a junction it does not have', () => {
    expect(describeSignalPriority(tlp({ junction: undefined }))).not.toContain('junction');
  });
});

describe('describeRequestType', () => {
  it('spells out the four HFP request types', () => {
    expect(describeRequestType('NORMAL')).toBe('on approach');
    expect(describeRequestType('DOOR_CLOSE')).toBe('on closing doors');
    expect(describeRequestType('DOOR_OPEN')).toBe('on opening doors');
    expect(describeRequestType('ADVANCE')).toBe('in advance');
  });

  it('returns null for anything it does not recognise', () => {
    expect(describeRequestType('SOMETHING_NEW')).toBeNull();
    expect(describeRequestType(undefined)).toBeNull();
  });
});

describe('trafficLightIconSvg', () => {
  it('draws three lenses and a mast, whatever the state', () => {
    for (const variant of TRAFFIC_LIGHT_ICON_VARIANTS) {
      const svg = trafficLightIconSvg(variant);
      expect((svg.match(/<circle/g) ?? []).length).toBe(3);
      expect(svg).toContain('<svg');
      expect(svg).toContain('</svg>');
    }
  });

  it('leaves every lens unlit when nothing is being asked', () => {
    const svg = trafficLightIconSvg('idle');
    expect(svg).not.toContain(`fill="${SIGNAL_GREEN}"`);
    expect(svg).not.toContain(`fill="${SIGNAL_RED}"`);
    expect(svg).not.toContain(`fill="${SIGNAL_AMBER}"`);
  });

  it('lights the lens the state means, and rings the head in it', () => {
    expect(trafficLightIconSvg('granted')).toContain(`fill="${SIGNAL_GREEN}"`);
    expect(trafficLightIconSvg('requesting')).toContain(`fill="${SIGNAL_AMBER}"`);
    expect(trafficLightIconSvg('denied')).toContain(`fill="${SIGNAL_RED}"`);
    expect(trafficLightIconSvg('granted')).toContain(`stroke="${SIGNAL_GREEN}"`);
  });

  it('gives each variant its own image name, and the idle one the old name', () => {
    expect(trafficLightIconName('idle')).toBe('traffic-light-icon');
    const names = TRAFFIC_LIGHT_ICON_VARIANTS.map(trafficLightIconName);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('warningLightIconSvg', () => {
  it('is a triangle with one lamp, not a three-lens head', () => {
    const svg = warningLightIconSvg();
    expect((svg.match(/<circle/g) ?? []).length).toBe(1);
    expect(svg).toContain(SIGNAL_AMBER);
  });
});

describe('trafficLightExtrusions', () => {
  it('builds a mast with an arm and two heads', () => {
    const parts = partsOf(light());
    expect(parts).toContain('foot');
    expect(parts).toContain('mast');
    expect(parts).toContain('arm');
    // Two heads, three lenses each, a hood over every lens.
    expect(parts.filter((p) => p === 'case').length).toBe(2);
    expect(parts.filter((p) => p === 'lens').length).toBe(6);
    expect(parts.filter((p) => p === 'hood').length).toBe(6);
  });

  it('draws the state disc only while something is being asked', () => {
    expect(partsOf(light())).not.toContain('halo');
    expect(partsOf(light({
      priority: { status: 'requesting', desi: '10B', veh: 'a', ts: 1 },
    }))).toContain('halo');
    // A vehicle deciding not to ask lights nothing, so there is no disc.
    expect(partsOf(light({
      priority: { status: 'norequest', desi: '10B', veh: 'a', ts: 1 },
    }))).not.toContain('halo');
  });

  it('lights the lens matching the state, on both heads', () => {
    const lit = (status: 'requesting' | 'granted' | 'denied', color: string) =>
      trafficLightExtrusions(light({ priority: { status, desi: '10B', veh: 'a', ts: 1 } }))
        .filter((f) => f.properties.part === 'lens' && f.properties.color === color).length;
    expect(lit('granted', SIGNAL_GREEN)).toBe(2);
    expect(lit('requesting', SIGNAL_AMBER)).toBe(2);
    expect(lit('denied', SIGNAL_RED)).toBe(2);
  });

  it('leaves every lens dark when nothing is being asked', () => {
    const colors = trafficLightExtrusions(light())
      .filter((f) => f.properties.part === 'lens')
      .map((f) => f.properties.color);
    expect(colors).not.toContain(SIGNAL_GREEN);
    expect(colors).not.toContain(SIGNAL_RED);
    expect(colors).not.toContain(SIGNAL_AMBER);
  });

  it('stands the mast off the junction point rather than in the crossing', () => {
    const mast = trafficLightExtrusions(light())
      .find((f) => f.properties.part === 'mast')!;
    const ring = mast.geometry.coordinates[0];
    const centre: [number, number] = [
      (ring[0][0] + ring[2][0]) / 2,
      (ring[0][1] + ring[2][1]) / 2,
    ];
    expect(metersBetween(HELSINKI, centre)).toBeCloseTo(SIGNAL.offset, 0);
  });

  it('rings the junction itself, where the marker was, and leaves the middle clear', () => {
    const halo = trafficLightExtrusions(light({
      priority: { status: 'granted', desi: '10B', veh: 'a', ts: 1 },
    })).find((f) => f.properties.part === 'halo')!;
    // Two rings: the band, and the hole punched out of it. A single ring would
    // be a filled disc, which buries the junction it is meant to mark.
    expect(halo.geometry.coordinates.length).toBe(2);
    for (const point of halo.geometry.coordinates[0]) {
      expect(metersBetween(HELSINKI, point)).toBeCloseTo(SIGNAL.halo.radius, 0);
    }
    for (const point of halo.geometry.coordinates[1]) {
      expect(metersBetween(HELSINKI, point)).toBeCloseTo(SIGNAL.halo.innerRadius, 0);
    }
  });

  it('draws a warning light as one lamp on a short pole', () => {
    const parts = partsOf(light({ kind: 'warning_light' }));
    expect(parts.filter((p) => p === 'lens').length).toBe(1);
    expect(parts).not.toContain('arm');
  });

  it('keeps every box above the ground and the right way up', () => {
    for (const feature of trafficLightCollection([
      light(),
      light({ kind: 'warning_light', bearing: null }),
    ]).features) {
      expect(feature.properties.base).toBeGreaterThanOrEqual(0);
      expect(feature.properties.top).toBeGreaterThan(feature.properties.base);
      expect(feature.properties.top).toBeLessThanOrEqual(SIGNAL.mastHeight + 0.1);
    }
  });

  it('draws a signal with no known street bearing rather than dropping it', () => {
    expect(partsOf(light({ bearing: null })).length).toBeGreaterThan(0);
  });
});

describe('trafficLightStates', () => {
  const feature = (id: number, type: 'traffic_light' | 'warning_light' = 'traffic_light'):
    TrafficLightFeature => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: HELSINKI },
      properties: { id, type, junction: `Junction ${id}` },
    });

  it('attaches the live exchange to the junction it names, and nothing to the rest', () => {
    const priorities = signalPriorityIndex([vehicle({ tlp: tlp({ junction: 75 }) })]);
    const states = trafficLightStates([feature(75), feature(76)], priorities, () => 90);
    expect(states[0].priority?.status).toBe('requesting');
    expect(states[0].bearing).toBe(90);
    expect(states[1].priority).toBeNull();
  });
});

// The layer paint expressions are only validated by MapLibre at runtime, in a
// browser; one bad ramp silently drops the layer, and takes the layers anchored
// to it with it. Same guard the stop and bike styles carry.
describe('zoom ramps', () => {
  const evaluate = (expression: unknown, property: string, zoom: number) => {
    const spec = (property === 'icon-opacity'
      ? v8['paint_symbol']['icon-opacity']
      : v8['paint_fill-extrusion']['fill-extrusion-opacity']) as StylePropertySpecification;
    const compiled = createPropertyExpression(expression, property, spec);
    if (compiled.result === 'error') throw new Error(`invalid ${property} expression`);
    return compiled.value.evaluate({ zoom }, {} as never);
  };

  it('fades the masts in over the band where a metre is worth a pixel', () => {
    expect(evaluate(TRAFFIC_LIGHT_3D_FADE_IN, 'fill-extrusion-opacity', TRAFFIC_LIGHT_3D_MIN_ZOOM))
      .toBe(0);
    expect(evaluate(TRAFFIC_LIGHT_3D_FADE_IN, 'fill-extrusion-opacity', TRAFFIC_LIGHT_3D_FULL_ZOOM))
      .toBeGreaterThan(0.9);
  });

  it('brings the marker in at street level on the flat map and leaves it there', () => {
    expect(evaluate(TRAFFIC_LIGHT_ICON_OPACITY, 'icon-opacity', TRAFFIC_LIGHT_MIN_ZOOM)).toBe(0);
    expect(evaluate(TRAFFIC_LIGHT_ICON_OPACITY, 'icon-opacity', TRAFFIC_LIGHT_FULL_ZOOM)).toBe(1);
    expect(evaluate(TRAFFIC_LIGHT_ICON_OPACITY, 'icon-opacity', 18)).toBe(1);
  });

  it('hands the marker over to the mast in 3D rather than stacking the two', () => {
    expect(evaluate(TRAFFIC_LIGHT_ICON_OPACITY_3D, 'icon-opacity', TRAFFIC_LIGHT_FULL_ZOOM)).toBe(1);
    expect(evaluate(TRAFFIC_LIGHT_ICON_OPACITY_3D, 'icon-opacity', TRAFFIC_LIGHT_3D_MIN_ZOOM))
      .toBe(1);
    expect(evaluate(TRAFFIC_LIGHT_ICON_OPACITY_3D, 'icon-opacity', TRAFFIC_LIGHT_3D_FULL_ZOOM))
      .toBe(0);
  });

  it('brings the mast in after the marker is fully up', () => {
    expect(TRAFFIC_LIGHT_FULL_ZOOM).toBeLessThan(TRAFFIC_LIGHT_3D_MIN_ZOOM);
    expect(TRAFFIC_LIGHT_3D_MIN_ZOOM).toBeLessThan(TRAFFIC_LIGHT_3D_FULL_ZOOM);
  });
});
