// City-bike stations as places, not scores.
//
// A station used to be a donut with a number in it: correct, but it said
// "data point", not "here is a rack of yellow bikes on the pavement". Two
// things live here, and they are two halves of the same idea.
//
// 1. The flat marker (`bikeGaugeIconSvg`). The availability gauge is kept —
//    the ring still shows how full the station is and still turns red when the
//    last bikes are going — but the middle of it now holds a bicycle instead
//    of a numeral, so the marker names itself before it is read. The count
//    moves under the marker where it stays legible at any icon size.
//
// 2. The 3D rack (`bikeStationExtrusions`). The counterpart to
//    `stopModels.ts`: the same real-metre boxes the vehicles and stop shelters
//    are built from, so a station standing beside a tram stop belongs to the
//    same scene. And because a dock is drawn per dock and a bike per bike, the
//    availability that the flat gauge summarises is, up close, simply visible —
//    a full rack looks full and an empty one looks empty.

import { offsetMeters, patchRing, SELECTED_COLOR } from './vehicleModels';
import { platformColors, type MapTheme } from './stopPlatforms';

/** HSL's city bikes, and everything painted to match them. */
export const CITYBIKE_YELLOW = '#fcbc19';
const FRAME_DARK = '#3d4451';
const RUBBER = '#242a33';
const METAL = '#8a94a3';

// --- 1. The flat marker ----------------------------------------------------

export interface GaugeBucket {
  /** Image name registered with the map. */
  name: string;
  /** Share of the ring drawn in `color`, 0…1. */
  fill: number;
  color: string;
}

/**
 * Scarcity buckets for the ring: grey when the last bike has gone, red when
 * one more rider empties it, amber in the middle, green when there is no
 * question. The thresholds are shares of the station's total docks, so a
 * six-dock station and a forty-dock one read the same way.
 */
export const BIKE_GAUGE_BUCKETS: GaugeBucket[] = [
  { name: 'bike-gauge-0', fill: 0, color: '#9ca3af' },   // no bikes left
  { name: 'bike-gauge-1', fill: 0.2, color: '#ef4444' }, // critically low
  { name: 'bike-gauge-2', fill: 0.4, color: '#fcbc19' }, // getting low
  { name: 'bike-gauge-3', fill: 0.6, color: '#fcbc19' }, // moderate
  { name: 'bike-gauge-4', fill: 0.8, color: '#20bf6b' }, // healthy
  { name: 'bike-gauge-5', fill: 1, color: '#20bf6b' },   // plenty / full
];

/** Art-board size of the marker in pixels; drawn at pixelRatio 2. */
export const BIKE_GAUGE_ICON_SIZE = 48;

const GAUGE_R = 16;
const GAUGE_C = 2 * Math.PI * GAUGE_R;

/**
 * A side-on bicycle inside the disc: two wheels, a diamond frame, bars and a
 * saddle. Drawn as strokes rather than a filled silhouette because at 22 CSS
 * pixels a solid blob loses its wheels and stops being a bicycle.
 */
function bicycleGlyph(color: string): string {
  const c = 24; // centre of the 48px board
  const wheelY = c + 3.2;
  const wheelR = 4.6;
  return `
    <g stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none">
      <circle cx="${c - 6.2}" cy="${wheelY}" r="${wheelR}"/>
      <circle cx="${c + 6.2}" cy="${wheelY}" r="${wheelR}"/>
      <path d="M${c - 6.2} ${wheelY} L${c - 1.4} ${wheelY} L${c + 2.6} ${c - 3.4} L${c + 6.2} ${wheelY}"/>
      <path d="M${c - 1.4} ${wheelY} L${c - 2.6} ${c - 3.4}"/>
      <path d="M${c - 4.6} ${c - 3.6} L${c - 0.6} ${c - 3.6}"/>
      <path d="M${c + 2.6} ${c - 3.4} L${c + 4.6} ${c - 3.4}"/>
    </g>
  `;
}

/**
 * One gauge marker: a track ring, the availability arc over it, a white disc,
 * and the bicycle. `fill` of 0 draws no arc at all — an empty station should
 * look empty rather than showing a hairline of colour.
 */
