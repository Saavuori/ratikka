import { describe, expect, it } from 'vitest';
import type { VehiclePosition } from '../types';
import type { ReplayDayCoverage } from '../types';
import {
  badgeTitle,
  coveredUntil,
  coverageMarks,
  FETCH_SPAN_SECONDS,
  fetchSpanForStep,
  hasCoverage,
  MAX_FETCH_SPAN_SECONDS,
  newestCoverage,
  nextFetchSpan,
  playbackPlan,
  prefetchHorizon,
  PREFETCH_RUNWAY_SECONDS,
  PREFETCH_SPAN_SECONDS,
  REPLAY_STALE_SECONDS,
  ReplayBuffer,
  replayRange,
  REPLAY_SPEEDS,
  replayTimeScale,
  TARGET_SNAPSHOTS_PER_SECOND,
} from './replay';

const reading = (veh: string, ts: number, lat = 60.17): VehiclePosition => ({
  veh, desi: '9', lat, lng: 24.94, hdg: 90, spd: 7, dl: 0, drst: 0,
  route: '1009', stop: null, ts, tripId: 'HSL:1009_x', mode: 'tram',
});

describe('playbackPlan', () => {
  it('plays real time as the live feed does — a reading a second', () => {
    expect(playbackPlan(1)).toEqual({ step: 1, intervalMs: 1000 });
  });

  it('draws faster rather than coarser while it still can', () => {
    // Up to the target rate the step stays at one second, so the map animates
    // a replay exactly as it animates the live feed.
    for (const speed of [2, 4, 8]) {
      expect(playbackPlan(speed).step).toBe(1);
      expect(playbackPlan(speed).intervalMs).toBeCloseTo(1000 / speed);
    }
  });

  it('grows the step instead of the rate once drawing cannot keep up', () => {
    const fast = playbackPlan(60);
    expect(fast.step).toBe(Math.round(60 / TARGET_SNAPSHOTS_PER_SECOND));
    // Whatever the speed, the drawing rate stays near the target: that is the
    // point of thinning rather than fetching everything.
    expect(1000 / fast.intervalMs).toBeGreaterThan(TARGET_SNAPSHOTS_PER_SECOND / 2);
    expect(1000 / fast.intervalMs).toBeLessThan(TARGET_SNAPSHOTS_PER_SECOND * 2);
  });

  it('keeps the drawing rate near target across every offered speed', () => {
    for (const speed of [1, 2, 4, 8, 30, 60, 240]) {
      const rate = 1000 / playbackPlan(speed).intervalMs;
      expect(rate).toBeLessThanOrEqual(TARGET_SNAPSHOTS_PER_SECOND + 1);
    }
  });
});

describe('replayTimeScale', () => {
  it('is one at real time, so live behaviour is untouched', () => {
    expect(replayTimeScale(1)).toBe(1);
  });

  it('reports how much history a second of wall clock covers', () => {
    expect(replayTimeScale(60)).toBe(60);
  });
});

