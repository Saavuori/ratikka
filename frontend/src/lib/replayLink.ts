/**
 * A link into the timelapse: `?at=<unix seconds>&veh=<vehicle>` opens the map
 * on history at that moment, with that vehicle picked and the camera on it.
 *
 * It exists for the Grafana dashboards over the same feed. A dashboard can say
 * that tram 0040-412 touched 69 km/h at 16:17:28; it cannot show where, or what
 * the street looked like around it. One click from that row to this map can.
 */
export interface ReplayLink {
  /** The moment of interest, in Unix seconds. */
  at: number;
  /** The vehicle key, as the feed and the archive both name it: `0040-412`. */
  veh: string;
}

/**
 * How long before the moment playback opens. Landing exactly on it would show
 * the vehicle already there; a few seconds earlier shows it getting there —
 * which, for a top speed, is the part worth watching.
 */
export const REPLAY_LINK_LEAD_SECONDS = 20;

// A vehicle key is an operator number and a vehicle number. Anything else in
// the parameter is not one, and is ignored rather than looked for.
const VEHICLE_KEY = /^\d{1,6}-\d{1,6}$/;

/**
 * Reads a timelapse link off a query string, or returns null when the string
 * does not hold a usable one. Accepts the moment in seconds or milliseconds,
 * since Grafana hands out the latter.
 */
export function parseReplayLink(search: string): ReplayLink | null {
  const params = new URLSearchParams(search);
  const rawAt = params.get('at');
  const veh = params.get('veh')?.trim() ?? '';
  if (!rawAt || !VEHICLE_KEY.test(veh)) return null;

  let at = Number(rawAt);
  if (!Number.isFinite(at) || at <= 0) return null;
  // Seconds since 1970 pass a trillion in the year 33658; milliseconds did in
  // 2001. Anything that large is milliseconds.
  if (at > 1e12) at /= 1000;
  return { at: Math.floor(at), veh };
}

/**
 * The same URL without the link's parameters, so reloading the page — or
 * sharing what is now on screen — does not jump back to the linked moment.
 */
export function withoutReplayLink(href: string): string {
  const url = new URL(href);
  url.searchParams.delete('at');
  url.searchParams.delete('veh');
  return url.pathname + url.search + url.hash;
}
