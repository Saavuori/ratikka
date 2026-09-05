import type { StopDepartureInfo, StopInfo } from '../types';

export const DEPARTURE_REFRESH_MS = 18_000;
export const DEPARTURE_STALE_MS = 45_000;
export const MAX_SAVED_STOPS = 10;

export function isDepartureSourceStale(fetchedAt: number | undefined, now: number, failed = false): boolean {
  return failed || !Number.isFinite(fetchedAt) || !fetchedAt
    || fetchedAt > now + 5_000 || now - fetchedAt > DEPARTURE_STALE_MS;
}

export function isCancelledDeparture(departure: StopDepartureInfo): boolean {
  return ['CANCELED', 'CANCELLED', 'DELETED'].includes(departure.realtimeState?.toUpperCase() ?? '');
}

export function departureView(departure: StopDepartureInfo, now: number, stale = false) {
  const cancelled = isCancelledDeparture(departure);
  const epoch = departure.realtime
    ? departure.realtimeDepartureTime ?? departure.scheduledDepartureTime
    : departure.scheduledDepartureTime;
  const validEpoch = typeof epoch === 'number' && Number.isFinite(epoch) && epoch > 0;
  const time = (departure.realtime ? departure.realtimeDeparture : undefined)
    || departure.scheduledDeparture
    || (validEpoch ? new Date(epoch).toLocaleTimeString('en-GB', {
      timeZone: 'Europe/Helsinki', hour: '2-digit', minute: '2-digit',
    }) : 'Time unavailable');
  let countdown: string | null = null;
  if (validEpoch && !cancelled) {
    const remaining = epoch - now;
    countdown = remaining < -60_000 ? 'Departed'
      : remaining <= 0 ? 'Due'
        : remaining < 60_000 ? '<1 min'
          : `${Math.ceil(remaining / 60_000)} min`;
  }
  const delay = departure.departureDelay;
  const delayText = departure.realtime && !stale && !cancelled && typeof delay === 'number' && Number.isFinite(delay)
    ? Math.abs(delay) < 30 ? 'On time'
      : `${Math.max(1, Math.round(Math.abs(delay) / 60))} min ${delay < 0 ? 'early' : 'late'}`
    : null;
  return {
    time,
    countdown,
    delayText,
    status: cancelled ? 'Cancelled' : stale ? 'Stale' : departure.realtime ? 'Live prediction' : 'Scheduled',
    selectable: !cancelled && Boolean(departure.tripId),
  };
}

// Schedule only after settlement, and guard callbacks even if a fetch ignores abort.
export function pollDepartures<T>(
  load: (signal: AbortSignal) => Promise<T>,
  onData: (data: T) => void,
  onError: () => void,
): () => void {
  let active = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController;
  const refresh = async () => {
    controller = new AbortController();
    try {
      const data = await load(controller.signal);
      if (active) onData(data);
    } catch {
      if (active) onError();
    } finally {
      if (active) timer = setTimeout(refresh, DEPARTURE_REFRESH_MS);
    }
  };
  void refresh();
  return () => {
    active = false;
    clearTimeout(timer);
    controller.abort();
  };
}

export function parseSavedStops(raw: string | null): StopInfo[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? '[]');
    if (!Array.isArray(parsed)) return [];
    const stops: StopInfo[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') continue;
      const { gtfsId, name, code, lat, lon, platformCode } = entry;
      if (typeof gtfsId !== 'string' || !gtfsId || typeof name !== 'string' || !name
        || typeof code !== 'string' || typeof lat !== 'number' || !Number.isFinite(lat) || Math.abs(lat) > 90
        || typeof lon !== 'number' || !Number.isFinite(lon) || Math.abs(lon) > 180
        || stops.some((stop) => stop.gtfsId === gtfsId)) continue;
      stops.push({ gtfsId, name, code, lat, lon, ...(typeof platformCode === 'string' ? { platformCode } : {}) });
      if (stops.length === MAX_SAVED_STOPS) break;
    }
    return stops;
  } catch {
    return [];
  }
}
