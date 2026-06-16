interface ParsedTripId {
  routeId: string;
  direction: string;
  startTime: string;
}

export function parseTripId(tripId: string): ParsedTripId | null {
  if (!tripId) return null;
  // Remove HSL: prefix if present
  const clean = tripId.replace(/^HSL:/, '');
  const parts = clean.split('_');
  if (parts.length < 5) return null;
  return {
    routeId: parts[0].trim(),
    direction: parts[3],
    startTime: parts[4],
  };
}

export function areTripsEquivalent(id1: string | null | undefined, id2: string | null | undefined): boolean {
  if (!id1 || !id2) return false;
  if (id1 === id2) return true;

  const p1 = parseTripId(id1);
  const p2 = parseTripId(id2);

  if (!p1 || !p2) return false;

  return (
    p1.routeId === p2.routeId &&
    p1.direction === p2.direction &&
    p1.startTime === p2.startTime
  );
}
