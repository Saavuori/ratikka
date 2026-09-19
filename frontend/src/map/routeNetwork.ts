import type {
  FilterSpecification,
  LayerSpecification,
  Map as MapLibreMap,
} from 'maplibre-gl';
import { NETWORK_COLORS } from '../lib/routeColors';
import type { ModeFlags, TransportMode } from '../lib/modes';

/** A `line-width` ramp, in the `{ stops }` form the HSL style writes them in. */
type WidthStops = { stops: [number, number][] };

const widths = (low: number, high: number): WidthStops => ({
  stops: [
    [10, low],
    [22, high],
  ],
});

/**
 * One band of the HSL route network: the white casing, the mode-coloured line
 * over it, and (for the street modes) the lighter core over that. Layer ids are
 * `<id>_case`, `<id>` and `<id>_inner`, matching what `style.json` calls them.
 *
 * This table is the single description of the network. The per-mode layer
 * groupings and the dark theme's recreated layers are both derived from it, so
 * a band added here needs no second or third edit somewhere else to match. The
 * base filters are deliberately *not* here — see `baseFilterOf`.
 */
interface NetworkBand {
  id: string;
  mode: TransportMode;
  /** Which network features this band draws, on the JORE `routes` tiles. */
  filter: FilterSpecification;
  color: string;
  width: WidthStops;
  /** The white casing under the line, for the bands that have one. */
  casing?: WidthStops;
  inner?: { color: string; width: WidthStops };
  dash?: [number, number];
  /**
   * Whether the fetched per-line ribbons cover this band. The ribbons and the
   * tiles must never draw the same line at once — only the ribbon is offset
   * into its own slot, so a line drawn by both appears twice, once on the
   * street and once beside it. Buses have no pattern geometry to draw from
   * (the route endpoint is tram-only), so their tiles stay up.
   */
  ribboned: boolean;
  /**
   * Whether narrowing to a selected line applies to this band. Every band drawn
   * from the JORE tiles carries `routeIdParsed`; the ferry crossing is left at
   * full strength because there is one of it.
   */
  lineFiltered: boolean;
}

const STREET_CASING = widths(4, 8);
const STREET_LINE = widths(2, 6);
const STREET_INNER = widths(0.5, 2);
// Metro and commuter rail are drawn wider than the street modes: two lines
// carry the whole east-west spine, so the network reads as the trunk it is.
const SPINE_CASING = widths(5, 10);
const SPINE_LINE = widths(3, 7);

const busFilter = (trunk: boolean): FilterSpecification =>
  [
    'all',
    [trunk ? '==' : '!=', ['get', 'trunk_route'], '1'],
    ['==', ['get', 'mode'], 'BUS'],
  ] as FilterSpecification;

const modeFilter = (mode: string): FilterSpecification =>
  ['==', ['get', 'mode'], mode] as FilterSpecification;

export const NETWORK_BANDS: NetworkBand[] = [
  {
    id: 'route_tram',
    mode: 'tram',
    filter: modeFilter('TRAM'),
    color: NETWORK_COLORS.tram.line,
    width: STREET_LINE,
    casing: STREET_CASING,
    inner: { color: NETWORK_COLORS.tram.inner, width: STREET_INNER },
    ribboned: true,
    lineFiltered: true,
  },
  {
    // Light rail / Raide-Jokeri, drawn with the trams and toggled with them.
    id: 'route_lrail',
    mode: 'tram',
    filter: modeFilter('L_RAIL'),
    color: NETWORK_COLORS.lightRail.line,
    width: STREET_LINE,
    casing: STREET_CASING,
    inner: { color: NETWORK_COLORS.lightRail.inner, width: STREET_INNER },
    ribboned: true,
    lineFiltered: true,
  },
  {
    id: 'route_bus',
    mode: 'bus',
    filter: busFilter(false),
    color: NETWORK_COLORS.bus.line,
    width: STREET_LINE,
    casing: STREET_CASING,
    inner: { color: NETWORK_COLORS.bus.inner, width: STREET_INNER },
    ribboned: false,
    lineFiltered: true,
  },
  {
    id: 'route_trunk',
    mode: 'bus',
    filter: busFilter(true),
    color: NETWORK_COLORS.trunk.line,
    width: STREET_LINE,
    casing: STREET_CASING,
    // The trunk core is drawn wider than the other street modes': it is the
    // orange that tells a trunk route apart from an ordinary bus at a glance.
    inner: { color: NETWORK_COLORS.trunk.inner, width: widths(1, 4) },
    ribboned: false,
    lineFiltered: true,
  },
  {
    id: 'route_subway',
    mode: 'metro',
    filter: modeFilter('SUBWAY'),
    color: NETWORK_COLORS.metro.line,
    width: SPINE_LINE,
    casing: SPINE_CASING,
    ribboned: true,
    lineFiltered: true,
  },
  {
    id: 'route_rail',
    mode: 'train',
    filter: modeFilter('RAIL'),
    color: NETWORK_COLORS.rail.line,
    width: SPINE_LINE,
    casing: SPINE_CASING,
    ribboned: true,
    lineFiltered: true,
  },
  {
    // The style's own dashed crossing. One route, so there is nothing to narrow
    // it to and no ribbon to give way to.
    id: 'route_ferry',
    mode: 'ferry',
    filter: modeFilter('FERRY'),
    color: NETWORK_COLORS.ferry.line,
    width: STREET_CASING,
    dash: [0, 4],
    ribboned: false,
    lineFiltered: false,
  },
];

