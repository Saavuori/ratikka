// Representative Helsinki vehicles, not fleet-specific engineering drawings.
// All dimensions are ground metres, including details: zoom never inflates them.

import { ROUTE_COLORS, METRO_COLORS, TRAIN_COLORS, FERRY_COLORS, TRAM_GREEN, METRO_ORANGE, TRAIN_PURPLE, BUS_BLUE, FERRY_CYAN } from './routeColors';
import { occupancyColor } from './occupancy';
import { offsetMeters } from './geo';

/** One rigid section of a body: a box measured from the vehicle's centre. */
export interface BodySection {
  /** Distance ahead of the centre where the section ends, in metres. */
  front: number;
  /** Distance behind the centre where it starts (negative is behind). */
  back: number;
  /** Half the body width, in metres. */
  halfWidth: number;
  /** Length of the raked chamfer at the front end (0 = flat). */
  nose?: number;
  /** Length of the chamfer at the rear end (0 = flat). */
  tail?: number;
}

export interface VehicleModel {
  sections: BodySection[];
  /** Roof height above the rail/road, in metres. */
  height: number;
  /** Bottom and top of the window band that wraps the flanks. */
  glassBase: number;
  glassTop: number;
  /** Centres of the door sets along the body, in metres from the centre. */
  doors: number[];
  /** How wide one door set is along the body. */
  doorWidth: number;
  doorSides: number[];
  bogies: number[];
  hvac: number[];
  pantograph?: number;
  /**
   * Driving ends, as distances from the centre: a pale patch is laid on the
   * roof at each, the 3D read of the schematic's cab windscreen. The sign says
   * which way it faces, so a two-cab vehicle lists both ends.
   */
  cabs: number[];
  /** A lighter stripe down the middle of the roof (the metro's white band). */
  roofStripe?: { color: string; halfWidth: number };
}

// Dimensions follow the real rolling stock closely enough that the modes are
// tellable apart by size alone: an Artic tram is 27 m, a city bus 12.5 m, a
// two-unit metro train just under 90 m, and a four-car Sm-series unit 75 m.
// Rail doors appear on both flanks because HFP does not report the platform side.
export const VEHICLE_MODELS: Record<string, VehicleModel> = {
  tram: {
    sections: [
      { front: 13.5, back: 4.8, halfWidth: 1.2, nose: 1.6 },
      { front: 4.3, back: -4.3, halfWidth: 1.2 },
      { front: -4.8, back: -13.5, halfWidth: 1.2, tail: 1.2 },
    ],
    height: 3.4,
    glassBase: 1.5,
    glassTop: 2.6,
    doors: [8.8, 1.8, -1.8, -8.2],
    doorWidth: 1.3,
    doorSides: [1],
    bogies: [10, 0, -10],
    hvac: [7, -7],
    pantograph: 0,
    cabs: [13.5],
  },
  bus: {
    sections: [{ front: 6.2, back: -6.3, halfWidth: 1.28, nose: 0.35, tail: 0.2 }],
    height: 3.1,
    glassBase: 1.6,
    glassTop: 2.6,
    doors: [4.2, -1.5],
    doorWidth: 1.1,
    doorSides: [1],
    bogies: [3, -3.8],
    hvac: [-2],
    cabs: [6.2],
  },
  // Four cars in two paired metro units; a larger coupling gap separates pairs.
  metro: {
    sections: [
      { front: 44.5, back: 22.9, halfWidth: 1.6, nose: 2.2 },
      { front: 22.3, back: 0.6, halfWidth: 1.6 },
      { front: -0.6, back: -22.3, halfWidth: 1.6 },
      { front: -22.9, back: -44.5, halfWidth: 1.6, tail: 2.2 },
    ],
    height: 3.6,
    glassBase: 1.7,
    glassTop: 2.8,
    doors: [39, 33.5, 27.5, 18, 11.5, 5, -5, -11.5, -18, -27.5, -33.5, -39],
    doorWidth: 1.4,
    doorSides: [1, -1],
    bogies: [40, 27, 18, 5, -5, -18, -27, -40],
    hvac: [33.5, 11.5, -11.5, -33.5],
    cabs: [44.5, -44.5],
    roofStripe: { color: '#f1f5f9', halfWidth: 0.45 },
  },
  train: {
    sections: [
      { front: 37.5, back: 19.1, halfWidth: 1.6, nose: 3.5 },
      { front: 18.5, back: 0.3, halfWidth: 1.6 },
      { front: -0.3, back: -18.5, halfWidth: 1.6 },
      { front: -19.1, back: -37.5, halfWidth: 1.6, tail: 3.5 },
    ],
    height: 4.0,
    glassBase: 1.9,
    glassTop: 3.0,
    doors: [27, 12, -12, -27],
    doorWidth: 1.4,
    doorSides: [1, -1],
    bogies: [32, 18.8, 0, -18.8, -32],
    hvac: [25, 9, -9, -25],
    pantograph: -5,
    cabs: [37.5, -37.5],
  },
};

