// The flat ferry marker: a vessel seen from above, with its passenger load
// drawn into the deck.
//
// The other four modes are carriages — a rounded box with a nose, longer or
// boxier per mode — because that is what they are. A boat is not, and drawing
// one as another box would have thrown away the one shape on the map that
// nothing else shares: a raked bow, a beam half as wide as the hull is long, a
// deckhouse set inboard of open decks fore and aft. That silhouette is what
// makes the fifth mode identifiable at a glance, before any colour is read.
//
// Into that silhouette goes the thing only this mode can show. The Suomenlinna
// ferry reports a real occupancy percentage (see `lib/occupancy`), so the
// deckhouse is drawn as a saloon that fills: a gauge running the length of the
// deck, filling from the stern forward and taking the load colour with it,
// ringed in the same colour so the state survives being shrunk to twenty
// pixels. A reader deciding whether to walk down to the quay can see whether
// the boat coming in has room on it.

import { occupancyBucket, OCCUPANCY_BUCKETS } from './occupancy';
import { FERRY_COLORS, FERRY_CYAN } from './routeColors';

/** The load steps a marker is drawn for: an index per `OCCUPANCY_BUCKETS` entry. */
export const FERRY_LOAD_STEPS: number[] = OCCUPANCY_BUCKETS.map((_, index) => index);

/** Art-board size of the marker in pixels; registered at pixelRatio 2. */
export const FERRY_ICON_SIZE = 40;

/** The neutral gauge drawn when no load has been reported for the vessel. */
const UNKNOWN_GAUGE_COLOR = '#94a3b8';

// The deck gauge, in art-board units: a capsule inside the deckhouse running
// from the stern (bottom) to the bow (top).
const GAUGE = { x: 17.4, y: 11.6, width: 5.2, height: 15.6, radius: 2.6 };

/**
 * The image name for a vessel's marker: the line it is tinted for (omitted for
 * the generic mode-cyan hull), the load step, and whether the ramps are down.
 * `bucket` is an index into `OCCUPANCY_BUCKETS`, or -1 where the feed reported
 * no load at all.
 */
export function ferryIconName(bucket: number, open: boolean, line = ''): string {
  const load = bucket >= 0 && bucket < OCCUPANCY_BUCKETS.length ? `o${bucket}` : 'ou';
  return `ferry-body-${line ? `${line}-` : ''}${load}${open ? '-open' : ''}`;
}

/**
 * One marker: hull, deckhouse, wheelhouse, funnel, and the load gauge. `bucket`
 * of -1 draws the gauge as an empty grey track — a vessel we have no count for,
 * which is not the same as an empty one.
 *
 * The deckhouse is deliberately inset well clear of the topsides: the open deck
 * showing down both sides in the hull colour is most of what makes this read as
 * a boat rather than as a rounded rectangle with a triangle on the front.
 */
