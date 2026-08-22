import { MAX_SLOT } from './routeLineStyle';

// Layout of the highlighted route paths: which slot a line occupies, which way
// round its paths run, and which of its paths are worth drawing at all.
//
// Helsinki tram lines share long stretches of track — most of the network runs
// down Aleksanterinkatu — so highlighting several lines stacks their polylines
// pixel-on-pixel. Drawn translucently they blend into a muddy third colour, and
// only the last-drawn line is really visible. Each path therefore gets a slot
// here, which the map turns into a perpendicular `line-offset`: overlapping
// routes fan out into parallel ribbons instead of covering one another.
//
// Slots are assigned per corridor rather than across the whole highlighted set:
// a path takes the slot nearest 0 that no other line is already using on the
// ground it covers. A route nobody shares a street with therefore stays on its
// true geometry, and the fan over Aleksanterinkatu is only as wide as the number
// of lines actually running down it — not as wide as the number highlighted.
// (A global fan was fine for the three or four lines a filter usually selects,
// but with the whole tram network shown it pushed routes tens of pixels off the
// street they follow.) When a vehicle is selected its line is placed first, so
// it claims slot 0 the whole way and everything else fans around it.

/**
 * Flip a polyline so every path along the same corridor runs the same way.
 *
 * MapLibre's `line-offset` is signed relative to the line's own direction of
 * travel, and the API returns one polyline per *pattern* — so a route's outbound
 * and inbound patterns arrive as near-reverses of each other. Offset as-is they
 * are pushed to opposite sides of the street and the single route reads as two
 * parallel ribbons.
 *
 * The orientation is decided on the path's *dominant* axis: an east/west route
 * is ordered west-to-east, a north/south one south-to-north. Deciding on
 * longitude alone (and only falling back to latitude on an exact tie) made the
 * choice a near coin-flip for a north/south route with a little sideways drift,
 * so two patterns of one line could still disagree. A path and its reverse
 * always agree on which axis dominates and always disagree on its sign, so
 * exactly one of the pair is flipped.
 *
 * Longitude is scaled by 0.5 first: at Helsinki's latitude a degree of longitude
 * covers about half the ground a degree of latitude does, and without that the
 * comparison is not really about which way the path runs.
 *
 * Nothing else depends on the stored direction: the paths are drawn with round
 * caps, no arrows and no gradient.
 */
export function canonicalizeDirection(
  coords: [number, number][]
): [number, number][] {
  if (coords.length < 2) return coords;
  const [startLng, startLat] = coords[0];
  const [endLng, endLat] = coords[coords.length - 1];
  const dx = (endLng - startLng) * 0.5;
  const dy = endLat - startLat;
  const flip = Math.abs(dx) >= Math.abs(dy) ? dx < 0 : dy < 0;
  return flip ? [...coords].reverse() : coords;
}

// Roughly 45 m of latitude — fine enough to tell two streets apart, coarse
// enough that the same street sampled by two patterns lands in the same cells.
const CELL = 0.0004;

// Vertices are as far apart as the street is straight, so two lines down the
// same boulevard can sample points several cells apart and never meet on the
// grid — they would then read as "different ground" and take the same slot.
// Walking each segment in half-cell steps closes those gaps: coverage follows
// the street rather than wherever the polyline happened to be sampled.
const STEP = CELL / 2;

const cellsOf = (coords: [number, number][]): Set<string> => {
  const cells = new Set<string>();
  if (coords.length === 0) return cells;
  const add = (lng: number, lat: number) =>
    cells.add(`${Math.round(lng / CELL)}:${Math.round(lat / CELL)}`);

  add(coords[0][0], coords[0][1]);
  for (let i = 1; i < coords.length; i++) {
    const [lng0, lat0] = coords[i - 1];
    const [lng1, lat1] = coords[i];
    const steps = Math.max(
      1,
      Math.ceil(Math.max(Math.abs(lng1 - lng0), Math.abs(lat1 - lat0)) / STEP)
    );
    for (let s = 1; s <= steps; s++) {
      add(lng0 + ((lng1 - lng0) * s) / steps, lat0 + ((lat1 - lat0) * s) / steps);
    }
  }
  return cells;
};

const neighboursOf = (cell: string): string[] => {
  const [cx, cy] = cell.split(':').map(Number);
  const out: string[] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) out.push(`${cx + dx}:${cy + dy}`);
  }
  return out;
};

export interface RoutePath {
  line: string;
  coords: [number, number][];
}

export interface SlottedPath extends RoutePath {
  slot: number;
}

// 0, 1, -1, 2, -2, … — the fan grows outwards from the true geometry, so the
// first line down a street keeps the real alignment and the rest alternate
// either side of it.
const slotCandidate = (i: number): number =>
  i === 0 ? 0 : i % 2 === 1 ? (i + 1) / 2 : -(i / 2);

// … but only so far. The slot becomes a *pixel* `line-offset` on the map, so a
// deep slot puts a route a block off the street it follows — the deeper the
// slot, the more ground that offset covers as you zoom out, until routes sit in
// the sea. Offsets that large also break MapLibre's own offsetting where the
// geometry turns tighter than the offset is wide: the terminal loops fold into
// solid blobs of colour. So the fan stops at MAX_SLOT; past that the corridor is
// too crowded to fan out legibly anyway, and lines double up in a slot — still
// told apart by colour — rather than drifting off their street. The cap is
// shared with the paint expression that turns a slot into pixels.
const SLOT_CANDIDATES = Array.from({ length: MAX_SLOT * 2 + 1 }, (_, i) => slotCandidate(i));