/**
 * The ferry, which is the one vehicle on the map that is not a carriage.
 *
 * `VehicleModel` describes rolling stock — sections on bogies, a pantograph, a
 * gangway between rigid halves — and none of that is a boat. A vessel is a hull
 * with a deckhouse standing on it, a wheelhouse on top of that and a funnel
 * behind it, and it has no wheels to draw at all. So it gets its own dimensions
 * and its own builder rather than being forced through the carriage one; what
 * it shares with the others is the thing that matters, which is that every
 * number here is a ground metre.
 *
 * The figures are the Suomenlinna boats: about 35 m long on an 8.5 m beam,
 * which puts the fifth mode between a bus and a tram in length and makes it by
 * far the widest thing on the water or the street.
 */
export interface FerryModel {
  hull: BodySection;
  /** Height of the main deck above the waterline. */
  deck: number;
  /** The passenger saloon standing on the deck. */
  deckhouse: { front: number; back: number; halfWidth: number; height: number };
  /** Glazing band around the saloon, measured from the deck. */
  glassBase: number;
  glassTop: number;
  /** The bridge, standing on the saloon roof. */
  wheelhouse: { front: number; back: number; halfWidth: number; height: number };
  funnel: { front: number; back: number; halfWidth: number; height: number };
  /** Side boarding ramps, as centres along the hull. */
  doors: number[];
  doorWidth: number;
  /**
   * The load gauge laid along the saloon roof: a full-length track with the
   * reported occupancy filled in from the stern forward. Seen from a pitched
   * 3D view this is the one part of the vessel a reader looks straight down
   * on, which is why the gauge lives there and not on a flank.
   */
  loadGauge: { front: number; back: number; halfWidth: number };
}

export const FERRY_MODEL: FerryModel = {
  hull: { front: 17.3, back: -17.3, halfWidth: 4.2, nose: 6.0, tail: 1.0 },
  deck: 2.2,
  deckhouse: { front: 9.6, back: -11.2, halfWidth: 3.3, height: 3.0 },
  glassBase: 1.1,
  glassTop: 2.4,
  // The bridge stands *on* the saloon roof rather than out over the foredeck,
  // and the gauge runs aft of it down the rest of that roof.
  wheelhouse: { front: 9.2, back: 4.6, halfWidth: 2.1, height: 2.2 },
  funnel: { front: -7.0, back: -9.2, halfWidth: 0.75, height: 1.8 },
  doors: [1.5],
  doorWidth: 2.2,
  loadGauge: { front: 3.8, back: -10.4, halfWidth: 1.15 },
};

/** Structural colours for the vessel, distinct from the rolling stock's. */
const HULL_BOOTTOP = '#0f2a3a';
const SUPERSTRUCTURE = '#f1f5f9';
const WHEELHOUSE_GLASS = '#9fd8f2';
const FUNNEL = '#334155';
/** The gauge track the load fills, and the colour of a load never reported. */
const GAUGE_TRACK = '#28323f';
const GAUGE_UNKNOWN = '#94a3b8';

export function vehicleModel(mode: string | null | undefined): VehicleModel {
  return VEHICLE_MODELS[mode ?? ''] ?? VEHICLE_MODELS.tram;
}

/**
 * Body colour, matching the flat icons exactly: trams, metro and commuter
 * trains take their line's colour where the palette has one and their mode
 * colour otherwise, and buses are always HSL blue.
 */
