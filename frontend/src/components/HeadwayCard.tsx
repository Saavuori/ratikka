import React from 'react';
import type { TripDetailsResponse, VehiclePosition } from '../types';
import {
  BUNCHED_CORAL,
  GAP_AMBER,
  describeHeadway,
  formatHeadway,
  vehicleAhead,
  vehicleBehind,
} from '../lib/headways';
import { getModeAccent, getRouteColor, BUS_BLUE } from '../lib/routeColors';
import './headwayCard.css';

interface HeadwayCardProps {
  vehicle: VehiclePosition;
  vehicles: Record<string, VehiclePosition>;
  /** The vehicle's trip, for naming the stop the gap ahead was timed at. */
  tripDetails: TripDetailsResponse | null;
  onSelectVehicle: (veh: string) => void;
}

const stateColor = (state: string | undefined): string | null =>
  state === 'bunched' ? BUNCHED_CORAL : state === 'gap' ? GAP_AMBER : null;

/**
 * How long to draw a gap, as a share of the strip: one timetabled headway is
 * one unit. Clamped so a bunch still shows a sliver of line and a long gap does
 * not push its neighbour off the card; unknown is drawn at the timetable's own.
 */
const gapLength = (secs: number | undefined, sched: number | undefined): number =>
  secs === undefined || !sched ? 1 : Math.min(Math.max(secs / sched, 0.12), 3);

/**
 * How this vehicle sits among the others on its line: how far behind the one
 * ahead, how far ahead of the one behind, and whether that is what the
 * timetable spaces them at. Either neighbour opens with a tap.
 *
 * Shown only once there is something measured to show. The gaps are timed as
 * vehicles leave stops, so a vehicle that has only just started its run — or a
 * replayed one, whose history does not carry them — has nothing to report, and
 * a card saying so on every such vehicle would be noise.
 */
export const HeadwayCard: React.FC<HeadwayCardProps> = ({ vehicle, vehicles, tripDetails, onSelectVehicle }) => {
  const hw = vehicle.hw;
  const ahead = vehicleAhead(vehicle, vehicles);
  const behind = vehicleBehind(vehicle, vehicles);
  if (!hw && !behind) return null;

  const color = stateColor(hw?.state);
  const sched = hw?.sched ?? behind?.hw?.sched;
  const lineColor = vehicle.mode === 'bus' ? BUS_BLUE : getRouteColor(vehicle.desi);
  const timedAt = hw?.stop
    ? tripDetails?.stops.find((s) => s.gtfsId === hw.stop)?.name ?? null
    : null;

  return (
    <div className="headway-card">
      <div className="headway-card-head">
        <span className="tp-caption" style={{ margin: 0 }}>Spacing</span>
        <span
          className="headway-card-state"
          style={{ '--state-color': color ?? getModeAccent(vehicle.mode) } as React.CSSProperties}
        >
          {describeHeadway(hw)}
        </span>
      </div>

      {/* The three vehicles in a row, running left to right, each gap drawn
          as long as it is against the timetable: a bunch is two dots almost
          touching, a gap a long amber stretch. */}
      <div className="headway-card-strip" aria-hidden="true">
        <span className="headway-card-dot" style={{ background: behind ? lineColor : 'transparent' }} />
        <span
          className="headway-card-gap"
          style={{
            flexGrow: gapLength(behind?.hw?.secs, sched),
            borderColor: stateColor(behind?.hw?.state) ?? 'var(--border-glow)',
          }}
        />
        <span className="headway-card-dot headway-card-dot--self" style={{ background: lineColor }} />
        <span
          className="headway-card-gap"
          style={{
            flexGrow: gapLength(hw?.secs, sched),
            borderColor: color ?? 'var(--border-glow)',
          }}
        />
        <span className="headway-card-dot" style={{ background: ahead ? lineColor : 'transparent' }} />
      </div>

      <div className="headway-card-rows">
        <HeadwayRow
          label="Behind"
          text={behind?.hw ? `${behind.hw.atLeast ? '≥ ' : ''}${formatHeadway(behind.hw.secs)}` : '—'}
          color={stateColor(behind?.hw?.state)}
          onClick={behind ? () => onSelectVehicle(behind.veh) : undefined}
        />
        <HeadwayRow
          label="Ahead"
          text={hw ? `${hw.atLeast ? '≥ ' : ''}${formatHeadway(hw.secs)}` : '—'}
          color={color}
          onClick={ahead ? () => onSelectVehicle(ahead.veh) : undefined}
          align="end"
        />
      </div>

      {(sched || timedAt) && (
        <p className="headway-card-note">
          {sched ? `Timetabled every ${formatHeadway(sched)}` : null}
          {sched && timedAt ? ' · ' : null}
          {timedAt ? `timed leaving ${timedAt}` : null}
        </p>
      )}
    </div>
  );
};

interface HeadwayRowProps {
  label: string;
  text: string;
  color: string | null;
  onClick?: () => void;
  align?: 'start' | 'end';
}

function HeadwayRow({ label, text, color, onClick, align = 'start' }: HeadwayRowProps) {
  const body = (
    <>
      <span className="headway-card-label">{label}</span>
      <span className="headway-card-value" style={{ color: color ?? undefined }}>{text}</span>
    </>
  );
  const className = `headway-card-row headway-card-row--${align}`;
  return onClick ? (
    <button type="button" className={`${className} headway-card-row--link`} onClick={onClick}
      aria-label={`${label}: ${text}. Show that vehicle`}>
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
}
