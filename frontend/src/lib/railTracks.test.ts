import { describe, it, expect } from 'vitest';
import {
  buildTrack,
  buildTracks,
  buildPatternTracks,
  snapToTracks,
  pointOnTrack,
  distanceBetween,
  placeOnTracks,
  trackSpine,
  hfpDirectionId,
  isMetroLine,
  isSnappedMode,
  isHelsinkiCentralStationZone,
  snappedLinesInFeed,
} from './railTracks';

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

describe('buildPatternTracks', () => {
  it('keeps the direction each polyline belongs to', () => {
    const tracks = buildPatternTracks([
      { points: '_p~iF~ps|U_ulLnnqC', directionId: 0 },
      { points: '_p~iF~ps|U_ulLnnqC', directionId: 1 },
    ]);
    expect(tracks.map((t) => t.direction)).toEqual([0, 1]);
  });

  it('leaves the direction unknown when the backend did not report one', () => {
    // An older backend answers with bare geometries; a tram then snaps to the
    // nearest rail of either direction rather than to none at all.
    expect(buildTracks(['_p~iF~ps|U_ulLnnqC'])[0].direction).toBeNull();
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

// The tram case: one street, two tracks, the pair some 7 m apart and running
// opposite ways. Which of them a tram is on is not something its position can
// answer — the GPS error is several times the gap — so the feed's direction and
// the tram's heading are what have to answer it.
const TRACK_PAIR = {
  outbound: buildTrack([[24.9300, 60.1700], [24.9480, 60.1700]], 0)!,
  inbound: buildTrack([[24.9480, 60.17006], [24.9300, 60.17006]], 1)!,
};

describe('snapToTracks on a pair of tracks', () => {
  const tracks = [TRACK_PAIR.outbound, TRACK_PAIR.inbound];
  // Sitting between the rails, marginally nearer the inbound one — which is
  // where a tram's reported position habitually is.
  const between = { lng: 24.9390, lat: 60.170045 };

  it('snaps within the direction the journey is running', () => {
    const outbound = snapToTracks(tracks, between.lng, between.lat, { direction: 0 })!;
    expect(outbound.trackIndex).toBe(0);
    const inbound = snapToTracks(tracks, between.lng, between.lat, { direction: 1 })!;
    expect(inbound.trackIndex).toBe(1);
  });

  it('takes the nearest track when the feed names no direction', () => {
    expect(snapToTracks(tracks, between.lng, between.lat)!.trackIndex).toBe(1);
  });

  it('prefers rails that run the way the vehicle is heading', () => {
    // Nearer the inbound track, but heading east: the tram is on the outbound
    // rail and simply reported from a couple of metres off it.
    const fix = snapToTracks(tracks, between.lng, between.lat, { heading: 90 })!;
    expect(fix.trackIndex).toBe(0);
    expect(fix.bearing).toBeCloseTo(90, 0);
  });

  it('does not let the heading drag a vehicle off a track it is plainly on', () => {
    // Squarely on the inbound rail: a heading that disagrees is not worth
    // several metres of position error.
    const fix = snapToTracks(tracks, 24.9390, 60.17006, { heading: 90, headingPenalty: 2 })!;
    expect(fix.trackIndex).toBe(1);
  });

  it('falls back to every track when the direction matches none of them', () => {
    const undirected = [buildTrack(EW)!];
    expect(snapToTracks(undirected, 24.9390, 60.1710, { direction: 1 })).not.toBeNull();
  });

  it('reports the honest distance to the rail, penalty or not', () => {
    const fix = snapToTracks(tracks, between.lng, between.lat, { heading: 90 })!;
    // ~5 m from the outbound rail it was placed on, not the penalised score.
    expect(fix.offset).toBeGreaterThan(3);
    expect(fix.offset).toBeLessThan(7);
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

  it('keeps its direction along a track, whatever a later heading says', () => {
    const first = placeOnTracks('M1', [eastbound], { lat: 60.1700, lng: 24.9350, hdg: 90 }, undefined)!;
    expect(first.track.forward).toBe(true);
    // The heading is dead-reckoned underground and wanders; the train has not
    // turned round, and a pattern polyline only carries one direction anyway.
    const second = placeOnTracks('M1', [eastbound], { lat: 60.1700, lng: 24.9400, hdg: 250 }, first.track)!;
    expect(second.track.forward).toBe(true);
    expect(second.hdg).toBeCloseTo(90, 0);
    expect(second.track.distance).toBeGreaterThan(first.track.distance);
  });

  it('does not turn a train round on a coordinate that measures backwards', () => {
    // The regression this exists for. Off the live feed, 64 of ~1700 movement
    // steps measure as reversals and every one falls in a pair — one coordinate
    // flung off the line and then returned. Reversing on that points the icon
    // the wrong way and sends the dead reckoning back down the track until the
    // next report turns it round again.
    const running = placeOnTracks('M1', [eastbound], { lat: 60.1700, lng: 24.9400, hdg: 90 }, {
      line: 'M1', index: 0, distance: 800, forward: true,
    })!;
    // The new coordinate sits well behind where the train was last placed.
    expect(running.track.distance).toBeLessThan(800);
    expect(running.track.forward).toBe(true);
    expect(running.hdg).toBeCloseTo(90, 0);
  });

  it('reads direction afresh when the train appears on another pattern', () => {
    // A genuine reversal ends one journey and starts another, which runs on the
    // opposite direction's own polyline — so it arrives as a track change, and
    // the heading decides.
    const p = placeOnTracks('M1', tracks, { lat: 60.1704, lng: 24.9390, hdg: 270 }, {
      line: 'M1', index: 0, distance: 500, forward: true,
    })!;
    expect(p.track.index).toBe(1);
    expect(p.hdg).toBeCloseTo(270, 0);
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

describe('placeOnTracks for a tram', () => {
  const tracks = [TRACK_PAIR.outbound, TRACK_PAIR.inbound];
  // A tram reported between its own rails and the opposite ones, which is the
  // ordinary case: the error is bigger than the gap between the two.
  const between = { lat: 60.170045, lng: 24.9390, hdg: 90 };

  it('puts the tram on the track its journey runs on, not the nearest one', () => {
    const wrong = placeOnTracks('9', tracks, between, undefined)!;
    expect(wrong.track.index).toBe(1); // nearest, and the wrong rail

    const right = placeOnTracks('9', tracks, between, undefined, { direction: 0 })!;
    expect(right.track.index).toBe(0);
    expect(right.track.forward).toBe(true);
    expect(right.hdg).toBeCloseTo(90, 0);
    expect(right.lat).toBeCloseTo(60.1700, 5);
  });

  it('uses the heading when the feed names no direction', () => {
    const p = placeOnTracks('9', tracks, between, undefined, { heading: between.hdg })!;
    expect(p.track.index).toBe(0);
  });

  it('lets a tram cross to the other rail rather than pinning it to the first', () => {
    // The hysteresis that holds a metro train on its (all but coincident)
    // pattern would hold a tram on the wrong one of a pair metres away, so a
    // tram is given a margin narrower than the track gap.
    const inbound = { lat: 60.17006, lng: 24.9390, hdg: 270 };
    const p = placeOnTracks('9', tracks, inbound, {
      line: '9', index: 0, distance: 500, forward: true,
    }, { direction: 1, switchMargin: 4 })!;
    expect(p.track.index).toBe(1);
    expect(p.hdg).toBeCloseTo(270, 0);
  });

  it('takes the arm of a junction it is actually running along', () => {
    // A route that passes through the same junction twice: east along the
    // street, a loop away, and back through the junction heading north. Both
    // passes are the same polyline, metres apart, and the second one is
    // marginally nearer the reported point.
    const junction = buildTrack([
      [24.9300, 60.1700],
      [24.9400, 60.1700], // first pass, eastbound
      [24.9400, 60.1650],
      [24.9402, 60.1650],
      [24.94005, 60.1700], // second pass, northbound through the same corner
      [24.94005, 60.1760],
    ], 0)!;
    const at = { lat: 60.17001, lng: 24.94002, hdg: 90 };

    // A tram already 500 m along the first pass is still on it.
    const first = placeOnTracks('9', [junction], at, {
      line: '9', index: 0, distance: 500, forward: true,
    }, { direction: 0, expectedAdvance: 10, continuityWindow: 40 })!;
    expect(first.track.distance).toBeGreaterThan(450);
    expect(first.track.distance).toBeLessThan(600);

    // One that has come round the loop is on the second, at the same spot on
    // the ground and a kilometre further along its run.
    const second = placeOnTracks('9', [junction], at, {
      line: '9', index: 0, distance: 1650, forward: true,
    }, { direction: 0, expectedAdvance: 10, continuityWindow: 40 })!;
    expect(second.track.distance).toBeGreaterThan(1600);
  });

  it('picks up a vehicle again when continuity has genuinely been lost', () => {
    // The continuity test is a penalty, not a veto: a tram that was off the
    // network, or whose feed skipped a stretch, is still placed rather than
    // pinned to a window it has long since left.
    const p = placeOnTracks('9', tracks, between, {
      line: '9', index: 0, distance: 20, forward: true,
    }, { direction: 0, expectedAdvance: 5, continuityWindow: 40 })!;
    expect(p.track.index).toBe(0);
    expect(p.track.distance).toBeGreaterThan(400);
  });

  it('refuses to drag a tram that is off its route onto rails it is not using', () => {
    // A diversion, a depot run or a replacement working: drawn where it says it
    // is, rather than confidently placed on a track it is nowhere near.
    expect(
      placeOnTracks('9', tracks, { lat: 60.1706, lng: 24.9390, hdg: 90 }, undefined, {
        maxOffset: 35,
      })
    ).toBeNull();
  });
});

describe('trackSpine', () => {
  // An L: 1 km east, then north — a street corner, in other words.
  const track = buildTrack([
    [24.9300, 60.1700],
    [24.9480, 60.1700],
    [24.9480, 60.1800],
  ])!;

  it('reads the vehicle\'s own length off the rails', () => {
    const spine = trackSpine(track, 500, true);
    const centre = spine(0);
    expect(centre.lat).toBeCloseTo(60.1700, 5);
    expect(centre.hdg).toBeCloseTo(90, 0);
    // 13.5 m ahead of the centre is 13.5 m further along the track.
    expect(distanceBetween(centre, spine(13.5))).toBeCloseTo(13.5, 1);
    expect(distanceBetween(centre, spine(-13.5))).toBeCloseTo(13.5, 1);
  });

  it('bends the body round a corner instead of running it straight on', () => {
    // Centre on the corner: the nose is up the northbound leg and the tail is
    // back down the eastbound one, each facing the way its own rails do.
    const spine = trackSpine(track, track.cum[1], true);
    const nose = spine(13.5);
    const tail = spine(-13.5);
    expect(nose.hdg).toBeCloseTo(0, 0);
    expect(tail.hdg).toBeCloseTo(90, 0);
    expect(nose.lat).toBeGreaterThan(60.1700);
    expect(tail.lng).toBeLessThan(24.9480);
    // A rigid 27 m body would span 27 m; bent round the corner it spans less.
    expect(distanceBetween(nose, tail)).toBeLessThan(26);
  });

  it('measures towards the nose whichever way the vehicle runs along the polyline', () => {
    const spine = trackSpine(track, 500, false);
    const centre = spine(0);
    expect(centre.hdg).toBeCloseTo(270, 0);
    // Running backwards along the polyline, the nose is at a smaller arc length.
    expect(spine(10).lng).toBeLessThan(centre.lng);
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

describe('isSnappedMode', () => {
  it('snaps the modes that run on known geometry, and nothing else', () => {
    expect(isSnappedMode('metro')).toBe(true);
    expect(isSnappedMode('tram')).toBe(true);
    // A bus may legitimately be on a diversion.
    expect(isSnappedMode('bus')).toBe(false);
    expect(isSnappedMode('train')).toBe(true);
    expect(isSnappedMode(undefined)).toBe(false);
  });
});

describe('isHelsinkiCentralStationZone', () => {
  it('protects the central station throat and platforms from false precision', () => {
    expect(isHelsinkiCentralStationZone(24.942, 60.172)).toBe(true);
    expect(isHelsinkiCentralStationZone(24.935, 60.172)).toBe(false);
    expect(isHelsinkiCentralStationZone(24.942, 60.176)).toBe(false);
  });
});

describe('snappedLinesInFeed', () => {
  const feed = {
    a: { mode: 'metro', desi: 'M2' },
    b: { mode: 'metro', desi: 'M1' },
    c: { mode: 'metro', desi: 'M1' },
    d: { mode: 'tram', desi: '9' },
    e: { mode: 'train', desi: 'A' },
    f: { mode: 'metro', desi: '' },
    g: { mode: 'bus', desi: '551' },
  };

  it('returns each snapped line in the snapshot exactly once', () => {
    expect(snappedLinesInFeed(feed)).toEqual(['9', 'A', 'M1', 'M2']);
  });

  it('is stable across snapshots whose key order differs, so it can be a fetch dependency', () => {
    const reordered = {
      d: feed.d,
      c: feed.c,
      e: feed.e,
      a: feed.a,
      b: feed.b,
    };
    expect(snappedLinesInFeed(reordered).join(',')).toBe(snappedLinesInFeed(feed).join(','));
  });

  it('returns nothing for a feed of modes that are drawn where they say they are', () => {
    expect(snappedLinesInFeed({ a: { mode: 'bus', desi: '551' } })).toEqual([]);
  });
});

describe('hfpDirectionId', () => {
  it('translates the feed\'s direction into the GTFS one the patterns use', () => {
    expect(hfpDirectionId('1')).toBe(0);
    expect(hfpDirectionId('2')).toBe(1);
    expect(hfpDirectionId(1)).toBe(0);
  });

  it('gives up rather than guessing, so an unknown direction snaps to either', () => {
    expect(hfpDirectionId(undefined)).toBeNull();
    expect(hfpDirectionId(null)).toBeNull();
    expect(hfpDirectionId('')).toBeNull();
    expect(hfpDirectionId('0')).toBeNull();
    expect(hfpDirectionId('nonsense')).toBeNull();
  });
});
