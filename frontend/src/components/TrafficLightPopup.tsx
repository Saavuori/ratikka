import React, { useState } from 'react';
import { X, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Radio } from 'lucide-react';
import { useIsMobile } from '../hooks/useIsMobile';
import { getRouteColor, getModeAccent } from '../lib/routeColors';
import { haversineMeters } from '../lib/trafficLights';
import {
  splitByOutcome,
  describeRequestType,
  priorityAccent,
  trafficLightIconSvg,
  warningLightIconSvg,
  SIGNAL_RED,
  SIGNAL_AMBER,
  SIGNAL_GREEN,
} from '../lib/trafficLightModels';
import type { JunctionActivity, JunctionPriority } from '../lib/trafficLightModels';
import type { TrafficLightFeature } from '../types';

interface TrafficLightPopupProps {
  junction: TrafficLightFeature;
  /** The live exchanges at this junction, or null while nobody is asking. */
  activity: JunctionActivity | null;
  /** Picking a vehicle out of the list opens its own panel. */
  onSelectVehicle: (veh: string) => void;
  onClose: () => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

/** Seconds since an HFP timestamp, as a phrase. */
function ago(ts: number): string {
  const seconds = Math.max(0, Math.round(Date.now() / 1000 - ts));
  if (seconds < 2) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
}

/** What the vehicle is doing while it waits — the thing a still photo misses. */
function motion(vehicle: JunctionPriority): string {
  if (vehicle.drst === 1) return 'doors open';
  if (vehicle.spd < 0.5) return 'stopped';
  return `${Math.round(vehicle.spd * 3.6)} km/h`;
}

const Row: React.FC<{
  vehicle: JunctionPriority;
  junction: TrafficLightFeature;
  onSelect: (veh: string) => void;
}> = ({ vehicle, junction, onSelect }) => {
  const [jlng, jlat] = junction.geometry.coordinates;
  const metres = Math.round(haversineMeters(vehicle.lat, vehicle.lng, jlat, jlng));
  const accent = priorityAccent(vehicle.status) ?? '#94a3b8';
  const requestPhrase = describeRequestType(vehicle.requestType);

  return (
    <button
      onClick={() => onSelect(vehicle.veh)}
      style={{
        display: 'flex', alignItems: 'center', gap: '10px', width: '100%',
        padding: '8px 10px', borderRadius: '10px', cursor: 'pointer',
        background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
        borderLeft: `3px solid ${accent}`, textAlign: 'left', color: 'inherit',
        font: 'inherit', outline: 'none',
      }}
    >
      {/* Line badge, in the line's own colour — the same cue the map uses. */}
      <span style={{
        minWidth: '34px', padding: '3px 6px', borderRadius: '7px', textAlign: 'center',
        fontSize: '0.7rem', fontWeight: 800, color: '#0b1016',
        background: vehicle.desi ? getRouteColor(vehicle.desi) : getModeAccent(vehicle.mode),
      }}>
        {vehicle.desi || '—'}
      </span>

      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: '0.7rem', fontWeight: 600, color: '#e2e8f0' }}>
          {metres} m away · {motion(vehicle)}
        </span>
        <span style={{ display: 'block', fontSize: '0.62rem', color: '#94a3b8', marginTop: '2px' }}>
          {requestPhrase ? `Asked ${requestPhrase}` : 'Asked'}
          {vehicle.attempts && vehicle.attempts > 1 ? ` · attempt ${vehicle.attempts}` : ''}
          {vehicle.level && vehicle.level !== 'normal' && vehicle.level !== 'norequest'
            ? ` · ${vehicle.level} priority` : ''}
          {vehicle.reason ? ` · ${vehicle.reason}` : ''}
          {' · '}{ago(vehicle.ts)}
        </span>
      </span>

      <span style={{ fontFamily: 'monospace', fontSize: '0.58rem', color: '#64748b' }}>
        {vehicle.veh}
      </span>
    </button>
  );
};

const Section: React.FC<{
  title: string;
  color: string;
  vehicles: JunctionPriority[];
  junction: TrafficLightFeature;
  onSelect: (veh: string) => void;
}> = ({ title, color, vehicles, junction, onSelect }) => {
  if (vehicles.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{
          width: '7px', height: '7px', borderRadius: '50%',
          background: color, boxShadow: `0 0 6px ${color}`,
        }} />
        <span style={{
          fontSize: '0.55rem', color, textTransform: 'uppercase',
          fontWeight: 800, letterSpacing: '0.05em',
        }}>
          {title} · {vehicles.length}
        </span>
      </div>
      {vehicles.map((vehicle) => (
        <Row key={vehicle.veh} vehicle={vehicle} junction={junction} onSelect={onSelect} />
      ))}
    </div>
  );
};

/**
 * A junction, from the junction's side of the conversation.
 *
 * The vehicle panel answers "what is this tram asking?"; this answers the
 * question you have when you are looking at the crossing rather than at one
 * tram — which vehicles are asking this junction for a green right now, and
 * which of them it has given one to. Both come from the same HFP `tlr`/`tla`
 * events, folded onto the junction by ID.
 *
 * What this cannot show is the signal's actual aspect. Nothing published says
 * whether the light is red; only what the vehicles asked and what came back.
 * So the panel is careful to say "granted" rather than "green".
 */
