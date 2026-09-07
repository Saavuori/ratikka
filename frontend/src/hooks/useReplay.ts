import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchReplayIndex, fetchReplayWindow } from '../lib/api';
import {
  coveredUntil,
  fetchSpanForStep,
  hasCoverage,
  MAX_INFLIGHT_FETCHES,
  newestCoverage,
  nextFetchSpan,
  playbackPlan,
  prefetchHorizon,
  PREFETCH_RUNWAY_SECONDS,
  ReplayBuffer,
  replayRange,
  replayTimeScale,
} from '../lib/replay';
import type { ReplayIndexResponse, VehiclePosition } from '../types';

export interface ReplayState {
  /** Whether history is being played instead of the live feed. */
  active: boolean;
  /** Whether the server records any history at all. */
  available: boolean;
  index: ReplayIndexResponse | null;
  playing: boolean;
  speed: number;
  /** Where the scrubber is, in Unix seconds. */
  cursor: number;
  range: { from: number; to: number };
  /** True while the cursor sits in a stretch nothing was recorded for. */
  inGap: boolean;
  /**
   * Whether the player is waiting on history it cannot draw yet — the first
   * window after a seek, or a stretch playback has caught up with. Not simply
   * "a fetch is in flight": at speed there is nearly always one, and a status
   * line lit by that would never go out.
   */
  loading: boolean;
  error: string | null;
  /** The snapshot to draw: the same shape the live WebSocket produces. */
  vehicles: Record<string, VehiclePosition>;
  /**
   * How many seconds of history a second of wall clock covers. The map needs
   * this to measure travel: at speed the glide between two snapshots is a
   * fraction of a second long but carries several seconds of movement.
   */
  timeScale: number;
}

export interface ReplayControls {
  enter: (at?: number) => void;
  exit: () => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (ts: number) => void;
  setSpeed: (speed: number) => void;
}

/**
 * Plays recorded history back through the same snapshot contract the live
 * WebSocket uses, so the map draws a replayed tram with the code it already has
 * for a running one.
 *
 * The clock is virtual: a wall-clock interval advances a cursor through history
 * at the chosen speed, and each tick asks the buffer which vehicles were on the
 * map at that instant. Fetching runs ahead of the cursor in aligned blocks so a
 * stretch played twice is served from the browser cache.
 */