/**
 * The modes whose per-line ribbons are fetched and drawn over the tiles. Read
 * from the table so the set the app fetches geometry for cannot drift from the
 * set whose tiles give way to it.
 */
export const RIBBONED_MODES: TransportMode[] = [
  ...new Set(NETWORK_BANDS.filter((band) => band.ribboned).map((band) => band.mode)),
];

/**
 * The layer ids one band occupies, bottom to top. `style.json` also ships
 * `route_subway_underground` — the dashed segment drawn where the metro runs
 * below ground — which has no equivalent on the JORE tiles the dark theme
 * recreates the network from, so it is listed only where it exists.
 */
export function bandLayerIds(band: NetworkBand): string[] {
  const ids = [band.id];
  if (band.casing) ids.unshift(`${band.id}_case`);
  if (band.inner) ids.push(`${band.id}_inner`);
  if (band.id === 'route_subway') ids.push('route_subway_underground');
  return ids;
}

/**
 * The highlighted per-line ribbons drawn from the fetched pattern geometry.
 * They are route lines too, so the "route lines" switch has to take them with
 * it — hiding only the tiled network would leave the selection's ribbons
 * painted on an otherwise bare map.
 */
export const RIBBON_LAYERS = ['route-lines-casing', 'route-lines-layer'];

const ROUTES_SOURCE = 'routes';

/**
 * The network as layer specifications, for the theme that has to build it.
 *
 * The `routes` vector source and its line layers ship only in the light
 * `style.json`. The dark theme loads Carto's dark-matter basemap, which has
 * neither, so the Settings "Routes" toggle used to do nothing there. These are
 * added when missing, which makes this a no-op in light mode.
 */
export function backgroundNetworkLayers(): LayerSpecification[] {
  const layers: LayerSpecification[] = [];
  const base = { type: 'line', source: ROUTES_SOURCE, 'source-layer': ROUTES_SOURCE } as const;
  const round = { 'line-cap': 'round', 'line-join': 'round' } as const;

  for (const band of NETWORK_BANDS) {
    if (band.casing) {
      layers.push({
        ...base,
        id: `${band.id}_case`,
        filter: band.filter,
        layout: round,
        paint: { 'line-color': '#fff', 'line-width': band.casing },
      } as unknown as LayerSpecification);
    }
    layers.push({
      ...base,
      id: band.id,
      filter: band.filter,
      layout: { ...round, ...(band.inner ? { 'line-round-limit': 1 } : {}) },
      paint: {
        'line-color': band.color,
        'line-width': band.width,
        ...(band.dash ? { 'line-dasharray': band.dash } : {}),
      },
    } as unknown as LayerSpecification);
    if (band.inner) {
      layers.push({
        ...base,
        id: `${band.id}_inner`,
        filter: band.filter,
        paint: { 'line-color': band.inner.color, 'line-width': band.inner.width },
      } as unknown as LayerSpecification);
    }
  }
  return layers;
}

/**
 * Add the network to a style that does not already carry it.
 *
 * Kept beneath the highlighted route path — casing included, or the network
 * would draw over it — and beneath the vehicles.
 */
export function ensureBackgroundRouteNetwork(map: MapLibreMap): void {
  if (!map.getSource(ROUTES_SOURCE)) {
    map.addSource(ROUTES_SOURCE, {
      type: 'vector',
      url: 'https://kartat.hsl.fi/jore/tiles/routes/index.json',
    });
  }

  const beforeId = ['route-lines-casing', 'route-lines-layer', 'trams-circles'].find((id) =>
    map.getLayer(id)
  );

  for (const layer of backgroundNetworkLayers()) {
    if (!map.getLayer(layer.id)) {
      map.addLayer(layer, beforeId);
    }
  }
}

