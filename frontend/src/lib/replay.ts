import type { ReplayDayCoverage, VehiclePosition } from '../types';

/**
 * Playback of recorded history, as the pure part: what to fetch, and which
 * vehicles are on the map at a given instant. The hook around it (useReplay)
 * owns the clock and the network; everything decidable without either lives
 * here so it can be tested without either.
 */

/**
 * How long a vehicle stays on the map after its last reading. The backend
 * drops a live vehicle from the cache after sixty seconds of silence, so
 * replay holds one for exactly as long: a tram that ends its journey should
 * disappear from a replay at the same moment it disappeared from the live map.
 */
export const REPLAY_STALE_SECONDS = 60;

/**
 * Roughly how many snapshots a second playback aims to draw, whatever speed it
 * is running at. The map interpolates between snapshots, so this is a drawing
 * rate, not a data rate — it is what `step` is chosen to hold constant.
 */
export const TARGET_SNAPSHOTS_PER_SECOND = 8;

/**
 * The smallest block of history one fetch covers, and the size every larger
 * block is a doubling of, so that blocks nest and stay aligned.
 */
export const FETCH_SPAN_SECONDS = 30;

/** The largest block one fetch covers. */
export const MAX_FETCH_SPAN_SECONDS = 480;

/**
 * How much history to ask for in one go, at a given thinning.
 *
 * Not a constant, because a constant span is a wildly varying amount of work. A
 * two-minute block of tram history is nine thousand readings and three
 * megabytes unthinned, and three hundred and seventy readings at a thirtieth of
 * that — and it was the unthinned end that hurt: parsing three megabytes and
 * building nine thousand objects is a tenth of a second of blocked main thread
 * on a desktop and several times that on a phone, once every two minutes of
 * playback, which is exactly where a viewer sees the timelapse jump.
 *
 * So the block is sized by the work rather than by the clock: roughly a
 * constant couple of thousand readings whatever the speed, which is a fetch
 * small enough to parse inside a frame or two and a seek quick enough to feel
 * immediate. Spans stay doublings of the smallest one and aligned to their own
 * size, so replaying a stretch at the same speed asks for the same URLs and the
 * browser cache answers them.
 */
export function fetchSpanForStep(step: number): number {
  const wanted = FETCH_SPAN_SECONDS * Math.max(1, step);
  let span = FETCH_SPAN_SECONDS;
  while (span * 2 <= wanted && span * 2 <= MAX_FETCH_SPAN_SECONDS) span *= 2;
  return span;
}

/**
 * How far ahead of the cursor the player keeps history buffered, at least. Fast
 * playback needs more runway in *history* seconds for the same runway in wall
 * seconds — at 240× the cursor crosses four minutes of history every wall
 * second — so the horizon grows with the speed; see `prefetchHorizon`.
 */
export const PREFETCH_SPAN_SECONDS = 180;

/** Seconds of wall-clock runway the player tries to keep buffered. */
export const PREFETCH_RUNWAY_SECONDS = 4;

/** How far ahead of the cursor to fetch, in seconds of history, at a speed. */
export function prefetchHorizon(speed: number): number {
  return Math.max(PREFETCH_SPAN_SECONDS, Math.max(0.1, speed) * PREFETCH_RUNWAY_SECONDS);
}

/** The speeds the timelapse panel offers, in multiples of real time. */
export const REPLAY_SPEEDS = [1, 2, 4, 8, 30, 60, 240] as const;

export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];

/**
 * How a given speed is played: how many seconds of history each drawn step
 * covers, and how often to draw one.
 *
 * At one times, this is a reading a second — exactly what the live feed
 * delivers, so the map animates a replay the way it animates now. Faster than
 * about eight times, asking for every reading would mean fetching (and
 * interpolating between) far more of them than can be drawn, so the step grows
 * instead of the rate: at sixty times the player draws eight steps a second of
 * eight seconds each, and fetches an eighth of the readings to do it.
 */
export function playbackPlan(speed: number): { step: number; intervalMs: number } {
  const safeSpeed = Math.max(0.1, speed);
  const step = Math.max(1, Math.round(safeSpeed / TARGET_SNAPSHOTS_PER_SECOND));
  return { step, intervalMs: (step / safeSpeed) * 1000 };
}

/**
 * The map's dead reckoning and its teleport guard measure travel in seconds of
 * *history*, while the glide between two snapshots is measured in seconds on
 * the wall clock. At one times these are the same number and nothing needs
 * saying; at sixty times a snapshot arrives every eighth of a second carrying
 * eight seconds of travel, and a map told only the wall figure would decide
 * every vehicle had teleported. This is the ratio between the two.
 */