export function useReplay(): ReplayState & { controls: ReplayControls } {
  const [index, setIndex] = useState<ReplayIndexResponse | null>(null);
  const [active, setActive] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeedState] = useState(1);
  const [cursor, setCursor] = useState(0);
  const [vehicles, setVehicles] = useState<Record<string, VehiclePosition>>({});
  const [stalled, setStalled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stalledRef = useRef(false);

  const bufferRef = useRef(new ReplayBuffer());
  // What has been fetched, and how thinly: a span fetched for a fast playback
  // holds one reading per journey per `step` seconds, so it satisfies any
  // playback that wanted no more than that and none that wanted finer.
  const fetchedRef = useRef<Array<{ from: number; to: number; step: number }>>([]);
  const cursorRef = useRef(0);
  // Read by the fetch loop, which must not be torn down and rebuilt every time
  // playback is paused or resumed.
  const playingRef = useRef(false);
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  // The server's clock is the archive's clock. A browser running a few minutes
  // fast would otherwise let the scrubber run past the end of the history and
  // sit in an empty window wondering why nothing plays. Anchored once from the
  // index and carried forward by the local clock's *elapsed* time, which is
  // reliable even when its absolute reading is not.
  const [clock, setClock] = useState<{ serverTime: number; receivedAt: number } | null>(null);
  // Ticks while a replay is open, so the live edge of the scrubber keeps
  // advancing instead of freezing at whatever it was when the panel opened.
  const [edgeTick, setEdgeTick] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetchReplayIndex(controller.signal)
      .then((res) => {
        setIndex(res);
        setClock({ serverTime: res.serverTime, receivedAt: Date.now() });
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        console.error('Failed to load replay index:', err);
        setIndex({ enabled: false, modes: [], retentionDays: 0, serverTime: 0, days: [] });
      });
    return () => controller.abort();
  }, []);

  const serverNow = useCallback(() => {
    if (!clock) return Math.floor(Date.now() / 1000);
    return clock.serverTime + Math.floor((Date.now() - clock.receivedAt) / 1000);
  }, [clock]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setEdgeTick((t) => t + 1), 30_000);
    return () => window.clearInterval(timer);
  }, [active]);

  const range = useMemo(() => {
    if (!index?.enabled) return { from: 0, to: 0 };
    // Read so the live edge of the scrubber is recomputed on every tick rather
    // than freezing at whatever it was when the panel opened.
    void edgeTick;
    return replayRange(serverNow(), index.retentionDays);
  }, [index, serverNow, edgeTick]);

  const setSpeed = useCallback((next: number) => {
    // The readings already held stay good — a reading is a reading — so the
    // buffer survives a speed change and the map does not blink out on one.
    // What the speed decides is how thinly the *next* fetches are asked for, so
    // spans fetched more coarsely than the new speed wants are forgotten and
    // asked for again; speeding up, which is what a viewer actually does mid
    // playback, keeps everything and carries straight on.
    const step = playbackPlan(next).step;
    fetchedRef.current = fetchedRef.current.filter((span) => span.step <= step);
    setSpeedState(next);
  }, []);

  const seek = useCallback((ts: number) => {
    bufferRef.current.clear();
    fetchedRef.current = [];
    cursorRef.current = ts;
    setCursor(ts);
    setVehicles({});
  }, []);

  const enter = useCallback(
    (at?: number) => {
      if (!index?.enabled) return;
      const bounds = replayRange(serverNow(), index.retentionDays);
      // Opened without a moment in mind, a replay starts an hour back: recent
      // enough to recognise, long enough ago to be worth watching. An archive
      // younger than that hour has nothing there, though — a server that
      // started recording this morning, or ten minutes ago — and a panel
      // opening onto an empty map reads as a broken feature rather than as a
      // young one. Where the hour is empty, it opens on the newest hour that
      // holds anything.
      const hourBack = Math.max(bounds.from, bounds.to - 3600);
      const start =
        at ??
        (hasCoverage(index.days, hourBack)
          ? hourBack
          : newestCoverage(index.days) ?? hourBack);
      seek(Math.min(Math.max(start, bounds.from), bounds.to));
      setActive(true);
      setPlaying(true);
      setError(null);
    },
    [index, seek, serverNow]
  );

  const exit = useCallback(() => {
    setActive(false);
    setPlaying(false);
    bufferRef.current.clear();
    fetchedRef.current = [];
    setVehicles({});
  }, []);

  const play = useCallback(() => setPlaying(true), []);
  const pause = useCallback(() => setPlaying(false), []);
  const toggle = useCallback(() => setPlaying((p) => !p), []);

  // The playback clock. Each tick advances the cursor through history and
  // publishes the snapshot for where it now sits.
  const plan = useMemo(() => playbackPlan(speed), [speed]);

  // Driven by animation frames rather than by a timer. `setInterval` at an
  // eighth of a second is coalesced and drifts, and the map measures its glide
  // window from the gap between snapshots — so an unevenly spaced tick is drawn
  // as unevenly moving trams. A frame callback is already aligned to what the
  // map draws, and the cursor advances by the time that actually passed rather
  // than by the time the timer was asked for, which keeps a replay honest about
  // its own speed when a frame runs late.
  useEffect(() => {
    if (!active || !playing) return;

    let frame = 0;
    let lastPublish = performance.now();
    let waitingSince = 0;

    const tick = () => {
      frame = window.requestAnimationFrame(tick);

      const now = performance.now();
      const elapsed = now - lastPublish;
      if (elapsed < plan.intervalMs) return;
      lastPublish = now;

      const bounds = replayRange(serverNow(), index?.retentionDays ?? 1);

      // Playing into history that has not arrived draws a thinning crowd: the
      // vehicles already held go stale one by one and wink out, which reads as
      // trams vanishing rather than as a player waiting. So the cursor holds
      // where it is until the fetches ahead of it land.
      const covered = coveredUntil(fetchedRef.current, cursorRef.current);
      const waiting = cursorRef.current >= covered && cursorRef.current < bounds.to;
      if (!waiting) waitingSince = 0;
      else if (waitingSince === 0) waitingSince = now;

      // Said only once the wait is long enough to be worth saying. A fast
      // playback runs a step or two ahead of a landing fetch fairly often, and
      // a status line lit for a tenth of a second at a time is a flicker in a
      // panel that changes height with it.
      const say = waiting && now - waitingSince > 400;
      if (say !== stalledRef.current) {
        stalledRef.current = say;
        setStalled(say);
      }
      if (waiting) return;

      // A tab that was in the background gets no frames at all, so the first
      // one back carries however long it was away. Capped at a few steps: the
      // honest thing is to carry on from about where playback was, not to leap
      // a minute of history nothing has been fetched for.
      const advance = (Math.min(elapsed, plan.intervalMs * 4) / 1000) * speed;
      // Never past what is held, and never backwards — the cursor can sit at
      // the live edge with less than that fetched behind it.
      const next = Math.max(cursorRef.current, Math.min(cursorRef.current + advance, covered));

      if (next >= bounds.to) {
        // Caught up with the present. Stop rather than loop: the user asked to
        // watch history, and there is no more of it.
        cursorRef.current = bounds.to;
        setCursor(bounds.to);
        setPlaying(false);
        return;
      }

      cursorRef.current = next;
      setCursor(next);
      setVehicles(bufferRef.current.snapshotAt(next));
      bufferRef.current.prune(next);
    };

    frame = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frame);
      // Nothing is waiting on history once nothing is playing, and a status
      // line left lit says the opposite.
      stalledRef.current = false;
      setStalled(false);
    };
  }, [active, playing, plan, speed, index, serverNow]);

  // Paused, the map should still show where the scrubber is rather than
  // whatever was last playing.
  useEffect(() => {
    if (!active || playing) return;
    setVehicles(bufferRef.current.snapshotAt(cursor));
  }, [active, playing, cursor]);

  // Fetching, running ahead of the cursor.
  //
  // Driven by its own loop rather than by the cursor: the cursor changes many
  // times a second while playing, and an effect keyed on it would abort its own
  // in-flight request on every tick and never finish one. The cursor is
  // therefore read from a ref, and requests are only ever cancelled when the
  // replay itself ends.
  //
  // A few windows at a time, and the next one asked for the moment one lands.
  // At two hundred and forty times the cursor crosses a fetched block in half a
  // second, so a loop that waits out a round trip before asking for the next
  // block cannot keep ahead of it — and the runway it fails to build is exactly
  // what the stall above then waits for.
  useEffect(() => {
    if (!active || !index?.enabled) return;

    let cancelled = false;
    const controller = new AbortController();
    // Spans asked for but not yet answered, so the parallel requests do not all
    // ask for the same block.
    const pending: Array<{ from: number; to: number; step: number }> = [];
    let inFlight = 0;
    let retryAt = 0;

    const run = async (span: { from: number; to: number; step: number }) => {
      try {
        const res = await fetchReplayWindow(
          span.from,
          span.to,
          { step: plan.step, modes: index.modes },
          controller.signal
        );
        if (cancelled) return;
        // Bounded, so a long playback does not accumulate every span it has
        // ever fetched; the buffer behind the cursor is pruned on the same
        // principle.
        fetchedRef.current = [...fetchedRef.current, span].slice(-64);
        bufferRef.current.append(res.samples);
        setError(null);
        // Paused, newly arrived readings still belong on the map straight away.
        // Playing, the next tick is a frame away and will draw them: publishing
        // here as well would hand the map a second snapshot a few milliseconds
        // after the last one, and restart every vehicle's glide from it.
        if (!playingRef.current) setVehicles(bufferRef.current.snapshotAt(cursorRef.current));
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        console.error('Failed to fetch replay window:', err);
        setError('Could not load this stretch of history.');
        // A failed span is not recorded as held, so the next pump would ask for
        // it again immediately and turn one broken window into a tight loop.
        retryAt = performance.now() + 1000;
      } finally {
        const at = pending.findIndex((s) => s.from === span.from && s.to === span.to);
        if (at >= 0) pending.splice(at, 1);
        inFlight -= 1;
        if (!cancelled) pump();
      }
    };

    const blockSpan = fetchSpanForStep(plan.step);

    const pump = () => {
      if (cancelled || performance.now() < retryAt) return;
      const bounds = replayRange(serverNow(), index.retentionDays);

      // How hard to fetch depends on how close the cursor is to running out of
      // history, in the only unit that matters: wall seconds of playback left.
      // Parallel requests are what keeps a fast replay supplied, but they also
      // land together, and three blocks parsed back to back is three times the
      // hitch of one — so at a speed where a single block lasts half a minute,
      // they are fetched one at a time and the work stays spread out.
      const runway = (coveredUntil(fetchedRef.current, cursorRef.current) - cursorRef.current) /
        Math.max(0.1, speed);
      const limit = runway < PREFETCH_RUNWAY_SECONDS ? MAX_INFLIGHT_FETCHES : 1;

      while (inFlight < limit) {
        const span = nextFetchSpan(
          cursorRef.current,
          [...fetchedRef.current, ...pending],
          bounds.to,
          prefetchHorizon(speed),
          blockSpan
        );
        if (!span) return;
        const wanted = { ...span, step: plan.step };
        pending.push(wanted);
        inFlight += 1;
        void run(wanted);
      }
    };

    pump();
    // The loop above re-arms itself on every answer, but nothing re-arms it
    // once the runway is full or a window failed — so a slow beat keeps asking
    // as the cursor moves on.
    const timer = window.setInterval(pump, 250);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      controller.abort();
    };
  }, [active, index, plan.step, speed, serverNow]);

  const inGap = active && index?.enabled === true && !hasCoverage(index.days, cursor);

  return {
    active,
    available: index?.enabled === true,
    index,
    playing,
    speed,
    cursor,
    range,
    inGap,
    loading: stalled,
    error,
    vehicles,
    timeScale: active ? replayTimeScale(speed) : 1,
    controls: { enter, exit, play, pause, toggle, seek, setSpeed },
  };
}
