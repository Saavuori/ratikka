/* eslint-disable react-hooks/set-state-in-effect */
import React, { useEffect, useState } from 'react';
import type { VehiclePosition, TripDetailsResponse } from '../types';
import { fetchTripDetails } from '../lib/api';
import { AlertTriangle, Loader2, ChevronLeft, ChevronRight, ChevronDown, ChevronUp } from 'lucide-react';

interface TramPopupProps {
  tram: VehiclePosition;
  onClose: () => void;
  onRouteNameReady?: (name: string) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export const TramPopup: React.FC<TramPopupProps> = ({
  tram,
  onClose,
  onRouteNameReady,
  isCollapsed,
  onToggleCollapse,
}) => {
  // Suppress unused variable warning for onClose
  if (false as boolean) {
    onClose();
  }

  const [tripDetails, setTripDetails] = useState<TripDetailsResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [showAllStops, setShowAllStops] = useState<boolean>(false);
  const [lastStopId, setLastStopId] = useState<string | null>(null);

  useEffect(() => {
    if (tram.stop) {
      setLastStopId(tram.stop);
    }
  }, [tram.stop]);

  useEffect(() => {
    if (!tram.tripId) {
      setError('Trip ID not available for this vehicle');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setTripDetails(null);
    setShowAllStops(false); // Reset to collapsed on trip change
    setLastStopId(tram.stop || null);

    fetchTripDetails(tram.tripId)
      .then((data) => {
        setTripDetails(data);
        setLoading(false);
        if (onRouteNameReady && data.route?.longName) {
          onRouteNameReady(data.route.longName);
        }
      })
      .catch((err) => {
        console.error(err);
        setError('Failed to load schedule details');
        setLoading(false);
      });
  }, [tram.tripId]);

  const getDelayColor = (seconds: number) => {
    if (seconds > 60) return '#f87171';
    if (seconds < -60) return '#38bdf8';
    return '#34d399';
  };

  // Determine current position in the schedule.
  // tram.stop = the GTFS ID of the stop the tram most recently passed or is currently at.
  // drst === 1 means doors open = stopped at a stop.
  const getStopIndices = () => {
    if (!tripDetails) return { currentStopIndex: -1, nextStopIndex: -1, lastKnownIndex: -1 };

    const isStopped = tram.drst === 1;
    const stopIdToMatch = tram.stop || lastStopId;
    let lastKnownIndex = tripDetails.stops.findIndex(s => s.gtfsId === stopIdToMatch);

    if (lastKnownIndex === -1) {
      // Fallback: Estimate position based on arrival times
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
      // Doors open: we ARE at this stop
      const currentStopIndex = lastKnownIndex;
      const nextStopIndex = lastKnownIndex + 1 < tripDetails.stops.length ? lastKnownIndex + 1 : -1;
      return { currentStopIndex, nextStopIndex, lastKnownIndex };
    } else {
      // Moving: we have departed lastKnownIndex, heading to lastKnownIndex + 1
      const nextStopIndex = lastKnownIndex + 1 < tripDetails.stops.length ? lastKnownIndex + 1 : lastKnownIndex;
      return { currentStopIndex: -1, nextStopIndex, lastKnownIndex };
    }
  };

  return (
    <div className={`glass-panel detail-popup ${isCollapsed ? 'collapsed' : ''}`}>
      {/* Collapse/Expand Toggle Tab */}
      <button
        className="detail-toggle-tab"
        onClick={onToggleCollapse}
        aria-label={isCollapsed ? 'Show Schedule' : 'Hide Schedule'}
      >
        <span className="icon-desktop">
          {isCollapsed ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
        </span>
        <span className="icon-mobile">
          {isCollapsed ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </span>
      </button>
      {/* Header */}
      <div className="panel-header" style={{ padding: '0 0 12px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div className="desi-circle">{tram.desi}</div>
          <div>
            <h2 style={{ fontSize: '0.8rem', fontWeight: 700, margin: 0, color: '#e2e8f0' }}>
              {tripDetails?.headsign ? `→ ${tripDetails.headsign}` : `Line ${tram.desi}`}
            </h2>
            <p className="panel-subtitle" style={{ marginTop: '1px' }}>
              {tripDetails?.route.longName || 'Loading route…'}
            </p>
          </div>
        </div>
      </div>

      {/* Next Stop Callout */}
      {!loading && !error && tripDetails && (() => {
        const { currentStopIndex, nextStopIndex, lastKnownIndex } = getStopIndices();
        const isStopped = tram.drst === 1;

        if (lastKnownIndex === -1) return null;

        const currentStop = isStopped && currentStopIndex !== -1 ? tripDetails.stops[currentStopIndex] : null;
        const nextStop = nextStopIndex !== -1 ? tripDetails.stops[nextStopIndex] : null;

        return (
          <div className={`next-stop-callout ${isStopped ? 'stopped' : 'moving'}`}>
            {isStopped && currentStop && (
              <div className="callout-main">
                <div>
                  <span style={{ fontSize: '0.6rem', textTransform: 'uppercase', fontWeight: 800, color: '#f59e0b', display: 'block', letterSpacing: '0.05em' }}>
                    At stop
                  </span>
                  <span className="callout-val">{currentStop.name}</span>
                </div>
                <span style={{
                  fontSize: '0.6rem', padding: '2px 6px', borderRadius: '4px',
                  backgroundColor: 'rgba(245,158,11,0.15)', border: '1px solid #f59e0b',
                  color: '#fbbf24', textTransform: 'uppercase', fontWeight: 'bold'
                }}>Stopped</span>
              </div>
            )}

            {nextStop && (
              <div className={isStopped ? 'next-stop-sub' : 'callout-main'}>
                <div>
                  <span style={{ fontSize: '0.6rem', textTransform: 'uppercase', fontWeight: 800, color: 'var(--accent-green)', display: 'block', letterSpacing: '0.05em' }}>
                    Next stop
                  </span>
                  <span className="callout-val next-name">{nextStop.name}</span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontSize: '0.6rem', textTransform: 'uppercase', fontWeight: 700, color: '#94a3b8', display: 'block' }}>ETA</span>
                  <span className="callout-val next-eta">{nextStop.realtimeArrival}</span>
                </div>
              </div>
            )}

            {!nextStop && (
              <div style={{ fontSize: '0.75rem', color: '#64748b', textAlign: 'center' }}>End of line</div>
            )}
          </div>
        );
      })()}

      {/* Loading */}
      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '36px 0', gap: '12px', color: '#94a3b8' }}>
          <Loader2 className="animate-spin" style={{ color: '#34d399' }} size={22} />
          <span style={{ fontSize: '0.7rem' }}>Loading schedule…</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '24px 0', gap: '8px', color: '#ef4444', textAlign: 'center' }}>
          <AlertTriangle size={22} />
          <span style={{ fontSize: '0.7rem', fontWeight: 600 }}>{error}</span>
        </div>
      )}

      {/* Stop Timeline — past stops hidden, show last stop by default, click to expand all */}
      {!loading && !error && tripDetails && (() => {
        const { currentStopIndex, nextStopIndex, lastKnownIndex } = getStopIndices();
        const isStopped = tram.drst === 1;

        // Filter for upcoming stops only (excluding past stops entirely)
        const upcomingStops = tripDetails.stops
          .map((stop, idx) => ({ ...stop, originalIdx: idx }))
          .filter((stop) => {
            if (lastKnownIndex === -1) return true;
            return isStopped ? stop.originalIdx >= currentStopIndex : stop.originalIdx > lastKnownIndex;
          });

        if (upcomingStops.length === 0) {
          return (
            <div style={{ fontSize: '0.75rem', color: '#64748b', textAlign: 'center', padding: '12px 0' }}>
              End of line
            </div>
          );
        }

        const stopsToRender = showAllStops ? upcomingStops : [upcomingStops[upcomingStops.length - 1]];

        return (
          <div className="timeline-container" style={{ marginTop: '12px' }}>
            {upcomingStops.length > 1 && (
              <button
                onClick={() => setShowAllStops(!showAllStops)}
                style={{
                  width: '100%',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-glow)',
                  background: 'var(--bg-button)',
                  color: 'var(--text-secondary)',
                  fontSize: '0.65rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  marginBottom: '10px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '4px'
                }}
              >
                {showAllStops ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                {showAllStops ? 'Hide stops' : `Show all intermediate stops (${upcomingStops.length - 1})`}
              </button>
            )}

            <div className="timeline-list">
              {stopsToRender.map((stop) => {
                const idx = stop.originalIdx;
                const isCurrent = idx === currentStopIndex && isStopped;
                const isNext = idx === nextStopIndex;
                const isUpcoming = !isCurrent && !isNext;

                let itemClass = 'timeline-item';
                if (isCurrent) itemClass += ' active current';
                else if (isNext) itemClass += ' active next';
                else if (isUpcoming) itemClass += ' upcoming';

                return (
                  <div key={idx} className={itemClass}>
                    <span className="timeline-dot" />
                    <div className="timeline-stop-info">
                      <h4 className="timeline-stop-name">{stop.name}</h4>
                      {(isCurrent || isNext || !showAllStops) && (
                        <span className="timeline-stop-code">{stop.code}</span>
                      )}
                    </div>
                    <div className="timeline-time-info">
                      <span className="timeline-time">{stop.realtimeArrival}</span>
                      {stop.delay !== 0 && (
                        <span className="timeline-delay" style={{ color: getDelayColor(stop.delay) }}>
                          {stop.delay < 0 ? '-' : '+'}{Math.round(Math.abs(stop.delay) / 60)}m
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
    </div>
  );
};
