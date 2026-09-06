import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchJourneyMonitor, fetchJourneyPlan, fetchNearbyStops, fetchStopDetails } from './api';

afterEach(() => vi.unstubAllGlobals());

function mockFetch(ok = true) {
  const fetcher = vi.fn().mockResolvedValue({ ok, statusText: 'Unavailable', json: async () => ({}) });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

describe('live transit API requests', () => {
  it('encodes stop identities and propagates cancellation', async () => {
    const fetcher = mockFetch();
    const controller = new AbortController();
    await fetchStopDetails('HSL:stop/one', 8, controller.signal);
    expect(fetcher).toHaveBeenCalledWith('/api/v1/stop/HSL%3Astop%2Fone?departures=8', { signal: controller.signal });
  });
  it('requests nearby stops with explicit coordinates', async () => {
    const fetcher = mockFetch();
    await fetchNearbyStops(60.1, 24.9);
    expect(fetcher).toHaveBeenCalledWith('/api/v1/stops/nearby?lat=60.1&lon=24.9', { signal: undefined });
  });
  it('passes local journey date and time without browser timezone conversion', async () => {
    const fetcher = mockFetch();
    const from = { name: 'A', lat: 60.1, lon: 24.9 };
    await fetchJourneyPlan(from, { ...from, name: 'B' }, undefined, { date: '2026-09-05', time: '23:55', arriveBy: true });
    const url = new URL(fetcher.mock.calls[0][0], 'https://example.test');
    expect(url.searchParams.get('date')).toBe('2026-09-05');
    expect(url.searchParams.get('time')).toBe('23:55');
    expect(url.searchParams.get('arriveBy')).toBe('true');
  });
  it('encodes opaque leg identities individually and keeps their order', async () => {
    const fetcher = mockFetch();
    const signal = new AbortController().signal;
    const ids = ['a+/=&', 'second'];
    await fetchJourneyMonitor(ids, signal);
    const url = new URL(fetcher.mock.calls[0][0], 'https://example.test');
    expect(url.searchParams.getAll('legId')).toEqual(ids);
    expect(fetcher.mock.calls[0][1].signal).toBe(signal);
  });
  it('does not treat failed refreshes as fresh responses', async () => {
    mockFetch(false);
    await expect(fetchJourneyMonitor(['leg'])).rejects.toThrow('Failed to refresh journey');
    await expect(fetchStopDetails('stop')).rejects.toThrow('Failed to fetch stop departures');
  });
});
