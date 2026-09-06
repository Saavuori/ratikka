import { describe, expect, it } from 'vitest';
import { approachSegment, closestPointIndex, type Coord } from './approachPath';

// A right-angled route: east along a street, then north up the next one.
const polyline: Coord[] = [
  [24.90, 60.17], [24.91, 60.17], [24.92, 60.17], [24.92, 60.18], [24.92, 60.19],
];

describe('closestPointIndex', () => {
  it('finds the nearest vertex', () => {
    expect(closestPointIndex(polyline, [24.9101, 60.1699])).toBe(1);
    expect(closestPointIndex(polyline, [24.92, 60.1902])).toBe(4);
  });
  it('keeps the first of equally near vertices', () => {
    expect(closestPointIndex([[0, 0], [2, 0]], [1, 0])).toBe(0);
  });
});

describe('approachSegment', () => {
  it('follows the route rather than cutting the corner', () => {
    const segment = approachSegment(polyline, [24.9105, 60.17], [24.92, 60.1895]);
    expect(segment[0]).toEqual([24.9105, 60.17]);
    expect(segment.at(-1)).toEqual([24.92, 60.1895]);
    // The corner vertex is on the path, so the ribbon turns with the street.
    expect(segment).toContainEqual([24.92, 60.17]);
  });

  it('slices the same stretch whichever end comes first along the line', () => {
    const forward = approachSegment(polyline, [24.90, 60.17], [24.92, 60.18]);
    const backward = approachSegment(polyline, [24.92, 60.18], [24.90, 60.17]);
    expect(forward.slice(1, -1)).toEqual(backward.slice(1, -1));
  });

  it('falls back to a direct line without geometry', () => {
    expect(approachSegment([], [24.90, 60.17], [24.92, 60.19]))
      .toEqual([[24.90, 60.17], [24.92, 60.19]]);
  });

  it('still returns a drawable path when both ends sit on one vertex', () => {
    const segment = approachSegment(polyline, [24.92, 60.19], [24.92, 60.1901]);
    expect(segment.length).toBeGreaterThanOrEqual(2);
  });
});
