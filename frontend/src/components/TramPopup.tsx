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
          <div style={{
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            backgroundColor: 'rgba(16, 185, 129, 0.15)',
            border: '1.5px solid var(--accent-green)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.15rem',
            fontWeight: 800,
            color: '#34d399'
          }}>
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
        {!loading && !error && tripDetails && (
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
                  return (
                    <div key={idx} className="timeline-item">
                      <span className="timeline-dot" />

                      <div className="timeline-stop-info">
                        <h4 className="timeline-stop-name">
                          {stop.name}
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
        )}
      </div>
    </div>
  );
};
