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
  it('plans a journey that leaves now, sending only the two endpoints', async () => {
    const fetcher = mockFetch();
    const from = { name: 'A', lat: 60.1, lon: 24.9 };
    await fetchJourneyPlan(from, { name: 'B', lat: 60.2, lon: 25 });
    const url = new URL(fetcher.mock.calls[0][0], 'https://example.test');
    expect(Object.fromEntries(url.searchParams)).toEqual({ fromLat: '60.1', fromLon: '24.9', toLat: '60.2', toLon: '25' });
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
