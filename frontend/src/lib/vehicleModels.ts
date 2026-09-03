// 3D vehicle bodies for the tilted map.
//
// In 3D view the flat carriage icons are replaced by extruded bodies built from
// the same anatomy the popup schematics draw (see VehicleSchematic): a tram is
// one carriage with a cab at either end, the metro is the coupled pair with the
// gap between its two units, a commuter train is one long body with a raked
// nose, and a bus is short and boxy. The details carry over too — a window band
// wrapping the flanks, individual doors that turn amber as they slide open, a
// pale cab patch at each driving end, and the train's pantograph — because a
// plain slab tells you nothing a dot would not.
//
// Everything here is in metres at real vehicle scale, so a train really is
// three tram-lengths long on the map. `fill-extrusion` geometry is anchored to
// the ground in world units, which is what makes the bodies sit in the street
// alongside the extruded buildings instead of floating at an icon size. It also
// decides what is worth drawing: a map camera looks down at these, so the
// details that read are the ones on the roof and standing proud of the flanks,
// not anything tucked under the sills.

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
  /**
   * Driving ends, as distances from the centre: a pale patch is laid on the
   * roof at each, the 3D read of the schematic's cab windscreen. The sign says
   * which way it faces, so a two-cab vehicle lists both ends.
   */
  cabs: number[];
  /** A lighter stripe down the middle of the roof (the metro's white band). */
  roofStripe?: { color: string; halfWidth: number };
  /** Optional roof box — the commuter train's pantograph. */
  roof?: BodySection & { base: number; top: number };
}

// Dimensions follow the real rolling stock closely enough that the modes are
// tellable apart by size alone: an Artic tram is 27 m, a city bus 12.5 m, a
// two-unit metro train just under 90 m, and a four-car Sm-series unit 75 m.
// Door counts and positions match the schematics: three sets on a tram, two on
// a bus, two per metro unit, three on a commuter train.
export const VEHICLE_MODELS: Record<string, VehicleModel> = {
  tram: {
    sections: [{ front: 13.5, back: -13.5, halfWidth: 1.2, nose: 1.6, tail: 1.6 }],
    height: 3.4,
    glassBase: 1.5,
    glassTop: 2.6,
    doors: [7.2, 0, -7.2],
    doorWidth: 1.3,
    cabs: [13.5, -13.5],
  },
  bus: {
    sections: [{ front: 6.2, back: -6.3, halfWidth: 1.28, nose: 1.2 }],
    height: 3.1,
    glassBase: 1.6,
    glassTop: 2.6,
    doors: [2.6, -2.4],
    doorWidth: 1.1,
    cabs: [6.2],
  },
  // Two units nose to nose with the coupling gap between them — the seam is the
  // cue that reads at a glance, exactly as in the schematic.
  metro: {
    sections: [
      { front: 44.5, back: 1.0, halfWidth: 1.6, nose: 2.2 },
      { front: -1.0, back: -44.5, halfWidth: 1.6, tail: 2.2 },
    ],
    height: 3.6,
    glassBase: 1.7,
    glassTop: 2.8,
    doors: [34, 12, -12, -34],
    doorWidth: 1.4,
    cabs: [44.5, -44.5],
    roofStripe: { color: '#f1f5f9', halfWidth: 0.45 },
  },
  train: {
    sections: [{ front: 37.5, back: -37.5, halfWidth: 1.6, nose: 3.5, tail: 3.5 }],
    height: 4.0,
    glassBase: 1.9,
    glassTop: 3.0,
    doors: [22, 0, -22],
    doorWidth: 1.4,
    cabs: [37.5, -37.5],
    // The pantograph on the roof, reaching for the overhead wire.
    roof: { front: 6, back: -6, halfWidth: 0.55, base: 4.0, top: 4.7 },
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
  // Chamfered corners are pulled in to about a third of the width, which is
  // enough taper to read as a nose without narrowing the cab to a point.
  const tip = hw * 0.35;

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
  selected?: boolean;
}

export type VehiclePart = 'body' | 'glass' | 'doorway' | 'door' | 'cab' | 'roof';

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
 * Every extruded piece of one vehicle: the body (or bodies, for the coupled
 * metro), the window band around it, a pair of door leaves on each flank at
 * every door position, a cab patch on the roof at each driving end, and the
 * roof detail where the model has one. A selected vehicle turns gold, the same
 * cue as the flat selection ring.
 */
export function vehicleExtrusions(v: VehicleState): ExtrusionFeature[] {
  const model = vehicleModel(v.mode);
  const bodyColor = v.selected ? SELECTED_COLOR : vehicleBodyColor(v.mode, v.desi);
  const doorway = v.doorsOpen;
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

  model.sections.forEach((s) => {
    section('body', s, bodyColor, 0, model.height);
    // A few centimetres proud of the flanks, so the band is visible against the
    // body rather than z-fighting with it.
    section('glass', s, GLASS_COLOR, model.glassBase, model.glassTop, GLASS_PROUD);
  });

  // Doors, drawn the way the schematic draws them: two leaves per doorway that
  // actually slide apart rather than merely changing colour. Closed, the pair
  // meets in the middle and covers the opening; open, each leaf slides its own
  // width clear along the flank and the amber doorway shows in the gap between
  // them. The leaves stand further out than the doorway, which stands further
  // out than the window band, so the three never z-fight.
  const halfWidth = model.sections[0].halfWidth;
  const half = model.doorWidth / 2;
  model.doors.forEach((centre) => {
    [1, -1].forEach((side) => {
      const flank = (proud: number): [number, number] => [
        side * (halfWidth - 0.05),
        side * (halfWidth + proud),
      ];
      // The opening behind the leaves. Only drawn when it can be seen: a shut
      // door hides it completely, and every vehicle is a few polygons already.
      if (doorway) {
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
      const slide = doorway ? half : 0;
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

  if (model.roof) {
    section('roof', model.roof, '#94a3b8', model.roof.base, model.roof.top);
  }

  return out;
}

/** Every vehicle's extrusions as one GeoJSON FeatureCollection. */
export function vehicleExtrusionCollection(vehicles: VehicleState[]) {
  return {
    type: 'FeatureCollection' as const,
    features: vehicles.flatMap(vehicleExtrusions),
  };
}

// The bodies are drawn at real scale, so they only start to read once the view
// is close enough for a few metres to be worth a pixel. Below that the flat
// carriage icons — which scale with zoom instead — stay in charge, and the two
// swap over a short zoom band so neither pops in. Typed loosely (rather than
// against MapLibre's expression types) so this module stays renderer-agnostic
// and testable without a map.
export const VEHICLE_3D_MIN_ZOOM = 15;

/** A MapLibre zoom-interpolate expression; cast at the call site. */
export type ZoomFade = (string | number | (string | number)[])[];

/** Extrusion opacity: invisible at the min zoom, fully solid one zoom later. */
export const VEHICLE_3D_FADE_IN: ZoomFade = [
  'interpolate', ['linear'], ['zoom'],
  VEHICLE_3D_MIN_ZOOM, 0,
  16, 1,
];

/** The mirror image, applied to the flat icons while 3D is on. */
export const VEHICLE_ICON_FADE_OUT: ZoomFade = [
  'interpolate', ['linear'], ['zoom'],
  VEHICLE_3D_MIN_ZOOM, 1,
  16, 0,
];