export const TrafficLightPopup: React.FC<TrafficLightPopupProps> = ({
  junction,
  activity,
  onSelectVehicle,
  onClose,
  isCollapsed,
  onToggleCollapse,
}) => {
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const isMobile = useIsMobile();
  const { granted, requesting, denied, silent } = splitByOutcome(activity);
  const isWarningLight = junction.properties.type === 'warning_light';
  const total = granted.length + requesting.length + denied.length + silent.length;

  // The header wears the map's own marker rather than a stand-in from an icon
  // set — lucide has no traffic light, and the nearest thing it has is a
  // road-works cone, which means something else entirely. Lit by the junction's
  // current state, so the panel and the marker agree at a glance.
  const headerIcon = isWarningLight
    ? warningLightIconSvg()
    : trafficLightIconSvg(
      activity && activity.status !== 'norequest' ? activity.status : 'idle',
    );

  const handleTouchStart = (e: React.TouchEvent) => setTouchStart(e.touches[0].clientX);
  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStart === null) return;
    const diff = e.touches[0].clientX - touchStart;
    if (diff < -45 && isCollapsed) {
      onToggleCollapse();
      setTouchStart(null);
    } else if (diff > 45 && !isCollapsed) {
      onToggleCollapse();
      setTouchStart(null);
    }
  };

  return (
    <div
      className={`glass-panel detail-popup ${isCollapsed ? 'collapsed' : ''}`}
      style={{ display: 'flex', flexDirection: 'column', pointerEvents: 'auto' }}
      onTouchStart={isMobile ? undefined : handleTouchStart}
      onTouchMove={isMobile ? undefined : handleTouchMove}
      onTouchEnd={() => setTouchStart(null)}
      onClick={() => { if (isCollapsed) onToggleCollapse(); }}
    >
      <div className="sheet-handle" onClick={() => !isCollapsed && onToggleCollapse()} />

      <button
        className="detail-toggle-tab"
        onClick={onToggleCollapse}
        aria-label={isCollapsed ? 'Show junction' : 'Hide junction'}
      >
        <span className="icon-desktop">
          {isCollapsed ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
        </span>
        <span className="icon-mobile">
          {isCollapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      </button>

      {/* Header */}
      <div className="panel-header" style={{
        padding: '0 0 16px 0', borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <img
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(headerIcon)}`}
              alt=""
              width={15}
              height={22}
              style={{ flexShrink: 0 }}
            />
            <h2 style={{ fontSize: '0.85rem', fontWeight: 700, margin: 0 }}>
              {junction.properties.junction || 'Signalised junction'}
            </h2>
          </div>
          <p className="panel-subtitle" style={{
            marginTop: '4px', fontSize: '0.65rem', color: '#94a3b8',
          }}>
            {isWarningLight ? 'Warning light' : 'Traffic lights'}
            <span style={{ fontFamily: 'monospace' }}> · #{junction.properties.id}</span>
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {!isCollapsed && (
            <button
              onClick={onToggleCollapse}
              style={{
                background: 'none', border: 'none', color: 'var(--text-secondary)',
                cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center',
                outline: 'none',
              }}
              aria-label="Collapse panel"
            >
              {isMobile ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
          )}
          <button onClick={onClose} className="close-btn">
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="timeline-container" style={{
        flex: 1, marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '16px',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          fontSize: '0.55rem', color: '#64748b', textTransform: 'uppercase',
          fontWeight: 800, letterSpacing: '0.05em',
        }}>
          <Radio size={10} />
          Priority requests (HFP tlr/tla)
        </div>

        {total === 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', padding: '28px 12px', gap: '8px',
            textAlign: 'center', color: '#94a3b8',
          }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>
              {isWarningLight
                ? 'Warning lights take no priority requests'
                : 'No vehicle is asking this junction right now'}
            </span>
            <span style={{ fontSize: '0.65rem', lineHeight: 1.5, color: '#64748b' }}>
              {isWarningLight
                ? 'This is a pedestrian and cyclist warning light. Only signalised junctions negotiate priority with trams and buses.'
                : 'Requests appear here as trams and buses come up on the crossing. Nothing is published about the signal’s own aspect — only what vehicles ask of it and what comes back.'}
            </span>
          </div>
        ) : (
          <>
            <Section title="Priority granted" color={SIGNAL_GREEN} vehicles={granted}
              junction={junction} onSelect={onSelectVehicle} />
            <Section title="Requesting" color={SIGNAL_AMBER} vehicles={requesting}
              junction={junction} onSelect={onSelectVehicle} />
            <Section title="Refused" color={SIGNAL_RED} vehicles={denied}
              junction={junction} onSelect={onSelectVehicle} />
            <Section title="Not requesting" color="#94a3b8" vehicles={silent}
              junction={junction} onSelect={onSelectVehicle} />

            <p style={{
              margin: 0, fontSize: '0.6rem', lineHeight: 1.5, color: '#64748b',
            }}>
              &ldquo;Granted&rdquo; is the junction acknowledging the request, not a green
              light showing: HFP publishes the negotiation, never the aspect. Pick a
              line to open that vehicle.
            </p>
          </>
        )}
      </div>
    </div>
  );
};
