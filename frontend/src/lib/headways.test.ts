import { describe, it, expect } from 'vitest';
import type { Headway, VehiclePosition } from '../types';
import {
  BUNCHED_CORAL,
  GAP_AMBER,
  describeHeadway,
  describeIssue,
  formatHeadway,
  headwayColor,
  headwayPairs,
  lineRegularity,
  regularityIssues,
  vehicleAhead,
  vehicleBehind,
} from './headways';

// Durations are written with no-break spaces; the assertions read plainer without.
const plain = (text: string) => text.replace(/\u00a0/g, ' ');

// A line-4 tram heading out, running `hw` behind whatever it names.
function tram(veh: string, hw?: Headway, extra: Partial<VehiclePosition> = {}): VehiclePosition {
  return {
    veh, desi: '4', route: '1004', dir: '1', mode: 'tram',
    lat: 60.17, lng: 24.94, hdg: 0, spd: 5, dl: 0, drst: 0, stop: null,
    ts: 1_000, tripId: `trip-${veh}`, hw, ...extra,
  };
}

function byVeh(...vehicles: VehiclePosition[]): Record<string, VehiclePosition> {
  return Object.fromEntries(vehicles.map((v) => [v.veh, v]));
}

describe('vehicleAhead / vehicleBehind', () => {
  it('finds the pair in both directions', () => {
    const vehicles = byVeh(
      tram('a'),
      tram('b', { ahead: 'a', secs: 360, sched: 360, state: 'regular' }),
    );
    expect(vehicleAhead(vehicles.b, vehicles)?.veh).toBe('a');
    expect(vehicleBehind(vehicles.a, vehicles)?.veh).toBe('b');
    expect(vehicleBehind(vehicles.b, vehicles)).toBeNull();
  });

  it('lets go of a vehicle ahead that has finished its run', () => {
    const vehicles = byVeh(
      tram('a', undefined, { eol: true }),
      tram('b', { ahead: 'a', secs: 60, sched: 360, state: 'bunched' }),
    );
    expect(vehicleAhead(vehicles.b, vehicles)).toBeNull();
  });

  it('lets go of a vehicle ahead that is now running the other way', () => {
    const vehicles = byVeh(
      tram('a', undefined, { dir: '2' }),
      tram('b', { ahead: 'a', secs: 60, sched: 360, state: 'bunched' }),
    );
    expect(vehicleAhead(vehicles.b, vehicles)).toBeNull();
    expect(headwayPairs(vehicles)).toEqual([]);
  });
});

describe('headwayPairs', () => {
  it('pairs up only the bunched and the gapped', () => {
    const vehicles = byVeh(
      tram('a'),
      tram('b', { ahead: 'a', secs: 60, sched: 360, state: 'bunched' }),
      tram('c', { ahead: 'b', secs: 360, sched: 360, state: 'regular' }),
      tram('d', { ahead: 'c', secs: 900, sched: 360, state: 'gap' }),
      tram('e', { ahead: 'd', secs: 30, atLeast: true, sched: 360 }),
    );
    expect(headwayPairs(vehicles)).toEqual([
      { line: '4', follower: 'b', leader: 'a', state: 'bunched' },
      { line: '4', follower: 'd', leader: 'c', state: 'gap' },
    ]);
  });
});

describe('regularityIssues', () => {
  it('groups a chain of bunched vehicles into one problem, front first', () => {
    const vehicles = byVeh(
      tram('a'),
      tram('b', { ahead: 'a', secs: 90, sched: 360, state: 'bunched' }),
      tram('c', { ahead: 'b', secs: 40, sched: 360, state: 'bunched' }),
    );
    const issues = regularityIssues(vehicles);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      kind: 'bunched', vehicles: ['a', 'b', 'c'], focus: 'a', secs: 40, sched: 360,
    });
    expect(plain(describeIssue(issues[0]))).toBe('3 trams, 40 s apart');
  });

  it('lists the costliest problem first', () => {
    const vehicles = byVeh(
      tram('a'),
      tram('b', { ahead: 'a', secs: 300, sched: 360, state: 'regular' }),
      tram('c', { ahead: 'b', secs: 1_500, sched: 360, state: 'gap' }),
      tram('x', undefined, { desi: '7', route: '1007' }),
      tram('y', { ahead: 'x', secs: 30, sched: 480, state: 'bunched' }, { desi: '7', route: '1007' }),
    );
    const issues = regularityIssues(vehicles);
    expect(issues.map((i) => [i.line, i.kind])).toEqual([['4', 'gap'], ['7', 'bunched']]);
    expect(issues[0].focus).toBe('c');
    expect(plain(describeIssue(issues[0]))).toBe('25 min, due every 6 min');
  });

  it('says when a gap is only known to be at least so long', () => {
    const vehicles = byVeh(
      tram('a'),
      tram('b', { ahead: 'a', secs: 1_000, atLeast: true, sched: 360, state: 'gap' }),
    );
    expect(plain(describeIssue(regularityIssues(vehicles)[0]))).toBe('≥ 17 min, due every 6 min');
  });
});

describe('lineRegularity', () => {
  it('shows a bunch over a gap on the same line', () => {
    const vehicles = byVeh(
      tram('a'),
      tram('b', { ahead: 'a', secs: 60, sched: 360, state: 'bunched' }),
      tram('c', { ahead: 'b', secs: 1_200, sched: 360, state: 'gap' }),
    );
    expect(lineRegularity(regularityIssues(vehicles))).toEqual({ '4': 'bunched' });
  });
});

describe('describeHeadway', () => {
  it('gives a verdict where there is one, and says what is missing where not', () => {
    expect(describeHeadway({ ahead: 'a', secs: 60, sched: 360, state: 'bunched' })).toBe('Bunched with the one ahead');
    expect(describeHeadway({ ahead: 'a', secs: 30, atLeast: true, sched: 360 })).toBe('Timed at the next stop');
    expect(describeHeadway({ ahead: 'a', secs: 300 })).toBe('Timetable not known yet');
    expect(describeHeadway(undefined)).toBe('Spacing not measured yet');
  });
});

describe('formatHeadway', () => {
  it('reads to the ten seconds under ten minutes and to the minute above', () => {
    expect(plain(formatHeadway(42))).toBe('40 s');
    expect(plain(formatHeadway(60))).toBe('1 min');
    expect(plain(formatHeadway(134))).toBe('2 min 10 s');
    expect(plain(formatHeadway(359))).toBe('6 min');
    expect(plain(formatHeadway(754))).toBe('13 min');
  });
});

describe('headwayColor', () => {
  it('colours the two problems and nothing else', () => {
    expect(headwayColor('bunched')).toBe(BUNCHED_CORAL);
    expect(headwayColor('gap')).toBe(GAP_AMBER);
    expect(headwayColor('regular')).toBeNull();
    expect(headwayColor(undefined)).toBeNull();
  });
});
