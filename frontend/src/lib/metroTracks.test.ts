import { describe, it, expect } from 'vitest';
import {
  buildTrack,
  buildTracks,
  snapToTracks,
  pointOnTrack,
  distanceBetween,
  placeOnTracks,
  isMetroLine,
  metroLinesInFeed,
} from './metroTracks';

// A straight ~1 km east-west leg through central Helsinki, and a second track
// running north-south a long way away, so "nearest track" has a clear answer.
const EW: [number, number][] = [
  [24.9300, 60.1700],
  [24.9480, 60.1700],
];
const NS: [number, number][] = [
  [25.0800, 60.1700],
  [25.0800, 60.1900],
];

describe('buildTrack', () => {
  it('indexes cumulative length in metres', () => {
    const track = buildTrack(EW)!;
    expect(track).not.toBeNull();
    // 0.018 deg of longitude at 60.17N is roughly 1 km.
    expect(track.length).toBeGreaterThan(950);
    expect(track.length).toBeLessThan(1050);
    expect(track.cum[0]).toBe(0);
    expect(track.cum[1]).toBeCloseTo(track.length, 6);
  });

  it('rejects degenerate geometry', () => {
    expect(buildTrack([])).toBeNull();
    expect(buildTrack([[24.93, 60.17]])).toBeNull();
    expect(buildTrack([[24.93, 60.17], [24.93, 60.17]])).toBeNull();
  });
});

describe('buildTracks', () => {
  it('skips empty and undecodable polylines instead of failing the route', () => {
    // "_p~iF~ps|U_ulLnnqC" is the canonical encoded-polyline example.
    const tracks = buildTracks(['', '_p~iF~ps|U_ulLnnqC']);
    expect(tracks).toHaveLength(1);
  });

  it('returns nothing for a route with no geometry', () => {
    expect(buildTracks(undefined)).toEqual([]);
    expect(buildTracks([])).toEqual([]);
  });
});

describe('snapToTracks', () => {
  const tracks = [buildTrack(EW)!, buildTrack(NS)!];

  it('pulls a drifted position back onto the nearest track', () => {
    // ~110 m north of the midpoint of the east-west leg.
    const fix = snapToTracks(tracks, 24.9390, 60.1710)!;
    expect(fix).not.toBeNull();
    expect(fix.trackIndex).toBe(0);
    expect(fix.lat).toBeCloseTo(60.1700, 5);
    expect(fix.lng).toBeCloseTo(24.9390, 5);
    expect(fix.offset).toBeGreaterThan(100);
    expect(fix.offset).toBeLessThan(120);
    // Halfway along a 1 km leg.
    expect(fix.distance).toBeGreaterThan(450);
    expect(fix.distance).toBeLessThan(550);
    // Heading due east.
    expect(fix.bearing).toBeCloseTo(90, 0);
  });

  it('picks the closer of several tracks', () => {
    const fix = snapToTracks(tracks, 25.0805, 60.1800)!;
    expect(fix.trackIndex).toBe(1);
    expect(fix.bearing).toBeCloseTo(0, 0);
  });

  it('clamps to a segment end rather than running past it', () => {
    const fix = snapToTracks(tracks, 24.9270, 60.1700)!;
    expect(fix.distance).toBe(0);
    expect(fix.lng).toBeCloseTo(24.9300, 5);
  });

  it('refuses a position that is nowhere near any track', () => {
    expect(snapToTracks(tracks, 24.9390, 60.2000)).toBeNull();
    // ...unless the caller is willing to reach that far.
    expect(snapToTracks(tracks, 24.9390, 60.2000, { maxOffset: 5000 })).not.toBeNull();
  });

  it('has nothing to snap to without tracks', () => {
    expect(snapToTracks([], 24.9390, 60.1700)).toBeNull();
  });
});

describe('pointOnTrack', () => {
  // An L-shaped track: east for ~1 km, then north.
  const track = buildTrack([
    [24.9300, 60.1700],
    [24.9480, 60.1700],
    [24.9480, 60.1800],
  ])!;

  it('reads a position back out at a given arc length', () => {
    const start = pointOnTrack(track, 0);
    expect(start.lng).toBeCloseTo(24.9300, 5);
    expect(start.bearing).toBeCloseTo(90, 0);

    const corner = pointOnTrack(track, track.cum[1]);
    expect(corner.lng).toBeCloseTo(24.9480, 5);
    expect(corner.lat).toBeCloseTo(60.1700, 5);
  });

  it('follows the bend instead of cutting the corner', () => {
    // Three quarters of the way along, we are on the northbound leg.
    const p = pointOnTrack(track, track.cum[1] + 500);
    expect(p.lng).toBeCloseTo(24.9480, 5);
    expect(p.lat).toBeGreaterThan(60.1700);
    expect(p.bearing).toBeCloseTo(0, 0);
  });

  it('clamps out-of-range distances to the ends of the track', () => {
    const before = pointOnTrack(track, -500);
    expect(before.lng).toBeCloseTo(24.9300, 5);
    const after = pointOnTrack(track, track.length + 5000);
    expect(after.lat).toBeCloseTo(60.1800, 5);
  });

  it('round-trips a snapped fix', () => {
    const fix = snapToTracks([track], 24.9390, 60.1706)!;
    const back = pointOnTrack(track, fix.distance);
    expect(back.lng).toBeCloseTo(fix.lng, 6);
    expect(back.lat).toBeCloseTo(fix.lat, 6);
  });
});

