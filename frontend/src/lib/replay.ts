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

/** How much history one fetch covers. */
export const FETCH_SPAN_SECONDS = 120;

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
 */
export class ReplayBuffer {
  private entries: BufferEntry[] = [];
  private cursor = 0;
  private live = new Map<string, VehiclePosition>();
  private lastTs = Number.NEGATIVE_INFINITY;

  /** Adds readings, keeping the buffer sorted and free of repeats. */
  append(samples: VehiclePosition[]): void {
    if (samples.length === 0) return;

    const seen = new Set(this.entries.map((e) => `${e.vehicle.veh}@${e.ts}`));
    const added: BufferEntry[] = [];
    for (const vehicle of samples) {
      const key = `${vehicle.veh}@${vehicle.ts}`;
      if (seen.has(key)) continue;
      seen.add(key);
      added.push({ ts: vehicle.ts, vehicle });
    }
    if (added.length === 0) return;

    this.entries = this.entries.concat(added).sort((a, b) => a.ts - b.ts);
    // A reading may have landed before the cursor — a window that arrived out
    // of order, or a gap filled in late — so the snapshot is rebuilt rather
    // than continued.
    this.reset();
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
   */
  prune(ts: number): void {
    const cutoff = ts - REPLAY_STALE_SECONDS * 2;
    if (this.entries.length === 0 || this.entries[0].ts >= cutoff) return;
    this.entries = this.entries.filter((entry) => entry.ts >= cutoff);
    this.reset();
  }

  /** Forgets everything, for a seek to somewhere else entirely. */
  clear(): void {
    this.entries = [];
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

/**
 * A span of history that is wanted but not yet held, or null when the buffer
 * already reaches far enough ahead. Fetches are aligned to whole
 * FETCH_SPAN_SECONDS blocks so that repeated playback of the same stretch asks
 * for the same URLs and the browser cache answers them.
 */
export function nextFetchSpan(
  cursorTs: number,
  fetched: Array<{ from: number; to: number }>,
  horizonTs: number,
  aheadSeconds: number = PREFETCH_SPAN_SECONDS
): { from: number; to: number } | null {
  const wanted = Math.min(cursorTs + aheadSeconds, horizonTs);

  for (let ts = Math.floor(cursorTs); ts <= wanted; ts += FETCH_SPAN_SECONDS) {
    const blockFrom = Math.floor(ts / FETCH_SPAN_SECONDS) * FETCH_SPAN_SECONDS;
    const blockTo = blockFrom + FETCH_SPAN_SECONDS;
    if (blockFrom > horizonTs) break;
    if (fetched.some((span) => span.from <= blockFrom && span.to >= blockTo)) continue;
    return { from: blockFrom, to: blockTo };
  }
  return null;
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
 * What the badge advertises on hover. The timelapse gesture is only mentioned
 * where there is history to reveal: an instance recording nothing must not
 * offer a double-click that does nothing.
 */
export function badgeTitle(revealable: boolean): string {
  return revealable
    ? `View changelog · double-click for timelapse · ${ATTRIBUTION}`
    : `View changelog · ${ATTRIBUTION}`;
}

/**
 * How long a single click waits to see whether it is really half of a double.
 * The browser's default double-click window is commonly about 500 ms; waiting
 * that long prevents the changelog link from winning before the second click.
 */
export const DOUBLE_CLICK_GRACE_MS = 500;

/**
 * Whether a click on the badge completes the timelapse gesture or is the first
 * of a pair still waiting for its partner. `pendingSince` is when the previous
 * click landed, or null when none is waiting.
 *
 * Counted from clicks rather than from the browser's own `dblclick`, which
 * touch browsers do not reliably emit even though they synthesize a click for
 * every tap: this is the one path a mouse and a finger both travel, so the
 * gesture behaves the same on a phone as on a desktop.
 */
export function badgeGesture(now: number, pendingSince: number | null): 'reveal' | 'wait' {
  if (pendingSince === null) return 'wait';
  return now - pendingSince <= DOUBLE_CLICK_GRACE_MS ? 'reveal' : 'wait';
}
