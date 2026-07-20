import React, { useEffect, useState } from 'react';
import type { StopDetailsResponse, Alert } from '../types';
import { useCollapsiblePanel } from '../hooks/useCollapsiblePanel';
import { fetchStopDetails } from '../lib/api';
import { X, Clock, AlertTriangle, Loader2, ChevronRight, ExternalLink } from 'lucide-react';

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

  const collapseProps = useCollapsiblePanel(isCollapsed, onToggleCollapse, 'Show stop timetable');

  const relevantAlerts = alerts.filter(alert =>
    alert.entities?.some(entity =>
      (entity.type === 'Stop' && entity.gtfsId === stopId) ||
      (entity.type === 'Route' && details && details.routes?.includes(entity.shortName || ''))
    )
  );

  useEffect(() => {
    let active = true;

    // Only the first load shows the spinner; refreshes swap the times in place.
    const load = (isInitial: boolean) => {
      if (isInitial) {
        setLoading(true);
        setError(null);
      }

      fetchStopDetails(stopId, 8)
        .then((data) => {
          if (!active) return;
          setDetails(data);
          setLoading(false);
          setError(null);
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
          // A failed refresh keeps the last good timetable on screen.
          if (isInitial) {
            setError('Failed to load stop timetable');
          }
          setLoading(false);
        });
    };

    load(true);
    // Departure times go stale fast — a static list is worse than no list.
    const interval = setInterval(() => load(false), 30000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [stopId, onStopDeparturesLoaded, onStopRoutesLoaded, onStopCoordsLoaded]);

  const getDelayColor = (seconds: number) => {
    if (seconds > 60) return '#f87171';
    if (seconds < -60) return '#38bdf8';
    return '#34d399';
  };

  const formatDelay = (seconds: number) => {
    if (Math.abs(seconds) < 30) return 'On time';
    const mins = Math.round(Math.abs(seconds) / 60);
    return seconds < 0 ? `${mins}m early` : `${mins}m late`;
  };

  return (
    <div
      {...collapseProps}
      className={`glass-panel detail-popup ${collapseProps.className}`}
      style={{ pointerEvents: 'auto' }}
    >
      {/* Header */}
      <div className="panel-header" style={{ padding: '0 0 16px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h2 style={{ fontSize: '0.85rem', fontWeight: 700, margin: 0 }}>{stopName}</h2>
            {stopCode && (
              <span style={{ fontSize: '0.65rem', backgroundColor: 'var(--surface-raised)', border: '1px solid var(--border-subtle)', padding: '2px 6px', borderRadius: '4px', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
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
            <ChevronRight size={16} />
          </button>
        )}
        <button onClick={onClose} className="close-btn">
          <X size={18} />
        </button>
      </div>

      {/* Service Alert Warnings */}
      {relevantAlerts.length > 0 && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          marginTop: '6px',
          marginBottom: '10px'
        }}>
          {relevantAlerts.map((alert, idx) => {
            const severityColor =
              alert.severityLevel === 'SEVERE'
                ? '#ef4444'
                : alert.severityLevel === 'WARNING'
                ? '#f59e0b'
                : '#3b82f6';
            return (
              <div
                key={idx}
                style={{
                  background: 'rgba(239, 68, 68, 0.04)',
                  border: '1px solid rgba(239, 68, 68, 0.12)',
                  borderLeft: `3px solid ${severityColor}`,
                  padding: '8px 10px',
                  borderRadius: '6px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '8px',
                }}
              >
                <AlertTriangle size={14} style={{ color: severityColor, flexShrink: 0, marginTop: '2px' }} />
                <div style={{ flex: 1 }}>
                  <h4 style={{ margin: 0, fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-strong)' }}>
                    {alert.headerText}
                  </h4>
                  <p style={{ margin: '2px 0 0 0', fontSize: '0.6rem', color: 'var(--text-secondary)', lineHeight: 1.3 }}>
                    {alert.descriptionText}
                  </p>
                  {alert.url && (
                    <a
                      href={alert.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '2px',
                        color: '#38bdf8',
                        textDecoration: 'none',
                        marginTop: '4px',
                        fontWeight: 600,
                        fontSize: '0.55rem',
                      }}
                    >
                      Official Info <ExternalLink size={8} />
                    </a>
                  )}
                </div>
              </div>
            );
          })}
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
                <span key={route} className="route-chip">
                  {route}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Loading Spinner */}
        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 0', gap: '12px', color: 'var(--text-secondary)' }}>
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
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', padding: '24px 0', textAlign: 'center' }}>
                No departures scheduled at this stop
              </div>
            ) : (
              <div className="departure-list">
                {details.departures.map((dep, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      if (dep.tripId) onSelectTripId(dep.tripId, dep.line);
                    }}
                    disabled={!dep.tripId}
                    aria-label={`Line ${dep.line} to ${dep.headsign || 'unknown destination'}, ${dep.realtimeArrival}`}
                    className="departure-item"
                  >
                    <div className="departure-left">
                      <div className="departure-badge">
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
                        <Clock size={12} style={{ color: 'var(--text-muted)' }} />
                        <span>{dep.realtimeArrival}</span>
                      </div>
                      <span className="timeline-delay" style={{ fontSize: '0.65rem', marginTop: '2px', display: 'block', color: getDelayColor(dep.delay) }}>
                        {formatDelay(dep.delay)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