/**
 * The filter a layer was built with, remembered the first time it is seen.
 *
 * Narrowing the network to exclude a selected line means combining that
 * layer's own filter with a `routeIdParsed` mismatch, so the original has to
 * survive. It used to be kept as a hand-written copy of what `style.json` says,
 * which was both a table to keep in sync and wrong: the light style draws the
 * metro from a separate `subway` source filtered on `underground` and zoom, not
 * on `mode`, so restoring a `mode` filter there quietly replaced the style's
 * own logic and let the underground layer draw above-ground segments too.
 *
 * Reading it off the map instead means the base is whatever the loaded style
 * actually used, in either theme, and there is nothing left to keep in sync.
 * Captured before the first narrowing, which is this function's own caller.
 */
const baseFilters = new WeakMap<MapLibreMap, globalThis.Map<string, FilterSpecification | undefined>>();

function baseFilterOf(map: MapLibreMap, layerId: string): FilterSpecification | undefined {
  let forMap = baseFilters.get(map);
  if (!forMap) {
    forMap = new globalThis.Map();
    baseFilters.set(map, forMap);
  }
  if (!forMap.has(layerId)) {
    forMap.set(layerId, map.getFilter(layerId) as FilterSpecification | undefined);
  }
  return forMap.get(layerId);
}

/**
 * Forget the captured base filters. A theme switch reloads the style, which
 * recreates every layer — possibly from a different source with a different
 * filter — so what was captured for the previous style no longer describes it.
 */
export function forgetBaseFilters(map: MapLibreMap): void {
  baseFilters.delete(map);
}

export interface RouteVisibility {
  /** Which modes the reader has switched on. */
  modes: ModeFlags;
  /** Lines the reader has filtered down to; the ribbons draw these instead. */
  lines: string[];
  /** The selected vehicle's line, drawn as context with the rest faded. */
  selectedLine: string | null;
  /** Lines the fetched pattern geometry covers. */
  ribbonLines: string[];
  /** The "route lines" switch, which sits above all of the above. */
  routes: boolean;
}

/**
 * Point the tiled network at what should be visible right now.
 *
 *   line filters active → hidden. The highlighted ribbons *are* those routes,
 *     drawn better (per-line offset, casing, selection emphasis).
 *   only a vehicle selected → the network drawn as context, minus that
 *     vehicle's line, faded so the selected route reads first.
 *   nothing selected → trams as ribbons, the rest of the network at full
 *     strength.
 *
 * When `routes` is off nothing route-shaped is drawn — neither the tiled
 * network nor the highlighted ribbons — leaving the vehicles, stops and any
 * planned journey on a clean basemap.
 */
export function updateRouteVisibility(map: MapLibreMap, view: RouteVisibility): void {
  const highlighted = view.lines.length > 0;
  const faded = !highlighted && !!view.selectedLine;
  const ribboned = view.ribbonLines.length > 0;

  const setVisible = (layerId: string, visible: boolean) => {
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
    }
  };

  // `routeIdParsed` is the JORE tiles' friendly line number — the same key as a
  // vehicle's `desi` and our palette — so excluding the selected line is a
  // plain negated match on it.
  const applyLineFilter = (layerId: string) => {
    if (!map.getLayer(layerId)) return;
    // A layer built without a filter (the light style draws commuter rail from
    // a source that is only rail) narrows to the exclusion alone, and restores
    // to no filter rather than to one invented here.
    const base = baseFilterOf(map, layerId);
    const exclude = ['!', ['in', ['get', 'routeIdParsed'], ['literal', [view.selectedLine]]]];
    const next = faded ? (base ? ['all', base, exclude] : exclude) : base;
    map.setFilter(layerId, (next ?? null) as FilterSpecification | null);
    map.setPaintProperty(layerId, 'line-opacity', faded ? 0.3 : 1);
  };

  for (const band of NETWORK_BANDS) {
    const visible =
      view.routes && view.modes[band.mode] && !highlighted && !(band.ribboned && ribboned);
    for (const layerId of bandLayerIds(band)) {
      setVisible(layerId, visible);
      if (band.lineFiltered) applyLineFilter(layerId);
    }
  }

  for (const layerId of RIBBON_LAYERS) setVisible(layerId, view.routes);
}
