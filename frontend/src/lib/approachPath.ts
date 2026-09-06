/**
 * The ribbon between a vehicle and the stop it is heading for.
 *
 * The trip's own geometry is what makes this read as a route rather than a
 * bearing: a straight line from a tram to a stop two corners away cuts through
 * the blocks between them. So the path is a slice of the pattern polyline,
 * pinned at each end to the two real positions.
 */
export type Coord = [number, number];

/** Index of the polyline vertex nearest a point, by squared degree distance. */
export function closestPointIndex(coords: Coord[], target: Coord): number {
  let minD = Infinity;
  let index = 0;
  for (let i = 0; i < coords.length; i++) {
    const d = Math.pow(coords[i][0] - target[0], 2) + Math.pow(coords[i][1] - target[1], 2);
    if (d < minD) {
      minD = d;
      index = i;
    }
  }
  return index;
}

/**
 * The stretch of `polyline` lying between `from` and `to`, with both ends
 * pinned on. Falls back to a direct line when there is no usable geometry —
 * a straight ribbon is wrong about the streets, but it is still honest about
 * which vehicle is coming to which stop, and it is what the map drew before
 * pattern geometry was fetched at all.
 */
export function approachSegment(polyline: Coord[], from: Coord, to: Coord): Coord[] {
  if (polyline.length === 0) return [from, to];
  const start = closestPointIndex(polyline, from);
  const end = closestPointIndex(polyline, to);
  const slice = polyline.slice(Math.min(start, end), Math.max(start, end) + 1);
  return [from, ...slice, to];
}