describe('distanceBetween', () => {
  it('measures metres between two positions', () => {
    const d = distanceBetween({ lng: 24.9300, lat: 60.1700 }, { lng: 24.9480, lat: 60.1700 });
    expect(d).toBeGreaterThan(950);
    expect(d).toBeLessThan(1050);
    expect(distanceBetween({ lng: 24.93, lat: 60.17 }, { lng: 24.93, lat: 60.17 })).toBe(0);
  });
});

describe('placeOnTracks', () => {
  // Two nearly-coincident patterns, the way the two directions of a metro line
  // are drawn: the same corridor, a few metres apart, running opposite ways.
  const eastbound = buildTrack([[24.9300, 60.1700], [24.9480, 60.1700]])!;
  const westbound = buildTrack([[24.9480, 60.1704], [24.9300, 60.1704]])!;
  const tracks = [eastbound, westbound];

  it('snaps a drifted train onto the tracks', () => {
    const p = placeOnTracks('M1', [eastbound], { lat: 60.1712, lng: 24.9390, hdg: 90 }, undefined)!;
    expect(p).not.toBeNull();
    expect(p.lat).toBeCloseTo(60.1700, 4);
    expect(p.track.line).toBe('M1');
  });

  it('draws direction from the reported heading when there is no history', () => {
    const east = placeOnTracks('M1', [eastbound], { lat: 60.1701, lng: 24.9390, hdg: 90 }, undefined)!;
    expect(east.track.forward).toBe(true);
    expect(east.hdg).toBeCloseTo(90, 0);

    // Same track, train running the other way along it: the icon must point
    // back down the tunnel, not along the polyline's own direction.
    const west = placeOnTracks('M1', [eastbound], { lat: 60.1701, lng: 24.9390, hdg: 270 }, undefined)!;
    expect(west.track.forward).toBe(false);
    expect(west.hdg).toBeCloseTo(270, 0);
  });

  it('prefers movement over the reported heading once the train has history', () => {
    const first = placeOnTracks('M1', [eastbound], { lat: 60.1700, lng: 24.9350, hdg: 0 }, undefined)!;
    // Reported heading is nonsense (0), but the train clearly moved east.
    const second = placeOnTracks('M1', [eastbound], { lat: 60.1700, lng: 24.9400, hdg: 0 }, first.track)!;
    expect(second.track.forward).toBe(true);
    expect(second.hdg).toBeCloseTo(90, 0);
    expect(second.track.distance).toBeGreaterThan(first.track.distance);
  });

  it('keeps facing the same way while standing at a platform', () => {
    const moving = placeOnTracks('M1', [eastbound], { lat: 60.1700, lng: 24.9400, hdg: 0 }, {
      line: 'M1', index: 0, distance: 100, forward: false,
    })!;
    // A stationary train (sub-metre jitter) inherits the direction it had.
    const stopped = placeOnTracks('M1', [eastbound], { lat: 60.1700, lng: 24.9400, hdg: 0 }, moving.track)!;
    expect(stopped.track.forward).toBe(moving.track.forward);
    expect(stopped.hdg).toBeCloseTo(moving.hdg, 5);
  });

  it('stays on the pattern it was already running along', () => {
    // Between the two patterns, a few metres closer to the westbound one — far
    // less than the margin, so a train already on the eastbound one stays there.
    const position = { lat: 60.17022, lng: 24.9390, hdg: 90 };
    const fresh = placeOnTracks('M1', tracks, position, undefined)!;
    expect(fresh.track.index).toBe(1);

    const continuing = placeOnTracks('M1', tracks, position, {
      line: 'M1', index: 0, distance: 480, forward: true,
    })!;
    expect(continuing.track.index).toBe(0);
  });

  it('does move a train that has genuinely changed pattern', () => {
    const moved = placeOnTracks('M1', tracks, { lat: 60.1704, lng: 24.9390, hdg: 270 }, {
      line: 'M1', index: 0, distance: 480, forward: true,
    })!;
    expect(moved.track.index).toBe(1);
  });

  it('leaves a position too far off the network alone', () => {
    expect(
      placeOnTracks('M1', tracks, { lat: 60.2000, lng: 24.9390, hdg: 90 }, undefined)
    ).toBeNull();
  });
});

describe('isMetroLine', () => {
  it('accepts the metro line numbers and rejects every other mode', () => {
    expect(isMetroLine('M1')).toBe(true);
    expect(isMetroLine('M2')).toBe(true);
    expect(isMetroLine('M1V')).toBe(true); // short-turn variant
    expect(isMetroLine('9')).toBe(false); // tram
    expect(isMetroLine('A')).toBe(false); // commuter train
    expect(isMetroLine('')).toBe(false);
    expect(isMetroLine(undefined)).toBe(false);
  });
});

describe('metroLinesInFeed', () => {
  const feed = {
    a: { mode: 'metro', desi: 'M2' },
    b: { mode: 'metro', desi: 'M1' },
    c: { mode: 'metro', desi: 'M1' },
    d: { mode: 'tram', desi: '9' },
    e: { mode: 'train', desi: 'A' },
    f: { mode: 'metro', desi: '' },
  };

  it('returns each metro line in the snapshot exactly once', () => {
    expect(metroLinesInFeed(feed)).toEqual(['M1', 'M2']);
  });

  it('is stable across snapshots whose key order differs, so it can be a fetch dependency', () => {
    const reordered = {
      c: feed.c,
      e: feed.e,
      a: feed.a,
      b: feed.b,
    };
    expect(metroLinesInFeed(reordered).join(',')).toBe(metroLinesInFeed(feed).join(','));
  });

  it('returns nothing for a feed with no metro in it', () => {
    expect(metroLinesInFeed({ a: { mode: 'tram', desi: '4' } })).toEqual([]);
  });
});
