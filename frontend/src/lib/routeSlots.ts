// Layout of the highlighted route paths: which slot a line occupies, which way
// round its paths run, and which of its paths are worth drawing at all.
//
// Helsinki tram lines share long stretches of track — most of the network runs
// down Aleksanterinkatu — so highlighting several lines stacks their polylines
// pixel-on-pixel. Drawn translucently they blend into a muddy third colour, and
// only the last-drawn line is really visible. Each line therefore gets a slot
// here, which the map turns into a perpendicular `line-offset`: overlapping
// routes fan out into parallel ribbons instead of covering one another.
//
// Slots are centred on the true geometry (…, -1, 0, 1, …) so the fan stays
// balanced over the street it follows. When a vehicle is selected, the whole fan
// shifts so *its* line sits at slot 0 — the selected route keeps the real
// alignment and everything else is pushed aside.

/**
 * Assign each line a centred offset slot, keyed by line short name.
 *
 * The ordering is numerically aware ("2" before "10") and depends only on the
 * set of lines, so a line's slot changes when the highlighted set changes and
 * never on a redraw — routes don't shuffle underneath the user.
 */
export function assignRouteSlots(
  lines: string[],
  selectedLine: string | null = null
): Record<string, number> {
  const ordered = [...lines].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true })
  );
  const centre = (ordered.length - 1) / 2;
  const selectedIdx = selectedLine ? ordered.indexOf(selectedLine) : -1;
  // Shifting by the selected line's own centred slot lands it exactly on 0.
  const shift = selectedIdx >= 0 ? selectedIdx - centre : 0;

  const slots: Record<string, number> = {};
  ordered.forEach((line, i) => {
    slots[line] = i - centre - shift;
  });
  return slots;
}

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

const cellsOf = (coords: [number, number][]): Set<string> => {
  const cells = new Set<string>();
  for (const [lng, lat] of coords) {
    cells.add(`${Math.round(lng / CELL)}:${Math.round(lat / CELL)}`);
  }
  return cells;
};

// A cell counts as covered if anything already kept passes through it *or* one
// of its neighbours. Two directions of a bus route run down opposite sides of
// the street, twenty-odd metres apart, and on a rigid grid roughly half those
// points would fall in the next cell along and score as new ground — enough to
// keep the return leg and put it back on the far side of the fan. The
// neighbourhood absorbs that; a branch has to leave the corridor entirely,
// which is the distinction worth drawing at map scale anyway.
const isCovered = (cell: string, covered: Set<string>): boolean => {
  const [cx, cy] = cell.split(':').map(Number);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (covered.has(`${cx + dx}:${cy + dy}`)) return true;
    }
  }
  return false;
};

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
