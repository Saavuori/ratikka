// Traffic lights as places, and as something a tram is talking to.
//
// The junction points from Helsinki open data used to be drawn as a little
// clip-art signal, which was fine while a traffic light on this map was only a
// location — a place where a stopped tram *might* be waiting. It is not only a
// location any more: the HFP feed carries the tram's own priority requests
// (`tlr`) and the junction's answers (`tla`), so the map can say that this
// tram, at this junction, has asked for a green and been given one.
//
// That turns the marker into a state display, and this module holds all three
// pieces of it:
//
//  1. `signalPriorityIndex` — the live exchanges, folded from the vehicles that
//     reported them onto the junctions they were aimed at. HFP's `sid` is
//     Helsinki's own junction number, which is exactly the `id` the
//     traffic-lights endpoint serves, so the join is an equality and not a
//     guess. (Measured against a capture of the live feed: 145 of 147 tram
//     requests named a junction that is in the open-data set.)
//  2. `trafficLightIconSvg` — the flat marker, redrawn as a signal head with a
//     hood over each lens on a mast, and lit by the state above.
//  3. `trafficLightExtrusions` — the 3D counterpart, the same real-metre boxes
//     the stop shelters and bike racks are built from, so a signal standing on
//     a corner belongs to the same scene as the tram waiting at it.

import { offsetMeters, patchRing } from './vehicleModels';
import { platformColors, type MapTheme } from './stopPlatforms';
import type { TrafficLightFeature, VehiclePosition, SignalPriority } from '../types';

// --- Colours ---------------------------------------------------------------

export const SIGNAL_RED = '#e0393e';
export const SIGNAL_AMBER = '#fcbc19';
export const SIGNAL_GREEN = '#20bf6b';
/** The unlit lens: the colour is still there, most of the light is not. */
const LENS_DARK = { red: '#5c2a2c', amber: '#5f4a17', green: '#1c4634' };
const HEAD_DARK = '#1f2937';
const HEAD_EDGE = '#f8fafc';
const MAST = '#4b5563';

// --- 1. Live priority state ------------------------------------------------

/** What a junction is currently being asked, if anything. */
export type JunctionPriorityStatus = SignalPriority['status'];

export interface JunctionPriority {
  status: JunctionPriorityStatus;
  /** The vehicle doing the asking, so the marker can name it. */
  desi: string;
  veh: string;
  requestType?: string;
  level?: string;
  reason?: string;
  ts: number;
}

// When two trams are working the same junction at once, the more advanced
// state wins the marker: an answer outranks a request, and a request outranks
// a vehicle that decided not to make one. Showing "granted" while another
// tram is still waiting is the honest summary — the junction *has* answered.
const STATUS_RANK: Record<JunctionPriorityStatus, number> = {
  norequest: 0,
  requesting: 1,
  denied: 2,
  granted: 3,
};

/** Live exchanges by junction ID. */
export type JunctionPriorityIndex = Map<number, JunctionPriority>;

/**
 * Fold the priority exchanges reported by vehicles onto the junctions they
 * name. Keyed by junction ID (HFP `sid` = open-data `numero` = the `id` on a
 * traffic-light feature).
 */
