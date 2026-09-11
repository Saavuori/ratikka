import type { LayerSeed } from './seed';
// MapLibre GL 6 is ESM-only and dropped the default export.
import * as maplibregl from 'maplibre-gl';
import {
} from '../routeNetwork';
import {
  ROUTE_COLORS,
  METRO_COLORS,
  TRAIN_COLORS,
  FERRY_COLORS,
  TRAM_GREEN,
  METRO_ORANGE,
  TRAIN_PURPLE,
  FERRY_CYAN,
} from '../../lib/routeColors';
import {
  FERRY_ICON_SIZE,
  FERRY_LOAD_STEPS,
  ferryIconName,
  ferryIconVariants,
} from '../../lib/ferryIcon';
import {
  VEHICLE_3D_MIN_ZOOM,
  VEHICLE_3D_FADE_IN,
} from '../../lib/vehicleModels';
import { vehicles3DEnabled } from '../../lib/vehicleAnimation';

// for the reported load step, open or shut. Written out here because it is
// fourteen images per line and the layer definition is unreadable inline.
export const ferryBucketMatch = (line: string): unknown[] => {
  const byBucket = (open: boolean): unknown[] => [
    'match',
    ['get', 'occuBucket'],
    ...FERRY_LOAD_STEPS.flatMap((bucket) => [bucket, ferryIconName(bucket, open, line)]),
    ferryIconName(-1, open, line),
  ];
  return ['case', ['get', 'doorsOpen'], byBucket(true), byBucket(false)];
};

