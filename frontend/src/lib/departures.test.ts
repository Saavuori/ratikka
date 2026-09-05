import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { StopDepartureInfo, StopInfo } from '../types';
import { DeparturesPanel } from '../components/DeparturesPanel';
import {
  DEPARTURE_REFRESH_MS, DEPARTURE_STALE_MS, departureView,
  isCancelledDeparture, isDepartureSourceStale, MAX_SAVED_STOPS,
  parseSavedStops, pollDepartures,
} from './departures';

const departure: StopDepartureInfo = {
  line: '4', headsign: 'Munkkiniemi', tripId: 'HSL:trip',
  scheduledArrival: '23:55', realtimeArrival: '23:56', delay: 0,
  scheduledDeparture: '00:05', realtimeDeparture: '00:07',
  scheduledDepartureTime: Date.parse('2026-09-06T00:05:00+03:00'),
  realtimeDepartureTime: Date.parse('2026-09-06T00:07:00+03:00'),
  departureDelay: 120, realtime: true,
};
const now = Date.parse('2026-09-05T23:59:00+03:00');
const stop: StopInfo = { gtfsId: 'HSL:1', name: 'Lasipalatsi', code: 'H0101', lat: 60.17, lon: 24.94, platformCode: '2' };

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('departure display', () => {
  it('uses departure fields and absolute timestamps across midnight, not arrival fields', () => {
    const view = departureView(departure, now);
    expect(view).toMatchObject({ time: '00:07', countdown: '8 min', status: 'Live prediction', delayText: '2 min late' });
  });

  it('does not label scheduled-only services on time or use their realtime timestamp', () => {
    expect(departureView({ ...departure, realtime: false, departureDelay: 0 }, now)).toMatchObject({
      time: '00:05', countdown: '6 min', status: 'Scheduled', delayText: null,
    });
  });

  it('does not invent a countdown from clock text or the current calendar date', () => {
    expect(departureView({ ...departure, scheduledDepartureTime: undefined, realtimeDepartureTime: undefined }, now).countdown).toBeNull();
    expect(departureView({ ...departure, scheduledDepartureTime: undefined, realtimeDepartureTime: NaN }, now).countdown).toBeNull();
  });

  it('does not fall back to arrival time when departures are unavailable', () => {
    expect(departureView({
      ...departure, scheduledDeparture: undefined, realtimeDeparture: undefined,
      scheduledDepartureTime: undefined, realtimeDepartureTime: undefined,
    }, now).time).toBe('Time unavailable');
  });

  it('can format a timestamp in Helsinki time without server clock text', () => {
    expect(departureView({ ...departure, scheduledDeparture: undefined, realtimeDeparture: undefined }, now).time).toBe('00:07');
  });

  it.each(['CANCELED', 'CANCELLED', 'DELETED', 'cancelled'])('never selects a %s trip', (realtimeState) => {
    const cancelled = { ...departure, realtimeState };
    expect(isCancelledDeparture(cancelled)).toBe(true);
    expect(departureView(cancelled, now, true)).toMatchObject({
      status: 'Cancelled', selectable: false, countdown: null, delayText: null,
    });
  });

  it('shows stale predictions without an on-time claim', () => {
    expect(departureView({ ...departure, departureDelay: 0 }, now, true)).toMatchObject({
      status: 'Stale', delayText: null,
    });
  });

  it('ticks through minutes, due and departed without negative countdowns', () => {
    const epoch = departure.realtimeDepartureTime!;
    expect(departureView(departure, epoch - 90_000).countdown).toBe('2 min');
    expect(departureView(departure, epoch - 10_000).countdown).toBe('<1 min');
    expect(departureView(departure, epoch).countdown).toBe('Due');
    expect(departureView(departure, epoch + 61_000).countdown).toBe('Departed');
  });
});

describe('source freshness', () => {
  it('ages the backend snapshot, not the time the HTTP response arrived', () => {
    expect(isDepartureSourceStale(now - DEPARTURE_STALE_MS - 1, now)).toBe(true);
    expect(isDepartureSourceStale(now - DEPARTURE_STALE_MS, now)).toBe(false);
    expect(isDepartureSourceStale(now - 10_000, now)).toBe(false);
    expect(isDepartureSourceStale(now - 10_000, now + 40_000)).toBe(true);
  });

  it('marks failures and unknown, invalid or future source times stale', () => {
    expect(isDepartureSourceStale(now, now, true)).toBe(true);
    for (const source of [undefined, NaN, 0, Infinity, now + 60_000]) {
      expect(isDepartureSourceStale(source, now)).toBe(true);
    }
  });
});

