import React from 'react';
import type { VehiclePosition } from '../types';
import { Navigation, Clock, X } from 'lucide-react';

interface TramCardProps {
  tram: VehiclePosition;
  routeName?: string;
  onClose: () => void;
}

export const TramCard: React.FC<TramCardProps> = ({ tram, routeName, onClose }) => {
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
          <Navigation size={13} style={{ color: '#94a3b8' }} />
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

      <button className="tram-card-close" onClick={onClose} aria-label="Close">
        <X size={14} />
      </button>
    </div>
  );
};