export function replayTimeScale(speed: number): number {
  return Math.max(0.1, speed);
}

interface BufferEntry {
  ts: number;
  vehicle: VehiclePosition;
}

/**
 * Holds fetched readings and answers "what was on the map at this instant".
 *
 * Playback runs forward, so the common case is advancing a cursor through a
 * sorted list and keeping the newest reading per vehicle — the same state the
 * live map holds, built from history instead of a socket. Seeking backwards
 * rebuilds from the start of what is buffered, which is bounded because the
 * player prunes behind itself.
 *
 * Everything here is on the playback tick's critical path, and at two hundred
 * and forty times a fetch lands several thousand readings twice a second into a
 * buffer holding tens of thousands. Rebuilding the whole thing on each of those
 * — re-sorting, re-keying, replaying the cursor from zero — is what a smooth
 * playback cannot afford, so appends merge and prunes slice.
 */
export class ReplayBuffer {
  private entries: BufferEntry[] = [];
  private cursor = 0;
  private live = new Map<string, VehiclePosition>();
  private lastTs = Number.NEGATIVE_INFINITY;
  // The readings held, so a repeat can be recognised without walking the
  // buffer. Kept in step with `entries` through every path that changes it.
  private keys = new Set<string>();

  /** Adds readings, keeping the buffer sorted and free of repeats. */
  append(samples: VehiclePosition[]): void {
    if (samples.length === 0) return;

    const added: BufferEntry[] = [];
    let earliest = Number.POSITIVE_INFINITY;
    for (const vehicle of samples) {
      const key = `${vehicle.veh}@${vehicle.ts}`;
      if (this.keys.has(key)) continue;
      this.keys.add(key);
      added.push({ ts: vehicle.ts, vehicle });
      if (vehicle.ts < earliest) earliest = vehicle.ts;
    }
    if (added.length === 0) return;

    added.sort((a, b) => a.ts - b.ts);
    this.entries = merge(this.entries, added);
    // A reading may have landed at a moment already played — a window that
    // arrived out of order, or a gap filled in late — and only then does the
    // snapshot have to be rebuilt. Readings for moments still ahead of the
    // cursor land ahead of it in the merge too, and cost nothing.
    if (earliest <= this.lastTs) this.reset();
  }

  /** Every vehicle whose newest reading at or before `ts` is still fresh. */
  snapshotAt(ts: number): Record<string, VehiclePosition> {
    if (ts < this.lastTs) this.reset();
    this.lastTs = ts;

    while (this.cursor < this.entries.length && this.entries[this.cursor].ts <= ts) {
      const entry = this.entries[this.cursor];
      const held = this.live.get(entry.vehicle.veh);
      // Out-of-order readings for the same vehicle must not move it backwards.
      if (!held || held.ts <= entry.ts) {
        this.live.set(entry.vehicle.veh, entry.vehicle);
      }
      this.cursor += 1;
    }

    const snapshot: Record<string, VehiclePosition> = {};
    for (const [veh, vehicle] of this.live) {
      if (ts - vehicle.ts > REPLAY_STALE_SECONDS) {
        this.live.delete(veh);
        continue;
      }
      snapshot[veh] = vehicle;
    }
    return snapshot;
  }

  /**
   * Drops readings older than `ts`, so a long playback does not accumulate the
   * whole day. Kept generously behind the cursor: a vehicle's last reading has
   * to survive as long as it is still drawn.
   *
   * Playback prunes behind a cursor that has already passed the cutoff, and
   * there the snapshot the buffer holds is still exactly right — only its index
   * has moved, so it is moved rather than rebuilt, which at speed would
   * otherwise happen on every tick.
   */
  prune(ts: number): void {
    const cutoff = ts - REPLAY_STALE_SECONDS * 2;
    if (this.entries.length === 0 || this.entries[0].ts >= cutoff) return;

    let drop = 0;
    while (drop < this.entries.length && this.entries[drop].ts < cutoff) drop += 1;
    // Rewriting the buffer is O(n), and at speed the cutoff moves on every
    // tick, so it is worth doing only once a real share of the buffer is
    // behind rather than for the handful of readings one tick leaves.
    if (drop === 0 || (drop < 256 && drop * 4 < this.entries.length)) return;

    for (let i = 0; i < drop; i += 1) {
      this.keys.delete(`${this.entries[i].vehicle.veh}@${this.entries[i].ts}`);
    }
    const consumed = drop <= this.cursor;
    this.entries = this.entries.slice(drop);
    // A prune reaching past where the cursor has read invalidates the snapshot
    // rather than merely shifting it, and that one rebuilds.
    if (consumed) this.cursor -= drop;
    else this.reset();
  }

