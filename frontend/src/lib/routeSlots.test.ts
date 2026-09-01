import { describe, it, expect } from 'vitest';
import { assignCorridorSlots, canonicalizeDirection, distinctPathSegments } from './routeSlots';

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

describe('distinctPathSegments', () => {
  // A corridor sampled every ~55 m, well inside one grid cell per point.
  const corridor: [number, number][] = Array.from({ length: 20 }, (_, i) => [
    24.92 + i * 0.001,
    60.166,
  ]);

  it('keeps a single path', () => {
    expect(distinctPathSegments([corridor])).toEqual([corridor]);
  });

  it('drops a reversed duplicate whichever way it runs', () => {
    expect(distinctPathSegments([corridor, [...corridor].reverse()])).toEqual([corridor]);
  });

  it('drops a short turn, which is a subset rather than a reverse', () => {
    const shortTurn = corridor.slice(0, 10);
    expect(distinctPathSegments([corridor, shortTurn])).toEqual([corridor]);
    // …and independently of the order they arrive in.
    expect(distinctPathSegments([shortTurn, corridor])).toEqual([corridor]);
  });

  it('drops a return leg running down the other side of the same street', () => {
    // What a bus route ships: the two directions are ~20 m apart, which a rigid
    // grid would score as new ground for about half the points.
    const otherSide: [number, number][] = corridor.map(([lng, lat]) => [lng, lat + 0.0002]);
    expect(distinctPathSegments([corridor, [...otherSide].reverse()])).toEqual([corridor]);
  });

  it('keeps only the part of a branch that goes somewhere new', () => {
    // A pattern that shares the corridor and then turns off. Drawn whole, the
    // shared half is a second ribbon of the same colour running alongside the
    // first — one line reading as two routes, which is what tram 3 looked like.
    const spur = Array.from(
      { length: 10 },
      (_, i) => [24.93, 60.17 + i * 0.001] as [number, number]
    );
    const branch: [number, number][] = [...corridor.slice(0, 10), ...spur];
    const kept = distinctPathSegments([corridor, branch]);

    expect(kept).toHaveLength(2);
    expect(kept[0]).toEqual(corridor);
    // The spur survives; the stretch it shared with the corridor does not.
    const drawn = kept[1];
    expect(drawn.every(([, lat]) => lat >= 60.166)).toBe(true);
    expect(drawn[drawn.length - 1]).toEqual(spur[spur.length - 1]);
    // …and it still meets the corridor it leaves, rather than floating beside it.
    const [startLng, startLat] = drawn[0];
    expect(Math.hypot((startLng - 24.93) * 0.5, startLat - 60.166) * 111_320).toBeLessThan(100);
  });

  it('cuts a duplicated trunk out of a pattern that keeps its own terminus', () => {
    // Tram 3's shape: two directions round a common loop, splitting at one end.
    // Neither keeping nor dropping the second pattern whole is right — one
    // redraws the loop beside itself, the other loses the terminus.
    const shared = corridor;
    const ownTail: [number, number][] = Array.from(
      { length: 6 },
      (_, i) => [24.939 + i * 0.001, 60.158] as [number, number]
    );
    // The variant runs its own tail, then back up most of the shared corridor —
    // shorter overall, so the shared corridor is the one measured against.
    const variant: [number, number][] = [...ownTail, ...[...shared].reverse().slice(0, 12)];
    const kept = distinctPathSegments([shared, variant]);

    expect(kept[0]).toEqual(shared);
    expect(kept).toHaveLength(2);
    expect(kept[1].some(([, lat]) => Math.abs(lat - 60.158) < 1e-9)).toBe(true);
    // Nothing of the shared corridor is drawn a second time.
    expect(kept[1].filter(([, lat]) => Math.abs(lat - 60.166) < 1e-9).length).toBeLessThan(3);
  });

  it('drops a stub too short to be anywhere the line goes', () => {
    // A pattern clipping a corner the trunk cut: fresh ground, but a few dozen
    // metres of it — drawn, it is a fleck of route colour beside the ribbon.
    const stub: [number, number][] = [
      [24.925, 60.1665],
      [24.9255, 60.1666],
      ...corridor.slice(6),
    ];
    expect(distinctPathSegments([corridor, stub])).toEqual([corridor]);
  });

  it('collapses a full set of patterns to one ribbon per corridor', () => {
    // What a route actually ships: both directions, plus a short turn in each.
    const patterns = [
      corridor,
      [...corridor].reverse(),
      corridor.slice(0, 12),
      [...corridor.slice(0, 12)].reverse(),
    ];
    expect(distinctPathSegments(patterns)).toEqual([corridor]);
  });

  it('ignores empty paths', () => {
    expect(distinctPathSegments([[], corridor])).toEqual([corridor]);
  });

  it('passes degenerate paths straight through', () => {
    expect(canonicalizeDirection([])).toEqual([]);
    expect(canonicalizeDirection([[24.94, 60.17]])).toEqual([[24.94, 60.17]]);
  });

});