export function vehicleBodyColor(mode: string | null | undefined, desi: string | null | undefined): string {
  const line = desi ?? '';
  switch (mode) {
    case 'bus':
      return BUS_BLUE;
    case 'metro':
      return METRO_COLORS[line] ?? METRO_ORANGE;
    case 'train':
      return TRAIN_COLORS[line] ?? TRAIN_PURPLE;
    case 'ferry':
      return FERRY_COLORS[line] ?? FERRY_CYAN;
    default:
      return ROUTE_COLORS[line] ?? TRAM_GREEN;
  }
}

/** Window glass, and the door leaves that stand proud of it. */
export const GLASS_COLOR = '#16202f';
export const DOOR_COLOR = '#47566b';
/** The amber of the doorway the leaves uncover, as in the schematic. */
export const DOORS_OPEN_COLOR = '#ffb020';
/** The cab patch laid on the roof at a driving end. */
export const CAB_COLOR = '#9fd8f2';
/** The gold a selected vehicle's body takes, matching the selection ring. */
export const SELECTED_COLOR = '#fdcb6e';
export const HEADLIGHT_COLOR = '#fff3ad';
export const TAILLIGHT_COLOR = '#a92532';
export const BRAKE_LIGHT_COLOR = '#ff3344';
export const BRAKE_INDICATOR_COLOR = '#ff962b';

/** Close a ring of vehicle-space points into lng/lat coordinates. */
function ringOf(
  lng: number,
  lat: number,
  hdg: number,
  points: Array<[number, number]>,
): [number, number][] {
  const ring = points.map(([along, across]) => offsetMeters(lng, lat, hdg, along, across));
  ring.push(ring[0]);
  return ring;
}

/**
 * The outline of one body section as a closed ring, chamfered at whichever ends
 * carry a nose or tail so a train reads as pointed and a tram as rounded-off.
 * `widen` pushes the sides out (used to make the window band stand a few
 * centimetres proud of the body, so it is not swallowed by it).
 */
export function sectionRing(
  lng: number,
  lat: number,
  hdg: number,
  section: BodySection,
  widen = 0,
): [number, number][] {
  const { front, back } = section;
  const hw = section.halfWidth + widen;
  const nose = section.nose ?? 0;
  const tail = section.tail ?? 0;
  // Chamfered corners retain enough width for the windscreen and end lamps,
  // enough taper to read as a nose without narrowing the cab to a point.
  const tip = hw * 0.6;

  const pts: Array<[number, number]> = [];
  const add = (along: number, across: number) => pts.push([along, across]);

  // Right-hand side, front to back, then back up the left-hand side.
  if (nose > 0) {
    add(front, tip);
    add(front - nose, hw);
  } else {
    add(front, hw);
  }
  if (tail > 0) {
    add(back + tail, hw);
    add(back, tip);
    add(back, -tip);
    add(back + tail, -hw);
  } else {
    add(back, hw);
    add(back, -hw);
  }
  if (nose > 0) {
    add(front - nose, -hw);
    add(front, -tip);
  } else {
    add(front, -hw);
  }

  return ringOf(lng, lat, hdg, pts);
}

/**
 * A quad spanning two frames: the ends are measured in each frame's own space,
 * so the shape stretches and skews to join them. This is what a gangway between
 * two articulated sections has to be — on a bend the two ends it connects are
 * neither parallel nor the same distance apart on the two sides, which is
 * exactly the job the bellows does on the real vehicle.
 */
export function bridgeRing(
  from: { lng: number; lat: number; hdg: number },
  fromAlong: number,
  to: { lng: number; lat: number; hdg: number },
  toAlong: number,
  halfWidth: number,
): [number, number][] {
  const ring: [number, number][] = [
    offsetMeters(from.lng, from.lat, from.hdg, fromAlong, halfWidth),
    offsetMeters(from.lng, from.lat, from.hdg, fromAlong, -halfWidth),
    offsetMeters(to.lng, to.lat, to.hdg, toAlong, -halfWidth),
    offsetMeters(to.lng, to.lat, to.hdg, toAlong, halfWidth),
  ];
  ring.push(ring[0]);
  return ring;
}

/** An axis-aligned patch of the body: `along` and `across` spans in metres. */
export function patchRing(
  lng: number,
  lat: number,
  hdg: number,
  along: [number, number],
  across: [number, number],
): [number, number][] {
  return ringOf(lng, lat, hdg, [
    [along[1], across[0]],
    [along[1], across[1]],
    [along[0], across[1]],
    [along[0], across[0]],
  ]);
}

