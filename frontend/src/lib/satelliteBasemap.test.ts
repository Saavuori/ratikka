import { describe, it, expect } from 'vitest';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import {
  MML_ORTHO_TILE_URL,
  SATELLITE_ATTRIBUTION,
  SATELLITE_MAX_ZOOM,
  satelliteSourceSpec,
  satelliteTileUrl,
  firstLabelLayerId,
  nonLabelLayersAboveSatellite,
} from './satelliteBasemap';

describe('MML_ORTHO_TILE_URL', () => {
  it('is the open interface, over https', () => {
    expect(MML_ORTHO_TILE_URL.startsWith('https://avoin-karttakuva.maanmittauslaitos.fi/avoin/wmts/')).toBe(true);
  });

  // WMTS numbers tiles row-then-column, so the path is {z}/{y}/{x}. Swapping
  // the two silently serves imagery from somewhere else entirely.
  it('carries the tile tokens in WMTS row/column order', () => {
    expect(MML_ORTHO_TILE_URL).toContain('/{z}/{y}/{x}.jpg');
  });
});

describe('satelliteTileUrl', () => {
  it('appends the API key the open interface requires', () => {
    expect(satelliteTileUrl('abc-123')).toBe(`${MML_ORTHO_TILE_URL}?api-key=abc-123`);
  });

  it('escapes the key rather than pasting it into the query string raw', () => {
    expect(satelliteTileUrl('a&b=c')).toBe(`${MML_ORTHO_TILE_URL}?api-key=a%26b%3Dc`);
  });

  it('leaves the URL alone when there is no key', () => {
    expect(satelliteTileUrl('')).toBe(MML_ORTHO_TILE_URL);
  });
});

describe('satelliteSourceSpec', () => {
  it('is a raster source MapLibre accepts', () => {
    const errors = validateStyleMin({
      version: 8,
      sources: { 'mml-ortho': satelliteSourceSpec('key') },
      layers: [],
    } as never);
    expect(errors).toEqual([]);
  });

  // Past the open interface's last level MapLibre has to overzoom rather than
  // request tiles that do not exist -- without maxzoom the imagery would just
  // stop at the zooms the map is most used at.
  it('caps the source at the last zoom the open interface serves', () => {
    expect(satelliteSourceSpec('key').maxzoom).toBe(SATELLITE_MAX_ZOOM);
  });

  it('carries the attribution the licence requires', () => {
    expect(satelliteSourceSpec('key').attribution).toBe(SATELLITE_ATTRIBUTION);
    expect(SATELLITE_ATTRIBUTION).toContain('Maanmittauslaitos');
  });
});

describe('firstLabelLayerId', () => {
  it('picks the first symbol layer, so the photo slides under the labels', () => {
    expect(firstLabelLayerId([
      { id: 'background', type: 'background' },
      { id: 'water', type: 'fill' },
      { id: 'roads', type: 'line' },
      { id: 'place-labels', type: 'symbol' },
      { id: 'road-labels', type: 'symbol' },
    ])).toBe('place-labels');
  });

  it('returns nothing when the style has no labels, putting the photo on top', () => {
    expect(firstLabelLayerId([{ id: 'background', type: 'background' }])).toBeUndefined();
    expect(firstLabelLayerId(undefined)).toBeUndefined();
  });
});

describe('nonLabelLayersAboveSatellite', () => {
  const layers = [
    { id: 'background', type: 'background' },
    { id: 'water', type: 'fill' },
    { id: 'place-labels', type: 'symbol' },
    { id: 'road-casing', type: 'line' },
    { id: 'buildings', type: 'fill' },
    { id: 'road-labels', type: 'symbol' },
  ];

  it('switches off vector ground the photo would otherwise be drawn under', () => {
    expect(nonLabelLayersAboveSatellite(layers)).toEqual(['road-casing', 'buildings']);
  });

  it('leaves every label alone -- they are what the photo is missing', () => {
    const hidden = nonLabelLayersAboveSatellite(layers);
    expect(hidden).not.toContain('place-labels');
    expect(hidden).not.toContain('road-labels');
  });

  it('has nothing to hide in a style with no labels', () => {
    expect(nonLabelLayersAboveSatellite([{ id: 'background', type: 'background' }])).toEqual([]);
    expect(nonLabelLayersAboveSatellite(undefined)).toEqual([]);
  });
});
