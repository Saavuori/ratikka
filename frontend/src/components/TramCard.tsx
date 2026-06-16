import React from 'react';
import type { VehiclePosition } from '../types';
import { Navigation, Clock, X, Target } from 'lucide-react';

interface TramCardProps {
  tram: VehiclePosition;
  routeName?: string;
  onClose: () => void;
  isFollowing: boolean;
  onToggleFollow: () => void;
}

export const TramCard: React.FC<TramCardProps> = ({ tram, routeName, onClose, isFollowing, onToggleFollow }) => {
  const speedKmh = Math.round(tram.spd * 3.6);

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

  return (
    <div className="tram-card-overlay">
      {/* Line number badge */}
      <div className="tram-card-desi">{tram.desi}</div>

      {/* Metrics row */}
      <div className="tram-card-metrics">
        <div className="tram-card-metric">
          <Navigation size={13} style={{ color: '#94a3b8', transform: `rotate(${tram.hdg - 45}deg)`, transition: 'transform 0.4s ease' }} />
          <span className="tram-card-metric-val">{speedKmh} <span className="tram-card-metric-unit">km/h</span></span>
        </div>
        <div className="tram-card-divider" />
        <div className="tram-card-metric">
          <Clock size={13} style={{ color: '#94a3b8' }} />
          <span className="tram-card-metric-val" style={{ color: getDelayColor(tram.dl) }}>
            {formatDelay(tram.dl)}
          </span>
        </div>
        {routeName && (
          <>
            <div className="tram-card-divider" />
            <span className="tram-card-route">{routeName}</span>
          </>
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