/**
 * A frame on the vehicle's own path: where the point `along` metres ahead of
 * its centre sits, and which way the path faces there. `lib/railTracks` builds
 * one of these from the rails a vehicle is snapped to.
 */
export type BodySpine = (along: number) => { lng: number; lat: number; hdg: number };

export interface VehicleState {
  veh: string;
  lng: number;
  lat: number;
  hdg: number;
  mode: string;
  desi: string;
  doorsOpen: boolean;
  /** Inferred deceleration, not an observed lamp or brake-circuit state. */
  braking?: boolean;
  /** Animated opening fraction; omitted/non-finite values use doorsOpen. */
  doorProgress?: number;
  selected?: boolean;
  /**
   * The path the body follows, if it is known. An articulated vehicle is not
   * one rigid box: a 27 m tram is three sections on joints that bend, and
   * through a street corner the rails turn well inside that length. Given a
   * spine, each section is placed at its own point on the path at the bearing
   * the path has there — so the tram bends round the corner the way it does in
   * the street, instead of cutting the nose through the building outside the
   * curve or swinging the tail through the one inside it.
   *
   * Without one (a bus, or a vehicle not on its route) the body is drawn rigid
   * about `lng`/`lat`/`hdg`, exactly as before.
   */
  spine?: BodySpine;
  /**
   * Reported passenger load, 0…1, or null/undefined where the mode does not
   * measure it. Only the ferry does; see `lib/occupancy`.
   */
  occupancy?: number | null;
}

export type VehiclePart = 'body' | 'glass' | 'pillar' | 'doorway' | 'door' | 'cab' | 'roof'
  | 'gangway' | 'bogie' | 'wheel' | 'wheel-hub' | 'hvac' | 'pantograph' | 'lamp-housing'
  | 'headlight' | 'taillight' | 'brake-indicator' | 'bumper' | 'destination'
  // Ferry-only parts (see `ferryExtrusions`).
  | 'hull' | 'deckhouse' | 'wheelhouse' | 'funnel' | 'load-track' | 'load-fill' | 'wake';

export interface ExtrusionFeature {
  type: 'Feature';
  geometry: { type: 'Polygon'; coordinates: [number, number][][] };
  properties: { veh: string; part: VehiclePart; color: string; base: number; top: number };
}

/** How far proud of the flank each layer stands, in metres. */
const GLASS_PROUD = 0.04;
const DOORWAY_PROUD = 0.10;
const DOOR_PROUD = 0.18;

/**
 * The vessel: hull, saloon, bridge, funnel — and the load gauge that is the
 * reason the ferry gets a drawing of its own rather than a recoloured tram.
 *
 * The gauge is a track running the length of the saloon roof with the reported
 * occupancy filled in from the stern forward, in the load colour. It sits on
 * the roof because that is the surface a pitched 3D camera looks straight down
 * on: a bar on a flank is edge-on and unreadable from half the compass, while
 * this one reads from every bearing, at every rotation, as plainly as a battery
 * meter. A vessel with no reported count gets an empty grey track rather than a
 * green one, because "nobody has said" is not "nobody aboard".
 *
 * No wheels, no bogies, no pantograph, no articulation. The `detailed` flag
 * drops the same kind of small furniture it drops on a carriage.
 */
