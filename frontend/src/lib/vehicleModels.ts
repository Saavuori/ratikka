// Representative Helsinki vehicles, not fleet-specific engineering drawings.
// All dimensions are ground metres, including details: zoom never inflates them.

import { ROUTE_COLORS, METRO_COLORS, TRAIN_COLORS, TRAM_GREEN, METRO_ORANGE, TRAIN_PURPLE, BUS_BLUE } from './routeColors';

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

const EARTH_RADIUS = 6378137;
const DEG = 180 / Math.PI;

/**
 * Offset a point by metres along and across a heading. `along` is towards the
 * nose, `across` is towards the vehicle's right-hand side; `hdg` is the HFP
 * heading in degrees clockwise from north.
 */
export function offsetMeters(
  lng: number,
  lat: number,
  hdg: number,
  along: number,
  across: number,
): [number, number] {
  const h = hdg * (Math.PI / 180);
  const east = along * Math.sin(h) + across * Math.cos(h);
  const north = along * Math.cos(h) - across * Math.sin(h);
  const dLat = (north / EARTH_RADIUS) * DEG;
  const dLng = (east / (EARTH_RADIUS * Math.cos(lat / DEG))) * DEG;
  return [lng + dLng, lat + dLat];
}

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
}

export type VehiclePart = 'body' | 'glass' | 'pillar' | 'doorway' | 'door' | 'cab' | 'roof'
  | 'gangway' | 'bogie' | 'wheel' | 'wheel-hub' | 'hvac' | 'pantograph' | 'lamp-housing'
  | 'headlight' | 'taillight' | 'brake-indicator' | 'bumper' | 'destination';

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
 * Sectioned bodies, window pillars, running gear, roof equipment, mounted lamps,
 * and sliding door leaves. Selected bodies and pillars match the gold ring.
 */
export function vehicleExtrusions(v: VehicleState, detailed = true): ExtrusionFeature[] {
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
  const section = (part: VehiclePart, s: BodySection, color: string, base: number, top: number, widen = 0) =>
    push(part, sectionRing(v.lng, v.lat, v.hdg, s, widen), color, base, top);
  const patch = (
    part: VehiclePart,
    along: [number, number],
    across: [number, number],
    color: string,
    base: number,
    top: number,
  ) => push(part, patchRing(v.lng, v.lat, v.hdg, along, across), color, base, top);

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
      patch('gangway', [s.front - 0.08, previous.back + 0.08],
        [-halfWidth * 0.82, halfWidth * 0.82], '#39414b', 0.8, model.height - 0.15);
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
  model.doors.forEach((centre) => {
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
 * Omit sub-pixel running gear, pillars and roof machinery at distant zooms.
 * Bodies, joints, doors, lamps and selection retain identical ground geometry.
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
