// Traffic lights as places, and as something a tram is talking to.
//
// The junction points from Helsinki open data used to be drawn as a little
// clip-art signal, which was fine while a traffic light on this map was only a
// location — a place where a stopped tram *might* be waiting. It is not only a
// location any more: the HFP feed carries the tram's own priority requests
// (`tlr`) and the junction's answers (`tla`), so the map can say that this
// tram, at this junction, has asked for a green and been given one.
//
// That turns the marker into a state display, and this module holds both
// pieces of it:
//
//  1. `signalPriorityIndex` — the live exchanges, folded from the vehicles that
//     reported them onto the junctions they were aimed at. HFP's `sid` is
//     Helsinki's own junction number, which is exactly the `id` the
//     traffic-lights endpoint serves, so the join is an equality and not a
//     guess. (Measured against a capture of the live feed: 145 of 147 tram
//     requests named a junction that is in the open-data set.)
//  2. `trafficLightIconSvg` — the marker, drawn as a signal head with a hood
//     over each lens on a mast, and lit by the state above. It is the whole of
//     the junction on the map, at every zoom and in 3D as well as flat: a
//     signal modelled in real metres is a thin object seen from a long way up,
//     and it said less about who had been given a green than this does.

import type { VehiclePosition, SignalPriority } from '../types';

// --- Colours ---------------------------------------------------------------

export const SIGNAL_RED = '#e0393e';
export const SIGNAL_AMBER = '#fcbc19';
export const SIGNAL_GREEN = '#20bf6b';
/** The unlit lens: the colour is still there, most of the light is not. */
const LENS_DARK = { red: '#5c2a2c', amber: '#5f4a17', green: '#1c4634' };
const HEAD_DARK = '#1f2937';
const HEAD_EDGE = '#f8fafc';

// --- 1. Live priority state ------------------------------------------------

/** What a junction is currently being asked, if anything. */
export type JunctionPriorityStatus = SignalPriority['status'];

export interface JunctionPriority {
  status: JunctionPriorityStatus;
  /** The vehicle doing the asking, so the junction can name it. */
  desi: string;
  veh: string;
  mode: string;
  /** Where it is and how fast, so "still coming" and "sitting at the line" read differently. */
  lat: number;
  lng: number;
  spd: number;
  drst: number;
  requestType?: string;
  level?: string;
  reason?: string;
  attempts?: number;
  ts: number;
}

// When two trams are working the same junction at once, the more advanced
// state wins the marker: an answer outranks a request, and a request outranks
// a vehicle that decided not to make one. Showing "granted" while another
// tram is still waiting is the honest summary — the junction *has* answered.
// It is only the marker that has to pick, though; the junction's own panel
// lists every vehicle, which is the whole reason the index keeps them all.
const STATUS_RANK: Record<JunctionPriorityStatus, number> = {
  norequest: 0,
  requesting: 1,
  denied: 2,
  granted: 3,
};

/** Everything currently being asked of one junction. */
export interface JunctionActivity {
  /**
   * Every vehicle in an exchange with this junction right now, most advanced
   * state first and newest first within a state. A junction on a corner two
   * tram lines share routinely has more than one.
   */
  vehicles: JunctionPriority[];
  /** The state the junction is drawn in: the leading vehicle's. */
  status: JunctionPriorityStatus;
}

/** Live exchanges by junction ID. */
export type JunctionPriorityIndex = Map<number, JunctionActivity>;

/** Sorts an exchange list the way a junction's panel reads it. */
function byPrecedence(a: JunctionPriority, b: JunctionPriority): number {
  const rank = STATUS_RANK[b.status] - STATUS_RANK[a.status];
  return rank !== 0 ? rank : b.ts - a.ts;
}

/**
 * Fold the priority exchanges reported by vehicles onto the junctions they
 * name. Keyed by junction ID (HFP `sid` = open-data `numero` = the `id` on a
 * traffic-light feature).
 */