export function ferryExtrusions(v: VehicleState, detailed = true): ExtrusionFeature[] {
  const model = FERRY_MODEL;
  const hullColor = v.selected ? SELECTED_COLOR : vehicleBodyColor(v.mode, v.desi);
  const progress = Number.isFinite(v.doorProgress)
    ? Math.max(0, Math.min(1, v.doorProgress!))
    : v.doorsOpen ? 1 : 0;
  const out: ExtrusionFeature[] = [];

  const push = (
    part: VehiclePart,
    ring: [number, number][],
    color: string,
    base: number,
    top: number,
  ) => {
    out.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [ring] },
      properties: { veh: v.veh, part, color, base, top },
    });
  };

  const patch = (
    part: VehiclePart,
    along: [number, number],
    across: [number, number],
    color: string,
    base: number,
    top: number,
  ) => push(part, patchRing(v.lng, v.lat, v.hdg, along, across), color, base, top);

  const box = (
    part: VehiclePart,
    b: { front: number; back: number; halfWidth: number },
    color: string,
    base: number,
    top: number,
  ) => patch(part, [b.back, b.front], [-b.halfWidth, b.halfWidth], color, base, top);

  // Hull, from the waterline to the main deck, with the raked bow the
  // `sectionRing` chamfer already draws. A boat is a rigid body, so unlike a
  // tram there is no spine to bend it along.
  push('hull', sectionRing(v.lng, v.lat, v.hdg, model.hull), hullColor, 0, model.deck);
  // Boot-top: a dark band at the waterline, standing a little proud of the
  // topsides so it is not swallowed by the hull above it.
  push('hull', sectionRing(v.lng, v.lat, v.hdg, model.hull, 0.06), HULL_BOOTTOP, 0, 0.45);

  // Saloon, its glazing band, and the bridge and funnel standing on its roof.
  const houseTop = model.deck + model.deckhouse.height;
  box('deckhouse', model.deckhouse, SUPERSTRUCTURE, model.deck, houseTop);
  box(
    'glass',
    { ...model.deckhouse, halfWidth: model.deckhouse.halfWidth + 0.05 },
    GLASS_COLOR,
    model.deck + model.glassBase,
    model.deck + model.glassTop,
  );
  box('wheelhouse', model.wheelhouse, SUPERSTRUCTURE, houseTop, houseTop + model.wheelhouse.height);
  box(
    'glass',
    { ...model.wheelhouse, halfWidth: model.wheelhouse.halfWidth + 0.05 },
    WHEELHOUSE_GLASS,
    houseTop + 0.7,
    houseTop + model.wheelhouse.height - 0.35,
  );
  if (detailed) {
    box('funnel', model.funnel, FUNNEL, houseTop, houseTop + model.funnel.height);
  }

  // The load gauge on the saloon roof: the full track, then the reported share
  // of it filled from the stern forward.
  const gauge = model.loadGauge;
  const length = gauge.front - gauge.back;
  patch('load-track', [gauge.back, gauge.front], [-gauge.halfWidth, gauge.halfWidth],
    GAUGE_TRACK, houseTop, houseTop + 0.06);
  const load = typeof v.occupancy === 'number' && Number.isFinite(v.occupancy)
    ? Math.max(0, Math.min(1, v.occupancy))
    : null;
  if (load === null) {
    // Nothing reported: a thin grey rail down the middle of the track, which is
    // visibly not a reading rather than visibly an empty boat.
    patch('load-fill', [gauge.back, gauge.front], [-0.12, 0.12],
      GAUGE_UNKNOWN, houseTop + 0.06, houseTop + 0.12);
  } else if (load > 0) {
    patch('load-fill', [gauge.back, gauge.back + length * load],
      [-gauge.halfWidth, gauge.halfWidth],
      occupancyColor(load), houseTop + 0.06, houseTop + 0.22);
  }

  // Side boarding ramps, one per flank, drawn like every other doorway on the
  // map: the amber opening shows as the leaves slide clear of it.
  const half = model.doorWidth / 2;
  (detailed ? model.doors : []).forEach((centre) => {
    for (const side of [1, -1]) {
      const flank = (proud: number): [number, number] => [
        side * (model.hull.halfWidth - 0.05),
        side * (model.hull.halfWidth + proud),
      ];
      if (progress > 0) {
        patch('doorway', [centre - half, centre + half], flank(DOORWAY_PROUD),
          DOORS_OPEN_COLOR, model.deck * 0.4, model.deck + model.glassTop);
      }
      const slide = half * progress;
      patch('door', [centre - half - slide, centre - slide], flank(DOOR_PROUD),
        DOOR_COLOR, model.deck * 0.4, model.deck + model.glassTop);
      patch('door', [centre + slide, centre + half + slide], flank(DOOR_PROUD),
        DOOR_COLOR, model.deck * 0.4, model.deck + model.glassTop);
    }
  });

  // Navigation lights: white at the masthead forward, red aft. The same
  // convention the carriages use for head and tail lamps, and on a vessel it is
  // also the truthful one.
  patch('headlight', [model.hull.front - 0.5, model.hull.front - 0.1], [-0.35, 0.35],
    HEADLIGHT_COLOR, model.deck + 0.5, model.deck + 0.9);
  patch('taillight', [model.hull.back + 0.1, model.hull.back + 0.5], [-0.35, 0.35],
    TAILLIGHT_COLOR, model.deck + 0.5, model.deck + 0.9);

  // A short wake off the transom while the vessel is making way. It is the only
  // motion cue a boat has — there are no wheels to turn and no brake lamps to
  // light — and it is drawn flat on the water, a third of the hull's length and
  // no more, so it reads as disturbed water astern rather than as more boat.
  if (detailed && !v.doorsOpen && !v.braking) {
    for (const step of [0, 1, 2]) {
      const from = model.hull.back - 1.6 - step * 3.4;
      patch('wake', [from - 2.6, from], [-model.hull.halfWidth * (0.7 + step * 0.22),
        model.hull.halfWidth * (0.7 + step * 0.22)], '#cfe9f5', 0, 0.05);
    }
  }

  return out;
}