export function signalPriorityIndex(
  vehicles: Iterable<VehiclePosition>,
): JunctionPriorityIndex {
  const index = new Map<number, JunctionPriority>();
  for (const vehicle of vehicles) {
    const tlp = vehicle.tlp;
    if (!tlp || typeof tlp.junction !== 'number') continue;
    const next: JunctionPriority = {
      status: tlp.status,
      desi: vehicle.desi,
      veh: vehicle.veh,
      requestType: tlp.requestType,
      level: tlp.level,
      reason: tlp.reason,
      ts: tlp.ts,
    };
    const current = index.get(tlp.junction);
    if (
      !current ||
      STATUS_RANK[next.status] > STATUS_RANK[current.status] ||
      (STATUS_RANK[next.status] === STATUS_RANK[current.status] && next.ts > current.ts)
    ) {
      index.set(tlp.junction, next);
    }
  }
  return index;
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

// --- 2. The flat marker ----------------------------------------------------

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

// --- 3. The 3D signal ------------------------------------------------------

export interface TrafficLightState {
  /** Junction ID — the open-data `numero`, and HFP's `sid`. */
  junctionId: number;
  lng: number;
  lat: number;
  kind: 'traffic_light' | 'warning_light';
  /**
   * Which way the street runs past the junction, degrees clockwise from north,
   * or null where nothing on the map says. The mast stands beside that line
   * with the head facing along it; with no bearing it is simply drawn
   * north-south, because a signal at a guessed angle is still a signal.
   */
  bearing: number | null;
  /** The live exchange at this junction, if a vehicle is having one. */
  priority?: JunctionPriority | null;
}

export type TrafficLightPart =
  | 'foot'
  | 'mast'
  | 'arm'
  | 'case'
  | 'hood'
  | 'lens'
  | 'halo';

export interface TrafficLightExtrusionFeature {
  type: 'Feature';
  geometry: { type: 'Polygon'; coordinates: [number, number][][] };
  properties: {
    junctionId: number;
    part: TrafficLightPart;
    color: string;
    base: number;
    top: number;
    /** Set on the parts that carry live state, for the layer's own styling. */
    status?: JunctionPriorityStatus;
  };
}

/**
 * Signal geometry in metres, off a Helsinki street signal: a 3.4 m mast with a
 * three-lens head at eye level for a tram driver, and the same head repeated on
 * a short cantilever arm over the carriageway.
 */
export const SIGNAL = {
  footRadius: 0.28,
  footHeight: 0.12,
  mastWidth: 0.14,
  mastHeight: 3.4,
  /** The head: a case a metre tall with three 0.2 m lenses down its face. */
  head: { width: 0.34, depth: 0.26, base: 2.25, height: 1.05 },
  lens: { size: 0.2, proud: 0.06, pitch: 0.31, first: 0.19 },
  hood: { drop: 0.05, proud: 0.13 },
  arm: { length: 1.5, thickness: 0.1, height: 3.25 },
  /** How far off the junction point the mast stands, across the street line. */
  offset: 3.2,
  /**
   * The state ring on the ground, drawn only while a request is live. A ring
   * rather than a disc: a filled 2.6 m circle of signal colour is the loudest
   * thing on the street and buries the junction it is meant to mark, where a
   * band around it frames the junction and leaves the pavement, the tracks and
   * the tram standing on them visible through the middle.
   */
  halo: { radius: 3.4, innerRadius: 2.5, height: 0.05 },
} as const;

/** Used when nothing on the map gives the junction an orientation. */
export const DEFAULT_SIGNAL_BEARING = 0;

const HALO_SIDES = 20;

function circle(
  lng: number,
  lat: number,
  radius: number,
  clockwise = true,
  sides = HALO_SIDES,
): [number, number][] {
  const ring: [number, number][] = [];
  for (let i = 0; i < sides; i++) {
    const step = (360 / sides) * i;
    ring.push(offsetMeters(lng, lat, clockwise ? step : 360 - step, radius, 0));
  }
  ring.push(ring[0]);
  return ring;
}

/** An annulus: the outer circle with the inner one punched out of it. */
function annulus(
  lng: number,
  lat: number,
  radius: number,
  innerRadius: number,
): [number, number][][] {
  // Wound the opposite way from the outer ring, which is what makes it a hole
  // rather than a second filled disc.
  return [circle(lng, lat, radius), circle(lng, lat, innerRadius, false)];
}

/**
 * The junction as extruded boxes. One mast stands for the junction, because
 * one point is all the open data gives: it records where a signalised junction
 * is, not where each of its masts is. So this is a signal at the junction, not
 * a survey of the junction's signals — and it is placed off to the side of the
 * street line rather than in the middle of the crossing, which is the one thing
 * that would read as wrong.
 */
export function trafficLightExtrusions(
  light: TrafficLightState,
  theme: MapTheme = 'light',
): TrafficLightExtrusionFeature[] {
  const palette = platformColors(theme);
  const out: TrafficLightExtrusionFeature[] = [];
  const hdg = light.bearing ?? DEFAULT_SIGNAL_BEARING;
  const status = light.priority?.status ?? null;
  const accent = priorityAccent(status);

  // The mast stands beside the street rather than on the junction point, so
  // the signals of a crossroads do not pile up on top of each other.
  const [mlng, mlat] = offsetMeters(light.lng, light.lat, hdg, 0, SIGNAL.offset);

  const push = (
    part: TrafficLightPart,
    ring: [number, number][],
    color: string,
    base: number,
    top: number,
  ) => {
    const feature: TrafficLightExtrusionFeature = {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [ring] },
      properties: { junctionId: light.junctionId, part, color, base, top },
    };
    if (status) feature.properties.status = status;
    out.push(feature);
  };
  const patch = (
    part: TrafficLightPart,
    along: [number, number],
    across: [number, number],
    color: string,
    base: number,
    top: number,
  ) => push(part, patchRing(mlng, mlat, hdg, along, across), color, base, top);

  // 1. The state disc, on the ground under the mast. In 3D the head is a small
  //    object seen from a long way up; the disc is what makes a junction that
  //    is being asked for a green findable from that height. A band rather than
  //    a disc, so it frames the junction instead of covering it. Drawn only
  //    while there is something to show.
  if (accent) {
    out.push({
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: annulus(light.lng, light.lat, SIGNAL.halo.radius, SIGNAL.halo.innerRadius),
      },
      properties: {
        junctionId: light.junctionId,
        part: 'halo',
        color: accent,
        base: 0,
        top: SIGNAL.halo.height,
        ...(status ? { status } : {}),
      },
    });
  }

  if (light.kind === 'warning_light') {
    // A warning light is one amber lamp on a shorter pole. It has no lens
    // stack and nothing to say about priority.
    patch('foot', [-SIGNAL.footRadius, SIGNAL.footRadius], [-SIGNAL.footRadius, SIGNAL.footRadius],
      palette.extrusion, 0, SIGNAL.footHeight);
    patch('mast', [-0.06, 0.06], [-0.06, 0.06], MAST, SIGNAL.footHeight, 2.6);
    patch('case', [-0.2, 0.2], [-0.14, 0.14], HEAD_DARK, 2.15, 2.75);
    patch('lens', [-0.1, 0.1], [-0.14 - SIGNAL.lens.proud, -0.14], SIGNAL_AMBER, 2.32, 2.58);
    return out;
  }

  // 2. Foot and mast.
  patch('foot', [-SIGNAL.footRadius, SIGNAL.footRadius], [-SIGNAL.footRadius, SIGNAL.footRadius],
    palette.extrusion, 0, SIGNAL.footHeight);
  patch('mast', [-SIGNAL.mastWidth / 2, SIGNAL.mastWidth / 2],
    [-SIGNAL.mastWidth / 2, SIGNAL.mastWidth / 2], MAST, SIGNAL.footHeight, SIGNAL.mastHeight);

  // 3. The cantilever arm reaching out over the carriageway, with the second
  //    head hanging off its end — the one a driver actually reads.
  patch('arm', [-SIGNAL.arm.thickness / 2, SIGNAL.arm.thickness / 2],
    [-SIGNAL.arm.length, 0], MAST, SIGNAL.arm.height - SIGNAL.arm.thickness, SIGNAL.arm.height);

  const h = SIGNAL.head;
  // Two heads: one on the mast facing the street, one under the arm.
  const heads: Array<{ across: number; base: number }> = [
    { across: -h.depth / 2, base: h.base },
    { across: -SIGNAL.arm.length - h.depth / 2, base: SIGNAL.arm.height - SIGNAL.arm.thickness - h.height },
  ];

  for (const head of heads) {
    const front = head.across;
    patch('case', [-h.width / 2, h.width / 2], [front, front + h.depth],
      HEAD_DARK, head.base, head.base + h.height);

    // 4. The lenses, proud of the case, each under its own hood. Red at the
    //    top, as they are on the street.
    const lenses: Array<['red' | 'amber' | 'green', string]> = [
      ['red', SIGNAL_RED],
      ['amber', SIGNAL_AMBER],
      ['green', SIGNAL_GREEN],
    ];
    lenses.forEach(([key, bright], i) => {
      // Top lens first: the stack is measured down from the top of the case.
      const centre = head.base + h.height - SIGNAL.lens.first - i * SIGNAL.lens.pitch;
      const on =
        (status === 'denied' && key === 'red') ||
        (status === 'requesting' && key === 'amber') ||
        (status === 'granted' && key === 'green');
      patch('lens', [-SIGNAL.lens.size / 2, SIGNAL.lens.size / 2],
        [front - SIGNAL.lens.proud, front],
        on ? bright : LENS_DARK[key],
        centre - SIGNAL.lens.size / 2, centre + SIGNAL.lens.size / 2);
      patch('hood', [-h.width / 2, h.width / 2],
        [front - SIGNAL.hood.proud, front],
        HEAD_DARK, centre + SIGNAL.lens.size / 2, centre + SIGNAL.lens.size / 2 + SIGNAL.hood.drop);
    });
  }

  return out;
}

