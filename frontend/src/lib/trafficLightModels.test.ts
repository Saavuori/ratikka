import { describe, it, expect } from 'vitest';
import { createPropertyExpression, v8 } from '@maplibre/maplibre-gl-style-spec';
import type { StylePropertySpecification } from '@maplibre/maplibre-gl-style-spec';
import {
  signalPriorityIndex,
  splitByOutcome,
  priorityAccent,
  describeSignalPriority,
  describeRequestType,
  trafficLightIconSvg,
  trafficLightIconName,
  warningLightIconSvg,
  SIGNAL_RED,
  SIGNAL_AMBER,
  SIGNAL_GREEN,
  TRAFFIC_LIGHT_ICON_VARIANTS,
  TRAFFIC_LIGHT_MIN_ZOOM,
  TRAFFIC_LIGHT_FULL_ZOOM,
  TRAFFIC_LIGHT_ICON_OPACITY,
} from './trafficLightModels';
import type { VehiclePosition, SignalPriority } from '../types';

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

describe('signalPriorityIndex', () => {
  it('keys the exchanges by the junction the vehicle named', () => {
    const index = signalPriorityIndex([
      vehicle({ tlp: tlp({ junction: 75 }) }),
      vehicle({ veh: '0040-408', desi: '3', tlp: tlp({ junction: 80, status: 'granted' }) }),
    ]);
    expect(index.get(75)?.vehicles[0].desi).toBe('10B');
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
    expect(index.get(75)?.vehicles[0].veh).toBe('b');
  });

  it('breaks a tie between equal states on the newer one', () => {
    const index = signalPriorityIndex([
      vehicle({ veh: 'old', tlp: tlp({ ts: 10 }) }),
      vehicle({ veh: 'new', tlp: tlp({ ts: 20 }) }),
    ]);
    expect(index.get(75)?.vehicles[0].veh).toBe('new');
  });
});

describe('signalPriorityIndex keeps every vehicle', () => {
  // The marker can only show one state, but the junction's own panel has to
  // list everyone: a corner two tram lines share routinely has more than one
  // vehicle negotiating with it at the same moment.
  const index = () => signalPriorityIndex([
    vehicle({ veh: 'a', desi: '10', tlp: tlp({ status: 'granted', ts: 10 }) }),
    vehicle({ veh: 'b', desi: '3', tlp: tlp({ status: 'requesting', ts: 30 }) }),
    vehicle({ veh: 'c', desi: '7', tlp: tlp({ status: 'granted', ts: 20 }) }),
    vehicle({ veh: 'd', desi: '9', tlp: tlp({ status: 'norequest', reason: 'AHEAD', ts: 40 }) }),
  ]);

  it('lists them all at the junction, most advanced state first', () => {
    const activity = index().get(75)!;
    expect(activity.vehicles.map((v) => v.veh)).toEqual(['c', 'a', 'b', 'd']);
    // The junction is drawn in the leading vehicle's state.
    expect(activity.status).toBe('granted');
  });

  it('carries what the panel needs to describe each vehicle', () => {
    const first = index().get(75)!.vehicles[0];
    expect(first.desi).toBe('7');
    expect(first.mode).toBe('tram');
    expect(first.lat).toBe(HELSINKI[1]);
    expect(typeof first.spd).toBe('number');
  });

  it('splits them into what was granted, asked and refused', () => {
    const split = splitByOutcome(index().get(75)!);
    expect(split.granted.map((v) => v.veh)).toEqual(['c', 'a']);
    expect(split.requesting.map((v) => v.veh)).toEqual(['b']);
    expect(split.denied).toEqual([]);
    // A vehicle that decided not to ask is at the junction, not negotiating
    // with it, so it is in neither of the first two.
    expect(split.silent.map((v) => v.veh)).toEqual(['d']);
  });

  it('splits nothing into empty lists rather than throwing', () => {
    const split = splitByOutcome(null);
    expect(split.granted).toEqual([]);
    expect(split.requesting).toEqual([]);
    expect(split.denied).toEqual([]);
    expect(split.silent).toEqual([]);
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

// The layer paint expressions are only validated by MapLibre at runtime, in a
// browser; one bad ramp silently drops the layer, and takes the layers anchored
// to it with it. Same guard the stop and bike styles carry.
describe('zoom ramps', () => {
  const evaluate = (expression: unknown, property: string, zoom: number) => {
    const spec = v8['paint_symbol']['icon-opacity'] as StylePropertySpecification;
    const compiled = createPropertyExpression(expression, property, spec);
    if (compiled.result === 'error') throw new Error(`invalid ${property} expression`);
    return compiled.value.evaluate({ zoom }, {} as never);
  };

  it('brings the marker in at street level and leaves it there, at every zoom above', () => {
    expect(evaluate(TRAFFIC_LIGHT_ICON_OPACITY, 'icon-opacity', TRAFFIC_LIGHT_MIN_ZOOM)).toBe(0);
    expect(evaluate(TRAFFIC_LIGHT_ICON_OPACITY, 'icon-opacity', TRAFFIC_LIGHT_FULL_ZOOM)).toBe(1);
    expect(evaluate(TRAFFIC_LIGHT_ICON_OPACITY, 'icon-opacity', 18)).toBe(1);
  });

});