export function bikeGaugeIconSvg(bucket: GaugeBucket): string {
  const c = BIKE_GAUGE_ICON_SIZE / 2;
  const arc = bucket.fill > 0
    ? `<circle cx="${c}" cy="${c}" r="${GAUGE_R}" fill="none" stroke="${bucket.color}" stroke-width="5"
         stroke-linecap="round" stroke-dasharray="${bucket.fill * GAUGE_C} ${GAUGE_C}"
         transform="rotate(-90 ${c} ${c})"/>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${BIKE_GAUGE_ICON_SIZE}" height="${BIKE_GAUGE_ICON_SIZE}" viewBox="0 0 ${BIKE_GAUGE_ICON_SIZE} ${BIKE_GAUGE_ICON_SIZE}" fill="none">
  <circle cx="${c}" cy="${c}" r="${GAUGE_R}" fill="none" stroke="#e5e7eb" stroke-width="5"/>
  ${arc}
  <circle cx="${c}" cy="${c}" r="12" fill="#ffffff" stroke="${bucket.color}" stroke-width="1.5"/>
  ${bicycleGlyph(bucket.color)}
</svg>`;
}

// --- 2. The 3D rack --------------------------------------------------------

export interface BikeStationState {
  stationId: string;
  lng: number;
  lat: number;
  bikesAvailable: number;
  spacesAvailable: number;
  /**
   * Direction the rack runs, degrees clockwise from north, or null when
   * nothing nearby says which way the pavement goes. Unlike a shelter, a rack
   * at a guessed angle is still a rack, so a null bearing is drawn north-south
   * rather than dropped — see `DEFAULT_RACK_BEARING`.
   */
  bearing: number | null;
  /** This station is the one open in the panel. */
  highlighted?: boolean;
}

export type BikeStationPart =
  | 'apron' | 'rail' | 'dock' | 'wheel' | 'frame' | 'bar' | 'terminal' | 'sign';

export interface BikeExtrusionFeature {
  type: 'Feature';
  geometry: { type: 'Polygon'; coordinates: [number, number][][] };
  properties: {
    stationId: string;
    part: BikeStationPart;
    color: string;
    base: number;
    top: number;
  };
}

/** Rack geometry, in metres, measured off an HSL station. */
export const RACK = {
  /** Spacing between neighbouring docks along the rail. */
  dockPitch: 0.82,
  /** Docks drawn at most — a 40-dock station would be a wall of posts. */
  maxDocks: 14,
  /** Bikes drawn at most, for the same reason. */
  maxBikes: 8,
  apronHeight: 0.06,
  apronMargin: 1.1,
  apronHalfWidth: 1.5,
  railHeight: 0.32,
  dockHeight: 0.58,
  /**
   * A parked bike, nose away from the rail. The map is mostly looked at from
   * above, where a bicycle is its frame seen end-on: so the frame is the wide
   * yellow slab and the wheels are the two dark ticks either side of it, not
   * the other way round.
   */
  bike: {
    wheelR: 0.31,
    wheelbase: 1.0,
    rearAxle: 0.3,
    wheelThickness: 0.05,
    frameThickness: 0.18,
    frameBase: 0.38,
    frameTop: 0.98,
    barHeight: 1.06,
  },
  terminal: { height: 1.95, signWidth: 0.62, signHeight: 0.52, signBase: 1.28 },
} as const;

/** Used when nothing on the map gives the station an orientation. */
export const DEFAULT_RACK_BEARING = 0;

/**
 * The station as extruded boxes: an apron, a rail with one dock post per dock,
 * a bike standing in each dock that has one, and the payment terminal at the
 * near end. Occupied docks are filled from the terminal end outwards, which is
 * how a station empties in practice and, more to the point, means the drawn
 * rack changes shape as bikes come and go.
 */
