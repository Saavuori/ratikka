import React, { useEffect, useState } from 'react';
import type { VehiclePosition, TripDetailsResponse } from '../types';
import { fetchTripDetails } from '../lib/api';
import { X, Clock, Navigation, AlertTriangle, Loader2 } from 'lucide-react';

interface TramPopupProps {
  tram: VehiclePosition;
  onClose: () => void;
}

export const TramPopup: React.FC<TramPopupProps> = ({ tram, onClose }) => {
  const [tripDetails, setTripDetails] = useState<TripDetailsResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tram.tripId) {
      setError('Trip ID not available for this vehicle');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    fetchTripDetails(tram.tripId)
      .then((data) => {
        setTripDetails(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setError('Failed to load schedule details');
        setLoading(false);
      });
  }, [tram.tripId]);

  const formatDelay = (seconds: number) => {
    if (seconds === 0) return 'On time';
    const mins = Math.round(Math.abs(seconds) / 60);
    return seconds < 0 ? `${mins} min early` : `${mins} min late`;
  };

  const getDelayColor = (seconds: number) => {
    if (seconds > 60) return 'text-rose-400';
    if (seconds < -60) return 'text-sky-400';
    return 'text-emerald-400';
  };

  return (
    <div className="glass-panel detail-popup">
      {/* Top Banner */}
      <div className="panel-header" style={{ padding: '0 0 16px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div className="desi-circle">
            {tram.desi}
          </div>
          <div>
            <h2 style={{ fontSize: '0.85rem', fontWeight: 700, margin: 0 }}>Tram #{tram.veh}</h2>
            <p className="panel-subtitle">
              {tripDetails?.route.longName || 'Fetching route details...'}
            </p>
          </div>
        </div>
        <button onClick={onClose} className="close-btn">
          <X size={18} />
        </button>
      </div>

      {/* Body Content */}
      <div className="timeline-container" style={{ flex: 1, marginTop: '16px' }}>
        {/* Real-time telemetry cards */}
        <div className="metric-grid">
          <div className="metric-card">
            <span className="metric-label">Speed</span>
            <span className="metric-val">
              <Navigation size={14} style={{ transform: 'rotate(90deg)', color: '#94a3b8' }} />
              {Math.round(tram.spd * 3.6)} km/h
            </span>
          </div>

          <div className="metric-card">
            <span className="metric-label">Schedule Offset</span>
            <span className={`metric-val ${getDelayColor(tram.dl)}`}>
              <Clock size={14} />
              {formatDelay(tram.dl)}
            </span>
          </div>
        </div>


        {/* Next Stop Info Callout */}
        {!loading && !error && tripDetails && (() => {
          const currentIndex = tripDetails.stops.findIndex(s => s.gtfsId === tram.stop);
          const currentStop = currentIndex !== -1 ? tripDetails.stops[currentIndex] : null;
          const isStopped = tram.drst === 1 || tram.spd === 0;

          if (!currentStop) return null;

          if (isStopped) {
            const nextStop = currentIndex + 1 < tripDetails.stops.length ? tripDetails.stops[currentIndex + 1] : null;
            return (
              <div className="next-stop-callout stopped">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{ fontSize: '0.65rem', textTransform: 'uppercase', fontWeight: 800, color: '#f59e0b', display: 'block', letterSpacing: '0.05em' }}>Current Stop</span>
                    <span style={{ fontSize: '0.9rem', fontWeight: 800, color: '#f1f5f9' }}>{currentStop.name}</span>
                  </div>
                  <span style={{
                    fontSize: '0.65rem',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    backgroundColor: 'rgba(245, 158, 11, 0.15)',
                    border: '1px solid #f59e0b',
                    color: '#fbbf24',
                    textTransform: 'uppercase',
                    fontWeight: 'bold'
                  }}>Stopped</span>
                </div>

                {nextStop && (
                  <div className="next-stop-sub">
                    <div>
                      <span style={{ fontSize: '0.65rem', textTransform: 'uppercase', fontWeight: 800, color: 'var(--accent-green)', display: 'block', letterSpacing: '0.05em' }}>Next Stop</span>
                      <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#cbd5e1' }}>{nextStop.name}</span>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: '0.65rem', textTransform: 'uppercase', fontWeight: 700, color: '#94a3b8', display: 'block' }}>ETA</span>
                      <span style={{ fontSize: '1.0rem', fontWeight: 800, color: 'var(--accent-green)' }}>{nextStop.realtimeArrival}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          } else {
            return (
              <div className="next-stop-callout moving">
                <div>
                  <span style={{ fontSize: '0.65rem', textTransform: 'uppercase', fontWeight: 800, color: 'var(--accent-green)', display: 'block', letterSpacing: '0.05em' }}>Next Stop</span>
                  <span style={{ fontSize: '0.9rem', fontWeight: 800, color: '#f1f5f9' }}>{currentStop.name}</span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontSize: '0.65rem', textTransform: 'uppercase', fontWeight: 700, color: '#94a3b8', display: 'block' }}>ETA</span>
                  <span style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--accent-green)' }}>{currentStop.realtimeArrival}</span>
                </div>
              </div>
            );
          }
        })()}

        {/* Loading Spinner */}
        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 0', gap: '12px', color: '#94a3b8' }}>
            <Loader2 className="animate-spin" style={{ color: '#34d399' }} size={24} />
            <span style={{ fontSize: '0.75rem' }}>Querying trip arrivals...</span>
          </div>
        )}

        {/* Error Fallback */}
        {error && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 0', gap: '8px', color: '#ef4444', textAlign: 'center' }}>
            <AlertTriangle size={24} />
            <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>{error}</span>
          </div>
        )}

        {/* Stops timeline */}
        {!loading && !error && tripDetails && (() => {
          const currentIndex = tripDetails.stops.findIndex(s => s.gtfsId === tram.stop);
          const isStopped = tram.drst === 1 || tram.spd === 0;

          let currentStopIndex = -1;
          let nextStopIndex = -1;

          if (currentIndex !== -1) {
            if (isStopped) {
              currentStopIndex = currentIndex;
              nextStopIndex = currentIndex + 1 < tripDetails.stops.length ? currentIndex + 1 : -1;
            } else {
              nextStopIndex = currentIndex;
            }
          }

          return (
            <div>
              <div className="legend-title" style={{ marginBottom: '12px' }}>
                Route Stop Schedule ({tripDetails.headsign ? `to ${tripDetails.headsign}` : 'Ongoing'})
              </div>

              {tripDetails.stops.length === 0 ? (
                <div style={{ fontSize: '0.75rem', color: '#64748b', padding: '16px 0', textAlign: 'center' }}>
                  No stop times available for this trip
                </div>
              ) : (
                <div className="timeline-list">
                  {tripDetails.stops.map((stop, idx) => {
                    const isPassed = currentIndex !== -1 && (isStopped ? idx < currentStopIndex : idx < nextStopIndex);
                    const isCurrent = idx === currentStopIndex;
                    const isNext = idx === nextStopIndex;

                    let itemClass = "timeline-item";
                    if (isPassed) itemClass += " passed";
                    else if (isCurrent) itemClass += " active current";
                    else if (isNext) itemClass += " active next";
                    else itemClass += " upcoming";

                    return (
                      <div key={idx} className={itemClass}>
                        <span className="timeline-dot" />

                        <div className="timeline-stop-info">
                          <h4 className="timeline-stop-name">
                            {stop.name}
                            {isCurrent && (
                              <span className="stop-status-badge current">Stopped</span>
                            )}
                            {isNext && (
                              <span className="stop-status-badge next">Next</span>
                            )}
                          </h4>
                          <span className="timeline-stop-code">
                            Code: {stop.code || 'N/A'}
                          </span>
                        </div>
                        <div className="timeline-time-info">
                          <span className="timeline-time">
                            {stop.realtimeArrival}
                          </span>
                          {stop.delay !== 0 && (
                            <span className={`timeline-delay ${getDelayColor(stop.delay)}`}>
                              {stop.delay < 0 ? '-' : '+'}{Math.round(Math.abs(stop.delay) / 60)} min
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
};
