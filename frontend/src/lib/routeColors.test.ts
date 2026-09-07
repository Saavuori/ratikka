import { describe, it, expect } from 'vitest';
import {
  getRouteColor,
  getModeAccent,
  ROUTE_COLORS,
  METRO_COLORS,
  TRAIN_COLORS,
  FERRY_COLORS,
  TRAM_GREEN,
  METRO_ORANGE,
  TRAIN_PURPLE,
  BUS_BLUE,
  FERRY_CYAN,
} from './routeColors';

describe('getRouteColor', () => {
  it('returns the curated colour for a tram line', () => {
    expect(getRouteColor('4')).toBe(ROUTE_COLORS['4']);
  });

  it('covers metro, commuter-train and ferry lines', () => {
    expect(getRouteColor('M1')).toBe(METRO_COLORS['M1']);
    expect(getRouteColor('M2')).toBe(METRO_COLORS['M2']);
    expect(getRouteColor('I')).toBe(TRAIN_COLORS['I']);
    expect(getRouteColor('R')).toBe(TRAIN_COLORS['R']);
    expect(getRouteColor('19')).toBe(FERRY_COLORS['19']);
  });

  // The palettes are looked up by short name alone, so a name shared between
  // two modes would paint one of them with the other's colour.
  it('has no short name shared between the curated palettes', () => {
    const names = [
      ...Object.keys(ROUTE_COLORS),
      ...Object.keys(METRO_COLORS),
      ...Object.keys(TRAIN_COLORS),
      ...Object.keys(FERRY_COLORS),
    ];
    expect(new Set(names).size).toBe(names.length);
  });

  it('falls back to a stable hash colour for an unknown line', () => {
    const first = getRouteColor('550');
    expect(first).toMatch(/^#[0-9a-f]{6}$/);
    expect(getRouteColor('550')).toBe(first);
    expect(getRouteColor('551')).not.toBe(first);
  });

  it('falls back to tram green for an empty line', () => {
    expect(getRouteColor('')).toBe(TRAM_GREEN);
    expect(getRouteColor(null)).toBe(TRAM_GREEN);
  });
});

describe('getModeAccent', () => {
  it('gives each vehicle mode its own accent', () => {
    expect(getModeAccent('bus')).toBe(BUS_BLUE);
    expect(getModeAccent('metro')).toBe(METRO_ORANGE);
    expect(getModeAccent('train')).toBe(TRAIN_PURPLE);
    expect(getModeAccent('ferry')).toBe(FERRY_CYAN);
    const tram = getModeAccent('tram');
    expect(getModeAccent('funicular')).toBe(tram); // unknown modes read as rail
    expect(new Set([tram, BUS_BLUE, METRO_ORANGE, TRAIN_PURPLE, FERRY_CYAN]).size).toBe(5);
  });
});
