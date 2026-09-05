/* eslint-disable react-hooks/set-state-in-effect */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Search, MapPin, Navigation, X, LocateFixed, ArrowRight, Footprints, Train, Bus, TrainFront, Ship, ArrowUpDown, Loader2, ChevronDown, Minimize2 } from 'lucide-react';
import type { Alert, VehiclePosition, GeocodeResult, JourneyItinerary, JourneyLeg, JourneyEndpoint } from '../types';
import { fetchGeocode, fetchJourneyPlan, fetchJourneyMonitor } from '../lib/api';
import { useGeolocation } from '../hooks/useGeolocation';
import { findJourneyVehicle } from '../lib/journeyVehicles';
import { findRefreshedItinerary, helsinkiDateTime, itineraryIdentity, journeyLegStatus, mergeMonitoredLegs, monitoredLegIds, relevantJourneyAlerts, transferEstimates, JOURNEY_REFRESH_MS, JOURNEY_STALE_MS } from '../lib/journeyMonitor';
import './JourneyMonitor.css';

export interface JourneySelection {
  from: JourneyEndpoint;
  to: JourneyEndpoint;
  itinerary: JourneyItinerary;
}

interface JourneySearchProps {
  /** Called whenever the highlighted itinerary (or origin/destination) changes. */
  onSelectionChange: (selection: JourneySelection | null) => void;
  /** Called when the search panel opens/closes so the parent can adjust layout. */
  onOpenChange?: (open: boolean) => void;
  /** Hide the collapsed launcher (e.g. while a top-center vehicle card is shown). */
  hidden?: boolean;
  isMobile: boolean;
  alerts?: Alert[];
  vehicles?: VehiclePosition[];
  onSelectVehicle?: (vehicle: VehiclePosition) => void;
}

const CURRENT_LOCATION_LABEL = 'Current location';

function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

function formatClock(epochMs: number): string {
  return helsinkiDateTime(epochMs).time;
}

function legModeIcon(mode: string, size = 12) {
  switch (mode.toUpperCase()) {
    case 'WALK':
      return <Footprints size={size} />;
    case 'BUS':
      return <Bus size={size} />;
    case 'RAIL':
      return <TrainFront size={size} />;
    case 'SUBWAY':
      return <Train size={size} />;
    case 'FERRY':
      return <Ship size={size} />;
    default:
      return <Train size={size} />;
  }
}

function legColor(leg: JourneyLeg): string {
  if (!leg.transit) return '#94a3b8';
  const c = leg.route?.color;
  if (c) return c.startsWith('#') ? c : `#${c}`;
  switch (leg.mode.toUpperCase()) {
    case 'BUS':
      return '#007ac9';
    case 'TRAM':
      return '#00985f';
    case 'SUBWAY':
      return '#ff6319';
    case 'RAIL':
      return '#8c4799';
    case 'FERRY':
      return '#00b9e4';
    default:
      return '#00985f';
  }
}

