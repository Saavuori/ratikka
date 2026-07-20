import React, { useEffect, useState } from 'react';
import type { BikeStationDetailsResponse } from '../types';
import { useCollapsiblePanel } from '../hooks/useCollapsiblePanel';
import { fetchBikeStationDetails } from '../lib/api';
import { X, Bike, Navigation, AlertTriangle, Loader2, ChevronRight, CheckCircle, AlertCircle } from 'lucide-react';

interface BikePopupProps {
  stationId: string;
  stationName: string;
  onClose: () => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export const BikePopup: React.FC<BikePopupProps> = ({
  stationId,
  stationName,
  onClose,
  isCollapsed,
  onToggleCollapse,
}) => {
  const [details, setDetails] = useState<BikeStationDetailsResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const collapseProps = useCollapsiblePanel(isCollapsed, onToggleCollapse, 'Show bike station details');

  useEffect(() => {
    let active = true;

    // Only the first load shows the spinner; refreshes swap the counts in place.
    const load = (isInitial: boolean) => {
      if (isInitial) {
        setLoading(true);
        setError(null);
      }

      fetchBikeStationDetails(stationId)
        .then((data) => {
          if (!active) return;
          setDetails(data);
          setLoading(false);
          setError(null);
        })
        .catch((err) => {
          if (!active) return;
          console.error(err);
          // A failed refresh keeps the last good counts on screen.
          if (isInitial) {
            setError('Failed to load bike station data');
          }
          setLoading(false);
        });
    };

    load(true);
    // Bike and dock counts turn over quickly at busy stations.
    const interval = setInterval(() => load(false), 30000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [stationId]);

  return (
    <div
      {...collapseProps}
      className={`glass-panel detail-popup ${collapseProps.className}`}
      style={{ display: 'flex', flexDirection: 'column', pointerEvents: 'auto' }}
    >

      {/* Header */}
      <div className="panel-header" style={{ padding: '0 0 16px 0', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h2 style={{ fontSize: '0.85rem', fontWeight: 700, margin: 0 }}>{stationName}</h2>
          </div>
          <p className="panel-subtitle" style={{ fontFamily: 'monospace', marginTop: '4px', fontSize: '0.65rem', color: 'var(--text-secondary)' }}>
            {stationId}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
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
      </div>

      {/* Body */}
      <div className="timeline-container" style={{ flex: 1, marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Loading Spinner */}
        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 0', gap: '12px', color: 'var(--text-secondary)' }}>
            <Loader2 className="animate-spin" style={{ color: '#fcbc19' }} size={24} />
            <span style={{ fontSize: '0.75rem' }}>Loading station status...</span>
          </div>
        )}

        {/* Error Fallback */}
        {error && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 0', gap: '8px', color: '#ef4444', textAlign: 'center' }}>
            <AlertTriangle size={24} />
            <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>{error}</span>
          </div>
        )}

        {/* Capacity Details */}
        {!loading && !error && details && (
          <>
            {/* Status Badges */}
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '0.65rem',
                backgroundColor: details.allowPickup ? 'rgba(32, 191, 107, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                color: details.allowPickup ? '#20bf6b' : '#ef4444',
                border: `1px solid ${details.allowPickup ? 'rgba(32, 191, 107, 0.25)' : 'rgba(239, 68, 68, 0.25)'}`,
                padding: '4px 8px',
                borderRadius: '12px',
                fontWeight: 600
              }}>
                {details.allowPickup ? <CheckCircle size={10} /> : <AlertCircle size={10} />}
                Pickups {details.allowPickup ? 'Allowed' : 'Disabled'}
              </span>
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '0.65rem',
                backgroundColor: details.allowDropoff ? 'rgba(32, 191, 107, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                color: details.allowDropoff ? '#20bf6b' : '#ef4444',
                border: `1px solid ${details.allowDropoff ? 'rgba(32, 191, 107, 0.25)' : 'rgba(239, 68, 68, 0.25)'}`,
                padding: '4px 8px',
                borderRadius: '12px',
                fontWeight: 600
              }}>
                {details.allowDropoff ? <CheckCircle size={10} /> : <AlertCircle size={10} />}
                Returns {details.allowDropoff ? 'Allowed' : 'Disabled'}
              </span>
            </div>

            {/* Counts Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '8px' }}>
              {/* Available Bikes Card */}
              <div style={{
                background: 'rgba(252, 188, 25, 0.08)',
                border: '1px solid rgba(252, 188, 25, 0.2)',
                borderRadius: '12px',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
              }}>
                <Bike size={24} style={{ color: '#fcbc19' }} />
                <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em' }}>Bikes</span>
                <span style={{ fontSize: '1.75rem', fontWeight: 800, color: '#fcbc19', lineHeight: 1 }}>{details.bikesAvailable}</span>
              </div>

              {/* Available Docks/Spaces Card */}
              <div style={{
                background: 'var(--border-faint)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '12px',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
              }}>
                <Navigation size={22} style={{ color: 'var(--text-secondary)', transform: 'rotate(45deg)' }} />
                <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em' }}>Free Docks</span>
                <span style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-strong)', lineHeight: 1 }}>{details.spacesAvailable}</span>
              </div>
            </div>

            {/* Graphic or visual progress bar of filling status */}
            {details.bikesAvailable + details.spacesAvailable > 0 && (
              <div style={{ marginTop: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  <span>Filling status</span>
                  <span>{Math.round((details.bikesAvailable / (details.bikesAvailable + details.spacesAvailable)) * 100)}%</span>
                </div>
                <div style={{ height: '6px', background: 'var(--border-subtle)', borderRadius: '3px', overflow: 'hidden', display: 'flex' }}>
                  <div style={{
                    width: `${(details.bikesAvailable / (details.bikesAvailable + details.spacesAvailable)) * 100}%`,
                    background: '#fcbc19',
                    transition: 'width 0.5s ease-out'
                  }} />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