  /** Forgets everything, for a seek to somewhere else entirely. */
  clear(): void {
    this.entries = [];
    this.keys.clear();
    this.reset();
  }

  get size(): number {
    return this.entries.length;
  }

  private reset(): void {
    this.cursor = 0;
    this.live.clear();
    this.lastTs = Number.NEGATIVE_INFINITY;
  }
}

/** Two timestamp-sorted runs of readings, merged into one. */
function merge(left: BufferEntry[], right: BufferEntry[]): BufferEntry[] {
  if (left.length === 0) return right;
  if (right.length === 0) return left;
  // The ordinary case: a fetch that lands entirely after everything held.
  if (left[left.length - 1].ts <= right[0].ts) return left.concat(right);

  const out: BufferEntry[] = new Array(left.length + right.length);
  let i = 0;
  let j = 0;
  for (let k = 0; k < out.length; k += 1) {
    if (j >= right.length || (i < left.length && left[i].ts <= right[j].ts)) {
      out[k] = left[i];
      i += 1;
    } else {
      out[k] = right[j];
      j += 1;
    }
  }
  return out;
}

/**
 * A span of history that is wanted but not yet held, or null when the buffer
 * already reaches far enough ahead. Fetches are aligned to whole blocks of
 * `spanSeconds` so that repeated playback of the same stretch asks for the same
 * URLs and the browser cache answers them.
 */
export function nextFetchSpan(
  cursorTs: number,
  fetched: Array<{ from: number; to: number }>,
  horizonTs: number,
  aheadSeconds: number = PREFETCH_SPAN_SECONDS,
  spanSeconds: number = FETCH_SPAN_SECONDS
): { from: number; to: number } | null {
  const wanted = Math.min(cursorTs + aheadSeconds, horizonTs);
  const span = Math.max(1, spanSeconds);

  for (let ts = Math.floor(cursorTs); ts <= wanted; ts += span) {
    const blockFrom = Math.floor(ts / span) * span;
    const blockTo = blockFrom + span;
    if (blockFrom > horizonTs) break;
    if (fetched.some((span) => span.from <= blockFrom && span.to >= blockTo)) continue;
    return { from: blockFrom, to: blockTo };
  }
  return null;
}

/**
 * How many window fetches may be in flight at once.
 *
 * One at a time is enough at real time, where a fetch covers two minutes of
 * playback; at two hundred and forty times it covers half a second, and a
 * player that spends a round trip idle between requests never builds a runway
 * and plays into history it does not hold yet — which on the map reads as trams
 * blinking out. Requests are small and the archive answers them from the page
 * cache on a second viewing, so a few in parallel is the cheap fix. Kept low
 * because playback is linear: the runway is short and there is little point
 * asking for more of it than the next few seconds need.
 */
export const MAX_INFLIGHT_FETCHES = 3;

/**
 * How far past `ts` the fetched spans reach without a hole in them.
 *
 * This is what tells playback whether the next step is history it actually
 * holds. A player that advances regardless draws whatever happens to be in the
 * buffer — which, running ahead of the data, is a thinning crowd of vehicles
 * going stale one by one until the fetch lands. Waiting instead is what a video
 * player does, and it looks like what it is: a pause, not a disappearance.
 */
export function coveredUntil(spans: Array<{ from: number; to: number }>, ts: number): number {
  let reach = ts;
  const sorted = [...spans].sort((a, b) => a.from - b.from);
  for (const span of sorted) {
    if (span.from > reach) break;
    if (span.to > reach) reach = span.to;
  }
  return reach;
}

/** The instants a replay may be scrubbed between, from the server's index. */
export interface ReplayRange {
  from: number;
  to: number;
}

/**
 * The scrubbable range, taken from the server's own clock rather than the
 * browser's: a client whose clock is a few minutes fast would otherwise scrub
 * into history that does not exist yet.
 */
export function replayRange(serverTime: number, retentionDays: number): ReplayRange {
  const days = Math.max(1, retentionDays);
  return {
    // The newest minute is still being written, so the live edge sits a minute
    // back — far enough that playback never runs into a partial chunk.
    to: serverTime - 60,
    from: serverTime - days * 24 * 3600,
  };
}

/**
 * Whether an instant has any recorded minutes, from the index's coverage. Used
 * to draw the timeline's gaps and to skip a stretch nothing was recorded for —
 * a deploy, a broker reconnect — instead of playing silence through it.
 */
