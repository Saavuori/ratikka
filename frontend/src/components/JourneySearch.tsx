/* eslint-disable react-hooks/set-state-in-effect */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Search, MapPin, Navigation, X, LocateFixed, ArrowRight, Footprints, Train, Bus, TrainFront, Ship, ArrowUpDown, Loader2, ChevronDown, Minimize2 } from 'lucide-react';
import type { GeocodeResult, JourneyItinerary, JourneyLeg, JourneyEndpoint } from '../types';
import { fetchGeocode, fetchJourneyPlan } from '../lib/api';
import { useGeolocation } from '../hooks/useGeolocation';

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
  const d = new Date(epochMs);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
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

export const JourneySearch: React.FC<JourneySearchProps> = ({ onSelectionChange, onOpenChange, hidden = false, isMobile }) => {
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
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [planLoading, setPlanLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const geocodeAbortRef = useRef<AbortController | null>(null);
  const planAbortRef = useRef<AbortController | null>(null);
  const toInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  // When opening, try to resolve the user's current location as the origin.
  useEffect(() => {
    if (!open) return;
    if (from) return;
    requestGeo()
      .then((c) => {
        setFrom({ name: CURRENT_LOCATION_LABEL, lat: c.lat, lon: c.lon });
        setFromText(CURRENT_LOCATION_LABEL);
      })
      .catch(() => {
        // Geolocation denied/unavailable — the user can type an origin instead.
      });
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
    if (!activeField) return;
    const q = activeQuery.trim();
    if (q.length < 2 || q === CURRENT_LOCATION_LABEL) {
      setSuggestions([]);
      setSuggestLoading(false);
      return;
    }

    setSuggestLoading(true);
    const handle = setTimeout(() => {
      geocodeAbortRef.current?.abort();
      const controller = new AbortController();
      geocodeAbortRef.current = controller;
      fetchGeocode(q, coords ?? undefined, controller.signal)
        .then((res) => {
          setSuggestions(res.results);
        })
        .catch((err) => {
          if (err?.name !== 'AbortError') setSuggestions([]);
        })
        .finally(() => setSuggestLoading(false));
    }, 280);

    return () => clearTimeout(handle);
  }, [activeQuery, activeField, coords]);

  // Plan a journey whenever both endpoints are resolved.
  const runPlan = useCallback((f: JourneyEndpoint, t: JourneyEndpoint) => {
    planAbortRef.current?.abort();
    const controller = new AbortController();
    planAbortRef.current = controller;
    setPlanLoading(true);
    setError(null);
    fetchJourneyPlan(f, t, controller.signal)
      .then((res) => {
        const list = res.itineraries || [];
        setItineraries(list);
        setSelectedIdx(0);
        if (list.length === 0) {
          setError('No routes found for this trip.');
          onSelectionChange(null);
        } else {
          onSelectionChange({ from: f, to: t, itinerary: list[0] });
        }
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return;
        setError('Could not plan this journey. Please try again.');
        setItineraries([]);
        onSelectionChange(null);
      })
      .finally(() => setPlanLoading(false));
  }, [onSelectionChange]);

  useEffect(() => {
    if (from && to) {
      runPlan(from, to);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  const handlePickSuggestion = (field: 'from' | 'to', s: GeocodeResult) => {
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
    requestGeo()
      .then((c) => {
        setFrom({ name: CURRENT_LOCATION_LABEL, lat: c.lat, lon: c.lon });
        setFromText(CURRENT_LOCATION_LABEL);
        setActiveField(null);
        setSuggestions([]);
      })
      .catch(() => {
        setError('Location unavailable. Please type a starting point.');
      });
  };

  const handleSwap = () => {
    setFrom(to);
    setTo(from);
    setFromText(toText);
    setToText(fromText);
  };

  const handleSelectItinerary = (idx: number) => {
    setSelectedIdx(idx);
    if (from && to && itineraries[idx]) {
      onSelectionChange({ from, to, itinerary: itineraries[idx] });
    }
    // On mobile the expanded panel covers the map, so collapse to a summary bar
    // once a route is chosen — the highlighted route on the map becomes visible.
    if (isMobile) setCollapsed(true);
  };

  const resetAll = () => {
    setFrom(null);
    setTo(null);
    setFromText('');
    setToText('');
    setItineraries([]);
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

  const selectedItinerary = itineraries[selectedIdx] ?? null;

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
        onClick={() => setOpen(true)}
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
          {planLoading && (
            <div className="journey-status">
              <Loader2 size={16} className="spin" /> Finding the best routes…
            </div>
          )}
          {!planLoading && error && <div className="journey-status error">{error}</div>}
          {!planLoading && !error && itineraries.length === 0 && (
            <div className="journey-status muted">
              Pick a destination to see routes that take you there.
            </div>
          )}
          {!planLoading &&
            itineraries.map((it, idx) => {
              const transitLegs = it.legs.filter((l) => l.transit);
              return (
                <button
                  key={idx}
                  className={`journey-itinerary ${idx === selectedIdx ? 'active' : ''}`}
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
