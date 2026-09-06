// The aerial basemap.
//
// A third map mode beside light and dark: the National Land Survey of Finland's
// orthophoto mosaic (`ortokuva`) under the same stops, routes and vehicles the
// other two carry. It is not Google's imagery — Google's satellite tiles may
// only be drawn by their own APIs, and pulling them into MapLibre would break
// their terms — and for Helsinki the national orthophotos are the better
// picture anyway: they are flown for mapping, not for a global mosaic.
//
// The imagery arrives as an opaque raster under the *labels* of the dark
// basemap rather than as a style of its own. Everything the vector style draws
// below its first symbol layer — land, water, roads, buildings — ends up under
// the photo and is simply never seen, while street and place names keep drawing
// on top, which is the one thing a bare aerial view badly lacks. Dark-matter's
// labels are light text in a dark halo, so they stay readable over the imagery
// without a palette of their own.

/**
 * MML's open WMTS, Web Mercator tile matrix. The path order is
 * `{z}/{row}/{col}`, hence `{z}/{y}/{x}` — MapLibre substitutes the tokens by
 * name, so the unusual order is fine.
 */
export const MML_ORTHO_TILE_URL =
  'https://avoin-karttakuva.maanmittauslaitos.fi/avoin/wmts/1.0.0/ortokuva/default/WGS84_Pseudo-Mercator/{z}/{y}/{x}.jpg';

export const SATELLITE_SOURCE_ID = 'mml-ortho';
export const SATELLITE_LAYER_ID = 'mml-ortho-layer';

/**
 * The open interface serves `ortokuva` up to zoom 16 — about 1.2 m per pixel at
 * Helsinki's latitude. The map itself goes to 18, so the last two zooms are
 * MapLibre overzooming the level-16 tiles: softer, but the alternative is the
 * imagery cutting out exactly where the stops become interesting.
 */
export const SATELLITE_MAX_ZOOM = 16;

/** Required by the open data licence (CC BY 4.0). Rendered by the map overlay. */
export const SATELLITE_ATTRIBUTION = '© Maanmittauslaitos, ortoilmakuva';

/** MML's open interface authenticates with a key on the query string. */
export function satelliteTileUrl(apiKey: string): string {
  if (!apiKey) return MML_ORTHO_TILE_URL;
  return `${MML_ORTHO_TILE_URL}?api-key=${encodeURIComponent(apiKey)}`;
}

export interface SatelliteSourceSpec {
  type: 'raster';
  tiles: string[];
  tileSize: number;
  maxzoom: number;
  attribution: string;
}

export function satelliteSourceSpec(apiKey: string): SatelliteSourceSpec {
  return {
    type: 'raster',
    tiles: [satelliteTileUrl(apiKey)],
    tileSize: 256,
    maxzoom: SATELLITE_MAX_ZOOM,
    attribution: SATELLITE_ATTRIBUTION,
  };
}

/**
 * Where the imagery goes in the base style's layer list: directly under the
 * first symbol layer, so it covers the vector ground and roads and leaves the
 * labels above it. With no symbol layer at all it goes on top of everything,
 * which for a photo basemap is still the right place.
 */
export function firstLabelLayerId(
  layers: { id: string; type: string }[] | undefined,
): string | undefined {
  return layers?.find((layer) => layer.type === 'symbol')?.id;
}

/**
 * Anything the base style draws *above* its first label but that is not a
 * label itself — a road casing, a building fill, a park boundary a style
 * happens to order late. Under a photo basemap those are the vector map's
 * guess at what the photo already shows, drawn on top of it, so they are
 * switched off. Labels are untouched: they are the reason the vector style is
 * still under there at all.
 */
export function nonLabelLayersAboveSatellite(
  layers: { id: string; type: string }[] | undefined,
): string[] {
  if (!layers) return [];
  const firstLabel = layers.findIndex((layer) => layer.type === 'symbol');
  if (firstLabel === -1) return [];
  return layers
    .slice(firstLabel + 1)
    .filter((layer) => layer.type !== 'symbol')
    .map((layer) => layer.id);
}
