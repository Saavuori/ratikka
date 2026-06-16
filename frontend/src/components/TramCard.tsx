import React, { useState, useEffect } from 'react';
import type { VehiclePosition, TripDetailsResponse } from '../types';
import { Navigation, Clock, X, Target } from 'lucide-react';
import { fetchTripDetails } from '../lib/api';

interface TramCardProps {
  tram: VehiclePosition;
  mapBearing: number;
  onClose: () => void;
  isFollowing: boolean;
  onToggleFollow: () => void;
}

export const TramCard: React.FC<TramCardProps> = ({ tram, mapBearing, onClose, isFollowing, onToggleFollow }) => {
  const speedKmh = Math.round(tram.spd * 3.6);
  const [tripDetails, setTripDetails] = useState<TripDetailsResponse | null>(null);
  const [lastStopId, setLastStopId] = useState<string | null>(null);

  useEffect(() => {
    if (tram.stop) {
      setLastStopId(tram.stop);
    }
  }, [tram.stop]);

  useEffect(() => {
    if (!tram.tripId) {
      setTripDetails(null);
      return;
    }
    fetchTripDetails(tram.tripId)
      .then((data) => {
        setTripDetails(data);
      })
      .catch((err) => {
        console.error('Failed to load schedule for top card:', err);
      });
  }, [tram.tripId]);

  const getDelayColor = (seconds: number): string => {
    if (seconds > 60) return '#f87171';
    if (seconds < -60) return '#38bdf8';
    return '#34d399';
  };

  const formatDelay = (seconds: number): string => {
    if (Math.abs(seconds) < 15) return 'On time';
    const mins = Math.round(Math.abs(seconds) / 60);
    if (mins === 0) return 'On time';
    return seconds < 0 ? `${mins} min early` : `${mins} min late`;
  };

  const getStopIndices = () => {
    if (!tripDetails) return { currentStopIndex: -1, nextStopIndex: -1, lastKnownIndex: -1 };

    const isStopped = tram.drst === 1;
    const stopIdToMatch = tram.stop || lastStopId;
    let lastKnownIndex = tripDetails.stops.findIndex(s => s.gtfsId === stopIdToMatch);

    if (lastKnownIndex === -1) {
      const now = new Date();
      const currentMinutes = now.getHours() * 60 + now.getMinutes();
      const nextIndex = tripDetails.stops.findIndex(stop => {
        const [h, m] = stop.realtimeArrival.split(':').map(Number);
        const stopMinutes = h * 60 + m;
        return stopMinutes >= currentMinutes;
      });

      if (nextIndex !== -1) {
        lastKnownIndex = nextIndex > 0 ? nextIndex - 1 : 0;
      } else {
        lastKnownIndex = tripDetails.stops.length - 1;
      }
    }

    if (isStopped) {
      const currentStopIndex = lastKnownIndex;
      const nextStopIndex = lastKnownIndex + 1 < tripDetails.stops.length ? lastKnownIndex + 1 : -1;
      return { currentStopIndex, nextStopIndex, lastKnownIndex };
    } else {
      const nextStopIndex = lastKnownIndex + 1 < tripDetails.stops.length ? lastKnownIndex + 1 : lastKnownIndex;
      return { currentStopIndex: -1, nextStopIndex, lastKnownIndex };
    }
  };

  const { currentStopIndex, nextStopIndex } = getStopIndices();
  const isStopped = tram.drst === 1;
  const currentStop = isStopped && currentStopIndex !== -1 ? tripDetails?.stops[currentStopIndex] : null;
  const nextStop = nextStopIndex !== -1 ? tripDetails?.stops[nextStopIndex] : null;

  const hasStopInfo = !!(tripDetails && (currentStop || nextStop));

  return (
    <div 
      className="tram-card-overlay" 
      style={hasStopInfo ? {
        borderRadius: '14px',
        padding: '6px 12px',
        gap: '10px'
      } : {}}
    >
      {/* Line number badge */}
      <div className="tram-card-desi">{tram.desi}</div>

      <div className="tram-card-divider" />

      {/* Middle stack: Metrics on top, Stop info on bottom */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '130px', maxWidth: '180px' }}>
        {/* Metrics row */}
        <div className="tram-card-metrics" style={{ gap: '8px' }}>
          <div className="tram-card-metric">
            <Navigation size={12} style={{ color: '#94a3b8', transform: `rotate(${tram.hdg - mapBearing - 45}deg)`, transition: 'transform 0.2s ease' }} />
            <span className="tram-card-metric-val" style={{ fontSize: '0.75rem' }}>{speedKmh} <span className="tram-card-metric-unit" style={{ fontSize: '0.6rem' }}>km/h</span></span>
          </div>
          <div className="tram-card-divider" style={{ height: '10px' }} />
          <div className="tram-card-metric">
            <Clock size={12} style={{ color: '#94a3b8' }} />
            <span className="tram-card-metric-val" style={{ color: getDelayColor(tram.dl), fontSize: '0.75rem' }}>
              {formatDelay(tram.dl)}
            </span>
          </div>
        </div>

        {/* Stop info row */}
        {hasStopInfo && (
          <div style={{ 
            fontSize: '0.68rem', 
            color: 'var(--text-secondary)', 
            overflow: 'hidden', 
            textOverflow: 'ellipsis', 
            whiteSpace: 'nowrap',
            textAlign: 'left'
          }}>
            {isStopped && currentStop ? (
              <span style={{ color: '#fbbf24', fontWeight: 600 }}>
                At <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{currentStop.name}</span>
              </span>
            ) : nextStop ? (
              <span>
                <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Next: </span>
                <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{nextStop.name}</span>
                {' '}
                <span style={{ color: '#10b981', fontSize: '0.65rem', fontWeight: 700 }}>
                  {(() => {
                    const now = new Date();
                    const currentMinutes = now.getHours() * 60 + now.getMinutes();
                    const [h, m] = nextStop.realtimeArrival.split(':').map(Number);
                    let stopMinutes = h * 60 + m;
                    const currentHour = now.getHours();
                    let localMinutes = currentMinutes;
                    if (currentHour < 5 && h >= 24) {
                      localMinutes += 24 * 60;
                    } else if (currentHour >= 20 && h < 5) {
                      stopMinutes += 24 * 60;
                    }
                    const etaMins = stopMinutes - localMinutes;
                    return etaMins <= 0 ? 'now' : `${etaMins} min`;
                  })()}
                </span>
              </span>
            ) : null}
          </div>
        )}
      </div>

      <div className="tram-card-divider" />

      {/* Follow toggle button */}
      <button 
        className={`tram-card-follow-btn ${isFollowing ? 'active' : ''}`} 
        onClick={onToggleFollow}
        title={isFollowing ? "Stop following tram" : "Follow tram from behind"}
        style={{
          background: isFollowing ? 'rgba(0, 184, 148, 0.15)' : 'transparent',
          border: isFollowing ? '1px solid rgba(0, 184, 148, 0.3)' : '1px solid transparent',
          borderRadius: '50%',
          width: '24px',
          height: '24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: isFollowing ? '#20bf6b' : '#94a3b8',
          cursor: 'pointer',
          padding: 0,
          transition: 'all 0.2s ease',
        }}
        onMouseEnter={(e) => {
          if (!isFollowing) e.currentTarget.style.color = '#e2e8f0';
        }}
        onMouseLeave={(e) => {
          if (!isFollowing) e.currentTarget.style.color = '#94a3b8';
        }}
      >
        <Target size={13} className={isFollowing ? 'animate-pulse' : ''} />
      </button>

      <div className="tram-card-divider" />

      <button className="tram-card-close" onClick={onClose} aria-label="Close">
        <X size={14} />
      </button>
    </div>
  );
};