export function trafficLightCollection(lights: TrafficLightState[], theme: MapTheme = 'light') {
  return {
    type: 'FeatureCollection' as const,
    features: lights.flatMap((l) => trafficLightExtrusions(l, theme)),
  };
}

/**
 * Turn the junction features the flat layer draws into 3D states, attaching
 * whatever priority exchange is live at each.
 */
export function trafficLightStates(
  features: TrafficLightFeature[],
  priorities: JunctionPriorityIndex,
  bearingOf: (lngLat: [number, number]) => number | null,
): TrafficLightState[] {
  return features.map((feature) => {
    const [lng, lat] = feature.geometry.coordinates;
    return {
      junctionId: feature.properties.id,
      lng,
      lat,
      kind: feature.properties.type,
      bearing: bearingOf([lng, lat]),
      priority: priorities.get(feature.properties.id) ?? null,
    };
  });
}

// --- Layer wiring ----------------------------------------------------------

/**
 * Street-level only: 557 junctions citywide would be a rash of markers over an
 * overview map, and a signal head is not worth drawing until a metre is worth
 * a pixel.
 */
export const TRAFFIC_LIGHT_MIN_ZOOM = 15;
export const TRAFFIC_LIGHT_FULL_ZOOM = 15.5;

/**
 * The 3D signal arrives later than the marker, and later than the stop
 * shelters: it is a thinner object than a shelter, so it needs more pixels per
 * metre before it stops being a smear.
 */
