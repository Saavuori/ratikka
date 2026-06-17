/* eslint-disable react-hooks/set-state-in-effect */
import React, { useEffect, useState } from 'react';
import type { StopDetailsResponse } from '../types';
import { fetchStopDetails } from '../lib/api';
import { X, Clock, AlertTriangle, Loader2, ChevronLeft, ChevronRight, ChevronDown, ChevronUp } from 'lucide-react';

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
}) => {
  const [details, setDetails] = useState<StopDetailsResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);

    fetchStopDetails(stopId, 8)
      .then((data) => {
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
        console.error(err);
        setError('Failed to load stop timetable');
        setLoading(false);
      });
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
    <div className={`glass-panel detail-popup ${isCollapsed ? 'collapsed' : ''}`}>
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
      <div className="panel-header" style={{ padding: '0 0 16px 0' }}>
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
        <button onClick={onClose} className="close-btn">
          <X size={18} />
        </button>
      </div>

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
