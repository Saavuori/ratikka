// Per-route colour palette for HSL tram/light-rail lines.
//
// HSL does NOT publish a distinct colour per line: both the GTFS `route.color`
// field and the JORE vector tiles colour vehicles by *mode* (all trams share
// the same green `#00985F`). To tell lines apart on the map we therefore
// maintain our own palette here.
//
// The curated colours below cover the Helsinki tram network (incl. the line 15
// Raide-Jokeri light rail). They are chosen to be visually distinct from one
// another and dark enough that white line-number text stays legible when a
// colour is used as a badge background. Any line not listed — a new line, a
// letter variant, a bus that slips through — falls back to a deterministic
// hash colour so it still gets a stable, distinct hue instead of the ambiguous
// mode green.

export const ROUTE_COLORS: Record<string, string> = {
  '1': '#C4322B',  // red
  '2': '#E4682B',  // orange
  '3': '#B07A00',  // amber / dark goldenrod
  '4': '#2E8B57',  // sea green
  '5': '#8E44AD',  // purple
  '6': '#1F78B4',  // strong blue
  '6T': '#6D8B3C', // olive
  '7': '#C71585',  // magenta
  '8': '#00838F',  // teal cyan
  '9': '#5D3FD3',  // iris / indigo
  '10': '#00695C', // deep teal-green
  '13': '#AD1457', // deep pink
  '15': '#455A9E', // slate blue (Raide-Jokeri)
};

// Metro (M1/M2). HSL paints the whole metro orange; the two lines share a
// street for most of their length, so they are split into two shades of it to
// stay tellable apart on the map while still reading as "metro".
export const METRO_COLORS: Record<string, string> = {
  'M1': '#FF6319', // HSL metro orange
  'M2': '#C1440E', // burnt orange
};

// Commuter trains. HSL's mode colour is a single purple; each letter line gets
// its own hue within the violet family, the same way tram lines do, so a line
// is identifiable without a legend.
export const TRAIN_COLORS: Record<string, string> = {
  'A': '#6A3D9A', // violet
  'D': '#B0559E', // orchid
  'E': '#8C4799', // HSL commuter-train purple
  'G': '#8557A8', // amethyst
  'I': '#7A4FB0', // ring line, iris
  'K': '#5C3A8E', // deep violet
  'L': '#9B4F96', // mulberry
  'P': '#A0459B', // ring line, magenta-violet
  'R': '#6B4FA0', // blue-violet
  'T': '#8E5BB5', // light amethyst
  'U': '#7C3F8F', // plum
  'X': '#94519E', // lilac
  'Y': '#5F4B9B', // indigo
  'Z': '#4E3B84', // dark indigo
};

// HSL's mode green — used as the last-resort fallback when even the hash colour
// is undesirable (e.g. an empty line identifier).
export const TRAM_GREEN = '#00985F';
export const METRO_ORANGE = '#FF6319';
export const TRAIN_PURPLE = '#8C4799';
export const BUS_BLUE = '#0984E3';

/**
 * Accent colour for a whole mode, used where a UI element belongs to a vehicle
 * rather than to one line (panel tabs, schematics, the heading needle).
 */
export function getModeAccent(mode: string | null | undefined): string {
  switch (mode) {
    case 'bus':
      return BUS_BLUE;
    case 'metro':
      return METRO_ORANGE;
    case 'train':
      return TRAIN_PURPLE;
    default:
      return '#00B894'; // tram / light rail
  }
}

// Deterministic string hash (FNV-1a variant) → stable across sessions.
function hashString(str: string): number {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

// h in [0,360], s and l in [0,100].
function hslToHex(h: number, s: number, l: number): string {
  const sn = s / 100;
  const ln = l / 100;
  const a = sn * Math.min(ln, 1 - ln);
  const f = (n: number): string => {
    const k = (n + h / 30) % 12;
    const color = ln - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// Stable, distinct fallback colour for any line missing from ROUTE_COLORS.
// Saturation/lightness are fixed in a band that keeps white text legible.
function fallbackColor(shortName: string): string {
  const hue = hashString(shortName) % 360;
  return hslToHex(hue, 62, 38);
}

/**
 * Resolve the display colour for a line by its short name (e.g. "4", "6T",
 * "M1", "R"). Returns a curated colour when available — tram, metro and
 * commuter-train short names never collide, so one lookup serves all three —
 * otherwise a deterministic hash colour, and the HSL tram green for empty
 * input.
 */
export function getRouteColor(shortName: string | null | undefined): string {
  if (!shortName) return TRAM_GREEN;
  return (
    ROUTE_COLORS[shortName] ??
    METRO_COLORS[shortName] ??
    TRAIN_COLORS[shortName] ??
    fallbackColor(shortName)
  );
}

// The JORE route tiles identify a line by `routeIdParsed`. For trams that is the
// plain line number ("4", "6T"), the same key our palette uses — but metro and
// commuter-rail lines carry a leading zone digit there ("1M1", "1I", "2P"), so
// the tiles need those spellings mapped onto the palette as well.
const withJorePrefixes = (colors: Record<string, string>, prefixes: string[]) => {
  const out: Record<string, string> = {};
  for (const [line, color] of Object.entries(colors)) {
    out[line] = color;
    for (const p of prefixes) out[p + line] = color;
  }
  return out;
};

export const METRO_TILE_COLORS = withJorePrefixes(METRO_COLORS, ['1']);
export const TRAIN_TILE_COLORS = withJorePrefixes(TRAIN_COLORS, ['1', '2']);

/**
 * Build a MapLibre `match` expression that maps a feature property (e.g. the
 * `desi` line number) to its colour in `colors`, falling back to `fallback` for
 * lines not in that palette.
 */
export function colorMatchExpression(
  property: string,
  colors: Record<string, string>,
  fallback: string
): unknown[] {
  const stops: string[] = [];
  for (const [line, color] of Object.entries(colors)) {
    stops.push(line, color);
  }
  return ['match', ['get', property], ...stops, fallback];
}

/**
 * Build a MapLibre `match` expression that maps a feature property (e.g. the
 * `desi` line number) to its curated tram route colour, falling back to
 * `fallback` for lines not in the palette.
 */
export function routeColorMatchExpression(
  property: string,
  fallback: string = TRAM_GREEN
): unknown[] {
  return colorMatchExpression(property, ROUTE_COLORS, fallback);
}
