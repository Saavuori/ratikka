import { Check, Loader2, TramFront, X } from 'lucide-react';
import { getRouteColor } from '../lib/routeColors';
import type { RideDetection } from '../hooks/useRideDetection';
import './ride.css';

export interface RidePanelProps {
  detection: RideDetection;
  hidden?: boolean;
  /**
   * Whether the map's locate control is switched on. The offer to look for a
   * ride is only made to a reader who has already put themselves on the map:
   * off it, the answer would be a permission prompt out of nowhere.
   */
  locating?: boolean;
  /** The line the ride is running, once one is being followed. */
  rideLine: string | null;
  /** The stop the ride is running to, in words, or null when unknown. */
  rideNextStop: string | null;
}

const MODE_NAMES: Record<string, string> = {
  tram: 'tram',
  bus: 'bus',
  metro: 'metro',
  train: 'train',
  ferry: 'ferry',
};

function vehicleName(mode: string, desi: string): string {
  return `${MODE_NAMES[mode] ?? 'vehicle'} ${desi}`;
}

/**
 * The "am I on board?" control, bottom centre.
 *
 * It has four faces, and each one says only what is actually known: an offer
 * to look, the looking itself, one vehicle put to the reader as a question,
 * and — once the evidence is beyond doubt — the ride it has locked onto. The
 * question is never skipped on a hunch: being told you are on the 7 when you
 * are standing beside it is worse than being asked.
 *
 * The first of those faces waits for the map's locate control. A reader who
 * has not put themselves on the map is not asking to be found, and an offer
 * that opens with a permission prompt is a poor way to ask them.
 */
export function RidePanel({ detection, hidden = false, locating = false, rideLine, rideNextStop }: RidePanelProps) {
  const { status, suggestion, ambiguous, error } = detection;
  if (hidden) return null;

  if (status === 'off' || status === 'unavailable' || status === 'denied') {
    // Nothing to offer until the reader has switched the map's locate control
    // on. A search that is already running keeps its own face below, so
    // switching locating off mid-ride never strands one with no way out.
    if (!locating) return null;
    const blocked = status !== 'off';
    return (
      <div className="ride-dock">
        <button
          type="button"
          className="ride-launcher"
          onClick={detection.start}
          disabled={blocked}
          title={blocked ? error : 'Find the vehicle you are travelling in and follow it'}
        >
          <TramFront size={16} aria-hidden="true" />
          {blocked ? 'Ride along unavailable' : "I'm on board"}
        </button>
      </div>
    );
  }

  if (status === 'riding') {
    const line = rideLine ?? '';
    return (
      <section className="glass-panel ride-panel riding" aria-label="Ride along">
        <span className="ride-badge" style={{ background: getRouteColor(line) }}>{line || '–'}</span>
        <div className="ride-text">
          <strong>Riding along</strong>
          <span>{rideNextStop ? `Next stop ${rideNextStop}` : 'Following your vehicle'}</span>
        </div>
        <button type="button" className="ride-button" onClick={detection.stop}>
          <X size={14} aria-hidden="true" /> Stop
        </button>
      </section>
    );
  }

  if (status === 'suggesting' && suggestion) {
    const name = vehicleName(suggestion.mode, suggestion.desi);
    return (
      <section className="glass-panel ride-panel" aria-label="Ride along">
        <span className="ride-badge" style={{ background: getRouteColor(suggestion.desi) }}>
          {suggestion.desi}
        </span>
        <div className="ride-text">
          <strong>On the {name}?</strong>
          <span>It has kept alongside you for {Math.round(suggestion.sharedMeters)} m.</span>
        </div>
        <button type="button" className="ride-button primary" onClick={detection.accept}>
          <Check size={14} aria-hidden="true" /> Yes
        </button>
        <button type="button" className="ride-button" onClick={detection.dismiss} aria-label="Not this vehicle">
          <X size={14} aria-hidden="true" />
        </button>
      </section>
    );
  }

  return (
    <section className="glass-panel ride-panel" aria-label="Ride along">
      <Loader2 size={16} className="spin" aria-hidden="true" />
      <div className="ride-text">
        <strong>Looking for your vehicle</strong>
        <span>
          {ambiguous
            ? `${ambiguous.join(' and ')} are running together — keep going and it will settle.`
            : error || 'Keep moving; a ride shows itself after a stop or two.'}
        </span>
      </div>
      <button type="button" className="ride-button" onClick={detection.stop} aria-label="Stop looking">
        <X size={14} aria-hidden="true" /> Stop
      </button>
    </section>
  );
}