export const JourneySearch: React.FC<JourneySearchProps> = ({ onSelectionChange, onOpenChange, hidden = false, isMobile, alerts = [], vehicles = [], onSelectVehicle }) => {
  const [open, setOpen] = useState(false);
  // When collapsed the planner shrinks to a summary bar so the highlighted route
  // stays on the map and remains visible (closing, by contrast, clears it).
  const [collapsed, setCollapsed] = useState(false);
  const { coords, status: geoStatus, request: requestGeo } = useGeolocation();

  const [from, setFrom] = useState<JourneyEndpoint | null>(null);
  const [to, setTo] = useState<JourneyEndpoint | null>(null);
  const [fromText, setFromText] = useState('');
  const [toText, setToText] = useState('');

  const [activeField, setActiveField] = useState<'from' | 'to' | null>(null);
  const [suggestions, setSuggestions] = useState<GeocodeResult[]>([]);
  const [suggestLoading, setSuggestLoading] = useState(false);

  const [itineraries, setItineraries] = useState<JourneyItinerary[]>([]);
  const [selectedItinerary, setSelectedItinerary] = useState<JourneyItinerary | null>(null);
  const selectedRef = useRef<JourneyItinerary | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [monitorLoading, setMonitorLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTime, setSearchTime] = useState(() => helsinkiDateTime(Date.now()));
  const [arriveBy, setArriveBy] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [alternativesUpdatedAt, setAlternativesUpdatedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now);
  const [unavailable, setUnavailable] = useState(false);
  const [alternativesError, setAlternativesError] = useState<string | null>(null);

  const geocodeAbortRef = useRef<AbortController | null>(null);
  const planAbortRef = useRef<AbortController | null>(null);
  const monitorAbortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const monitorGenerationRef = useRef(0);
  const endpointGenerationRef = useRef(0);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const geocodeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectionCallback = useRef(onSelectionChange);
  const toInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { selectionCallback.current = onSelectionChange; }, [onSelectionChange]);

  const cancelPending = useCallback(() => {
    generationRef.current++;
    monitorGenerationRef.current++;
    endpointGenerationRef.current++;
    geocodeAbortRef.current?.abort();
    planAbortRef.current?.abort();
    monitorAbortRef.current?.abort();
    if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    if (geocodeTimerRef.current) clearTimeout(geocodeTimerRef.current);
    setSuggestLoading(false);
    setSuggestions([]);
    setMonitorLoading(false);
  }, []);

  useEffect(() => cancelPending, [cancelPending]);

  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  // When opening, try to resolve the user's current location as the origin.
  useEffect(() => {
    if (!open) return;
    if (from) return;
    let active = true;
    const generation = endpointGenerationRef.current;
    requestGeo()
      .then((c) => {
        if (!active || generation !== endpointGenerationRef.current) return;
        setFrom({ name: CURRENT_LOCATION_LABEL, lat: c.lat, lon: c.lon });
        setFromText(CURRENT_LOCATION_LABEL);
      })
      .catch(() => {
        // Geolocation denied/unavailable — the user can type an origin instead.
      });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Focus the destination field once the panel is open.
  useEffect(() => {
    if (open && toInputRef.current) {
      toInputRef.current.focus();
    }
  }, [open]);

  // Debounced autocomplete for the active field.
  const activeQuery = activeField === 'from' ? fromText : activeField === 'to' ? toText : '';
  useEffect(() => {
    geocodeAbortRef.current?.abort();
    if (!open || collapsed || !activeField) return;
    const controller = new AbortController();
    geocodeAbortRef.current = controller;
    const q = activeQuery.trim();
    if (q.length < 2 || q === CURRENT_LOCATION_LABEL) {
      setSuggestions([]);
      setSuggestLoading(false);
      return () => controller.abort();
    }

    setSuggestLoading(true);
    const handle = setTimeout(() => {
      fetchGeocode(q, coords ?? undefined, controller.signal)
        .then((res) => {
          if (controller.signal.aborted) return;
          setSuggestions(res.results);
        })
        .catch((err) => {
          if (!controller.signal.aborted && err?.name !== 'AbortError') setSuggestions([]);
        })
        .finally(() => { if (!controller.signal.aborted) setSuggestLoading(false); });
    }, 280);
    geocodeTimerRef.current = handle;

    return () => { clearTimeout(handle); controller.abort(); };
  }, [activeQuery, activeField, coords, open, collapsed]);

  // Searching alternatives never replaces an existing selection.
  const runPlan = useCallback((f: JourneyEndpoint, t: JourneyEndpoint) => {
    planAbortRef.current?.abort();
    const generation = ++generationRef.current;
    const controller = new AbortController();
    planAbortRef.current = controller;
    setPlanLoading(true);
    setAlternativesError(null);
    fetchJourneyPlan(f, t, controller.signal, { ...searchTime, arriveBy })
      .then((res) => {
        if (controller.signal.aborted || generation !== generationRef.current) return;
        const list = res.itineraries || [];
        setItineraries(list);
        const fetchedAt = res.fetchedAt ?? Date.now();
        setAlternativesUpdatedAt(fetchedAt);
        const previous = selectedRef.current;
        if (previous) {
          if (!list.length) setAlternativesError('No alternatives found for the chosen date and time.');
          return;
        }
        const next = list[0];
        if (next) {
          selectedRef.current = next;
          setSelectedItinerary(next);
          setUpdatedAt(fetchedAt);
          setUnavailable(false);
          setError(null);
          selectionCallback.current({ from: f, to: t, itinerary: next });
        } else {
          setError('No routes found for this trip.');
        }
      })
      .catch((err) => {
        if (controller.signal.aborted || generation !== generationRef.current || err?.name === 'AbortError') return;
        setAlternativesError('Could not find alternatives. Last known results retained. Please retry.');
      })
      .finally(() => {
        // An aborted plan must not clear the loading state of the newer
        // request that superseded it.
        if (!controller.signal.aborted && generation === generationRef.current) setPlanLoading(false);
      });
  }, [searchTime, arriveBy]);

  const runMonitor = useCallback((f: JourneyEndpoint, t: JourneyEndpoint) => {
    const selected = selectedRef.current;
    if (!selected) return;
    monitorAbortRef.current?.abort();
    const generation = ++monitorGenerationRef.current;
    const controller = new AbortController();
    monitorAbortRef.current = controller;
    setMonitorLoading(true);
    const legIds = monitoredLegIds(selected);
    const request = legIds
      ? fetchJourneyMonitor(legIds, controller.signal).then(response => ({
        ...mergeMonitoredLegs(selected, response.legs),
        fetchedAt: response.fetchedAt ?? Date.now(),
      }))
      : fetchJourneyPlan(f, t, controller.signal, { ...searchTime, arriveBy }).then(response => {
        const match = findRefreshedItinerary(selected, response.itineraries);
        return {
          itinerary: match ?? selected,
          missingLegIndexes: match ? [] : selected.legs.map((_, index) => index),
          fetchedAt: response.fetchedAt ?? Date.now(),
        };
      });
    request.then(result => {
      if (controller.signal.aborted || generation !== monitorGenerationRef.current) return;
      const missing = result.missingLegIndexes.length > 0;
      selectedRef.current = result.itinerary;
      setSelectedItinerary(result.itinerary);
      selectionCallback.current({ from: f, to: t, itinerary: result.itinerary });
      setUnavailable(missing);
      if (!missing) {
        setUpdatedAt(result.fetchedAt);
        setError(null);
      } else {
        setError(itineraryIdentity(selected)
          ? 'Some selected legs are unavailable. Last known values retained; this does not mean they are cancelled. Journey estimates are stale.'
          : 'This itinerary has no reliable trip identity. Last known results retained; choose an alternative explicitly.');
      }
    }).catch(err => {
      if (controller.signal.aborted || generation !== monitorGenerationRef.current || err?.name === 'AbortError') return;
      setError('Could not refresh this journey. Last known results retained. Please retry.');
    }).finally(() => {
      if (!controller.signal.aborted && generation === monitorGenerationRef.current) setMonitorLoading(false);
    });
  }, [searchTime, arriveBy]);

  useEffect(() => {
    selectedRef.current = null;
    setSelectedItinerary(null);
    setItineraries([]);
    setUpdatedAt(null);
    setAlternativesUpdatedAt(null);
    setUnavailable(false);
    setError(null);
    setAlternativesError(null);
    setPlanLoading(false);
    selectionCallback.current(null);
    if (!open || !from || !to || !searchTime.date || !searchTime.time) return;
    runPlan(from, to);
    return cancelPending;
  }, [from, to, open, runPlan, cancelPending, searchTime.date, searchTime.time]);

  useEffect(() => {
    if (!open || !selectedItinerary) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [open, selectedItinerary]);

  useEffect(() => {
    if (!open || !selectedItinerary || !from || !to) return;
    const timer = setInterval(() => runMonitor(from, to), JOURNEY_REFRESH_MS);
    refreshTimerRef.current = timer;
    return () => clearInterval(timer);
  }, [open, selectedItinerary, from, to, runMonitor]);

  const handlePickSuggestion = (field: 'from' | 'to', s: GeocodeResult) => {
    cancelPending();
    const endpoint: JourneyEndpoint = { name: s.name || s.label, lat: s.lat, lon: s.lon };
    if (field === 'from') {
      setFrom(endpoint);
      setFromText(endpoint.name);
    } else {
      setTo(endpoint);
      setToText(endpoint.name);
    }
    setSuggestions([]);
    setActiveField(null);
  };

  const handleUseCurrentLocation = () => {
    const generation = ++endpointGenerationRef.current;
    requestGeo()
      .then((c) => {
        if (generation !== endpointGenerationRef.current) return;
        cancelPending();
        setFrom({ name: CURRENT_LOCATION_LABEL, lat: c.lat, lon: c.lon });
        setFromText(CURRENT_LOCATION_LABEL);
        setActiveField(null);
        setSuggestions([]);
      })
      .catch(() => {
        if (generation !== endpointGenerationRef.current) return;
        setError('Location unavailable. Please type a starting point.');
      });
  };

  const handleSwap = () => {
    cancelPending();
    setFrom(to);
    setTo(from);
    setFromText(toText);
    setToText(fromText);
  };

  const handleSelectItinerary = (idx: number) => {
    planAbortRef.current?.abort();
    monitorAbortRef.current?.abort();
    generationRef.current++;
    monitorGenerationRef.current++;
    setPlanLoading(false);
    setMonitorLoading(false);
    if (from && to && itineraries[idx]) {
      selectedRef.current = itineraries[idx];
      setSelectedItinerary(itineraries[idx]);
      setUpdatedAt(alternativesUpdatedAt);
      setUnavailable(false);
      setError(alternativesError ? 'Alternatives could not be refreshed. Showing last known values.' : null);
      onSelectionChange({ from, to, itinerary: itineraries[idx] });
    }
    // On mobile the expanded panel covers the map, so collapse to a summary bar
    // once a route is chosen — the highlighted route on the map becomes visible.
    if (isMobile) setCollapsed(true);
  };

  const resetAll = () => {
    cancelPending();
    setFrom(null);
    setTo(null);
    setFromText('');
    setToText('');
    setItineraries([]);
    selectedRef.current = null;
    setSelectedItinerary(null);
    setSuggestions([]);
    setActiveField(null);
    setError(null);
    onSelectionChange(null);
  };

  const handleClose = () => {
    resetAll();
    setCollapsed(false);
    setOpen(false);
  };

  const ageSeconds = updatedAt === null ? null : Math.max(0, Math.floor((now - updatedAt) / 1000));
  const stale = unavailable || !!error || updatedAt === null || now - updatedAt > JOURNEY_STALE_MS;
  const transfers = selectedItinerary ? transferEstimates(selectedItinerary) : [];
  const journeyAlerts = selectedItinerary ? relevantJourneyAlerts(selectedItinerary, alerts) : [];
  const cancelled = selectedItinerary?.legs.some(leg => journeyLegStatus(leg, false) === 'Cancelled');
  const monitorSummary = `${stale ? 'Stale · ' : ''}${ageSeconds === null ? 'Not updated yet' : `Updated ${ageSeconds}s ago`}`;

  // Compact row of mode/route chips shared by the results list and summary bar.
  const renderLegChips = (it: JourneyItinerary) => (
    <div className="journey-legs">
      {it.legs.map((leg, li) => {
        const isLast = li === it.legs.length - 1;
        return (
          <React.Fragment key={li}>
            <span
              className="journey-leg-chip"
              style={{
                backgroundColor: leg.transit ? legColor(leg) : 'transparent',
                color: leg.transit ? '#fff' : 'var(--text-secondary)',
                border: leg.transit ? 'none' : '1px dashed var(--border-button-hover)',
              }}
            >
              {legModeIcon(leg.mode)}
              {leg.transit && <span className="journey-leg-label">{leg.route?.shortName}</span>}
            </span>
            {!isLast && <span className="journey-leg-sep">›</span>}
          </React.Fragment>
        );
      })}
    </div>
  );

  if (!open) {
    if (hidden) return null;
    return (
      <button
        className="journey-launcher"
        onClick={() => { setSearchTime(helsinkiDateTime(Date.now())); setOpen(true); }}
        aria-label="Plan a journey"
      >
        <Search size={16} />
        <span>Where to?</span>
      </button>
    );
  }

  // Collapsed summary bar: keeps the route highlighted on the map while showing a
  // one-tap-to-expand summary. Closing (X) clears the journey entirely.
  if (collapsed) {
    return (
      <div className="journey-collapsed-bar">
        <button
          className="journey-collapsed-main"
          onClick={() => setCollapsed(false)}
          aria-label="Expand journey planner"
        >
          {selectedItinerary ? (
            <>
              {renderLegChips(selectedItinerary)}
              <span className="journey-collapsed-dur">{formatDuration(selectedItinerary.duration)}</span>
              <span className={`journey-monitor-summary ${stale ? 'warning' : ''}`}>
                {formatClock(selectedItinerary.endTime)} Helsinki · {monitorSummary}
                {error && ' · Update unavailable'}
                {(cancelled || transfers.some(t => t.risk !== 'normal') || journeyAlerts.length > 0) && ' · Warnings — expand'}
              </span>
              <ChevronDown size={15} className="journey-collapsed-caret" />
            </>
          ) : (
            <>
              <Search size={15} style={{ color: 'var(--accent-green)' }} />
              <span className="journey-collapsed-label">{to?.name || 'Plan a journey'}</span>
              <ChevronDown size={15} className="journey-collapsed-caret" />
            </>
          )}
        </button>
        <button className="journey-collapsed-close" onClick={handleClose} aria-label="Clear journey">
          <X size={16} />
        </button>
      </div>
    );
  }

  const renderField = (field: 'from' | 'to') => {
    const isFrom = field === 'from';
    const value = isFrom ? fromText : toText;
    const setValue = isFrom ? setFromText : setToText;
    const clearEndpoint = isFrom ? () => setFrom(null) : () => setTo(null);

    return (
      <div className="journey-field">
        <span className="journey-field-icon" style={{ color: isFrom ? 'var(--accent-green)' : 'var(--accent-coral)' }}>
          {isFrom ? <Navigation size={15} /> : <MapPin size={15} />}
        </span>
        <input
          ref={isFrom ? undefined : toInputRef}
          className="journey-input"
          type="text"
          placeholder={isFrom ? 'Choose starting point' : 'Choose destination'}
          value={value}
          onChange={(e) => {
            cancelPending();
            setValue(e.target.value);
            clearEndpoint();
          }}
          onFocus={() => setActiveField(field)}
        />
        {value && (
          <button
            className="journey-field-clear"
            aria-label="Clear"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              cancelPending();
              setValue('');
              clearEndpoint();
              setActiveField(field);
              setSuggestions([]);
            }}
          >
            <X size={13} />
          </button>
        )}
      </div>
    );
  };

  const showSuggestions = activeField !== null && (suggestions.length > 0 || suggestLoading || activeField === 'from');

  return (
    <div className={`glass-panel journey-panel ${isMobile ? 'mobile' : ''}`}>
      <div className="journey-header">
        <h2 className="journey-title">
          <Search size={15} /> Plan a journey
        </h2>
        <div className="journey-header-actions">
          <button
            className="journey-close"
            onClick={() => setCollapsed(true)}
            aria-label="Minimize journey planner"
            title="Minimize to see the map"
          >
            <Minimize2 size={15} />
          </button>
          <button className="journey-close" onClick={handleClose} aria-label="Close journey planner" title="Clear journey">
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="journey-fields">
        <div className="journey-fields-stack">
          {renderField('from')}
          {renderField('to')}
        </div>
        <button className="journey-swap" onClick={handleSwap} aria-label="Swap origin and destination" title="Swap">
          <ArrowUpDown size={14} />
        </button>
      </div>

      <div className="journey-time-controls">
        <label>
          Journey time
          <select value={arriveBy ? 'arrival' : 'departure'} onChange={e => {
            cancelPending();
            setArriveBy(e.target.value === 'arrival');
          }}>
            <option value="departure">Depart at</option>
            <option value="arrival">Arrive by</option>
          </select>
        </label>
        <label>
          Date
          <input type="date" value={searchTime.date} onChange={e => {
            cancelPending();
            setSearchTime(current => ({ ...current, date: e.target.value }));
          }} />
        </label>
        <label>
          Time
          <input type="time" value={searchTime.time} onChange={e => {
            cancelPending();
            setSearchTime(current => ({ ...current, time: e.target.value }));
          }} />
        </label>
        <span className="journey-time-zone">Europe/Helsinki · All journey times are Helsinki local time.</span>
        <button type="button" onClick={() => {
          cancelPending();
          setSearchTime(helsinkiDateTime(Date.now()));
          setArriveBy(false);
        }}>Depart now</button>
      </div>

      {/* Autocomplete suggestions */}
      {showSuggestions && (
        <div className="journey-suggestions">
          {activeField === 'from' && (
            <button className="journey-suggestion current-loc" onClick={handleUseCurrentLocation}>
              <LocateFixed size={15} style={{ color: 'var(--accent-blue)' }} />
              <span className="journey-suggestion-name">
                {geoStatus === 'locating' ? 'Locating…' : 'Use current location'}
              </span>
            </button>
          )}
          {suggestLoading && suggestions.length === 0 && (
            <div className="journey-suggestion muted">
              <Loader2 size={14} className="spin" /> Searching…
            </div>
          )}
          {suggestions.map((s) => (
            <button
              key={s.id + s.lat + s.lon}
              className="journey-suggestion"
              onClick={() => handlePickSuggestion(activeField!, s)}
            >
              <MapPin size={14} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
              <span className="journey-suggestion-text">
                <span className="journey-suggestion-name">{s.name}</span>
                {s.locality && s.locality !== s.name && (
                  <span className="journey-suggestion-locality">{s.locality}</span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Results */}
      {!showSuggestions && (
        <div className="journey-results">
          {(planLoading || monitorLoading) && (
            <div className="journey-status">
              <Loader2 size={16} className="spin" /> {selectedItinerary ? 'Refreshing predictions…' : 'Finding routes…'}
            </div>
          )}
          {error && <div className="journey-status error" role="status">{error}</div>}
          {alternativesError && <div className="journey-status error" role="status">{alternativesError}</div>}
          {from && to && searchTime.date && searchTime.time && (
            <div className="journey-monitor-actions">
              {selectedItinerary && <button className="journey-refresh" disabled={monitorLoading} onClick={() => runMonitor(from, to)}>
                Refresh predictions
              </button>}
              <button className="journey-refresh" disabled={planLoading} onClick={() => runPlan(from, to)}>
                Find alternatives
              </button>
            </div>
          )}
          {selectedItinerary && (
            <section className="journey-monitor" aria-label="Selected journey monitoring">
              <h3>Selected journey</h3>
              <p className={stale ? 'warning' : ''}>{monitorSummary} · Automatic refresh every 20s</p>
              <p>Predictions and transfer margins are estimates, not guaranteed connections.</p>
              {cancelled && <p className="warning" role="status">Cancellation reported. Check alternatives before travelling.</p>}
              {selectedItinerary.legs.map((leg, index) => {
                const vehicle = leg.transit && !stale && journeyLegStatus(leg, false) !== 'Cancelled'
                  ? findJourneyVehicle(leg, vehicles, now) : undefined;
                return (
                  <div className="journey-monitored-leg" key={index}>
                    <strong>{leg.transit ? `${leg.route?.shortName ?? leg.mode} ${leg.headsign ?? ''}` : 'Walk'}</strong>
                    {leg.transit && <span className="journey-prediction-status">{journeyLegStatus(leg, stale)}{stale && journeyLegStatus(leg, false) === 'Cancelled' ? ' · Stale' : ''}</span>}
                    <div>{leg.transit ? 'Board' : 'Leave'} {leg.from.name} · {formatClock(leg.startTime)}
                      {leg.from.platformCode && ` · Platform ${leg.from.platformCode}`}
                    </div>
                    <div>Arrive {leg.to.name} · {formatClock(leg.endTime)}
                      {helsinkiDateTime(leg.endTime).date !== helsinkiDateTime(leg.startTime).date && ` (${helsinkiDateTime(leg.endTime).date})`}
                      {leg.to.platformCode && ` · Platform ${leg.to.platformCode}`}
                    </div>
                    {leg.transit && (vehicle && onSelectVehicle
                      ? <button onClick={() => onSelectVehicle(vehicle)}>Show this live vehicle</button>
                      : <small>No reliable live vehicle match{stale ? ' while predictions are stale' : ' — the exact trip may not be reporting yet'}.</small>)}
                  </div>
                );
              })}
              {transfers.map(transfer => (
                <p key={transfer.legIndex} className={transfer.risk !== 'normal' ? 'warning' : ''}>
                  Connection to {selectedItinerary.legs[transfer.legIndex].route?.shortName ?? selectedItinerary.legs[transfer.legIndex].mode}: {transfer.message}
                </p>
              ))}
              {journeyAlerts.length > 0 && <h4>Alerts affecting this journey</h4>}
              {journeyAlerts.map((alert, index) => (
                <div className="journey-alert warning" key={index}>
                  <strong>{alert.headerText}</strong>
                  <p>{alert.descriptionText}</p>
                </div>
              ))}
            </section>
          )}
          {!planLoading && !error && itineraries.length === 0 && (
            <div className="journey-status muted">
              Pick a destination to see routes that take you there.
            </div>
          )}
          {itineraries.length > 0 && <h3 className="journey-alternatives-title">Choose an itinerary</h3>}
          {itineraries.map((it, idx) => {
              const transitLegs = it.legs.filter((l) => l.transit);
              return (
                <button
                  key={idx}
                  className={`journey-itinerary ${it === selectedItinerary || (selectedItinerary && itineraryIdentity(it) && itineraryIdentity(it) === itineraryIdentity(selectedItinerary)) ? 'active' : ''}`}
                  onClick={() => handleSelectItinerary(idx)}
                >
                  <div className="journey-itinerary-top">
                    <span className="journey-itinerary-time">
                      {formatClock(it.startTime)} <ArrowRight size={11} /> {formatClock(it.endTime)}
                    </span>
                    <span className="journey-itinerary-duration">{formatDuration(it.duration)}</span>
                  </div>
                  {renderLegChips(it)}
                  {transitLegs.length > 0 && (
                    <div className="journey-itinerary-meta">
                      Board at <strong>{transitLegs[0].from.name}</strong>
                      {it.transfers > 0 && ` · ${it.transfers} transfer${it.transfers > 1 ? 's' : ''}`}
                    </div>
                  )}
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
};