describe('ReplayBuffer', () => {
  it('holds the newest reading per vehicle at the cursor', () => {
    const buffer = new ReplayBuffer();
    buffer.append([reading('a', 100, 60.1), reading('a', 105, 60.2), reading('b', 102)]);

    const snapshot = buffer.snapshotAt(103);
    expect(Object.keys(snapshot).sort()).toEqual(['a', 'b']);
    // 105 has not happened yet at 103.
    expect(snapshot.a.lat).toBe(60.1);

    expect(buffer.snapshotAt(106).a.lat).toBe(60.2);
  });

  it('drops a vehicle once its readings stop, as the live map does', () => {
    const buffer = new ReplayBuffer();
    buffer.append([reading('a', 100)]);

    expect(buffer.snapshotAt(100 + REPLAY_STALE_SECONDS)).toHaveProperty('a');
    expect(buffer.snapshotAt(100 + REPLAY_STALE_SECONDS + 1)).toEqual({});
  });

  it('rebuilds when the scrubber is dragged backwards', () => {
    const buffer = new ReplayBuffer();
    buffer.append([reading('a', 100, 60.1), reading('a', 200, 60.9)]);

    expect(buffer.snapshotAt(200).a.lat).toBe(60.9);
    // Seeking back must forget the later reading, not keep showing it.
    expect(buffer.snapshotAt(150).a.lat).toBe(60.1);
  });

  it('never moves a vehicle backwards on an out-of-order reading', () => {
    const buffer = new ReplayBuffer();
    buffer.append([reading('a', 100, 60.1)]);
    buffer.append([reading('a', 90, 60.0)]);

    expect(buffer.snapshotAt(120).a.lat).toBe(60.1);
  });

  it('ignores a repeat of a reading it already holds', () => {
    const buffer = new ReplayBuffer();
    buffer.append([reading('a', 100)]);
    buffer.append([reading('a', 100)]);
    expect(buffer.size).toBe(1);
  });

  it('sorts readings that arrive out of order between fetches', () => {
    const buffer = new ReplayBuffer();
    buffer.append([reading('a', 200, 60.9)]);
    buffer.append([reading('a', 100, 60.1)]);

    expect(buffer.snapshotAt(150).a.lat).toBe(60.1);
    expect(buffer.snapshotAt(250).a.lat).toBe(60.9);
  });

  it('prunes behind the cursor without dropping a vehicle still drawn', () => {
    const buffer = new ReplayBuffer();
    buffer.append([reading('a', 100), reading('b', 400)]);

    buffer.prune(500);
    // 'a' is long past being drawn at 500; 'b' is not.
    expect(buffer.size).toBe(1);
    expect(buffer.snapshotAt(420)).toHaveProperty('b');
  });

  it('clears completely for a seek somewhere else entirely', () => {
    const buffer = new ReplayBuffer();
    buffer.append([reading('a', 100)]);
    buffer.clear();
    expect(buffer.size).toBe(0);
    expect(buffer.snapshotAt(100)).toEqual({});
  });
});

describe('ReplayBuffer under a fast playback', () => {
  it('keeps a reading that arrives while the cursor is still behind it', () => {
    const buffer = new ReplayBuffer();
    buffer.append([reading('a', 100)]);
    // The cursor has drawn 100 but not yet reached 130.
    expect(buffer.snapshotAt(100)).toHaveProperty('a');
    buffer.append([reading('a', 130, 60.5)]);
    expect(buffer.snapshotAt(130).a.lat).toBe(60.5);
  });

  it('survives a prune with the snapshot it was holding intact', () => {
    const buffer = new ReplayBuffer();
    const samples: VehiclePosition[] = [];
    for (let ts = 0; ts < 2000; ts += 1) samples.push(reading(`v${ts % 4}`, ts));
    buffer.append(samples);

    expect(buffer.snapshotAt(1500)).toHaveProperty('v0');
    buffer.prune(1500);
    // Everything more than two stale windows back is gone, and the vehicles
    // still on the map are still on it.
    expect(buffer.size).toBeLessThan(2000);
    expect(buffer.snapshotAt(1501)).toHaveProperty('v0');
    expect(buffer.snapshotAt(1501).v0.ts).toBeGreaterThanOrEqual(1500 - REPLAY_STALE_SECONDS);
  });
});

describe('coveredUntil', () => {
  it('reports nothing held as no runway at all', () => {
    expect(coveredUntil([], 1000)).toBe(1000);
  });

  it('follows adjoining blocks to the end of the run', () => {
    const held = [
      { from: 960, to: 1080 },
      { from: 1080, to: 1200 },
      { from: 1200, to: 1320 },
    ];
    expect(coveredUntil(held, 1000)).toBe(1320);
  });

  it('stops at a hole rather than counting what is past it', () => {
    const held = [
      { from: 960, to: 1080 },
      // 1080..1200 has not landed yet.
      { from: 1200, to: 1320 },
    ];
    expect(coveredUntil(held, 1000)).toBe(1080);
  });

  it('does not mind what order the blocks landed in', () => {
    const held = [
      { from: 1200, to: 1320 },
      { from: 960, to: 1080 },
      { from: 1080, to: 1200 },
    ];
    expect(coveredUntil(held, 1000)).toBe(1320);
  });

  it('reports the cursor itself when the cursor is past everything held', () => {
    expect(coveredUntil([{ from: 0, to: 500 }], 1000)).toBe(1000);
  });
});