export function hasCoverage(
  days: Array<{ date: string; hours: Record<string, number[]> }> | null | undefined,
  ts: number,
  timeZone = 'Europe/Helsinki'
): boolean {
  if (!days || days.length === 0) return false;

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(new Date(ts * 1000));

  const lookup = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const date = `${lookup('year')}-${lookup('month')}-${lookup('day')}`;
  // Intl renders midnight as "24" in some engines and "00" in others.
  const hour = Number(lookup('hour')) % 24;

  const day = days.find((d) => d.date === date);
  if (!day) return false;
  return Object.values(day.hours).some((hours) => (hours[hour] ?? 0) > 0);
}

/**
 * Which stretches of the scrubbed range hold recordings, as fractions of its
 * width, so the timeline can shade the gaps a deploy or a broker reconnect left
 * rather than letting the user drag into silence and wonder.
 *
 * Coverage is reported per hour, which is the resolution the marks are drawn
 * at: an hour with any minutes in it counts as covered.
 */
export function coverageMarks(
  days: ReplayDayCoverage[] | null,
  range: { from: number; to: number }
): Array<{ left: number; width: number }> {
  if (!days?.length || range.to <= range.from) return [];

  const span = range.to - range.from;
  const marks: Array<{ left: number; width: number }> = [];

  for (const day of days) {
    // Midnight Helsinki for this day. Parsing the date at +00:00 and asking
    // Intl where that lands would be circular, so the offset is read off the
    // formatted hour instead: a day's chunks are filed by local hour, and the
    // day's own midnight is what those hours are counted from.
    const midnight = Date.parse(`${day.date}T00:00:00${helsinkiOffset(day.date)}`) / 1000;
    if (!Number.isFinite(midnight)) continue;

    for (let hour = 0; hour < 24; hour += 1) {
      const covered = Object.values(day.hours).some((hours) => (hours[hour] ?? 0) > 0);
      if (!covered) continue;

      const start = midnight + hour * 3600;
      const end = start + 3600;
      if (end <= range.from || start >= range.to) continue;

      const left = (Math.max(start, range.from) - range.from) / span;
      const width = (Math.min(end, range.to) - Math.max(start, range.from)) / span;
      marks.push({ left: left * 100, width: width * 100 });
    }
  }
  return marks;
}

/**
 * The most recent moment the archive holds anything for, or null when it holds
 * nothing at all.
 *
 * A replay opened without a moment in mind starts an hour back, which is the
 * right place in a week of history and the wrong one in an archive that has
 * been recording for ten minutes — there the panel would open onto an empty map
 * and read as broken. Landing on the newest recorded hour instead means the
 * first thing a reader sees is trams moving.
 *
 * Resolved to the middle of that hour: coverage is reported per hour, and its
 * final minutes are the ones a recording still in progress may not have written
 * yet.
 */
export function newestCoverage(days: ReplayDayCoverage[] | null): number | null {
  if (!days?.length) return null;

  let newest: number | null = null;
  for (const day of days) {
    const midnight = Date.parse(`${day.date}T00:00:00${helsinkiOffset(day.date)}`) / 1000;
    if (!Number.isFinite(midnight)) continue;

    for (let hour = 23; hour >= 0; hour -= 1) {
      if (!Object.values(day.hours).some((hours) => (hours[hour] ?? 0) > 0)) continue;
      const mid = midnight + hour * 3600 + 1800;
      if (newest === null || mid > newest) newest = mid;
      break;
    }
  }
  return newest;
}

/**
 * Helsinki's UTC offset on a given date: +03:00 through summer time, +02:00
 * outside it. Derived from the zone itself rather than from a rule, so it stays
 * right when the changeover dates move.
 */
function helsinkiOffset(date: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Helsinki',
    timeZoneName: 'longOffset',
  }).formatToParts(new Date(`${date}T12:00:00Z`));
  const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+02:00';
  return name.replace('GMT', '') || '+02:00';
}

const ATTRIBUTION =
  'Traffic-light junctions: Helsingin kaupunkiympäristön toimiala / Kaupunkimittauspalvelut, CC BY 4.0';

/**
 * What the badge advertises on hover. The timelapse is only offered where there
 * is history to reveal; with none, the badge is its changelog link and says so.
 */
export function badgeTitle(revealable: boolean): string {
  return revealable
    ? `Open the timelapse · long-press for the changelog · ${ATTRIBUTION}`
    : `View changelog · ${ATTRIBUTION}`;
}