export const TRAFFIC_LIGHT_3D_MIN_ZOOM = 16.4;
export const TRAFFIC_LIGHT_3D_FULL_ZOOM = 17.2;

export const TRAFFIC_LIGHT_3D_FADE_IN: unknown[] = [
  'interpolate', ['linear'], ['zoom'],
  TRAFFIC_LIGHT_3D_MIN_ZOOM, 0,
  TRAFFIC_LIGHT_3D_FULL_ZOOM, 0.95,
];

/** The marker's own fade-in on the flat map, where it is all there is. */
export const TRAFFIC_LIGHT_ICON_OPACITY: unknown[] = [
  'interpolate', ['linear'], ['zoom'],
  TRAFFIC_LIGHT_MIN_ZOOM, 0,
  TRAFFIC_LIGHT_FULL_ZOOM, 1,
];

/**
 * In 3D the marker hands over to the mast: it fades in as before, then back
 * out across the band the extrusion arrives in, so a junction is drawn as a
 * symbol or as a signal but never as both. What the marker carried — which
 * lens is lit — the mast carries too, and the state disc on the ground carries
 * it further, being the part still legible from a rooftop camera angle.
 */
export const TRAFFIC_LIGHT_ICON_OPACITY_3D: unknown[] = [
  'interpolate', ['linear'], ['zoom'],
  TRAFFIC_LIGHT_MIN_ZOOM, 0,
  TRAFFIC_LIGHT_FULL_ZOOM, 1,
  TRAFFIC_LIGHT_3D_MIN_ZOOM, 1,
  TRAFFIC_LIGHT_3D_FULL_ZOOM, 0,
];

/** Cap on how many junctions get a mast at once, so a dense view stays cheap. */
export const TRAFFIC_LIGHT_LIMIT = 40;

export const TRAFFIC_LIGHT_SOURCE = 'traffic-lights';
export const TRAFFIC_LIGHT_ICON_LAYER = 'traffic-lights-icons';
export const TRAFFIC_LIGHT_3D_SOURCE = 'traffic-light-furniture';
export const TRAFFIC_LIGHT_3D_LAYER = 'traffic-lights-3d';
