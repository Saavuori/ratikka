/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Clock, Footprints, LocateFixed, X, Zap } from 'lucide-react';
import { getRouteColor } from '../lib/routeColors';
import type { NearbyStop, StopDetailsResponse, StopInfo } from '../types';
import { fetchNearbyStops, fetchStopDetails } from '../lib/api';
import { departureView, isDepartureSourceStale, MAX_SAVED_STOPS, pollDepartures } from '../lib/departures';
import { useSavedStops } from '../hooks/useSavedStops';
import { nextArrivals, walkVerdict, walkVerdictLabel } from '../lib/stopArrivals';
import './departures.css';
import './arrival.css';

export interface StopSelectionExtras {
  /** Walking distance to the stop, metres — only ever a street distance. */
  distance?: number;
  /** Follow the stop's next arrival on the map without a second tap. */
  autoTrack?: boolean;
}

export interface DeparturesPanelProps {
  onSelectStop: (stop: StopInfo, extras?: StopSelectionExtras) => void;
  hidden?: boolean;
  isMobile: boolean;
  onOpenChange?: (open: boolean) => void;
}

interface Preview {
  details?: StopDetailsResponse;
  failed: boolean;
}

export function DeparturesPanel({ onSelectStop, hidden = false, isMobile, onOpenChange }: DeparturesPanelProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'nearby' | 'saved'>('saved');
  const { savedStops, toggleStop } = useSavedStops();
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [nearby, setNearby] = useState<NearbyStop[]>([]);
  const [nearbyFetchedAt, setNearbyFetchedAt] = useState<number>();
  const [nearbyLoaded, setNearbyLoaded] = useState(false);
  const [locating, setLocating] = useState(false);
  const [catching, setCatching] = useState(false);
  const [locationError, setLocationError] = useState('');
  const [nearbyError, setNearbyError] = useState('');
  const [previews, setPreviews] = useState<Record<string, Preview>>({});
  const [now, setNow] = useState(() => Date.now());
  const locationRequest = useRef(0);
  const closeButton = useRef<HTMLButtonElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const visible = open && !hidden;
  const stops: StopInfo[] = (tab === 'saved' ? savedStops : nearby).slice(0, MAX_SAVED_STOPS);
  const stopIds = JSON.stringify(stops.map((stop) => stop.gtfsId));
  const reportOpen = useEffectEvent((value: boolean) => onOpenChange?.(value));
  const cancelLocation = useEffectEvent(() => { locationRequest.current++; });

  useEffect(() => {
    reportOpen(visible);
    if (visible) closeButton.current?.focus();
    else {
      locationRequest.current++;
      setLocating(false);
    }
    return () => cancelLocation();
  }, [visible]);

  useEffect(() => {
    if (hidden) setOpen(false);
  }, [hidden]);

  useEffect(() => {
    if (!visible) return;
    setNow(Date.now());
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(clock);
  }, [visible]);

  useEffect(() => {
    if (!visible || tab !== 'nearby' || !coords) return;
    return pollDepartures(
      (signal) => fetchNearbyStops(coords.lat, coords.lon, signal),
      (data) => {
        setNearby(data.stops.slice(0, MAX_SAVED_STOPS));
        setNearbyFetchedAt(data.fetchedAt);
        setNearbyLoaded(true);
        setNearbyError('');
      },
      () => setNearbyError('Could not update nearby stops. Retrying automatically.'),
    );
  }, [coords, tab, visible]);

  useEffect(() => {
    if (!visible) return;
    const ids: string[] = JSON.parse(stopIds);
    if (ids.length === 0) return;
    return pollDepartures(
      (signal) => Promise.all(ids.map(async (id) => {
        try {
          const details = await fetchStopDetails(id, 3, signal);
          return { id, details, failed: false };
        } catch {
          return { id, failed: true };
        }
      })),
      (results) => {
        setPreviews((previous) => Object.fromEntries(results.map((result) => [
          result.id,
          { details: result.details ?? previous[result.id]?.details, failed: result.failed },
        ])));
        setNow(Date.now());
      },
      () => setPreviews((previous) => Object.fromEntries(ids.map((id) => [id, { ...previous[id], failed: true }]))),
    );
  }, [visible, stopIds]);

  const requestLocation = () => {
    const request = ++locationRequest.current;
    setLocationError('');
    if (!navigator.geolocation) {
      setLocationError('Location is unavailable in this browser. Use saved stops or select a stop on the map.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (request !== locationRequest.current) return;
        setCoords({ lat: position.coords.latitude, lon: position.coords.longitude });
        setNearby([]);
        setNearbyLoaded(false);
        setNearbyError('');
        setLocating(false);
      },
      (error) => {
        if (request !== locationRequest.current) return;
        setLocating(false);
        setLocationError(error.code === 1
          ? 'Location permission denied. Use saved stops or select a stop on the map.'
          : 'Could not determine your location. Try again, or use saved stops.');
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  };

  /**
   * The whole walk-to-the-stop gesture in one tap: where am I, which stop is
   * nearest on foot, and what is coming to it — the map opens already
   * following that arrival.
   */
  const catchNextArrival = async () => {
    if (!navigator.geolocation) {
      setLocationError('Location is unavailable in this browser. Use saved stops or select a stop on the map.');
      return;
    }
    const request = ++locationRequest.current;
    setLocationError('');
    setCatching(true);
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject,
          { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 });
      });
      const { latitude, longitude } = position.coords;
      const data = await fetchNearbyStops(latitude, longitude);
      if (request !== locationRequest.current) return;
      const nearest = data.stops[0];
      if (!nearest) {
        setLocationError('No stops within walking distance. Select a stop on the map instead.');
        return;
      }
      setCoords({ lat: latitude, lon: longitude });
      setOpen(false);
      onSelectStop(nearest, { distance: nearest.distance, autoTrack: true });
    } catch (error) {
      if (request !== locationRequest.current) return;
      setLocationError(
        error instanceof GeolocationPositionError && error.code === error.PERMISSION_DENIED
          ? 'Location permission denied. Use saved stops or select a stop on the map.'
          : 'Could not find the nearest stop. Try again, or pick a stop on the map.');
    } finally {
      if (request === locationRequest.current) setCatching(false);
    }
  };

  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => launcher.current?.focus());
  };

  if (hidden) return null;
  if (!open) return (
    <button ref={launcher} type="button" className="departures-launcher" onClick={() => setOpen(true)} aria-expanded={false}>
      <Clock size={16} aria-hidden="true" /> Departures
    </button>
  );

  return (
    <section
      className={`glass-panel departures-panel ${isMobile ? 'mobile' : ''}`}
      aria-label="Stop departures"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          close();
        }
      }}
    >
      <header className="departures-panel-header">
        <h2><Clock size={17} aria-hidden="true" /> Departures</h2>
        <button ref={closeButton} type="button" className="departures-icon-button" onClick={close} aria-label="Close departures">
          <X size={18} />
        </button>
      </header>
      <button type="button" className="arrival-now-button" onClick={catchNextArrival} disabled={catching}>
        <Zap size={14} aria-hidden="true" />
        {catching ? 'Finding the next one…' : 'Catch the next one'}
      </button>
      <div className="departures-tabs" role="group" aria-label="Departure stops">
        <button type="button" aria-pressed={tab === 'saved'} onClick={() => setTab('saved')}>Saved ({savedStops.length})</button>
        <button type="button" aria-pressed={tab === 'nearby'} onClick={() => setTab('nearby')}>Nearby</button>
      </div>
      {tab === 'nearby' && (
        <div className="departures-location">
          <button type="button" className="save-stop-button" onClick={requestLocation} disabled={locating}>
            <LocateFixed size={14} aria-hidden="true" /> {locating ? 'Finding location…' : coords ? 'Update my location' : 'Use my location'}
          </button>
          {!coords && !locationError && <p>Find stops within walking distance. Location is requested only when you press the button.</p>}
          {coords && <p>Near your requested location · {coords.lat.toFixed(3)}, {coords.lon.toFixed(3)}</p>}
          {locationError && <p role="status">{locationError}</p>}
          {nearbyError && <p className="is-stale" role="status">{nearbyError}</p>}
          {coords && !nearbyLoaded && !nearbyError && <p role="status">Finding nearby stops…</p>}
          {nearbyLoaded && isDepartureSourceStale(nearbyFetchedAt, now, Boolean(nearbyError)) && (
            <p className="is-stale">Stale nearby list · showing last known stops</p>
          )}
          {nearbyLoaded && !nearbyError && nearby.length === 0 && <p>No stops found nearby. Select a stop on the map to save it.</p>}
        </div>
      )}
      {tab === 'saved' && savedStops.length === 0 && (
        <p className="departures-message">No saved stops yet. Select a stop on the map and press “Save stop”.</p>
      )}
      {tab === 'saved' && savedStops.length > 0 && (
        <p className="departures-message">Saved on this device · up to 10 stops</p>
      )}
      <ul className="departures-stop-list">
        {stops.map((stop) => {
          const preview = previews[stop.gtfsId];
          const stale = isDepartureSourceStale(preview?.details?.fetchedAt, now, preview?.failed);
          const departures = preview?.details?.departures ?? [];
          const distance = tab === 'nearby' ? nearby.find((item) => item.gtfsId === stop.gtfsId)?.distance : undefined;
          const saved = savedStops.some((item) => item.gtfsId === stop.gtfsId);
          // Only the nearby tab knows a walking distance, and only a street
          // distance can honestly say whether the walk beats the departure.
          const verdict = stale ? undefined
            : walkVerdict(distance, nextArrivals(departures, [], now, { limit: 1 })[0]?.etaMs);
          return (
            <li key={stop.gtfsId} className="departures-stop">
              <button
                type="button"
                className="departures-stop-select"
                onClick={() => {
                  setOpen(false);
                  onSelectStop(stop, { distance });
                }}
              >
                <span className="departures-stop-head">
                  <strong className="departures-stop-name">{stop.name}</strong>
                  <span className="departures-stop-code">{stop.code || stop.gtfsId}</span>
                </span>
                {(stop.platformCode || typeof distance === 'number') && (
                  <span className="departures-stop-meta">
                    {stop.platformCode && `Platform ${stop.platformCode}`}
                    {stop.platformCode && typeof distance === 'number' && ' · '}
                    {typeof distance === 'number' && `${Math.round(distance)} m away`}
                  </span>
                )}
                {verdict && (
                  <span className={`arrival-chip outcome-${verdict.outcome}`}>
                    <Footprints size={11} aria-hidden="true" /> {walkVerdictLabel(verdict)}
                  </span>
                )}
                {!preview && <span className="departures-note">Loading departures…</span>}
                {preview?.failed && <span className="departures-note is-stale">Stale · update failed; retrying</span>}
                {preview?.details && departures.length === 0 && (
                  <span className="departures-note">{stale ? 'Stale · ' : ''}No upcoming departures</span>
                )}
                {departures.length > 0 && (
                  <span className="departure-list departures-preview-list">
                    {departures.slice(0, 2).map((departure, index) => {
                      const view = departureView(departure, now, stale);
                      return (
                        <span
                          className={`departure-item departures-preview ${view.status === 'Cancelled' ? 'is-cancelled' : ''}`}
                          key={`${departure.tripId}-${index}`}
                        >
                          <span className="departure-left">
                            <span
                              className="departure-badge"
                              style={{ backgroundColor: getRouteColor(departure.line), color: '#ffffff' }}
                            >
                              {departure.line}
                            </span>
                            <span className="departure-dest-container">
                              <span className="departure-dest">{departure.headsign || 'Unknown destination'}</span>
                            </span>
                          </span>
                          <span className="departure-right">
                            <span className="departure-time">
                              <Clock size={11} aria-hidden="true" />
                              <span>{view.time}{view.countdown && ` · ${view.countdown}`}</span>
                            </span>
                            <span className={`departure-status ${stale ? 'is-stale' : ''}`}>{view.status}</span>
                          </span>
                        </span>
                      );
                    })}
                  </span>
                )}
              </button>
              <button
                type="button"
                className="save-stop-button"
                aria-label={`${saved ? 'Remove saved stop' : 'Save stop'} ${stop.name}`}
                aria-pressed={saved}
                disabled={!saved && savedStops.length >= MAX_SAVED_STOPS}
                onClick={() => toggleStop(stop)}
              >
                {saved ? 'Remove' : 'Save'}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
