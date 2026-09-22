import React, { useState } from 'react';
import { describeIssue, headwayColor } from '../lib/headways';
import type { RegularityIssue } from '../lib/headways';
import { BUS_BLUE, getRouteColor } from '../lib/routeColors';
import './lineSpacing.css';

interface LineSpacingProps {
  /** The problems to list, worst first (see `regularityIssues`). */
  issues: RegularityIssue[];
  /** Select a vehicle, which also brings the map to it. */
  onSelectVehicle: (veh: string) => void;
}

// A narrow panel holds a few of these before the line buttons are pushed out
// of sight, and the worst few are the ones worth reading.
const SHOWN = 3;

/**
 * Where the lines are not running the way the timetable spaces them: vehicles
 * bunched together, and the gaps left behind them. Each entry takes the reader
 * to the vehicle it is about.
 *
 * Nothing at all is shown while every measured line is running evenly — and
 * nothing is claimed about the lines not yet measured, which after a restart is
 * all of them for one headway's worth of minutes.
 */
export const LineSpacing: React.FC<LineSpacingProps> = ({ issues, onSelectVehicle }) => {
  const [expanded, setExpanded] = useState(false);
  if (issues.length === 0) return null;

  const bunched = issues.filter((i) => i.kind === 'bunched').length;
  const gaps = issues.length - bunched;
  const shown = expanded ? issues : issues.slice(0, SHOWN);
  const summary = [
    bunched > 0 ? `${bunched} bunched` : null,
    gaps > 0 ? `${gaps} gap${gaps === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <section className="line-spacing" aria-label="Line spacing">
      <div className="line-spacing-head">
        <span>Spacing</span>
        <span className="line-spacing-summary">{summary}</span>
      </div>
      <ul className="line-spacing-list">
        {shown.map((issue) => {
          const color = headwayColor(issue.kind);
          const detail = describeIssue(issue);
          return (
            <li key={`${issue.kind}-${issue.focus}`}>
              <button
                type="button"
                className="line-spacing-item"
                style={{ '--issue-color': color } as React.CSSProperties}
                onClick={() => onSelectVehicle(issue.focus)}
                aria-label={`Line ${issue.line}: ${issue.kind === 'bunched' ? 'bunched' : 'gap'}, ${detail}`}
              >
                <span
                  className="line-spacing-line"
                  style={{ backgroundColor: issue.mode === 'bus' ? BUS_BLUE : getRouteColor(issue.line) }}
                >
                  {issue.line}
                </span>
                <span className="line-spacing-text">
                  <span className="line-spacing-kind">{issue.kind === 'bunched' ? 'Bunched' : 'Gap'}</span>
                  <span className="line-spacing-detail">{detail}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {issues.length > SHOWN && (
        <button type="button" className="line-spacing-more" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show fewer' : `Show all ${issues.length}`}
        </button>
      )}
    </section>
  );
};