describe('nextFetchSpan', () => {
  it('asks for the block the cursor is in when nothing is held', () => {
    const span = nextFetchSpan(1000, [], 100000);
    expect(span).not.toBeNull();
    expect(span!.to - span!.from).toBe(FETCH_SPAN_SECONDS);
    expect(span!.from).toBeLessThanOrEqual(1000);
    expect(span!.to).toBeGreaterThan(1000);
  });

  it('aligns blocks so replaying a stretch twice hits the browser cache', () => {
    const first = nextFetchSpan(1000, [], 100000)!;
    const again = nextFetchSpan(1000 + FETCH_SPAN_SECONDS / 3, [], 100000)!;
    expect(again).toEqual(first);
    expect(first.from % FETCH_SPAN_SECONDS).toBe(0);
  });

  it('runs ahead of the cursor once the current block is held', () => {
    const held = [{ from: 960, to: 1080 }];
    const span = nextFetchSpan(1000, held, 100000)!;
    expect(span.from).toBeGreaterThanOrEqual(1080);
  });

  it('stops at the end of the archive rather than asking for the future', () => {
    expect(nextFetchSpan(1000, [{ from: 960, to: 1080 }], 1000)).toBeNull();
  });

  it('is satisfied once the prefetch horizon is covered', () => {
    const held = [{ from: 0, to: 100000 }];
    expect(nextFetchSpan(1000, held, 100000)).toBeNull();
  });
});

describe('fetchSpanForStep', () => {
  it('asks for a small block of unthinned history, which is the dear one', () => {
    // Two minutes of tram history unthinned is nine thousand readings and three
    // megabytes: a block that size is a tenth of a second of blocked main
    // thread every two minutes of playback, and that is what a viewer sees as
    // the timelapse jumping.
    expect(fetchSpanForStep(1)).toBe(FETCH_SPAN_SECONDS);
  });

  it('asks for more history the more thinly it is being read', () => {
    expect(fetchSpanForStep(4)).toBeGreaterThan(fetchSpanForStep(1));
    expect(fetchSpanForStep(8)).toBeGreaterThan(fetchSpanForStep(4));
  });

  it('keeps a block to roughly one amount of work whatever the speed', () => {
    for (const speed of REPLAY_SPEEDS) {
      const { step } = playbackPlan(speed);
      const readings = fetchSpanForStep(step) / step;
      expect(readings).toBeGreaterThanOrEqual(FETCH_SPAN_SECONDS / 2);
      expect(readings).toBeLessThanOrEqual(FETCH_SPAN_SECONDS * 2);
    }
  });

  it('keeps every span a doubling of the smallest, so blocks nest and align', () => {
    for (const speed of REPLAY_SPEEDS) {
      const span = fetchSpanForStep(playbackPlan(speed).step);
      expect(span % FETCH_SPAN_SECONDS).toBe(0);
      expect(Number.isInteger(Math.log2(span / FETCH_SPAN_SECONDS))).toBe(true);
      expect(span).toBeLessThanOrEqual(MAX_FETCH_SPAN_SECONDS);
    }
  });

  it('aligns the larger blocks to their own size, not to the smallest', () => {
    const span = fetchSpanForStep(8);
    const held: Array<{ from: number; to: number }> = [];
    const first = nextFetchSpan(1_000_000, held, 2_000_000, 600, span)!;
    expect(first.to - first.from).toBe(span);
    expect(first.from % span).toBe(0);
  });
});

