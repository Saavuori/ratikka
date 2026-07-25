// Slot assignment for the highlighted route paths.
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