/**
 * Sectioned bodies, window pillars, running gear, roof equipment, mounted lamps,
 * and sliding door leaves. Selected bodies and pillars match the gold ring.
 *
 * A ferry is not a carriage and is built by `ferryExtrusions` instead.
 */
export function vehicleExtrusions(v: VehicleState, detailed = true): ExtrusionFeature[] {
  if (v.mode === 'ferry') return ferryExtrusions(v, detailed);
  const model = vehicleModel(v.mode);
  const bodyColor = v.selected ? SELECTED_COLOR : vehicleBodyColor(v.mode, v.desi);
  const progress = Number.isFinite(v.doorProgress)
    ? Math.max(0, Math.min(1, v.doorProgress!))
    : v.doorsOpen ? 1 : 0;
  const out: ExtrusionFeature[] = [];

  const push = (
    part: VehiclePart,
    ring: [number, number][],
    color: string,
    base: number,
    top: number,
  ) => {
    out.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [ring] },
      properties: { veh: v.veh, part, color, base, top },
    });
  };

  // Where each rigid section sits. With a spine the sections are placed
  // independently along the path, each at its own centre and its own bearing —
  // that is the articulation. Without one they all share the vehicle's single
  // frame, which is the rigid body drawn before and is still what a bus is.
  //
  // The granularity is the section, not the polygon: a section *is* rigid, so
  // its windows, doors, bogies and lamps ride with it rather than being bent
  // individually. That is both the truthful drawing and the cheap one — one
  // path lookup per section per frame, not one per polygon.
  const frames = model.sections.map((s) => {
    if (!v.spine) return { lng: v.lng, lat: v.lat, hdg: v.hdg, pivot: 0 };
    const pivot = (s.front + s.back) / 2;
    return { ...v.spine(pivot), pivot };
  });

  // The frame a feature at `along` metres from the centre rides on: its own
  // section's, or the nearest section's for anything in the gap between two
  // (a gangway, a joint bogie).
  const frameAt = (along: number) => {
    let best = frames[0];
    let bestGap = Infinity;
    model.sections.forEach((s, index) => {
      const gap = along > s.front ? along - s.front : along < s.back ? s.back - along : 0;
      if (gap < bestGap) {
        bestGap = gap;
        best = frames[index];
      }
    });
    return best;
  };

  const section = (part: VehiclePart, s: BodySection, color: string, base: number, top: number, widen = 0) => {
    const frame = frameAt((s.front + s.back) / 2);
    // Measured from the frame's own origin, so a section drawn on its own
    // anchor keeps its true length along the path.
    const local = { ...s, front: s.front - frame.pivot, back: s.back - frame.pivot };
    push(part, sectionRing(frame.lng, frame.lat, frame.hdg, local, widen), color, base, top);
  };
  const patch = (
    part: VehiclePart,
    along: [number, number],
    across: [number, number],
    color: string,
    base: number,
    top: number,
  ) => {
    const frame = frameAt((along[0] + along[1]) / 2);
    push(
      part,
      patchRing(frame.lng, frame.lat, frame.hdg,
        [along[0] - frame.pivot, along[1] - frame.pivot], across),
      color, base, top,
    );
  };

  const halfWidth = model.sections[0].halfWidth;
  model.sections.forEach((s, index) => {
    section('body', s, bodyColor, 0.55, model.height);
    // A few centimetres proud of the flanks, so the band is visible against the
    // body rather than z-fighting with it.
    section('glass', s, GLASS_COLOR, model.glassBase, model.glassTop, GLASS_PROUD);
    const start = s.back + (s.tail ?? 0) + 0.5;
    const end = s.front - (s.nose ?? 0) - 0.5;
    for (let along = start; detailed && along < end; along += 2.2) {
      for (const side of [1, -1]) {
        patch('pillar', [along, along + 0.16],
          [side * (s.halfWidth - 0.03), side * (s.halfWidth + 0.07)],
          bodyColor, model.glassBase, model.glassTop);
      }
    }
    if (index > 0) {
      const previous = model.sections[index - 1];
      // Drawn between the two sections' own frames rather than in either one's:
      // articulated, the joint is where they stop being parallel, and a patch
      // laid out in one section's space leaves the other end of it hanging in
      // the air on the outside of a bend.
      const ahead = frames[index - 1];
      const behind = frames[index];
      push(
        'gangway',
        bridgeRing(
          ahead, previous.back + 0.08 - ahead.pivot,
          behind, s.front - 0.08 - behind.pivot,
          halfWidth * 0.82,
        ),
        '#39414b', 0.8, model.height - 0.15,
      );
    }
  });

  for (const axle of detailed ? model.bogies : []) {
    patch('bogie', [axle - 0.8, axle + 0.8], [-halfWidth, halfWidth], '#30343b', 0.18, 0.7);
    for (const side of [1, -1]) {
      for (const delta of v.mode === 'bus' ? [0] : [-0.6, 0.6]) {
        patch('wheel', [axle + delta - 0.36, axle + delta + 0.36],
          [side * (halfWidth - 0.12), side * (halfWidth + 0.09)], '#14181e', 0.06, 0.82);
        patch('wheel-hub', [axle + delta - 0.17, axle + delta + 0.17],
          [side * (halfWidth + 0.09), side * (halfWidth + 0.11)], '#8b96a3', 0.26, 0.6);
      }
    }
  }

  // Doors, drawn the way the schematic draws them: two leaves per doorway that
  // actually slide apart rather than merely changing colour. Closed, the pair
  // meets in the middle and covers the opening; open, each leaf slides its own
  // width clear along the flank and the amber doorway shows in the gap between
  // them. The leaves stand further out than the doorway, which stands further
  // out than the window band, so the three never z-fight.
  const half = model.doorWidth / 2;
  (detailed ? model.doors : []).forEach((centre) => {
    const owner = model.sections.find((s) => centre >= s.back && centre <= s.front)!;
    model.doorSides.forEach((side) => {
      const flank = (proud: number): [number, number] => [
        side * (owner.halfWidth - 0.05),
        side * (owner.halfWidth + proud),
      ];
      // The opening behind the leaves. Only drawn when it can be seen: a shut
      // door hides it completely, and every vehicle is a few polygons already.
      if (progress > 0) {
        patch(
          'doorway',
          [centre - half, centre + half],
          flank(DOORWAY_PROUD),
          DOORS_OPEN_COLOR,
          0.35,
          model.glassTop,
        );
      }
      // Each leaf slides its own width clear, which uncovers exactly the
      // doorway between them — no wider, or plain body would show in the gap.
      const slide = half * progress;
      patch('door', [centre - half - slide, centre - slide], flank(DOOR_PROUD), DOOR_COLOR, 0.35, model.glassTop);
      patch('door', [centre + slide, centre + half + slide], flank(DOOR_PROUD), DOOR_COLOR, 0.35, model.glassTop);
    });
  });

  // Cab patches lie flat on the roof at each driving end, where a camera
  // looking down at the vehicle can actually see them — the schematic's
  // windscreen, turned to face the sky.
  model.cabs.forEach((end) => {
    const sign = Math.sign(end) || 1;
    patch(
      'cab',
      [end - sign * 2.6, end - sign * 0.6],
      [-halfWidth * 0.62, halfWidth * 0.62],
      CAB_COLOR,
      model.height,
      model.height + 0.06,
    );
  });

  if (model.roofStripe) {
    model.sections.forEach((s) => {
      patch(
        'roof',
        [s.back + 1, s.front - 1],
        [-model.roofStripe!.halfWidth, model.roofStripe!.halfWidth],
        model.roofStripe!.color,
        model.height,
        model.height + 0.05,
      );
    });
  }

  for (const centre of detailed ? model.hvac : []) {
    patch('hvac', [centre - 1.1, centre + 1.1], [-0.7, 0.7], '#aeb8c4', model.height, model.height + 0.3);
    patch('roof', [centre - 0.8, centre + 0.8], [-0.45, 0.45], '#596673', model.height + 0.3, model.height + 0.34);
  }
  if (detailed && model.pantograph !== undefined) {
    const p = model.pantograph;
    // Stepped arms approximate a raised collector without a mesh/custom layer.
    patch('pantograph', [p - 0.9, p + 0.9], [-0.4, 0.4], '#55616d', model.height, model.height + 0.15);
    for (const side of [-1, 1]) {
      for (let step = 0; step < 5; step++) {
        patch('pantograph', [p - 0.7 + step * 0.16, p - 0.5 + step * 0.16],
          [side * 0.22 - 0.06, side * 0.22 + 0.06], '#d4dce3',
          model.height + 0.15 + step * 0.1, model.height + 0.27 + step * 0.1);
      }
    }
    patch('pantograph', [p - 0.1, p + 0.12], [-0.9, 0.9], '#303a45', model.height + 0.65, model.height + 0.8);
  }

  const front = model.sections[0].front;
  const back = model.sections[model.sections.length - 1].back;
  for (const [end, direction] of [[front, 1], [back, -1]]) {
    patch('bumper', [end - direction * 0.08, end + direction * 0.09],
      [-halfWidth * 0.55, halfWidth * 0.55], '#303a45', 0.55, 0.8);
    for (const side of [-1, 1]) {
      const across = side * halfWidth * 0.38;
      patch('lamp-housing', [end - direction * 0.04, end + direction * 0.15],
        [across - 0.24, across + 0.24], '#202833', 1.05, 1.55);
      patch(direction === 1 ? 'headlight' : 'taillight',
        [end + direction * 0.15, end + direction * 0.23], [across - 0.18, across + 0.18],
        direction === 1 ? HEADLIGHT_COLOR
          : v.braking && (v.mode === 'bus' || v.mode === 'tram') ? BRAKE_LIGHT_COLOR : TAILLIGHT_COLOR,
        1.13, 1.47);
    }
  }
  patch('destination', [front - 0.45, front - 0.2], [-0.5, 0.5], '#e8e5bb',
    model.height + 0.06, model.height + 0.16);
  if (v.braking) {
    // A schematic telemetry cue, NOT a claim that rail stock has brake lamps.
    // Rail tail lamps stay red/steady; only road rear lamps brighten.
    patch('brake-indicator', [back + 1.5, back + 2.1], [-0.4, 0.4],
      BRAKE_INDICATOR_COLOR, model.height + 0.08, model.height + 0.2);
  }

  return out;
}

