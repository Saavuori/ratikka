import { describe, it, expect } from 'vitest';
import { buildTrack } from '../../lib/railTracks';
import type { HeadwayPair } from '../../lib/headways';
import type { RenderPosition } from '../animation/types';
import { headwayLinks } from './headways';

// One line's track: an L with its corner ~500 m along.
const L: [number, number][] = [
  [24.9300, 60.1700],
  [24.9390, 60.1700],
  [24.9390, 60.1750],
];
const tracks = { '4': [buildTrack(L, 0)!] };

const onTrack = (distance: number): RenderPosition => ({
  lat: 0, lng: 0, hdg: 0,
  track: { line: '4', index: 0, distance, forward: true },
});

const pair = (state: 'bunched' | 'gap'): HeadwayPair => ({
  line: '4', follower: 'back', leader: 'front', state,
});

describe('headwayLinks', () => {
  it('draws a gap along the rails, round the corner between the two', () => {
    const links = headwayLinks(
      [pair('gap')],
      { back: onTrack(300), front: onTrack(800) },
      tracks,
      ['4'],
    );
    expect(links).toHaveLength(1);
    expect(links[0].properties.state).toBe('gap');
    expect(links[0].geometry.coordinates).toContainEqual(L[1]);
  });

  it('draws gaps only on the lines picked out', () => {
    expect(headwayLinks(
      [pair('gap')],
      { back: onTrack(300), front: onTrack(800) },
      tracks,
      [],
    )).toEqual([]);
  });

  it('draws a bunch everywhere', () => {
    expect(headwayLinks(
      [pair('bunched')],
      { back: onTrack(300), front: onTrack(340) },
      tracks,
      [],
    )).toHaveLength(1);
  });

  it('joins an unsnapped bunch with a straight line, if the two are close', () => {
    const near = headwayLinks(
      [pair('bunched')],
      { back: { lat: 60.17, lng: 24.93, hdg: 0 }, front: { lat: 60.1705, lng: 24.93, hdg: 0 } },
      tracks,
      [],
    );
    expect(near[0].geometry.coordinates).toEqual([[24.93, 60.17], [24.93, 60.1705]]);

    const far = headwayLinks(
      [pair('bunched')],
      { back: { lat: 60.17, lng: 24.93, hdg: 0 }, front: { lat: 60.2, lng: 24.93, hdg: 0 } },
      tracks,
      [],
    );
    expect(far).toEqual([]);
  });

  it('never draws a gap as a straight line', () => {
    expect(headwayLinks(
      [pair('gap')],
      { back: { lat: 60.17, lng: 24.93, hdg: 0 }, front: { lat: 60.1705, lng: 24.93, hdg: 0 } },
      tracks,
      ['4'],
    )).toEqual([]);
  });

  it('skips a pair with a vehicle not on the map', () => {
    expect(headwayLinks([pair('bunched')], { back: onTrack(300) }, tracks, ['4'])).toEqual([]);
  });
});
