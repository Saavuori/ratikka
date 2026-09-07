import React, { useMemo } from 'react';
import { Pause, Play, Radio } from 'lucide-react';
import { coverageMarks, REPLAY_SPEEDS } from '../lib/replay';
import type { ReplayDayCoverage } from '../types';

interface TimelapsePanelProps {
  cursor: number;
  range: { from: number; to: number };
  playing: boolean;
  speed: number;
  loading: boolean;
  inGap: boolean;
  error: string | null;
  days: ReplayDayCoverage[] | null;
  retentionDays: number;
  onSeek: (ts: number) => void;
  onToggle: () => void;
  onSpeed: (speed: number) => void;
  onExit: () => void;
}

const HELSINKI = 'Europe/Helsinki';

/** The moment the scrubber is on, in the city's own time rather than the viewer's. */
function formatCursor(ts: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: HELSINKI,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
    .format(new Date(ts * 1000))
    // en-GB comma-separates the parts; the panel is tight and the reading is
    // just as clear without them.
    .replace(/,/g, '');
}

function formatAgo(ts: number, edge: number): string {
  const seconds = Math.max(0, edge - ts);
  if (seconds < 90) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/**
 * The timelapse controls. Deliberately not part of the map's ordinary
 * furniture: this is a way to watch the city's past, which is a different thing
 * from watching it now, and it is reached through the version badge. While it
 * is open it is the only chrome on the map — the filters, chips, planner and
 * tab bar all belong to the live feed and stand down until it closes. Which is
 * also why the panel is built to take as little of the map as it can: two rows,
 * no title of its own, no standing status line, and one way out rather than two
 * (the Live button, which says where it goes).
 */
export const TimelapsePanel: React.FC<TimelapsePanelProps> = ({
  cursor,
  range,
  playing,
  speed,
  loading,
  inGap,
  error,
  days,
  retentionDays,
  onSeek,
  onToggle,
  onSpeed,
  onExit,
}) => {
  const marks = useMemo(() => coverageMarks(days, range), [days, range]);

  // Only said when there is something to say. A permanent status line costs a
  // row of the map for a sentence nobody needs twice.
  const note = error
    ? error
    : inGap
      ? 'Nothing was recorded here — drag on to find history.'
      : loading
        ? 'Loading history…'
        : null;

  return (
    <div className="timelapse-panel" role="group" aria-label="Timelapse playback">
      <div className="timelapse-panel__bar">
        <button
          type="button"
          className="timelapse-panel__play"
          onClick={onToggle}
          title={playing ? 'Pause' : 'Play'}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </button>

        <div className="timelapse-panel__speeds" role="group" aria-label="Playback speed">
          {REPLAY_SPEEDS.map((option) => (
            <button
              key={option}
              type="button"
              className={`timelapse-panel__speed${option === speed ? ' is-active' : ''}`}
              onClick={() => onSpeed(option)}
              aria-pressed={option === speed}
            >
              {option}×
            </button>
          ))}
        </div>

        <button
          type="button"
          className="timelapse-panel__live"
          onClick={onExit}
          title="Return to the live map"
        >
          <Radio size={12} />
          Live
        </button>
      </div>

      <div className="timelapse-panel__timeline">
        <span className="timelapse-panel__when">
          <span className="timelapse-panel__clock">{formatCursor(cursor)}</span>
          <span className="timelapse-panel__ago">{formatAgo(cursor, range.to)}</span>
        </span>

        {/* The scrubber, with the recorded stretches shaded behind it. */}
        <div className="timelapse-panel__track">
          <div className="timelapse-panel__coverage" aria-hidden="true">
            {marks.map((mark) => (
              <span
                key={`${mark.left}-${mark.width}`}
                className="timelapse-panel__covered"
                style={{ left: `${mark.left}%`, width: `${Math.max(mark.width, 0.2)}%` }}
              />
            ))}
          </div>
          <input
            type="range"
            className="timelapse-panel__scrubber"
            min={range.from}
            max={range.to}
            step={60}
            value={Math.min(Math.max(cursor, range.from), range.to)}
            onChange={(e) => onSeek(Number(e.target.value))}
            aria-label={`Position in the last ${retentionDays} days of history, Helsinki time`}
          />
        </div>
      </div>

      {note && <div className="timelapse-panel__status">{note}</div>}
    </div>
  );
};