/**
 * Give every path the offset slot it should be drawn in.
 *
 * Paths are placed one at a time, each claiming its slot on the grid cells it
 * covers; a later path may take a slot only where no *other* line already holds
 * it nearby. Two lines sharing a corridor therefore end up side by side, while a
 * line alone on its street stays at 0.
 *
 * A line's own paths are allowed to share a slot: the branches of one route are
 * drawn in one colour, so where they retrace the same trunk they should sit on
 * top of each other rather than fan out into two ribbons of the same line.
 *
 * The order — selected line first, then numerically ("2" before "10"), longest
 * path first within a line — depends only on the set of paths, so slots don't
 * shuffle underneath the user on a redraw.
 */
export function assignCorridorSlots(
  paths: RoutePath[],
  selectedLine: string | null = null
): SlottedPath[] {
  const ordered = [...paths].sort((a, b) => {
    if (a.line !== b.line) {
      if (a.line === selectedLine) return -1;
      if (b.line === selectedLine) return 1;
      return a.line.localeCompare(b.line, undefined, { numeric: true });
    }
    return b.coords.length - a.coords.length;
  });

  // cell → slot → the line holding that slot there.
  const claims = new Map<string, Map<number, string>>();

  return ordered.map((path) => {
    const cells = cellsOf(path.coords);
    const taken = new Set<number>(); // held nearby by another line
    const own = new Set<number>(); // held nearby by this same line
    const crowding = new Map<number, number>(); // slot → other lines holding it nearby
    for (const cell of cells) {
      for (const near of neighboursOf(cell)) {
        const held = claims.get(near);
        if (!held) continue;
        for (const [slot, line] of held) {
          if (line === path.line) {
            own.add(slot);
          } else {
            taken.add(slot);
            crowding.set(slot, (crowding.get(slot) ?? 0) + 1);
          }
        }
      }
    }

    const pick = (): number => {
      const reuse = [...own]
        .sort((a, b) => Math.abs(a) - Math.abs(b))
        .find((s) => !taken.has(s));
      if (reuse !== undefined) return reuse;
      const free = SLOT_CANDIDATES.find((candidate) => !taken.has(candidate));
      if (free !== undefined) return free;
      // Every slot in the fan is spoken for: share the least crowded one,
      // nearest the true geometry on a tie (SLOT_CANDIDATES is in that order).
      return SLOT_CANDIDATES.reduce((best, candidate) =>
        (crowding.get(candidate) ?? 0) < (crowding.get(best) ?? 0) ? candidate : best
      );
    };
    const slot = pick();

    for (const cell of cells) {
      const held = claims.get(cell) ?? new Map<number, string>();
      held.set(slot, path.line);
      claims.set(cell, held);
    }
    return { ...path, slot };
  });
}

// A cell counts as covered if anything already kept passes through it *or* one
// of its neighbours. Two directions of a bus route run down opposite sides of
// the street, twenty-odd metres apart, and on a rigid grid roughly half those
// points would fall in the next cell along and score as new ground — enough to
// keep the return leg and put it back on the far side of the fan. The
// neighbourhood absorbs that; a branch has to leave the corridor entirely,
// which is the distinction worth drawing at map scale anyway.
const isCovered = (cell: string, covered: Set<string>): boolean =>
  neighboursOf(cell).some((near) => covered.has(near));

/**
 * Drop the paths of one line that cover ground another of its paths already
 * covers, keeping the ones that actually go somewhere new.
 *
 * A route ships several patterns — each direction, plus short turns and branch
 * variants — and they nearly all retrace the same corridor. Every pattern of a
 * line takes the same offset slot, so any two that disagree about which way they
 * run end up on opposite sides of the street and the line reads as two or three
 * ribbons. Matching reversed *pairs* is not enough: a short turn is not the
 * reverse of anything, it is a subset.
 *
 * Comparing coverage rather than direction sidesteps that entirely. Paths are
 * reduced to the grid cells they occupy, longest first; a path earns its place
 * only if enough of its cells are ones nothing kept so far has visited. A
 * reversed duplicate contributes nothing new and is dropped whichever way it
 * runs, a short turn is a subset and is dropped, and a genuine branch survives.
 */
export function dedupeOverlappingPaths(
  paths: [number, number][][],
  minNewFraction = 0.15
): [number, number][][] {
  const ordered = [...paths].sort((a, b) => b.length - a.length);
  const covered = new Set<string>();
  const kept: [number, number][][] = [];

  for (const path of ordered) {
    const cells = cellsOf(path);
    if (cells.size === 0) continue;
    let fresh = 0;
    for (const cell of cells) if (!isCovered(cell, covered)) fresh++;
    // The longest path is always kept — it is the one everything else is
    // measured against.
    if (kept.length === 0 || fresh / cells.size >= minNewFraction) {
      kept.push(path);
      for (const cell of cells) covered.add(cell);
    }
  }
  return kept;
}
