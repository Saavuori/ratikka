// 3D vehicle bodies for the tilted map.
//
// In 3D view the flat carriage icons are replaced by extruded boxes built from
// the same anatomy the popup schematics draw (see VehicleSchematic): a tram is
// one carriage with a cab at either end, the metro is the coupled pair with the
// gap between its two units, a commuter train is one long body with a raked
// nose, and a bus is short and boxy. Each body carries a window band around its
// flanks, which turns amber while the doors are open — the 3D echo of the
// sliding door leaves in the schematic.
//
// Everything here is in metres at real vehicle scale, so a train really is
// three tram-lengths long on the map. `fill-extrusion` geometry is anchored to
// the ground in world units, which is what makes the bodies sit in the street
// alongside the extruded buildings instead of floating at an icon size.

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
  /** Optional roof box — the commuter train's pantograph. */
  roof?: BodySection & { base: number; top: number };
}

// Dimensions follow the real rolling stock closely enough that the modes are
// tellable apart by size alone: an Artic tram is 27 m, a city bus 12.5 m, a
// two-unit metro train just under 90 m, and a four-car Sm-series unit 75 m.
export const VEHICLE_MODELS: Record<string, VehicleModel> = {
  tram: {
    sections: [{ front: 13.5, back: -13.5, halfWidth: 1.2, nose: 1.6, tail: 1.6 }],
    height: 3.4,
    glassBase: 1.5,
    glassTop: 2.6,
  },
  bus: {
    sections: [{ front: 6.2, back: -6.3, halfWidth: 1.28, nose: 1.2 }],
    height: 3.1,
    glassBase: 1.6,
    glassTop: 2.6,
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
  },
  train: {
    sections: [{ front: 37.5, back: -37.5, halfWidth: 1.6, nose: 3.5, tail: 3.5 }],
    height: 4.0,
    glassBase: 1.9,
    glassTop: 3.0,
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

/** Window glass, and the amber it turns while the doors are open. */
export const GLASS_COLOR = '#16202f';
export const DOORS_OPEN_COLOR = '#ffb020';
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
  // Chamfered corners are pulled in to a quarter of the width, which is enough
  // taper to read as a nose without narrowing the cab to a point.
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

  const ring = pts.map(([along, across]) => offsetMeters(lng, lat, hdg, along, across));
  ring.push(ring[0]);
  return ring;
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

export interface ExtrusionFeature {
  type: 'Feature';
  geometry: { type: 'Polygon'; coordinates: [number, number][][] };
  properties: { veh: string; part: 'body' | 'glass' | 'roof'; color: string; base: number; top: number };
}

/**
 * Extruded footprints for one vehicle: the body (or bodies, for the coupled
 * metro), the window band around it, and the roof detail where the model has
 * one. A selected vehicle turns gold, the same cue as the flat selection ring.
 */
export function vehicleExtrusions(v: VehicleState): ExtrusionFeature[] {
  const model = vehicleModel(v.mode);
  const bodyColor = v.selected ? SELECTED_COLOR : vehicleBodyColor(v.mode, v.desi);
  const glassColor = v.doorsOpen ? DOORS_OPEN_COLOR : GLASS_COLOR;
  const out: ExtrusionFeature[] = [];

  const push = (
    part: 'body' | 'glass' | 'roof',
    section: BodySection,
    color: string,
    base: number,
    top: number,
    widen = 0,
  ) => {
    out.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [sectionRing(v.lng, v.lat, v.hdg, section, widen)] },
      properties: { veh: v.veh, part, color, base, top },
    });
  };

  model.sections.forEach((section) => {
    push('body', section, bodyColor, 0, model.height);
    // 4 cm proud of the flanks, so the band is visible against the body rather
    // than z-fighting with it.
    push('glass', section, glassColor, model.glassBase, model.glassTop, 0.04);
  });

  if (model.roof) {
    push('roof', model.roof, '#94a3b8', model.roof.base, model.roof.top);
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
