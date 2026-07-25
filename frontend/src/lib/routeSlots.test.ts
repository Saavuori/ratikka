import { describe, it, expect } from 'vitest';
import { assignRouteSlots } from './routeSlots';

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
