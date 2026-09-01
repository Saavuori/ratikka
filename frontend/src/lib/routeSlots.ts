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
//
// Slots are per *line*, not per path: every path of one line shares its slot, so
// the two directions of a route stay on the ground they actually run over
// instead of being pushed to opposite sides of the fan.

/**
 * Flip a polyline so every path along the same corridor runs the same way.
 *
 * MapLibre's `line-offset` is signed relative to the line's own direction of
 * travel, and the API returns one polyline per *pattern* — so a route's outbound
 * and inbound patterns arrive as near-reverses of each other. Offset as-is, the
 * two directions of one line are pushed to opposite sides of the fan and end up
 * further apart on screen than the tracks they represent are on the ground.
 * Canonicalising first means an offset moves a line's whole bundle together, and
 * whatever separation is left between the two ribbons is the real one.
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
  return runsBackwards(coords) ? [...coords].reverse() : coords;
}

/**
 * Which of the two directions of travel a path is one of.
 *
 * This is the same test `canonicalizeDirection` uses to decide whether to flip
 * a path, exposed on its own: a path and its reverse always disagree on it, so
 * it sorts a route's patterns into its two directions without having to match
 * them up pairwise. A short turn lands with the direction it runs in, which is
 * what we want — it is a duplicate of that direction's trunk, not of the other.
 */
export function runsBackwards(coords: [number, number][]): boolean {
  if (coords.length < 2) return false;
  const [startLng, startLat] = coords[0];
  const [endLng, endLat] = coords[coords.length - 1];
  const dx = (endLng - startLng) * 0.5;
  const dy = endLat - startLat;
  return Math.abs(dx) >= Math.abs(dy) ? dx < 0 : dy < 0;
}

// Roughly 45 m of latitude — fine enough to tell two streets apart, coarse
// enough that the same street sampled by two patterns lands in the same cells.
const CELL = 0.0004;

// Telling the two directions of one route apart needs a much finer grid: they
// run on separate tracks a lane or two apart, which the 45 m grid above (whose
// whole job is to call that "the same street") cannot see at all. Roughly 11 m
// of latitude — under the width of a two-track alignment, so a direction that
// really does have its own track scores most of its length as new ground, while
// a pattern that retraces the other direction's exact geometry scores none.
const TRACK_CELL = 0.0001;

const cellsOf = (coords: [number, number][], cell = CELL): Set<string> => {
  const cells = new Set<string>();
  if (coords.length === 0) return cells;
  const step = cell / 2;
  const add = (lng: number, lat: number) =>
    cells.add(`${Math.round(lng / cell)}:${Math.round(lat / cell)}`);

  add(coords[0][0], coords[0][1]);
  for (let i = 1; i < coords.length; i++) {
    const [lng0, lat0] = coords[i - 1];
    const [lng1, lat1] = coords[i];
    const steps = Math.max(
      1,
      Math.ceil(Math.max(Math.abs(lng1 - lng0), Math.abs(lat1 - lat0)) / step)
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
// of its neighbours. Two patterns of the same direction can be sampled twenty-odd
// metres apart down one street, and on a rigid grid roughly half those points
// would fall in the next cell along and score as new ground — enough to keep a
// pattern that goes nowhere new. The neighbourhood absorbs that; a branch has to
// leave the corridor entirely, which is the distinction worth drawing at map
// scale anyway. (Which side of the street a path runs down is *not* a question
// for this grid — that is what the finer one in `directionalPaths` is for.)
const isCovered = (cell: string, covered: Set<string>): boolean =>
  neighboursOf(cell).some((near) => covered.has(near));

/**
 * Drop the paths of one line that cover ground another of its paths already
 * covers, keeping the ones that actually go somewhere new.
 *
 * One direction of a route still ships several patterns — the full run plus its
 * short turns and branch variants — and they nearly all retrace the same
 * corridor. Drawn as they arrive they stack on top of one another, thickening
 * the ribbon over the trunk for no information. Matching duplicate *pairs* is
 * not enough: a short turn is not a copy of anything, it is a subset.
 *
 * Comparing coverage sidesteps that entirely. Paths are
 * reduced to the grid cells they occupy, longest first; a path earns its place
 * only if enough of its cells are ones nothing kept so far has visited. A
 * reversed duplicate contributes nothing new and is dropped whichever way it
 * runs, a short turn is a subset and is dropped, and a genuine branch survives.
 *
 * This is the *within one direction* pass — `directionalPaths` is what callers
 * want, and it runs this once per direction of travel.
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

// How much of a return leg has to be track the outbound leg never touches
// before it is worth drawing in its own right. On the TRACK_CELL grid a
// direction with its own alignment clears this along most of its length, while
// a pattern that is the exact reverse of one already kept scores zero.
const MIN_OWN_TRACK_FRACTION = 0.1;

/**
 * Reduce a route's patterns to the paths worth drawing — one per direction of
 * travel, plus any genuine branches, minus the short turns and duplicates.
 *
 * A route ships a dozen-odd patterns and nearly all of them retrace each other,
 * so they cannot all be drawn. Collapsing them to a single path is not right
 * either, and that is what this fixes: outside the centre both directions of a
 * tram line have their own track, and the two metro tunnels are separate bores,
 * so dropping the return leg drew half of the infrastructure and left every
 * vehicle travelling the other way sitting beside the line rather than on it —
 * on the metro, where positions are projected onto the route geometry itself,
 * those trains ran along a track that was not drawn at all.
 *
 * So the patterns are split into their two directions first (see
 * `runsBackwards`) and deduped within each, which drops that direction's short
 * turns and repeats while leaving the other direction alone. The return leg is
 * then kept only if it covers track the outbound leg does not — measured on the
 * fine TRACK_CELL grid, so "the same street" is not mistaken for "the same
 * track". Where the two directions genuinely share one alignment (a single-track
 * section, or a pattern that is simply the reverse of another) nothing extra is
 * drawn.
 *
 * Every path returned runs the same way round, so the whole bundle takes its
 * line's offset slot together.
 */
export function directionalPaths(
  paths: [number, number][][],
  minNewFraction = 0.15
): [number, number][][] {
  const forward: [number, number][][] = [];
  const backward: [number, number][][] = [];
  for (const path of paths) {
    (runsBackwards(path) ? backward : forward).push(canonicalizeDirection(path));
  }

  // The direction with the longest pattern leads — that is the one
  // `dedupeOverlappingPaths` keeps and measures its own group against — so "the
  // other direction" is judged against the full route rather than against a
  // short turn that happened to be the only pattern going one way.
  const longest = (group: [number, number][][]) =>
    group.reduce((most, path) => Math.max(most, path.length), 0);
  const [primary, secondary] =
    longest(forward) >= longest(backward) ? [forward, backward] : [backward, forward];

  const kept = dedupeOverlappingPaths(primary, minNewFraction);
  const covered = new Set<string>();
  for (const path of kept) for (const cell of cellsOf(path, TRACK_CELL)) covered.add(cell);

  for (const path of dedupeOverlappingPaths(secondary, minNewFraction)) {
    const cells = cellsOf(path, TRACK_CELL);
    if (cells.size === 0) continue;
    let fresh = 0;
    for (const cell of cells) if (!covered.has(cell)) fresh++;
    if (kept.length === 0 || fresh / cells.size >= MIN_OWN_TRACK_FRACTION) {
      kept.push(path);
      for (const cell of cells) covered.add(cell);
    }
  }
  return kept;
}
