import { Bell, BellOff, DoorOpen, TriangleAlert } from 'lucide-react';
import { getRouteColor } from '../lib/routeColors';
import type { AlightAlert } from '../lib/alightAlert';
import type { AlightNotifications } from '../hooks/useAlightNotifications';
import './alight.css';

export interface AlightBannerProps {
  alert: AlightAlert | null;
  notifications: AlightNotifications;
  hidden?: boolean;
}

function minutesLabel(secondsAway: number | null): string | null {
  if (secondsAway === null || secondsAway < 30) return null;
  return `about ${Math.max(1, Math.round(secondsAway / 60))} min`;
}

/**
 * "Get off here." The one thing a rider on an unfamiliar line needs, said at
 * the moment it is needed rather than left to be counted out of the window.
 *
 * It states where the answer came from, because the two are not equally
 * strong: the vehicle naming your stop as the one it is running to is a fact,
 * while a prediction with no vehicle located behind it is an estimate, and a
 * rider deciding whether to stand up deserves to know which they have.
 */
export function AlightBanner({ alert, notifications, hidden = false }: AlightBannerProps) {
  if (!alert || hidden) return null;

  const urgent = alert.phase === 'next' || alert.phase === 'now';
  const detail = [
    alert.source === 'vehicle'
      ? `Line ${alert.line} says so`
      : `By the timetable — line ${alert.line} not located`,
    minutesLabel(alert.secondsAway),
  ].filter(Boolean).join(' · ');

  const offerBell = notifications.permission === 'default' ||
    (notifications.permission === 'granted' && !notifications.enabled);

  return (
    <section
      className={`glass-panel alight-banner ${alert.phase}`}
      aria-label="When to get off"
      role={urgent ? 'alert' : 'status'}
      aria-live={urgent ? 'assertive' : 'polite'}
    >
      {alert.phase === 'now' ? (
        <DoorOpen size={20} className="alight-icon" aria-hidden="true" />
      ) : alert.phase === 'passed' ? (
        <TriangleAlert size={18} className="alight-icon" aria-hidden="true" />
      ) : (
        <span className="alight-badge" style={{ background: getRouteColor(alert.line) }}>
          {alert.line || '–'}
        </span>
      )}
      <div className="alight-text">
        <strong>{alert.message}</strong>
        <span>{detail}</span>
      </div>
      {offerBell && (
        <button
          type="button"
          className="alight-bell"
          onClick={notifications.enable}
          title="Also alert me when the screen is off"
          aria-label="Also alert me when the screen is off"
        >
          <Bell size={15} aria-hidden="true" />
        </button>
      )}
      {notifications.enabled && (
        <button
          type="button"
          className="alight-bell on"
          onClick={notifications.disable}
          title="Stop alerting me when the screen is off"
          aria-label="Stop alerting me when the screen is off"
        >
          <BellOff size={15} aria-hidden="true" />
        </button>
      )}
    </section>
  );
}
