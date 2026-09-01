import { describe, it, expect } from 'vitest';
import {
  assignCorridorSlots,
  canonicalizeDirection,
  dedupeOverlappingPaths,
  directionalPaths,
  runsBackwards,
} from './routeSlots';

describe('assignCorridorSlots', () => {
  // One east/west corridor, sampled every ~55 m…
  const corridor = (lat = 60.166, from = 0, to = 20): [number, number][] =>
    Array.from({ length: to - from }, (_, i) => [24.92 + (from + i) * 0.001, lat]);
  // …and a street far enough away to share nothing with it.
  const elsewhere = corridor(60.2);

  const slotOf = (slotted: { line: string; slot: number }[], line: string) =>
    slotted.find((p) => p.line === line)?.slot;

  it('returns nothing for no paths', () => {
    expect(assignCorridorSlots([])).toEqual([]);
  });

  it('leaves a lone route on its true geometry', () => {
    expect(assignCorridorSlots([{ line: '4', coords: corridor() }])[0].slot).toBe(0);
  });

  it('fans routes that share a corridor out either side', () => {
    const slotted = assignCorridorSlots([
      { line: '1', coords: corridor() },
      { line: '2', coords: corridor() },
      { line: '3', coords: corridor() },
    ]);
    expect(slotted.map((p) => p.slot).sort((a, b) => a - b)).toEqual([-1, 0, 1]);
  });

  it('does not push a route aside for a line it never meets', () => {
    // The whole point of slotting per corridor: line 9 is somewhere else
    // entirely, so line 4 keeps the street it actually runs down.
    const slotted = assignCorridorSlots([
      { line: '4', coords: corridor() },
      { line: '9', coords: elsewhere },
    ]);
    expect(slotOf(slotted, '4')).toBe(0);
    expect(slotOf(slotted, '9')).toBe(0);
  });

  it('keeps the fan only as wide as the corridor is busy', () => {
    // Ten lines highlighted, two of them sharing a street: a global fan would
    // have spread these over ten slots.
    const paths = [
      { line: '1', coords: corridor() },
      { line: '2', coords: corridor() },
      ...Array.from({ length: 8 }, (_, i) => ({
        line: `${i + 3}`,
        coords: corridor(60.2 + i * 0.01),
      })),
    ];
    const slots = assignCorridorSlots(paths).map((p) => p.slot);
    expect(Math.max(...slots) - Math.min(...slots)).toBe(1);
  });

  it('caps how wide a busy corridor fans out', () => {
    // Twelve lines down one street. Unbounded, the outermost would sit six slots
    // out — far enough off the street at city zoom to land in the sea, and far
    // enough to fold MapLibre's offsetting into blobs at the turning loops.
    const slots = assignCorridorSlots(
      Array.from({ length: 12 }, (_, i) => ({ line: `${i + 1}`, coords: corridor() }))
    ).map((p) => p.slot);
    expect(Math.min(...slots)).toBeGreaterThanOrEqual(-3);
    expect(Math.max(...slots)).toBeLessThanOrEqual(3);
    // The seven available slots are all used before any line doubles up.
    expect(new Set(slots).size).toBe(7);
  });

  it('orders lines numerically, not lexically', () => {
    // Lexically "10" sorts before "2" and would take the middle slot.
    const slotted = assignCorridorSlots([
      { line: '10', coords: corridor() },
      { line: '2', coords: corridor() },
      { line: '9', coords: corridor() },
    ]);
    expect(slotOf(slotted, '2')).toBe(0);
    expect(slotOf(slotted, '9')).toBe(1);
    expect(slotOf(slotted, '10')).toBe(-1);
  });

  it('is stable across redraws of the same set, whatever the input order', () => {
    const paths = [
      { line: '7', coords: corridor() },
      { line: '4', coords: corridor() },
      { line: '9', coords: elsewhere },
    ];
    expect(assignCorridorSlots(paths)).toEqual(assignCorridorSlots([...paths].reverse()));
  });

  it('puts the selected line on the true geometry and fans the rest around it', () => {
    const slotted = assignCorridorSlots(
      [
        { line: '1', coords: corridor() },
        { line: '2', coords: corridor() },
        { line: '3', coords: corridor() },
      ],
      '3'
    );
    expect(slotOf(slotted, '3')).toBe(0);
    expect([slotOf(slotted, '1'), slotOf(slotted, '2')].sort()).toEqual([-1, 1]);
  });

  it('lets one line stack its own branches instead of fanning them', () => {
    // A branch that shares the trunk is the same colour, so it belongs on top of
    // the trunk — fanning it would draw line 4 as two parallel ribbons.
    const branch: [number, number][] = [
      ...corridor().slice(0, 10),
      ...Array.from({ length: 10 }, (_, i) => [24.93, 60.17 + i * 0.001] as [number, number]),
    ];
    const slotted = assignCorridorSlots([
      { line: '4', coords: corridor() },
      { line: '4', coords: branch },
      { line: '7', coords: corridor() },
    ]);
    expect(slotted.filter((p) => p.line === '4').map((p) => p.slot)).toEqual([0, 0]);
    expect(slotOf(slotted, '7')).toBe(1);
  });

  it('separates lines that share a street but were sampled at different points', () => {
    // Both run down the same corridor; the second only has a vertex every ~275 m.
    // Without walking the segments they would share no grid cell and stack.
    const sparse: [number, number][] = [
      [24.92, 60.166],
      [24.925, 60.166],
      [24.93, 60.166],
      [24.935, 60.166],
    ];
    const slotted = assignCorridorSlots([
      { line: '1', coords: corridor() },
      { line: '2', coords: sparse },
    ]);
    expect(slotOf(slotted, '2')).not.toBe(slotOf(slotted, '1'));
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

  it('orients a north/south route on latitude', () => {
    const northbound: [number, number][] = [[24.94, 60.15], [24.94, 60.19]];
    const southbound: [number, number][] = [...northbound].reverse();
    expect(canonicalizeDirection(southbound)).toEqual(northbound);
  });

  it('still decides on latitude when a north/south route drifts sideways', () => {
    // Deciding on longitude first made this a coin flip, so two patterns of the
    // same line could disagree and land on opposite sides of the street.
    const northbound: [number, number][] = [[24.94, 60.15], [24.945, 60.19]];
    const southbound: [number, number][] = [...northbound].reverse();
    expect(canonicalizeDirection(northbound)).toEqual(northbound);
    expect(canonicalizeDirection(southbound)).toEqual(northbound);
  });
});

describe('dedupeOverlappingPaths', () => {
  // A corridor sampled every ~55 m, well inside one grid cell per point.
  const corridor: [number, number][] = Array.from({ length: 20 }, (_, i) => [
    24.92 + i * 0.001,
    60.166,
  ]);

  it('keeps a single path', () => {
    expect(dedupeOverlappingPaths([corridor])).toEqual([corridor]);
  });

  it('drops a duplicate of a path already kept', () => {
    expect(dedupeOverlappingPaths([corridor, [...corridor]])).toEqual([corridor]);
  });

  it('drops a short turn, which is a subset rather than a reverse', () => {
    const shortTurn = corridor.slice(0, 10);
    expect(dedupeOverlappingPaths([corridor, shortTurn])).toEqual([corridor]);
    // …and independently of the order they arrive in.
    expect(dedupeOverlappingPaths([shortTurn, corridor])).toEqual([corridor]);
  });

  it('drops a second path running down the other side of the same street', () => {
    // Two patterns of one direction ~20 m apart, which a rigid grid would score
    // as new ground for about half the points.
    const otherSide: [number, number][] = corridor.map(([lng, lat]) => [lng, lat + 0.0002]);
    expect(dedupeOverlappingPaths([corridor, otherSide])).toEqual([corridor]);
  });

  it('keeps a branch that goes somewhere new', () => {
    const branch: [number, number][] = [
      ...corridor.slice(0, 10),
      ...Array.from({ length: 10 }, (_, i) => [24.93, 60.17 + i * 0.001] as [number, number]),
    ];
    const kept = dedupeOverlappingPaths([corridor, branch]);
    expect(kept).toHaveLength(2);
    expect(kept).toContain(corridor);
    expect(kept).toContain(branch);
  });

  it('collapses one direction\'s patterns to a single ribbon', () => {
    expect(dedupeOverlappingPaths([corridor, corridor.slice(0, 12)])).toEqual([corridor]);
  });

  it('ignores empty paths', () => {
    expect(dedupeOverlappingPaths([[], corridor])).toEqual([corridor]);
  });

  it('passes degenerate paths straight through', () => {
    expect(canonicalizeDirection([])).toEqual([]);
    expect(canonicalizeDirection([[24.94, 60.17]])).toEqual([[24.94, 60.17]]);
  });

});

describe('runsBackwards', () => {
  const eastbound: [number, number][] = [
    [24.93, 60.16],
    [24.97, 60.18],
  ];

  it('splits a path and its reverse', () => {
    expect(runsBackwards(eastbound)).toBe(false);
    expect(runsBackwards([...eastbound].reverse())).toBe(true);
  });

  it('puts a short turn with the direction it runs in', () => {
    expect(runsBackwards(eastbound.slice(0, 1).concat([[24.95, 60.17]]))).toBe(false);
  });

  it('calls a path too short to have a direction forward', () => {
    expect(runsBackwards([])).toBe(false);
    expect(runsBackwards([[24.94, 60.17]])).toBe(false);
  });
});

describe('directionalPaths', () => {
  // A corridor sampled every ~55 m, and the return leg on its own track ~22 m
  // to the north — about the separation of a two-track alignment.
  const corridor: [number, number][] = Array.from({ length: 20 }, (_, i) => [
    24.92 + i * 0.001,
    60.166,
  ]);
  const otherTrack: [number, number][] = corridor.map(([lng, lat]) => [lng, lat + 0.0002]);

  it('keeps both directions when each has its own track', () => {
    // The bug this fixes: the return leg used to be dropped, so every vehicle
    // travelling that way was drawn beside the route line instead of on it.
    const kept = directionalPaths([corridor, [...otherTrack].reverse()]);
    expect(kept).toHaveLength(2);
    expect(kept).toContainEqual(corridor);
    expect(kept).toContainEqual(otherTrack);
  });

  it('draws a shared alignment once', () => {
    // A pattern that is the exact reverse of another is the same track, not a
    // second one — drawing it again would just thicken the ribbon.
    expect(directionalPaths([corridor, [...corridor].reverse()])).toEqual([corridor]);
  });

  it('drops the short turns of each direction', () => {
    const kept = directionalPaths([
      corridor,
      corridor.slice(0, 12),
      [...otherTrack].reverse(),
      [...otherTrack.slice(0, 12)].reverse(),
    ]);
    expect(kept).toHaveLength(2);
    expect(kept).toContainEqual(corridor);
    expect(kept).toContainEqual(otherTrack);
  });

  it('returns every path running the same way round', () => {
    // They share one offset slot, and `line-offset` is signed by the path's own
    // direction — disagree here and the two tracks are thrown apart on screen.
    for (const path of directionalPaths([corridor, [...otherTrack].reverse()])) {
      expect(runsBackwards(path)).toBe(false);
    }
  });

  it('keeps a branch as well as both directions', () => {
    const branch: [number, number][] = [
      ...corridor.slice(0, 10),
      ...Array.from({ length: 10 }, (_, i) => [24.93, 60.17 + i * 0.001] as [number, number]),
    ];
    const kept = directionalPaths([corridor, [...otherTrack].reverse(), branch]);
    expect(kept).toHaveLength(3);
    expect(kept).toContainEqual(branch);
  });

  it('keeps a one-way loop that only exists in one direction', () => {
    expect(directionalPaths([corridor])).toEqual([corridor]);
  });

  it('measures the return leg against the fuller direction, not a short turn', () => {
    // Only a short turn runs the "forward" way; the full route runs back. The
    // full path has to lead, or the short turn covers it and it is dropped.
    const kept = directionalPaths([corridor.slice(0, 6), [...corridor].reverse()]);
    expect(kept).toEqual([corridor]);
  });

  it('returns nothing for no paths', () => {
    expect(directionalPaths([])).toEqual([]);
  });
});
