import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchReplayIndex, fetchReplayWindow } from '../lib/api';
import {
  hasCoverage,
  newestCoverage,
  nextFetchSpan,
  playbackPlan,
  prefetchHorizon,
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bufferRef = useRef(new ReplayBuffer());
  const fetchedRef = useRef<Array<{ from: number; to: number }>>([]);
  const cursorRef = useRef(0);
  const inFlightRef = useRef(false);

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
    // The thinning that makes a speed affordable is baked into the readings
    // already fetched, so a speed change starts a fresh fetch plan.
    bufferRef.current.clear();
    fetchedRef.current = [];
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

  // The playback clock. Each tick advances the cursor by one step of history
  // and publishes the snapshot for where it now sits.
  const plan = useMemo(() => playbackPlan(speed), [speed]);

  useEffect(() => {
    if (!active || !playing) return;

    const timer = window.setInterval(() => {
      const next = cursorRef.current + plan.step;
      const bounds = replayRange(serverNow(), index?.retentionDays ?? 1);
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
    }, plan.intervalMs);

    return () => window.clearInterval(timer);
  }, [active, playing, plan, index, serverNow]);

  // Paused, the map should still show where the scrubber is rather than
  // whatever was last playing.
  useEffect(() => {
    if (!active || playing) return;
    setVehicles(bufferRef.current.snapshotAt(cursor));
  }, [active, playing, cursor]);

  // Fetching, running ahead of the cursor.
  //
  // Driven by its own timer rather than by the cursor: the cursor changes up to
  // eight times a second while playing, and an effect keyed on it would abort
  // its own in-flight request on every tick and never finish one. The cursor is
  // therefore read from a ref, and the request is only ever cancelled when the
  // replay itself ends.
  //
  // One request at a time. Playback is linear, and a queue of parallel windows
  // would arrive out of order and mostly be pruned before being drawn.
  useEffect(() => {
    if (!active || !index?.enabled) return;

    let cancelled = false;
    const controller = new AbortController();

    const pump = async () => {
      if (inFlightRef.current || cancelled) return;
      const bounds = replayRange(serverNow(), index.retentionDays);
      const span = nextFetchSpan(
        cursorRef.current,
        fetchedRef.current,
        bounds.to,
        prefetchHorizon(speed)
      );
      if (!span) return;

      inFlightRef.current = true;
      setLoading(true);
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
        // Paused or between ticks, newly arrived readings still belong on the
        // map straight away.
        setVehicles(bufferRef.current.snapshotAt(cursorRef.current));
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        console.error('Failed to fetch replay window:', err);
        setError('Could not load this stretch of history.');
      } finally {
        inFlightRef.current = false;
        if (!cancelled) setLoading(false);
      }
    };

    void pump();
    const timer = window.setInterval(() => void pump(), 250);

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
    loading,
    error,
    vehicles,
    timeScale: active ? replayTimeScale(speed) : 1,
    controls: { enter, exit, play, pause, toggle, seek, setSpeed },
  };
}