export function bikeStationExtrusions(
  station: BikeStationState,
  theme: MapTheme = 'light',
): BikeExtrusionFeature[] {
  const palette = platformColors(theme);
  const out: BikeExtrusionFeature[] = [];
  const hdg = station.bearing ?? DEFAULT_RACK_BEARING;
  const accent = station.highlighted ? SELECTED_COLOR : CITYBIKE_YELLOW;

  const push = (part: BikeStationPart, ring: [number, number][], color: string, base: number, top: number) => {
    out.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [ring] },
      properties: { stationId: station.stationId, part, color, base, top },
    });
  };
  const patch = (
    part: BikeStationPart,
    along: [number, number],
    across: [number, number],
    color: string,
    base: number,
    top: number,
  ) => push(part, patchRing(station.lng, station.lat, hdg, along, across), color, base, top);

  const bikes = Math.max(0, Math.floor(station.bikesAvailable));
  const spaces = Math.max(0, Math.floor(station.spacesAvailable));
  // A station with no counts at all still gets a short rack: it exists, we
  // just do not know what is in it.
  const totalDocks = Math.min(RACK.maxDocks, Math.max(4, bikes + spaces));
  const drawnBikes = Math.min(bikes, totalDocks, RACK.maxBikes);

  const rackLength = (totalDocks - 1) * RACK.dockPitch;
  const start = -rackLength / 2;

  // 1. Apron. The paved strip the rack stands on, in the same grey the stop
  //    platforms use, so the two kinds of furniture share a ground.
  patch('apron',
    [start - RACK.apronMargin, start + rackLength + RACK.apronMargin],
    [-RACK.apronHalfWidth, RACK.apronHalfWidth],
    palette.extrusion, 0, RACK.apronHeight);

  // 2. The rail the docks are bolted to.
  patch('rail', [start - 0.2, start + rackLength + 0.2], [-0.06, 0.06],
    METAL, RACK.apronHeight, RACK.railHeight);

  const deck = RACK.apronHeight;
  const b = RACK.bike;

  for (let i = 0; i < totalDocks; i++) {
    const at = start + i * RACK.dockPitch;
    const occupied = i < drawnBikes;

    // 3. The dock post itself. Every dock gets one, so the empty half of the
    //    rack is visible as empty rather than as nothing.
    patch('dock', [at - 0.05, at + 0.05], [-0.05, 0.05],
      METAL, deck, deck + RACK.dockHeight);

    if (!occupied) continue;

    // 4. A bike, standing across the rail with its nose out: two wheels, the
    //    frame between them and the bars over the front wheel.
    const rear = b.rearAxle;
    const front = b.rearAxle + b.wheelbase;
    for (const axle of [rear, front]) {
      patch('wheel', [at - b.wheelThickness / 2, at + b.wheelThickness / 2],
        [axle - b.wheelR, axle + b.wheelR], RUBBER, deck, deck + b.wheelR * 2);
    }
    patch('frame', [at - b.frameThickness / 2, at + b.frameThickness / 2],
      [rear + 0.06, front - 0.04], accent, deck + b.frameBase, deck + b.frameTop);
    patch('bar', [at - 0.26, at + 0.26], [front - 0.14, front - 0.02],
      FRAME_DARK, deck + b.barHeight - 0.07, deck + b.barHeight);
  }

  // 5. The terminal at the near end: a post with the yellow sign board on it.
  //    It is the tallest thing in the station, which is what makes the whole
  //    arrangement read as a city-bike station from across the street.
  const t = RACK.terminal;
  const post = start - RACK.apronMargin + 0.35;
  patch('terminal', [post - 0.08, post + 0.08], [-0.08, 0.08],
    station.highlighted ? SELECTED_COLOR : '#4b5563', deck, deck + t.height);
  patch('sign', [post - t.signWidth / 2, post + t.signWidth / 2], [-0.04, 0.04],
    accent, deck + t.signBase, deck + t.signBase + t.signHeight);

  return out;
}

export function bikeStationCollection(stations: BikeStationState[], theme: MapTheme = 'light') {
  return {
    type: 'FeatureCollection' as const,
    features: stations.flatMap((s) => bikeStationExtrusions(s, theme)),
  };
}

/** Point `metres` to the right of `bearing` from a station — used by the tests. */
export function acrossFrom(
  lng: number,
  lat: number,
  bearing: number,
  metres: number,
): [number, number] {
  return offsetMeters(lng, lat, bearing, 0, metres);
}

// A rack is a couple of metres of pavement furniture, so like the stop
// shelters it only starts to mean anything once a metre is worth a pixel.
// Where the gauge markers switch on. The stop discs are pinned level with it
// (see lib/stopCircleStyle) so both kinds of marker arrive together on the way
// out of a zoomed-in view — a map that shows bike stations and no stops looks
// like a map that does not know where the stops are.
export const BIKE_STATION_MIN_ZOOM = 13;

export const BIKE_3D_MIN_ZOOM = 16.2;
export const BIKE_3D_FULL_ZOOM = 17.2;

export const BIKE_3D_FADE_IN: unknown[] = [
  'interpolate', ['linear'], ['zoom'],
  BIKE_3D_MIN_ZOOM, 0,
  BIKE_3D_FULL_ZOOM, 0.95,
];

/**
 * As the rack arrives the flat gauge is handed over to it: the disc fades out
 * across the same band, so the station gains a body instead of wearing a
 * marker on top of one. The count keeps its own opacity and stays, hovering
 * over the rack as a label.
 */
export const BIKE_ICON_FADE_OUT: unknown[] = [
  'interpolate', ['linear'], ['zoom'],
  BIKE_3D_MIN_ZOOM, 1,
  BIKE_3D_FULL_ZOOM, 0,
];

/** Cap on how many stations get a rack at once, so a dense view stays cheap. */
export const BIKE_STATION_LIMIT = 30;

export const BIKE_STATION_SOURCE = 'bike-station-furniture';
export const BIKE_STATION_LAYER = 'bike-station-3d';
