import React from 'react';
import { Crosshair, Footprints, Radio } from 'lucide-react';
import type { StopArrival, WalkVerdict } from '../lib/stopArrivals';
import { walkVerdictLabel } from '../lib/stopArrivals';
import { departureView } from '../lib/departures';
import { getRouteColor } from '../lib/routeColors';
import './arrival.css';

const CONFIDENCE_TEXT: Record<StopArrival['confidence'], string> = {
  'at-stop': 'Here now · doors open',
  approaching: 'Live · on its way here',
  'live-tracked': 'Live · vehicle on the map',
  'live-predicted': 'Live prediction · vehicle not located yet',
  scheduled: 'Scheduled · no live prediction yet',
};

export interface ArrivalHeadlineProps {
  arrival: StopArrival | undefined;
  now: number;
  stale: boolean;
  /** Walking time verdict, when a walking distance to this stop is known. */
  verdict?: WalkVerdict;
  /** True while this arrival is the one the map is following. */
  tracking: boolean;
  onToggleTracking: () => void;
}

/**
 * The one answer someone walking to a stop actually wants: what is next, how
 * long have I got, and can I see it. The countdown is always the feed's own
 * prediction — locating the vehicle only unlocks the map trace, it never
 * becomes a second, competing estimate.
 */
export const ArrivalHeadline: React.FC<ArrivalHeadlineProps> = ({
  arrival, now, stale, verdict, tracking, onToggleTracking,
}) => {
  if (!arrival) {
    return (
      <div className="arrival-headline is-empty">
        <span className="arrival-countdown">—</span>
        <span className="arrival-meta">Nothing due at this stop right now</span>
      </div>
    );
  }

  const { departure, vehicle, confidence } = arrival;
  const view = departureView(departure, now, stale);
  const trackable = Boolean(vehicle);

  return (
    <div className={`arrival-headline confidence-${confidence}`}>
      <div className="arrival-line">
        <span
          className="arrival-badge"
          style={{ backgroundColor: getRouteColor(departure.line), color: '#ffffff' }}
        >
          {departure.line}
        </span>
        <span className="arrival-headsign">{departure.headsign || 'Unknown destination'}</span>
      </div>
      <div className="arrival-figures">
        <span className="arrival-countdown">{view.countdown ?? view.time}</span>
        <span className="arrival-clock">{view.time}</span>
      </div>
      <p className="arrival-meta">
        <Radio size={12} aria-hidden="true" />
        {stale ? 'Stale · last known prediction' : CONFIDENCE_TEXT[confidence]}
        {view.delayText && ` · ${view.delayText}`}
      </p>
      {verdict && (
        <p className={`arrival-walk outcome-${verdict.outcome}`}>
          <Footprints size={12} aria-hidden="true" />
          {walkVerdictLabel(verdict)}
        </p>
      )}
      <button
        type="button"
        className="save-stop-button arrival-track"
        aria-pressed={tracking}
        disabled={!trackable}
        onClick={onToggleTracking}
      >
        <Crosshair size={14} aria-hidden="true" />
        {!trackable ? 'Not on the map yet' : tracking ? 'Stop tracking' : 'Track on map'}
      </button>
    </div>
  );
};