describe('replayRange', () => {
  it('scrubs against the server clock, not the browser one', () => {
    const range = replayRange(1_757_174_400, 7);
    expect(range.to).toBe(1_757_174_400 - 60);
    expect(range.from).toBe(1_757_174_400 - 7 * 24 * 3600);
  });

  it('holds the live edge back off the minute still being written', () => {
    expect(replayRange(1000, 7).to).toBeLessThan(1000);
  });
});

describe('hasCoverage', () => {
  const days = [{ date: '2026-09-06', hours: { tram: Array(24).fill(0) } }];
  days[0].hours.tram[17] = 42;

  it('finds a recorded hour', () => {
    // 2026-09-06 17:30 Helsinki (UTC+3 in September).
    expect(hasCoverage(days, Date.parse('2026-09-06T17:30:00+03:00') / 1000)).toBe(true);
  });

  it('reports an hour nothing was recorded for', () => {
    expect(hasCoverage(days, Date.parse('2026-09-06T04:30:00+03:00') / 1000)).toBe(false);
  });

  it('reports a day that is not in the archive', () => {
    expect(hasCoverage(days, Date.parse('2026-09-01T17:30:00+03:00') / 1000)).toBe(false);
  });

  it('treats an empty index as no coverage rather than throwing', () => {
    expect(hasCoverage(null, 1_757_174_400)).toBe(false);
    expect(hasCoverage([], 1_757_174_400)).toBe(false);
  });
});

const hours = (recorded: Record<number, number>): number[] =>
  Array.from({ length: 24 }, (_, h) => recorded[h] ?? 0);

const day = (date: string, recorded: Record<number, number>): ReplayDayCoverage => ({
  date,
  hours: { tram: hours(recorded) },
});

// 2026-09-06 is a Sunday in Finnish summer time (UTC+3).
const dayRange = {
  from: Date.parse('2026-09-06T00:00:00+03:00') / 1000,
  to: Date.parse('2026-09-07T00:00:00+03:00') / 1000,
};

describe('coverageMarks', () => {
  it('marks a recorded hour in the right place on the timeline', () => {
    const marks = coverageMarks([day('2026-09-06', { 12: 60 })], dayRange);
    expect(marks).toHaveLength(1);
    // Noon is halfway through the day, and an hour is 1/24 of it.
    expect(marks[0].left).toBeCloseTo(50, 1);
    expect(marks[0].width).toBeCloseTo(100 / 24, 1);
  });

  it('leaves unrecorded hours unmarked, so gaps are visible', () => {
    const marks = coverageMarks([day('2026-09-06', { 12: 60, 14: 60 })], dayRange);
    expect(marks).toHaveLength(2);
    // 13:00 is not covered, so the two marks do not touch.
    const [first, second] = [...marks].sort((a, b) => a.left - b.left);
    expect(second.left).toBeGreaterThan(first.left + first.width + 1);
  });

  it('counts an hour with any minutes at all as recorded', () => {
    expect(coverageMarks([day('2026-09-06', { 12: 1 })], dayRange)).toHaveLength(1);
  });

  it('handles the winter offset as well as the summer one', () => {
    // 2026-01-15 is UTC+2. A mark placed with the summer offset would land an
    // hour out, which at a day's width is visible.
    const winter = {
      from: Date.parse('2026-01-15T00:00:00+02:00') / 1000,
      to: Date.parse('2026-01-16T00:00:00+02:00') / 1000,
    };
    const marks = coverageMarks([day('2026-01-15', { 12: 60 })], winter);
    expect(marks).toHaveLength(1);
    expect(marks[0].left).toBeCloseTo(50, 1);
  });

  it('clips a day that runs past the ends of the scrubbed range', () => {
    const narrow = {
      from: Date.parse('2026-09-06T12:30:00+03:00') / 1000,
      to: Date.parse('2026-09-06T13:30:00+03:00') / 1000,
    };
    const marks = coverageMarks([day('2026-09-06', { 12: 60 })], narrow);
    expect(marks).toHaveLength(1);
    expect(marks[0].left).toBeGreaterThanOrEqual(0);
    expect(marks[0].left + marks[0].width).toBeLessThanOrEqual(100.01);
  });

  it('draws nothing when there is no history', () => {
    expect(coverageMarks(null, dayRange)).toEqual([]);
    expect(coverageMarks([], dayRange)).toEqual([]);
  });
});

