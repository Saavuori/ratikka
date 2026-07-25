import { describe, it, expect } from 'vitest';
import { assignRouteSlots, canonicalizeDirection } from './routeSlots';

describe('assignRouteSlots', () => {
  it('returns an empty map for no lines', () => {
    expect(assignRouteSlots([])).toEqual({});
  });

  it('puts a lone line on the true geometry', () => {
    expect(assignRouteSlots(['4'])).toEqual({ '4': 0 });
  });

  it('centres the fan so it stays balanced over the shared track', () => {
    expect(assignRouteSlots(['1', '2'])).toEqual({ '1': -0.5, '2': 0.5 });
    expect(assignRouteSlots(['1', '2', '3'])).toEqual({ '1': -1, '2': 0, '3': 1 });
  });

  it('orders lines numerically, not lexically', () => {
    // Lexical sorting would put "10" before "2" and shuffle the ribbons.
    const slots = assignRouteSlots(['10', '2', '9']);
    expect(slots['2']).toBeLessThan(slots['9']);
    expect(slots['9']).toBeLessThan(slots['10']);
  });

  it('is stable across redraws of the same set, whatever the input order', () => {
    expect(assignRouteSlots(['7', '4', '9'])).toEqual(assignRouteSlots(['9', '7', '4']));
  });

  it('places the selected line on the true geometry and shifts the rest aside', () => {
    const slots = assignRouteSlots(['1', '2', '3', '4'], '3');
    expect(slots['3']).toBe(0);
    expect(slots['1']).toBe(-2);
    expect(slots['2']).toBe(-1);
    expect(slots['4']).toBe(1);
  });

  it('keeps adjacent lines one slot apart after shifting', () => {
    const slots = assignRouteSlots(['4', '6', '6T', '15'], '6T');
    const values = Object.values(slots).sort((a, b) => a - b);
    values.slice(1).forEach((v, i) => expect(v - values[i]).toBeCloseTo(1));
  });

  it('falls back to the centred fan when the selected line is not highlighted', () => {
    expect(assignRouteSlots(['1', '2', '3'], '9')).toEqual(assignRouteSlots(['1', '2', '3']));
  });
});

describe('canonicalizeDirection', () => {
  // A route's outbound and inbound patterns arrive as reverses of each other.
  // Offset without this they land on opposite sides of the street and one route
  // reads as two ribbons.
  const outbound: [number, number][] = [
    [24.93, 60.16],
    [24.95, 60.17],
    [24.97, 60.18],
  ];
  const inbound: [number, number][] = [...outbound].reverse();

  it('maps a path and its reverse onto the same orientation', () => {
    expect(canonicalizeDirection(inbound)).toEqual(canonicalizeDirection(outbound));
  });

  it('leaves an already-canonical (west to east) path untouched', () => {
    expect(canonicalizeDirection(outbound)).toEqual(outbound);
  });

  it('does not mutate the input', () => {
    const original: [number, number][] = [...inbound];
    canonicalizeDirection(inbound);
    expect(inbound).toEqual(original);
  });

  it('breaks a north/south tie on latitude', () => {
    const northbound: [number, number][] = [[24.94, 60.15], [24.94, 60.19]];
    const southbound: [number, number][] = [...northbound].reverse();
    expect(canonicalizeDirection(southbound)).toEqual(northbound);
  });

  it('passes degenerate paths straight through', () => {
    expect(canonicalizeDirection([])).toEqual([]);
    expect(canonicalizeDirection([[24.94, 60.17]])).toEqual([[24.94, 60.17]]);
  });
});
