/* eslint-disable react-hooks/set-state-in-effect */
import React, { useEffect, useState } from 'react';
import type { StopDetailsResponse, Alert } from '../types';
import { fetchStopDetails } from '../lib/api';
import { getRouteColor } from '../lib/routeColors';
import { relevantStopAlerts } from '../lib/stopAlerts';
import { X, Clock, AlertTriangle, Loader2, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { useIsMobile } from '../hooks/useIsMobile';

interface StopPopupProps {
  stopId: string;
  stopName: string;
  stopCode: string;
  onClose: () => void;
  onSelectTripId: (tripId: string, lineDesi: string) => void;
  onStopDeparturesLoaded?: (tripIds: string[]) => void;
  onStopRoutesLoaded?: (routes: string[]) => void;
  onStopCoordsLoaded?: (lat: number, lng: number) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  alerts: Alert[];
}

export const StopPopup: React.FC<StopPopupProps> = ({
  stopId,
  stopName,
  stopCode,
  onClose,
  onSelectTripId,
  onStopDeparturesLoaded,
  onStopRoutesLoaded,
  onStopCoordsLoaded,
  isCollapsed,
  onToggleCollapse,
  alerts = [],
}) => {
  const [details, setDetails] = useState<StopDetailsResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  // The timetable is what the panel is for, so alerts stay folded away until
  // asked for — a stop served by many routes can otherwise collect enough of
  // them to fill the panel on its own.
  const [alertsExpanded, setAlertsExpanded] = useState<boolean>(false);
  const isMobile = useIsMobile();

  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStart(e.touches[0].clientX);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStart === null) return;
    const currentX = e.touches[0].clientX;
    const diff = currentX - touchStart;

    // Swipe left (at least 45px) to expand (on the right panel)
    if (diff < -45 && isCollapsed) {
      onToggleCollapse();
      setTouchStart(null);
    }
    // Swipe right (at least 45px) to collapse (on the right panel)
    else if (diff > 45 && !isCollapsed) {
      onToggleCollapse();
      setTouchStart(null);
    }
  };

  const handleTouchEnd = () => {
    setTouchStart(null);
  };

  // Sorted worst-first, so the head of the list sets the summary's colour.
  const relevantAlerts = relevantStopAlerts(alerts, stopId, details?.routes);
  const worstSeverity = relevantAlerts[0]?.severityLevel ?? 'INFO';

  useEffect(() => {
    // Guard against a slow response for a previously selected stop landing
    // after this one and overwriting both local state and the parent's
    // route/coordinate state with the wrong stop's data.
    let active = true;
    setLoading(true);
    setError(null);
    setAlertsExpanded(false);

    fetchStopDetails(stopId, 8)
      .then((data) => {
        if (!active) return;
        setDetails(data);
        setLoading(false);
        if (onStopDeparturesLoaded) {
          const tripIds = data.departures.map((d) => d.tripId).filter(Boolean);
          onStopDeparturesLoaded(tripIds);
        }
        if (onStopRoutesLoaded) {
          onStopRoutesLoaded(data.routes || []);
        }
        if (onStopCoordsLoaded && data.stop) {
          onStopCoordsLoaded(data.stop.lat, data.stop.lon);
        }
      })
      .catch((err) => {
        if (!active) return;
        console.error(err);
        setError('Failed to load stop timetable');
        setLoading(false);
      });

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- callbacks are stable enough; re-fetch only when the stop changes
  }, [stopId]);

  const getDelayColor = (seconds: number) => {
    if (seconds > 60) return 'text-rose-400';
    if (seconds < -60) return 'text-sky-400';
    return 'text-emerald-400';
  };

  const formatDelay = (seconds: number) => {
    if (Math.abs(seconds) < 30) return 'On time';
    const mins = Math.round(Math.abs(seconds) / 60);
    return seconds < 0 ? `${mins}m early` : `${mins}m late`;
  };

  return (
    <div
      className={`glass-panel detail-popup ${isCollapsed ? 'collapsed' : ''}`}
      style={{ pointerEvents: 'auto' }}
      onTouchStart={isMobile ? undefined : handleTouchStart}
      onTouchMove={isMobile ? undefined : handleTouchMove}
      onTouchEnd={isMobile ? undefined : handleTouchEnd}
      onClick={() => {
        if (isCollapsed) {
          onToggleCollapse();
        }
      }}
    >
      {/* Drag handle affordance (mobile bottom-sheet only) */}
      <div className="sheet-handle" onClick={() => !isCollapsed && onToggleCollapse()} />

      {/* Collapse/Expand Toggle Tab */}
      <button
        className="detail-toggle-tab"
        onClick={onToggleCollapse}
        aria-label={isCollapsed ? 'Show Timetable' : 'Hide Timetable'}
      >
        <span className="icon-desktop">
          {isCollapsed ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
        </span>
        <span className="icon-mobile">
          {isCollapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      </button>
      {/* Header */}
      <div className="panel-header" style={{ padding: '0 0 16px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h2 style={{ fontSize: '0.85rem', fontWeight: 700, margin: 0 }}>{stopName}</h2>
            {stopCode && (
              <span style={{ fontSize: '0.65rem', backgroundColor: 'rgba(30, 41, 59, 0.6)', border: '1px solid rgba(255, 255, 255, 0.08)', padding: '2px 6px', borderRadius: '4px', color: '#94a3b8', fontFamily: 'monospace' }}>
                {stopCode}
              </span>
            )}
          </div>
          <p className="panel-subtitle" style={{ fontFamily: 'monospace', marginTop: '4px', fontSize: '0.65rem' }}>
            {stopId}
          </p>
        </div>
        {!isCollapsed && (
          <button
            onClick={onToggleCollapse}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
              outline: 'none',
            }}
            aria-label="Collapse panel"
          >
            {isMobile ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        )}
        <button onClick={onClose} className="close-btn">
          <X size={18} />
        </button>
      </div>

      {/* Service alerts — a one-line summary that expands into a scrollable
          list, so the timetable below always keeps its share of the panel. */}
      {relevantAlerts.length > 0 && (
        <div className="stop-alerts">
          <button
            className={`stop-alerts-summary severity-${worstSeverity.toLowerCase()}`}
            onClick={() => setAlertsExpanded((v) => !v)}
            aria-expanded={alertsExpanded}
          >
            <AlertTriangle size={14} className="stop-alerts-icon" />
            <span className="stop-alerts-count">
              {relevantAlerts.length === 1
                ? '1 service alert'
                : `${relevantAlerts.length} service alerts`}
            </span>
            {!alertsExpanded && (
              <span className="stop-alerts-preview">{relevantAlerts[0].headerText}</span>
            )}
            {alertsExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>

          {alertsExpanded && (
            <div className="stop-alerts-list">
              {relevantAlerts.map((alert, idx) => (
                <div key={idx} className={`stop-alert severity-${alert.severityLevel.toLowerCase()}`}>
                  <h4 className="stop-alert-title">{alert.headerText}</h4>
                  {alert.descriptionText && (
                    <p className="stop-alert-desc">{alert.descriptionText}</p>
                  )}
                  {alert.url && (
                    <a
                      href={alert.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="stop-alert-link"
                    >
                      Official Info <ExternalLink size={8} />
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Body */}
      <div className="timeline-container" style={{ flex: 1, marginTop: '16px' }}>
        {/* Routes serving stop */}
        {details && details.routes && details.routes.length > 0 && (
          <div>
            <div className="legend-title">Lines serving this stop</div>
            <div className="routes-chips">
              {details.routes.map((route) => (
                <span
                  key={route}
                  className="route-chip"
                  style={{ backgroundColor: getRouteColor(route), borderColor: getRouteColor(route), color: '#ffffff' }}
                >
                  {route}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Loading Spinner */}
        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 0', gap: '12px', color: '#94a3b8' }}>
            <Loader2 className="animate-spin" style={{ color: '#34d399' }} size={24} />
            <span style={{ fontSize: '0.75rem' }}>Loading timetable...</span>
          </div>
        )}

        {/* Error Fallback */}
        {error && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 0', gap: '8px', color: '#ef4444', textAlign: 'center' }}>
            <AlertTriangle size={24} />
            <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>{error}</span>
          </div>
        )}

        {/* Departures List */}
        {!loading && !error && details && (
          <div>
            <div className="legend-title" style={{ marginBottom: '8px' }}>Upcoming Departures</div>

            {details.departures.length === 0 ? (
              <div style={{ fontSize: '0.75rem', color: '#64748b', padding: '24px 0', textAlign: 'center' }}>
                No departures scheduled at this stop
              </div>
            ) : (
              <div className="departure-list">
                {details.departures.map((dep, idx) => (
                  <div
                    key={idx}
                    onClick={() => {
                      if (dep.tripId) onSelectTripId(dep.tripId, dep.line);
                    }}
                    className="departure-item"
                  >
                    <div className="departure-left">
                      <div className="departure-badge" style={{ backgroundColor: getRouteColor(dep.line), color: '#ffffff' }}>
                        {dep.line}
                      </div>
                      <div className="departure-dest-container">
                        <h4 className="departure-dest">
                          {dep.headsign || 'Unknown Destination'}
                        </h4>
                      </div>
                    </div>
                    <div className="departure-right">
                      <div className="departure-time">
                        <Clock size={12} style={{ color: '#64748b' }} />
                        <span>{dep.realtimeArrival}</span>
                      </div>
                      <span className={`timeline-delay ${getDelayColor(dep.delay)}`} style={{ fontSize: '0.65rem', marginTop: '2px', display: 'block' }}>
                        {formatDelay(dep.delay)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