export function installVehicleLayers(map: maplibregl.Map, seed: LayerSeed): void {
    // Directional vehicle-body markers. Instead of a bare dot + arrow, each
  // vehicle is a little top-down carriage: a rounded body with a windshield
  // and a nose nub so heading reads at a glance (the icon rotates to `hdg`).
  // Trams are sleek (large corner radius, HSL green); buses are boxier (HSL
  // blue). A "-open" variant swaps the flush side windows for amber door
  // gaps, shown while the real doors are open (`drst === 1`).
  const registerVehicleImage = (name: string, svg: string, size = 40) => {
    if (map.hasImage(name)) return;
    const img = new Image(size, size);
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    // pixelRatio 2 keeps the body crisp on retina; the 40px art shows at ~20 CSS px
    // before the layer's zoom-based icon-size scaling.
    img.onload = () => {
      // The image decodes async; the map may have been removed meanwhile.
      if (!seed.isCurrent(map)) return;
      if (!map.hasImage(name)) map.addImage(name, img, { pixelRatio: 2 });
    };
  };

  // The tram carriage is tinted by its line colour (see lib/routeColors).
  // Window/door/shadow accents use neutral tones so any hue reads cleanly.
  const tramBody = (open: boolean, color: string = TRAM_GREEN) => `
    <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40" fill="none">
      <path d="M20 3.2 L24 8.4 L16 8.4 Z" fill="${color}" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round"/>
      <rect x="12.5" y="7.5" width="15" height="26" rx="6.5" fill="${color}" stroke="#ffffff" stroke-width="2"/>
      <rect x="15" y="10" width="10" height="4.6" rx="2" fill="rgba(255,255,255,0.9)"/>
      ${open
        ? `<rect x="11.9" y="18.4" width="4.4" height="7.6" rx="1.3" fill="#ffb020" stroke="#ffffff" stroke-width="0.7"/>
           <rect x="23.7" y="18.4" width="4.4" height="7.6" rx="1.3" fill="#ffb020" stroke="#ffffff" stroke-width="0.7"/>`
        : `<rect x="14.7" y="17.5" width="4" height="9" rx="1.2" fill="rgba(0,0,0,0.4)"/>
           <rect x="21.3" y="17.5" width="4" height="9" rx="1.2" fill="rgba(0,0,0,0.4)"/>`}
      <rect x="15" y="29" width="10" height="3" rx="1.5" fill="rgba(0,0,0,0.3)"/>
    </svg>
  `;

  const busBody = (open: boolean) => `
    <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40" fill="none">
      <path d="M20 3.2 L24.6 8.4 L15.4 8.4 Z" fill="#0984e3" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round"/>
      <rect x="12" y="7.5" width="16" height="26" rx="4" fill="#0984e3" stroke="#ffffff" stroke-width="2"/>
      <rect x="14.5" y="10" width="11" height="4.6" rx="1.5" fill="#dbeeff"/>
      ${open
        ? `<rect x="11.4" y="18.4" width="4.4" height="7.6" rx="1.1" fill="#ffb020" stroke="#ffffff" stroke-width="0.7"/>
           <rect x="24.2" y="18.4" width="4.4" height="7.6" rx="1.1" fill="#ffb020" stroke="#ffffff" stroke-width="0.7"/>`
        : `<rect x="14.3" y="17.5" width="4.2" height="9" rx="1.1" fill="#08355c" opacity="0.5"/>
           <rect x="21.5" y="17.5" width="4.2" height="9" rx="1.1" fill="#08355c" opacity="0.5"/>`}
      <rect x="14.5" y="29" width="11" height="3" rx="1.2" fill="#08355c" opacity="0.35"/>
    </svg>
  `;

  // Metro: a coupled pair of units, drawn as what it is — one long, flat-
  // fronted train split across the middle by the coupling gap between its two
  // halves, in HSL's metro orange with the white bands the M-stock carries.
  // The seam and the doubled length are the cue that reads at a glance:
  // nothing else on the map is shaped like this. Both ends get a cab
  // windshield, because a metro train has a driver's cab at each end and
  // reverses at the terminus rather than turning around — the leading one is
  // brighter, so the direction of travel still reads.
  const metroBody = (open: boolean, color: string = METRO_ORANGE) => `
    <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40" fill="none">
      <rect x="12.4" y="2.6" width="15.2" height="34.8" rx="3.2" fill="${color}" stroke="#ffffff" stroke-width="2"/>
      <rect x="14.6" y="4.6" width="10.8" height="4.2" rx="1.1" fill="rgba(255,255,255,0.95)"/>
      <rect x="14.6" y="31.2" width="10.8" height="3.6" rx="1" fill="rgba(255,255,255,0.55)"/>
      <rect x="12.4" y="16.4" width="15.2" height="1.5" fill="rgba(255,255,255,0.85)"/>
      <rect x="12.4" y="19" width="15.2" height="2" fill="rgba(0,0,0,0.55)"/>
      <rect x="12.4" y="22.1" width="15.2" height="1.5" fill="rgba(255,255,255,0.85)"/>
      ${open
        ? `<rect x="11.7" y="10.6" width="4.6" height="4.6" rx="1" fill="#ffb020" stroke="#ffffff" stroke-width="0.7"/>
           <rect x="23.7" y="10.6" width="4.6" height="4.6" rx="1" fill="#ffb020" stroke="#ffffff" stroke-width="0.7"/>
           <rect x="11.7" y="25" width="4.6" height="4.6" rx="1" fill="#ffb020" stroke="#ffffff" stroke-width="0.7"/>
           <rect x="23.7" y="25" width="4.6" height="4.6" rx="1" fill="#ffb020" stroke="#ffffff" stroke-width="0.7"/>`
        : `<rect x="13.4" y="10.4" width="4.2" height="5" rx="0.9" fill="rgba(0,0,0,0.42)"/>
           <rect x="22.4" y="10.4" width="4.2" height="5" rx="0.9" fill="rgba(0,0,0,0.42)"/>
           <rect x="13.4" y="24.8" width="4.2" height="5" rx="0.9" fill="rgba(0,0,0,0.42)"/>
           <rect x="22.4" y="24.8" width="4.2" height="5" rx="0.9" fill="rgba(0,0,0,0.42)"/>`}
    </svg>
  `;

  // Commuter train: the longest body of the set, in HSL's commuter purple,
  // with a slanted nose — a Sm-series unit seen from above.
  const trainBody = (open: boolean, color: string = TRAIN_PURPLE) => `
    <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40" fill="none">
      <path d="M20 1.8 L25.2 7.8 L14.8 7.8 Z" fill="${color}" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round"/>
      <path d="M13 11 C13 8.4 15.9 6.6 20 6.6 C24.1 6.6 27 8.4 27 11 L27 33 C27 34.7 25.7 36 24 36 L16 36 C14.3 36 13 34.7 13 33 Z" fill="${color}" stroke="#ffffff" stroke-width="2"/>
      <rect x="15" y="9.6" width="10" height="4.4" rx="1.4" fill="rgba(255,255,255,0.92)"/>
      ${open
        ? `<rect x="12.4" y="19.2" width="4.4" height="8" rx="1.1" fill="#ffb020" stroke="#ffffff" stroke-width="0.7"/>
           <rect x="23.2" y="19.2" width="4.4" height="8" rx="1.1" fill="#ffb020" stroke="#ffffff" stroke-width="0.7"/>`
        : `<rect x="14.8" y="18.4" width="4.2" height="9.6" rx="1" fill="rgba(0,0,0,0.42)"/>
           <rect x="21" y="18.4" width="4.2" height="9.6" rx="1" fill="rgba(0,0,0,0.42)"/>`}
      <rect x="15" y="31" width="10" height="3" rx="1.2" fill="rgba(0,0,0,0.3)"/>
    </svg>
  `;

  // Generic (unknown-line) tram bodies fall back to HSL green.
  registerVehicleImage('tram-body', tramBody(false));
  registerVehicleImage('tram-body-open', tramBody(true));
  // One tinted body per known line so each route is distinguishable on the map.
  Object.entries(ROUTE_COLORS).forEach(([line, color]) => {
    registerVehicleImage(`tram-body-${line}`, tramBody(false, color));
    registerVehicleImage(`tram-body-${line}-open`, tramBody(true, color));
  });
  registerVehicleImage('bus-body', busBody(false));
  registerVehicleImage('bus-body-open', busBody(true));
  // Metro and commuter trains get the same per-line tinting as trams: few
  // lines, so every one of them has a curated colour.
  registerVehicleImage('metro-body', metroBody(false));
  registerVehicleImage('metro-body-open', metroBody(true));
  Object.entries(METRO_COLORS).forEach(([line, color]) => {
    registerVehicleImage(`metro-body-${line}`, metroBody(false, color));
    registerVehicleImage(`metro-body-${line}-open`, metroBody(true, color));
  });
  registerVehicleImage('train-body', trainBody(false));
  registerVehicleImage('train-body-open', trainBody(true));
  Object.entries(TRAIN_COLORS).forEach(([line, color]) => {
    registerVehicleImage(`train-body-${line}`, trainBody(false, color));
    registerVehicleImage(`train-body-${line}-open`, trainBody(true, color));
  });
  // Ferries. The vessel art lives in `lib/ferryIcon` rather than inline here,
  // because unlike the four carriages it carries live data: there is one
  // marker per load step (and one for a vessel with no count reported), open
  // and shut, per hull colour. `trams-body` picks between them from the
  // `occuBucket` property below, so a boat's deck gauge fills on the map as
  // the feed reports it filling.
  ferryIconVariants().forEach(({ name, svg }) => {
    registerVehicleImage(name, svg, FERRY_ICON_SIZE);
  });

  // Rear brake lights: two red lamps on a transparent 40x40 canvas, positioned
  // at the tail of the carriage (bottom of the art). Drawn on top of the body
  // and rotated with `hdg`, so the lamps always sit on the vehicle's rear.
  // Each lamp is a hot core inside two softer red glows (no SVG filters — the
  // rest of the icon set fakes glow with stacked opacities the same way).
  const brakeLights = `
    <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40" fill="none">
      <circle cx="16" cy="30.6" r="3.7" fill="#ff1f1f" opacity="0.30"/>
      <circle cx="16" cy="30.6" r="2.1" fill="#ff2d2d" opacity="0.8"/>
      <circle cx="16" cy="30.6" r="1.15" fill="#ff8a8a"/>
      <circle cx="24" cy="30.6" r="3.7" fill="#ff1f1f" opacity="0.30"/>
      <circle cx="24" cy="30.6" r="2.1" fill="#ff2d2d" opacity="0.8"/>
      <circle cx="24" cy="30.6" r="1.15" fill="#ff8a8a"/>
    </svg>
  `;
  registerVehicleImage('brake-lights', brakeLights);

  // Create Selected Tram Highlight Image
  if (!map.hasImage('tram-selected')) {
    const selectedSvg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44" fill="none">
        <circle cx="22" cy="22" r="18" stroke="#fdcb6e" stroke-width="4" fill="none"/>
      </svg>
    `;
    const selectedImg = new Image(44, 44);
    selectedImg.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(selectedSvg);
    selectedImg.onload = () => {
      if (!seed.isCurrent(map)) return;
      if (!map.hasImage('tram-selected')) map.addImage('tram-selected', selectedImg);
    };
  }

  // Stop signs. Not a road sign on a stick: HSL's kerbside furniture is a
  // rectangular board on a pole, and drawing it that way is most of what
  // makes a stop read as a stop rather than as a map pin. Each is a board in
  // the mode's colour with a white pictogram, a pole below it and a contact
  // shadow at the foot, so the sign looks planted rather than floating.
  //
  // Every variant is the same art with a different board colour and glyph;
  // the "-selected" pair swaps the white border for the gold of the
  // selection ring. Drawn at 2x and registered with pixelRatio 2, so the
  // board's edges and the glyph stay crisp when zoomed in.
  const SIGN_W = 44;
  const SIGN_H = 62;
  const signGlyphs: Record<string, (color: string) => string> = {
    // A tram: body with a pantograph stub, destination window and two lamps.
    tram: (color) => `
      <path d="M22 7.5 L22 5 M18.6 5 L25.4 5" stroke="#ffffff" stroke-width="1.4" stroke-linecap="round"/>
      <rect x="15.6" y="7.6" width="12.8" height="17" rx="3" fill="#ffffff"/>
      <rect x="17.4" y="9.6" width="9.2" height="4.6" rx="1" fill="${color}"/>
      <circle cx="18.6" cy="19.4" r="1.15" fill="${color}"/>
      <circle cx="25.4" cy="19.4" r="1.15" fill="${color}"/>
      <path d="M18.2 24.6 L16.6 27 M25.8 24.6 L27.4 27" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round"/>
    `,
    // A bus: boxier than the tram, windscreen band and two wheels.
    bus: (color) => `
      <rect x="14.4" y="8.4" width="15.2" height="15.4" rx="2.6" fill="#ffffff"/>
      <rect x="16.2" y="10.4" width="11.6" height="4.4" rx="1" fill="${color}"/>
      <circle cx="18.1" cy="19.6" r="1.2" fill="${color}"/>
      <circle cx="25.9" cy="19.6" r="1.2" fill="${color}"/>
      <rect x="16.4" y="23.8" width="3" height="2.4" rx="1" fill="#ffffff"/>
      <rect x="24.6" y="23.8" width="3" height="2.4" rx="1" fill="#ffffff"/>
    `,
    // The metro's M.
    metro: () => `
      <path d="M15 25 L15 8 L22 17.4 L29 8 L29 25" stroke="#ffffff" stroke-width="3.2"
            stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    `,
    // A ferry quay: a vessel bow-on above its own reflection in the water.
    ferry: (color) => `
      <path d="M22 6.6 C24.6 8.6 26.2 11 26.8 13.8 L26.8 18.4
               C26.8 20 25.6 21.2 24 21.2 L20 21.2
               C18.4 21.2 17.2 20 17.2 18.4 L17.2 13.8
               C17.8 11 19.4 8.6 22 6.6 Z" fill="#ffffff"/>
      <rect x="19.2" y="11.4" width="5.6" height="3.4" rx="1" fill="${color}"/>
      <path d="M13.4 24.2 C15.6 25.8 17.8 25.8 20 24.2 C22.2 25.8 24.4 25.8 26.6 24.2
               C28 23.2 29.4 23.4 30.6 24.6" stroke="#ffffff" stroke-width="1.6"
            stroke-linecap="round" fill="none"/>
    `,
    // A commuter train: rounded cab roof, windscreen, lamps and rails below.
    train: (color) => `
      <path d="M15.4 12.6 C15.4 9.2 18.4 7.4 22 7.4 C25.6 7.4 28.6 9.2 28.6 12.6
               L28.6 21.6 C28.6 23.2 27.4 24.4 25.8 24.4 L18.2 24.4
               C16.6 24.4 15.4 23.2 15.4 21.6 Z" fill="#ffffff"/>
      <rect x="17.4" y="11" width="9.2" height="4.6" rx="1.2" fill="${color}"/>
      <circle cx="18.7" cy="20.4" r="1.2" fill="${color}"/>
      <circle cx="25.3" cy="20.4" r="1.2" fill="${color}"/>
      <path d="M18 24.6 L16.2 27.2 M26 24.6 L27.8 27.2" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round"/>
    `,
  };

  const registerStopSign = (name: string, glyph: keyof typeof signGlyphs, color: string, selected: boolean) => {
    if (map.hasImage(name)) return;
    const border = selected ? '#fdcb6e' : '#ffffff';
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${SIGN_W}" height="${SIGN_H}" viewBox="0 0 ${SIGN_W} ${SIGN_H}" fill="none">
        <ellipse cx="22" cy="58.4" rx="7.6" ry="2.4" fill="rgba(15,23,42,0.28)"/>
        <rect x="20.2" y="30" width="3.6" height="28.4" rx="1.6" fill="#4b5563"/>
        <rect x="20.2" y="30" width="1.3" height="28.4" fill="#6b7684"/>
        <rect x="3.4" y="3.4" width="37.2" height="29.2" rx="4.4" fill="${color}"
              stroke="${border}" stroke-width="${selected ? 3.4 : 2.6}"/>
        ${signGlyphs[glyph](color)}
      </svg>
    `;
    const img = new Image(SIGN_W, SIGN_H);
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    img.onload = () => {
      if (!seed.isCurrent(map)) return;
      if (!map.hasImage(name)) map.addImage(name, img, { pixelRatio: 2 });
    };
  };

  ([
    ['sign-tram', 'tram', TRAM_GREEN],
    ['sign-bus', 'bus', '#007ac9'],
    ['sign-bus-trunk', 'bus', '#CA4300'],
    ['sign-metro', 'metro', METRO_ORANGE],
    ['sign-train', 'train', TRAIN_PURPLE],
    ['sign-ferry', 'ferry', FERRY_CYAN],
  ] as Array<[string, keyof typeof signGlyphs, string]>).forEach(([name, glyph, color]) => {
    registerStopSign(name, glyph, color, false);
    registerStopSign(`${name}-selected`, glyph, color, true);
  });

  // Add Live Trams Source (GeoJSON)
  if (!map.getSource('trams')) {
    map.addSource('trams', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [],
      },
    });
  }

  // Vehicle base circle — the floor of the vehicle stack. It is kept as
  // `trams-circles` for two reasons even though the motion aura it used to
  // draw is gone: it is the `beforeId` anchor every other custom layer is
  // inserted before, and it is the (invisible) tap/click hit-target for a
  // vehicle, extending the target beyond the body icon (the body is the
  // primary target; both are bound in the interaction setup below). It is
  // fully transparent, so no coloured glow is drawn under vehicles — the
  // heading/state is read from the carriage body and the rear brake lights.
  if (!map.getLayer('trams-circles')) {
    map.addLayer({
      id: 'trams-circles',
      type: 'circle',
      source: 'trams',
      paint: {
        // A modest zoom-scaled radius keeps vehicles easy to tap; opacity 0
        // means it only ever acts as a hit-target, never a visible mark.
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 11, 17, 20],
        'circle-opacity': 0,
      },
    });
  }

  // 6b. (The stopped cue is no longer a glow under the vehicle — it is the rear
  //  brake-lights layer added on top of the body in section 7b below.)

  // Directional vehicle body (on top of the aura + pulse). Rotates to `hdg`
  // and swaps to the doors-open art while the doors are open.
  if (!map.getLayer('trams-body')) {
    map.addLayer({
      id: 'trams-body',
      type: 'symbol',
      source: 'trams',
      layout: {
        // Body art per mode, then per line: each of trams, metro and trains
        // picks the line-tinted body (open/closed variants), falling back to
        // its generic mode-coloured body for lines outside the palette.
        'icon-image': [
          'case',
          ['==', ['get', 'mode'], 'bus'],
          ['case', ['get', 'doorsOpen'], 'bus-body-open', 'bus-body'],
          ['==', ['get', 'mode'], 'metro'],
          ['case', ['get', 'doorsOpen'],
            ['match', ['get', 'desi'],
              ...Object.keys(METRO_COLORS).flatMap((l) => [l, `metro-body-${l}-open`]),
              'metro-body-open'],
            ['match', ['get', 'desi'],
              ...Object.keys(METRO_COLORS).flatMap((l) => [l, `metro-body-${l}`]),
              'metro-body']],
          ['==', ['get', 'mode'], 'train'],
          ['case', ['get', 'doorsOpen'],
            ['match', ['get', 'desi'],
              ...Object.keys(TRAIN_COLORS).flatMap((l) => [l, `train-body-${l}-open`]),
              'train-body-open'],
            ['match', ['get', 'desi'],
              ...Object.keys(TRAIN_COLORS).flatMap((l) => [l, `train-body-${l}`]),
              'train-body']],
          // Ferries branch on the load step as well as the line, so the deck
          // gauge on the marker tracks what the vessel is reporting. -1 is
          // "no count", which draws the grey track rather than an empty deck.
          ['==', ['get', 'mode'], 'ferry'],
          ['match', ['get', 'desi'],
            ...Object.keys(FERRY_COLORS).flatMap((line) => [
              line,
              ferryBucketMatch(line),
            ]),
            ferryBucketMatch('')],
          ['get', 'doorsOpen'],
          ['match', ['get', 'desi'],
            ...Object.keys(ROUTE_COLORS).flatMap((l) => [l, `tram-body-${l}-open`]),
            'tram-body-open'],
          ['match', ['get', 'desi'],
            ...Object.keys(ROUTE_COLORS).flatMap((l) => [l, `tram-body-${l}`]),
            'tram-body'],
        ] as unknown as maplibregl.DataDrivenPropertyValueSpecification<string>,
        'icon-rotate': ['get', 'hdg'],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-size': [
          'interpolate', ['linear'], ['zoom'],
          12, 1.3,
          14, 1.55,
          17, 2.0,
        ],
      },
    });
  }

  // 7b. Rear brake lights — the stopped/braking cue, replacing the old coral
  //  glow. Two red tail lamps drawn on TOP of the body (the lamps sit inside
  //  the carriage footprint, so a layer under the body would hide them) and
  //  rotated with `hdg` at the exact icon-size of the body, so they stay
  //  pinned to the vehicle's rear at every zoom. They light while the vehicle
  //  is `stopped` (waiting at a light, in traffic, at a terminus, or with
  //  doors open) and also while it is braking hard (`acc < -0.35`, the same
  //  threshold that turns the motion aura red), so they glow on the way into
  //  a stop and stay lit through it — just like real brake lights. Off (and
  //  placement-free) the instant the vehicle is moving without braking.
  if (!map.getLayer('trams-brake')) {
    map.addLayer({
      id: 'trams-brake',
      type: 'symbol',
      source: 'trams',
      layout: {
        'icon-image': 'brake-lights',
        'icon-rotate': ['get', 'hdg'],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-size': [
          'interpolate', ['linear'], ['zoom'],
          12, 1.3,
          14, 1.55,
          17, 2.0,
        ],
      },
      paint: {
        'icon-opacity': [
          'case',
          ['any', ['get', 'stopped'], ['<', ['get', 'acc'], -0.35]], 1,
          0,
        ],
      },
    });
  }

  // 7c. Detailed 3D vehicle bodies at real vehicle scale (lib/vehicleModels).
  //  Colour, height and base come from each part's feature.
  //  Populated only while models are enabled (see the animation loop), and faded in
  //  across the same zooms the flat icons fade out over, so the swap between
  //  the two is a crossfade rather than a pop.
  if (!map.getSource('vehicles-3d')) {
    map.addSource('vehicles-3d', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
  }
  if (!map.getLayer('vehicles-3d')) {
    map.addLayer({
      id: 'vehicles-3d',
      type: 'fill-extrusion',
      source: 'vehicles-3d',
      minzoom: VEHICLE_3D_MIN_ZOOM,
      layout: { visibility: vehicles3DEnabled(seed.is3D, seed.always3DVehicles) ? 'visible' : 'none' },
      paint: {
        'fill-extrusion-color': ['get', 'color'],
        'fill-extrusion-height': ['get', 'top'],
        'fill-extrusion-base': ['get', 'base'],
        'fill-extrusion-opacity': VEHICLE_3D_FADE_IN as maplibregl.PropertyValueSpecification<number>,
      },
    });
  }

  // Add Tram Text Label Layer (on top of arrows/circles)
  if (!map.getLayer('trams-labels')) {
    map.addLayer({
      id: 'trams-labels',
      type: 'symbol',
      source: 'trams',
      layout: {
        'text-field': '{desi}',
        'text-font': ['Gotham Rounded Medium'],
        'text-size': 12,
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: {
        'text-color': '#ffffff',
        // Dark halo keeps the line number legible over the body's windows
        // and the lighter windshield band.
        'text-halo-color': 'rgba(15, 23, 42, 0.65)',
        'text-halo-width': 1.1,
      },
    });
  }

  // Add Selection Highlight Ring (circle style, rendered under labels, on top of circles)
  if (!map.getLayer('trams-selected-layer')) {
    map.addLayer({
      id: 'trams-selected-layer',
      type: 'circle',
      source: 'trams',
      paint: {
        'circle-radius': 20,
        'circle-color': 'rgba(253, 203, 110, 0.15)',
        'circle-stroke-color': '#fdcb6e',
        'circle-stroke-width': 3,
      },
      filter: ['in', ['get', 'veh'], ['literal', [...seed.journeyVehicleIds, seed.selectedVehicleId || '']]],
    }, 'trams-labels');
  }

}