export function signalPriorityIndex(
  vehicles: Iterable<VehiclePosition>,
): JunctionPriorityIndex {
  const byJunction = new Map<number, JunctionPriority[]>();
  for (const vehicle of vehicles) {
    const tlp = vehicle.tlp;
    if (!tlp || typeof tlp.junction !== 'number') continue;
    const entry: JunctionPriority = {
      status: tlp.status,
      desi: vehicle.desi,
      veh: vehicle.veh,
      mode: vehicle.mode,
      lat: vehicle.lat,
      lng: vehicle.lng,
      spd: vehicle.spd,
      drst: vehicle.drst,
      requestType: tlp.requestType,
      level: tlp.level,
      reason: tlp.reason,
      attempts: tlp.attempts,
      ts: tlp.ts,
    };
    const list = byJunction.get(tlp.junction);
    if (list) list.push(entry);
    else byJunction.set(tlp.junction, [entry]);
  }

  const index: JunctionPriorityIndex = new Map();
  for (const [junction, list] of byJunction) {
    list.sort(byPrecedence);
    index.set(junction, { vehicles: list, status: list[0].status });
  }
  return index;
}

/**
 * The vehicles at a junction split the way the panel shows them: the ones the
 * junction has answered, and the ones still asking. A vehicle that decided not
 * to ask is in neither — it is at the junction, not negotiating with it.
 */
export function splitByOutcome(activity: JunctionActivity | null | undefined) {
  const vehicles = activity?.vehicles ?? [];
  return {
    granted: vehicles.filter((v) => v.status === 'granted'),
    denied: vehicles.filter((v) => v.status === 'denied'),
    requesting: vehicles.filter((v) => v.status === 'requesting'),
    silent: vehicles.filter((v) => v.status === 'norequest'),
  };
}

/** Which lens a state lights, and the accent the marker is ringed in. */
export function priorityAccent(status: JunctionPriorityStatus | null): string | null {
  switch (status) {
    case 'granted':
      return SIGNAL_GREEN;
    case 'requesting':
      return SIGNAL_AMBER;
    case 'denied':
      return SIGNAL_RED;
    case 'norequest':
      return null;
    default:
      return null;
  }
}

/** A sentence for the popup and the map label. */
export function describeSignalPriority(tlp: SignalPriority): string {
  const at = typeof tlp.junction === 'number' ? ` at junction ${tlp.junction}` : '';
  switch (tlp.status) {
    case 'requesting':
      return `Requesting traffic light priority${at}`;
    case 'granted':
      return `Traffic light priority granted${at}`;
    case 'denied':
      return `Traffic light priority refused${at}`;
    case 'norequest':
      return `No priority requested${at}${tlp.reason ? ` (${tlp.reason})` : ''}`;
    default:
      return `Traffic light priority${at}`;
  }
}

/**
 * The request types spelled out. HFP names four; the door ones are a tram
 * asking to be let out of the stop it is standing in rather than waved through
 * a junction it is approaching.
 */
export function describeRequestType(requestType: string | undefined): string | null {
  switch (requestType) {
    case 'NORMAL':
      return 'on approach';
    case 'DOOR_CLOSE':
      return 'on closing doors';
    case 'DOOR_OPEN':
      return 'on opening doors';
    case 'ADVANCE':
      return 'in advance';
    default:
      return null;
  }
}

// --- 2. The marker ---------------------------------------------------------

/** Icon variants, one image per state; MapLibre picks between them by name. */
export const TRAFFIC_LIGHT_ICON_VARIANTS = [
  'idle',
  'requesting',
  'granted',
  'denied',
] as const;

export type TrafficLightIconVariant = (typeof TRAFFIC_LIGHT_ICON_VARIANTS)[number];

export const TRAFFIC_LIGHT_ICON_WIDTH = 26;
export const TRAFFIC_LIGHT_ICON_HEIGHT = 38;

export function trafficLightIconName(variant: TrafficLightIconVariant): string {
  return variant === 'idle' ? 'traffic-light-icon' : `traffic-light-icon-${variant}`;
}

/** Which of the three lenses burns, per state. */
function litLens(variant: TrafficLightIconVariant): 'red' | 'amber' | 'green' | null {
  switch (variant) {
    case 'granted':
      return 'green';
    case 'requesting':
      return 'amber';
    case 'denied':
      return 'red';
    default:
      return null;
  }
}

/**
 * A signal head on a mast: a dark case with a white edge, a hood shading each
 * lens, and the three lenses down the front. Idle, every lens sits at its unlit
 * colour, so the marker still reads as a traffic light rather than as a green
 * light that happens to be showing. With a live request the matching lens is
 * lit, and a halo behind the head carries the same colour outwards far enough
 * to be picked out among the stops and vehicles around it.
 */