/**
 * Omit sub-pixel running gear, pillars, doors and roof machinery at distant zooms.
 * Bodies, joints, lamps and selection retain identical ground geometry.
 */
export function vehicleExtrusionCollection(vehicles: VehicleState[], detailed = true) {
  return {
    type: 'FeatureCollection' as const,
    features: vehicles.flatMap((v) => vehicleExtrusions(v, detailed)),
  };
}

// The bodies are drawn at real scale, so they only start to read once the view
// is close enough for a few metres to be worth a pixel. Below that the flat
// carriage icons — which scale with zoom instead — stay in charge, and the two
// swap over a short zoom band so neither pops in. Typed loosely (rather than
// against MapLibre's expression types) so this module stays renderer-agnostic
// and testable without a map.
export const VEHICLE_3D_MIN_ZOOM = 13;
export const VEHICLE_3D_FULL_ZOOM = 14;

/** A MapLibre zoom-interpolate expression; cast at the call site. */
export type ZoomFade = (string | number | (string | number)[])[];

/** Extrusion opacity: invisible at the min zoom, fully solid one zoom later. */
export const VEHICLE_3D_FADE_IN: ZoomFade = [
  'interpolate', ['linear'], ['zoom'],
  VEHICLE_3D_MIN_ZOOM, 0,
  VEHICLE_3D_FULL_ZOOM, 1,
];

/** The mirror image, applied to the flat icons while 3D is on. */
export const VEHICLE_ICON_FADE_OUT: ZoomFade = [
  'interpolate', ['linear'], ['zoom'],
  VEHICLE_3D_MIN_ZOOM, 1,
  VEHICLE_3D_FULL_ZOOM, 0,
];