describe('departure polling lifecycle', () => {
  it('does not overlap requests and starts the refresh delay after settlement', async () => {
    vi.useFakeTimers();
    let resolve!: (value: string) => void;
    const load = vi.fn(() => new Promise<string>((done) => { resolve = done; }));
    const onData = vi.fn();
    const cancel = pollDepartures(load, onData, vi.fn());
    await vi.advanceTimersByTimeAsync(DEPARTURE_REFRESH_MS * 3);
    expect(load).toHaveBeenCalledTimes(1);
    resolve('initial');
    await vi.advanceTimersByTimeAsync(0);
    expect(onData).toHaveBeenCalledWith('initial');
    await vi.advanceTimersByTimeAsync(DEPARTURE_REFRESH_MS - 1);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(2);
    cancel();
    resolve('late');
    await vi.advanceTimersByTimeAsync(DEPARTURE_REFRESH_MS * 2);
    expect(onData).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('aborts the old stop and ignores a response even if its fetch ignores abort', async () => {
    vi.useFakeTimers();
    let resolve!: (value: string) => void;
    let signal!: AbortSignal;
    const load = (requestSignal: AbortSignal) => {
      signal = requestSignal;
      return new Promise<string>((done) => { resolve = done; });
    };
    const onData = vi.fn();
    const cancel = pollDepartures(load, onData, vi.fn());
    cancel();
    expect(signal.aborted).toBe(true);
    resolve('old stop');
    await vi.advanceTimersByTimeAsync(DEPARTURE_REFRESH_MS * 2);
    expect(onData).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retains the last good result after failure and retries', async () => {
    vi.useFakeTimers();
    const load = vi.fn()
      .mockResolvedValueOnce('last good')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce('recovered');
    const onData = vi.fn();
    const onError = vi.fn();
    const cancel = pollDepartures(load, onData, onError);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(DEPARTURE_REFRESH_MS);
    expect(onData).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(DEPARTURE_REFRESH_MS);
    expect(onData).toHaveBeenLastCalledWith('recovered');
    cancel();
  });

  it('does not report an abort as a visible error', async () => {
    vi.useFakeTimers();
    let reject!: (error: Error) => void;
    const onError = vi.fn();
    const cancel = pollDepartures(() => new Promise((_, fail) => { reject = fail; }), vi.fn(), onError);
    cancel();
    reject(new Error('aborted'));
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).not.toHaveBeenCalled();
  });
});

describe('saved stops', () => {
  it('recovers from malformed, wrong-shaped and malicious-looking persisted data', () => {
    for (const value of [null, '{', '{}', '"text"', 'null', '[null,1,"stop",{}]']) {
      expect(parseSavedStops(value)).toEqual([]);
    }
    expect(parseSavedStops(JSON.stringify([
      { ...stop, lat: 91 }, { ...stop, lon: 181 }, { ...stop, name: 5 }, { ...stop, gtfsId: '' },
      stop, { ...stop, name: 'Duplicate' },
    ]))).toEqual([stop]);
  });

  it('preserves coordinates, stop code and platform for opening saved stops without geolocation', () => {
    expect(parseSavedStops(JSON.stringify([stop]))).toEqual([stop]);
  });

  it('bounds storage and preview fan-out to ten unique stops', () => {
    const stops = Array.from({ length: 100 }, (_, index) => ({ ...stop, gtfsId: `HSL:${index}` }));
    expect(parseSavedStops(JSON.stringify(stops))).toHaveLength(MAX_SAVED_STOPS);
  });

  it('persists additions/removals and maintains stable snapshots for both consumers', async () => {
    vi.resetModules();
    const values = new Map<string, string>();
    const setItem = vi.fn((key: string, value: string) => { values.set(key, value); });
    vi.stubGlobal('window', { localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem } });
    const store = await import('../hooks/useSavedStops');
    const empty = store.getSavedStops();
    expect(store.getSavedStops()).toBe(empty);
    store.toggleSavedStop(stop);
    expect(store.getSavedStops()).toEqual([stop]);
    expect(setItem).toHaveBeenLastCalledWith('hsl-live-saved-stops', JSON.stringify([stop]));
    store.toggleSavedStop(stop);
    expect(store.getSavedStops()).toEqual([]);
    expect(setItem).toHaveBeenLastCalledWith('hsl-live-saved-stops', '[]');
  });

  it('works in memory when even accessing localStorage throws', async () => {
    vi.resetModules();
    vi.stubGlobal('window', { get localStorage() { throw new Error('Storage blocked'); } });
    const store = await import('../hooks/useSavedStops');
    expect(store.getSavedStops()).toEqual([]);
    expect(() => store.toggleSavedStop(stop)).not.toThrow();
    expect(store.getSavedStops()).toEqual([stop]);
    store.toggleSavedStop(stop);
    expect(store.getSavedStops()).toEqual([]);
  });
});

describe('departure discovery launcher', () => {
  it('renders an accessible button without requesting location during render', () => {
    const getCurrentPosition = vi.fn();
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
    const html = renderToStaticMarkup(createElement(DeparturesPanel, { onSelectStop: vi.fn(), isMobile: false }));
    expect(html).toContain('<button');
    expect(html).toContain('Departures');
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it('hides discovery while another detail panel is selected', () => {
    expect(renderToStaticMarkup(createElement(DeparturesPanel, {
      onSelectStop: vi.fn(), isMobile: true, hidden: true,
    }))).toBe('');
  });
});