export function trafficLightIconSvg(variant: TrafficLightIconVariant = 'idle'): string {
  const lit = litLens(variant);
  const accent = priorityAccent(variant === 'idle' ? null : variant);
  const lens = (cy: number, key: 'red' | 'amber' | 'green', bright: string) => {
    const on = lit === key;
    return `
      <circle cx="13" cy="${cy}" r="${on ? 3.1 : 2.7}" fill="${on ? bright : LENS_DARK[key]}"${
        on ? ` stroke="${bright}" stroke-opacity="0.45" stroke-width="2.4"` : ''
      }/>`;
  };

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${TRAFFIC_LIGHT_ICON_WIDTH}" height="${TRAFFIC_LIGHT_ICON_HEIGHT}" viewBox="0 0 26 38" fill="none">
      ${accent ? `<rect x="2" y="1" width="22" height="28" rx="9" fill="${accent}" fill-opacity="0.18"/>` : ''}
      <line x1="13" y1="27" x2="13" y2="36" stroke="${HEAD_DARK}" stroke-width="2.2" stroke-linecap="round"/>
      <rect x="9.6" y="34.6" width="6.8" height="2.4" rx="1.2" fill="${HEAD_DARK}"/>
      <rect x="6.5" y="3" width="13" height="24" rx="3.4" fill="${HEAD_DARK}" stroke="${HEAD_EDGE}" stroke-width="1.3"/>
      <path d="M6.9 7.2 H19.1" stroke="${HEAD_EDGE}" stroke-opacity="0.28" stroke-width="1"/>
      <path d="M6.9 14.6 H19.1" stroke="${HEAD_EDGE}" stroke-opacity="0.28" stroke-width="1"/>
      <path d="M6.9 22 H19.1" stroke="${HEAD_EDGE}" stroke-opacity="0.28" stroke-width="1"/>
      ${lens(9.4, 'red', SIGNAL_RED)}
      ${lens(16.2, 'amber', SIGNAL_AMBER)}
      ${lens(23, 'green', SIGNAL_GREEN)}
      ${accent ? `<rect x="4.6" y="1.2" width="16.8" height="27.6" rx="5.4" stroke="${accent}" stroke-width="1.4" fill="none"/>` : ''}
    </svg>
  `;
}

/**
 * Pedestrian and cyclist warning lights are the other half of the dataset and a
 * different object: one amber lamp on a pole under a warning triangle, and
 * nothing a tram can ask anything of. It gets no state variants for that
 * reason.
 */
export function warningLightIconSvg(): string {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${TRAFFIC_LIGHT_ICON_WIDTH}" height="${TRAFFIC_LIGHT_ICON_HEIGHT}" viewBox="0 0 26 38" fill="none">
      <line x1="13" y1="26" x2="13" y2="36" stroke="${HEAD_DARK}" stroke-width="2.2" stroke-linecap="round"/>
      <rect x="9.6" y="34.6" width="6.8" height="2.4" rx="1.2" fill="${HEAD_DARK}"/>
      <path d="M13 2.6 L23.2 21.4 A2.4 2.4 0 0 1 21.1 25 L4.9 25 A2.4 2.4 0 0 1 2.8 21.4 Z"
            fill="${SIGNAL_AMBER}" stroke="${HEAD_EDGE}" stroke-width="1.3"/>
      <rect x="12" y="9" width="2" height="8" rx="1" fill="${HEAD_DARK}"/>
      <circle cx="13" cy="20.4" r="1.5" fill="${HEAD_DARK}"/>
    </svg>
  `;
}

// --- Layer wiring ----------------------------------------------------------

/**
 * Street-level only: 557 junctions citywide would be a rash of markers over an
 * overview map, and a signal head is not worth drawing until a metre is worth
 * a pixel. From there up it is the marker all the way, in 2D and in 3D alike:
 * a signal is a small, thin object, and a modelled mast at a rooftop camera
 * angle says less about who has been given a green than the flat head does.
 */
export const TRAFFIC_LIGHT_MIN_ZOOM = 15;
export const TRAFFIC_LIGHT_FULL_ZOOM = 15.5;

/** The marker's own fade-in; it stays up at every zoom above it. */
export const TRAFFIC_LIGHT_ICON_OPACITY: unknown[] = [
  'interpolate', ['linear'], ['zoom'],
  TRAFFIC_LIGHT_MIN_ZOOM, 0,
  TRAFFIC_LIGHT_FULL_ZOOM, 1,
];

export const TRAFFIC_LIGHT_SOURCE = 'traffic-lights';
export const TRAFFIC_LIGHT_ICON_LAYER = 'traffic-lights-icons';
export const TRAFFIC_LIGHT_SELECTION_LAYER = 'traffic-lights-selected';