export function ferryIconSvg(bucket: number, open: boolean, hull: string = FERRY_CYAN): string {
  const known = bucket >= 0 && bucket < OCCUPANCY_BUCKETS.length;
  const step = known ? OCCUPANCY_BUCKETS[bucket] : null;
  const load = step ? step.color : UNKNOWN_GAUGE_COLOR;
  // The saloon fills from the stern forward, so the bar grows upwards on an
  // art board whose bow points up.
  const filled = step ? GAUGE.height * step.fill : 0;

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${FERRY_ICON_SIZE}" height="${FERRY_ICON_SIZE}" viewBox="0 0 40 40" fill="none">
      <!-- Hull: a raked stem drawn as two curves into the sheer, straight
           topsides on a wide beam, and a transom stern with rounded quarters. -->
      <path d="M20 2.2 C23.3 4.9 25.6 8.0 26.6 11.6 L26.6 31.2
               C26.6 33.4 25.2 34.8 23.0 34.8 L17.0 34.8
               C14.8 34.8 13.4 33.4 13.4 31.2 L13.4 11.6
               C14.4 8.0 16.7 4.9 20 2.2 Z"
            fill="${hull}" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/>
      <!-- Foredeck rail across the open deck ahead of the superstructure. -->
      <path d="M16.4 10.2 L23.6 10.2" stroke="rgba(255,255,255,0.6)" stroke-width="0.9" stroke-linecap="round"/>
      <!-- Wheelhouse, glazed, standing forward on the deckhouse. -->
      <rect x="17.2" y="7.4" width="5.6" height="3.4" rx="1.2" fill="#dbeeff" stroke="rgba(255,255,255,0.75)" stroke-width="0.6"/>
      <!-- Deckhouse, ringed in the load colour so the state reads at icon size. -->
      <rect x="16.2" y="10.4" width="7.6" height="18.0" rx="2" fill="#f1f5f9" stroke="${load}" stroke-width="1.5"/>
      <!-- The saloon gauge: a dark track, filled from the stern forward. -->
      <rect class="ferry-load-track" x="${GAUGE.x}" y="${GAUGE.y}" width="${GAUGE.width}" height="${GAUGE.height}"
            rx="${GAUGE.radius}" fill="rgba(15,23,42,0.16)"/>
      ${filled > 0
        ? `<rect class="ferry-load-fill" x="${GAUGE.x}" y="${(GAUGE.y + GAUGE.height - filled).toFixed(2)}"
                 width="${GAUGE.width}" height="${filled.toFixed(2)}"
                 rx="${GAUGE.radius}" fill="${load}"/>`
        : ''}
      <!-- Funnel, aft on the deckhouse roof. -->
      <rect x="19.1" y="25.0" width="1.8" height="2.8" rx="0.7" fill="#334155"/>
      ${open
        // Boarding: the side ramps are down over the open deck, drawn in the
        // amber every other mode uses for an open doorway.
        ? `<rect x="12.2" y="17.6" width="4.4" height="6.4" rx="1.2" fill="#ffb020" stroke="#ffffff" stroke-width="0.7"/>
           <rect x="23.4" y="17.6" width="4.4" height="6.4" rx="1.2" fill="#ffb020" stroke="#ffffff" stroke-width="0.7"/>`
        : `<rect x="13.9" y="18.4" width="1.7" height="5" rx="0.8" fill="rgba(15,23,42,0.4)"/>
           <rect x="24.4" y="18.4" width="1.7" height="5" rx="0.8" fill="rgba(15,23,42,0.4)"/>`}
      <!-- Boot-top band along the transom. -->
      <rect x="16.0" y="31.4" width="8.0" height="2.2" rx="1" fill="rgba(15,23,42,0.32)"/>
    </svg>
  `;
}

/**
 * Every ferry marker the map has to register: one per load step (plus the
 * unknown-load step), open and shut, for the mode-cyan hull and for each line
 * with a curated colour — the same per-line tinting the tram, metro and
 * commuter-train bodies get.
 */
export function ferryIconVariants(): Array<{ name: string; svg: string }> {
  const variants: Array<{ name: string; svg: string }> = [];
  const hulls: Array<[string, string]> = [
    ['', FERRY_CYAN],
    ...Object.entries(FERRY_COLORS),
  ];
  for (const [line, hull] of hulls) {
    for (const bucket of [-1, ...FERRY_LOAD_STEPS]) {
      for (const open of [false, true]) {
        variants.push({
          name: ferryIconName(bucket, open, line),
          svg: ferryIconSvg(bucket, open, hull),
        });
      }
    }
  }
  return variants;
}

/**
 * The bucket index to put on a vehicle feature, for the map's icon match. -1
 * means "no load reported", which is every mode but the ferry and a ferry whose
 * counter is silent.
 */
export function ferryIconBucket(fraction: number | null): number {
  if (fraction === null) return -1;
  return OCCUPANCY_BUCKETS.indexOf(occupancyBucket(fraction));
}
