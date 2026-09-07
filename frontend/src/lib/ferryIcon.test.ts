import { describe, it, expect } from 'vitest';
import {
  FERRY_LOAD_STEPS,
  ferryIconBucket,
  ferryIconName,
  ferryIconSvg,
  ferryIconVariants,
} from './ferryIcon';
import { OCCUPANCY_BUCKETS } from './occupancy';
import { FERRY_COLORS, FERRY_CYAN } from './routeColors';

describe('ferryIconName', () => {
  it('names a marker by line, load step and door state', () => {
    expect(ferryIconName(0, false)).toBe('ferry-body-o0');
    expect(ferryIconName(3, true)).toBe('ferry-body-o3-open');
    expect(ferryIconName(3, false, '19')).toBe('ferry-body-19-o3');
  });

  it('has a name of its own for a vessel with no count', () => {
    expect(ferryIconName(-1, false)).toBe('ferry-body-ou');
    expect(ferryIconName(999, false)).toBe('ferry-body-ou');
    expect(ferryIconName(-1, false)).not.toBe(ferryIconName(0, false));
  });
});

describe('ferryIconSvg', () => {
  it('is a hull, a deckhouse, a wheelhouse and a funnel', () => {
    const svg = ferryIconSvg(2, false);
    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox="0 0 40 40"');
    // The bow is drawn as a curve into the sheer, which is the shape that makes
    // the vessel unmistakable next to four rectangular carriages.
    expect(svg).toContain('M20 2.2 C23.3 4.9');
  });

  it('paints the hull in the line colour when there is one', () => {
    expect(ferryIconSvg(0, false)).toContain(FERRY_CYAN);
    expect(ferryIconSvg(0, false, FERRY_COLORS['20'])).toContain(FERRY_COLORS['20']);
  });

  it('fills the deck gauge further the fuller the boat is', () => {
    const heightOf = (svg: string): number => {
      const match = /class="ferry-load-fill"[^>]*?height="([\d.]+)"/.exec(svg.replace(/\s+/g, ' '));
      return match ? Number(match[1]) : 0;
    };
    const empty = ferryIconSvg(0, false);
    const half = ferryIconSvg(3, false);
    const full = ferryIconSvg(OCCUPANCY_BUCKETS.length - 1, false);
    expect(heightOf(empty)).toBe(0);
    expect(heightOf(half)).toBeGreaterThan(0);
    expect(heightOf(full)).toBeGreaterThan(heightOf(half));
    // Each step carries its own colour, so the gauge reads before it is measured.
    expect(full).toContain(OCCUPANCY_BUCKETS[OCCUPANCY_BUCKETS.length - 1].color);
  });

  it('draws an empty grey track, not an empty green boat, with no count', () => {
    const unknown = ferryIconSvg(-1, false);
    expect(unknown).not.toContain(OCCUPANCY_BUCKETS[0].color);
    expect(unknown).toContain('#94a3b8');
  });

  it('drops the boarding ramps when the doors are open', () => {
    expect(ferryIconSvg(0, true)).toContain('#ffb020');
    expect(ferryIconSvg(0, false)).not.toContain('#ffb020');
  });
});

describe('ferryIconVariants', () => {
  it('covers every load step, open and shut, for every hull colour', () => {
    const variants = ferryIconVariants();
    const hulls = 1 + Object.keys(FERRY_COLORS).length;
    expect(variants).toHaveLength(hulls * (FERRY_LOAD_STEPS.length + 1) * 2);
    expect(new Set(variants.map((v) => v.name)).size).toBe(variants.length);
    for (const variant of variants) {
      expect(variant.svg).toContain('<svg');
    }
  });

  it('registers exactly the names the map layer asks for', () => {
    const names = new Set(ferryIconVariants().map((v) => v.name));
    for (const line of ['', ...Object.keys(FERRY_COLORS)]) {
      for (const open of [false, true]) {
        expect(names.has(ferryIconName(-1, open, line))).toBe(true);
        for (const step of FERRY_LOAD_STEPS) {
          expect(names.has(ferryIconName(step, open, line))).toBe(true);
        }
      }
    }
  });
});

describe('ferryIconBucket', () => {
  it('maps a load fraction onto a registered step, and null onto none', () => {
    expect(ferryIconBucket(null)).toBe(-1);
    expect(ferryIconBucket(0)).toBe(0);
    expect(ferryIconBucket(1)).toBe(OCCUPANCY_BUCKETS.length - 1);
    expect(FERRY_LOAD_STEPS).toContain(ferryIconBucket(0.5));
  });
});
