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

// HSL's mode green — used as the last-resort fallback when even the hash colour
// is undesirable (e.g. an empty line identifier).
export const TRAM_GREEN = '#00985F';

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
 * Resolve the display colour for a line by its short name (e.g. "4", "6T").
 * Returns a curated colour when available, otherwise a deterministic hash
 * colour, and finally the HSL tram green for empty input.
 */
export function getRouteColor(shortName: string | null | undefined): string {
  if (!shortName) return TRAM_GREEN;
  return ROUTE_COLORS[shortName] ?? fallbackColor(shortName);
}

/**
 * Build a MapLibre `match` expression that maps a feature property (e.g. the
 * `desi` line number) to its curated route colour, falling back to
 * `fallback` for lines not in the palette.
 */
export function routeColorMatchExpression(
  property: string,
  fallback: string = TRAM_GREEN
): unknown[] {
  const stops: string[] = [];
  for (const [line, color] of Object.entries(ROUTE_COLORS)) {
    stops.push(line, color);
  }
  return ['match', ['get', property], ...stops, fallback];
}