describe('newestCoverage', () => {
  it('finds nothing in an archive that holds nothing', () => {
    expect(newestCoverage(null)).toBeNull();
    expect(newestCoverage([])).toBeNull();
    expect(newestCoverage([day('2026-09-06', {})])).toBeNull();
  });

  it('lands in the middle of the newest recorded hour', () => {
    const at = newestCoverage([day('2026-09-06', { 12: 60, 14: 3 })]);
    expect(at).toBe(Date.parse('2026-09-06T14:30:00+03:00') / 1000);
  });

  it('takes the newest hour across days, whichever order they arrive in', () => {
    const at = newestCoverage([
      day('2026-09-05', { 23: 60 }),
      day('2026-09-06', { 6: 60 }),
    ]);
    expect(at).toBe(Date.parse('2026-09-06T06:30:00+03:00') / 1000);
  });

  it('reaches a server that has only been recording for minutes', () => {
    // The case this exists for: an archive younger than the hour a replay
    // otherwise opens at.
    const at = newestCoverage([day('2026-09-06', { 9: 4 })]);
    expect(at).toBe(Date.parse('2026-09-06T09:30:00+03:00') / 1000);
  });
});

describe('badgeTitle', () => {
  it('offers the timelapse where there is history to reveal', () => {
    expect(badgeTitle(true)).toContain('Open the timelapse');
  });

  it('offers nothing but the changelog on an instance that records nothing', () => {
    expect(badgeTitle(false)).not.toContain('timelapse');
    expect(badgeTitle(false)).toContain('View changelog');
  });

  it('says where the changelog went when the press opens the timelapse instead', () => {
    expect(badgeTitle(true)).toContain('long-press');
  });

  it('keeps the attribution the badge exists to carry, either way', () => {
    for (const title of [badgeTitle(true), badgeTitle(false)]) {
      expect(title).toContain('CC BY 4.0');
    }
  });
});


describe('prefetchHorizon', () => {
  it('buffers a fixed stretch at ordinary speeds', () => {
    expect(prefetchHorizon(1)).toBe(PREFETCH_SPAN_SECONDS);
    expect(prefetchHorizon(8)).toBe(PREFETCH_SPAN_SECONDS);
  });

  it('runs further ahead the faster the cursor moves', () => {
    // At 240x the cursor crosses four minutes of history every wall second, so
    // a fixed 180-second horizon would be less than a second of runway.
    expect(prefetchHorizon(240)).toBeGreaterThan(prefetchHorizon(1));
    expect(prefetchHorizon(240) / 240).toBeGreaterThanOrEqual(PREFETCH_RUNWAY_SECONDS);
  });

  it('keeps the runway in wall seconds roughly constant', () => {
    for (const speed of [30, 60, 240]) {
      expect(prefetchHorizon(speed) / speed).toBeGreaterThanOrEqual(PREFETCH_RUNWAY_SECONDS - 0.01);
    }
  });
});

describe('nextFetchSpan horizon', () => {
  // 960-1200 covers the block the cursor is in and the one after it, so the
  // default horizon is already satisfied and a fast playback's is not.
  const held = [{ from: 960, to: 1200 }];

  it('is satisfied at the default horizon', () => {
    expect(nextFetchSpan(1000, held, 100000)).toBeNull();
  });

  it('reaches past it when a fast playback asks for more runway', () => {
    const far = nextFetchSpan(1000, held, 100000, 2000);
    expect(far).not.toBeNull();
    expect(far!.from).toBe(1200);
  });

  it('still stops at the end of the archive however far it is asked to reach', () => {
    expect(nextFetchSpan(1000, held, 1150, 2000)).toBeNull();
  });
});
