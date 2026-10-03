import React, { useMemo, useState } from 'react';
import type { VehiclePosition, Alert } from '../types';
import { ChevronLeft, ChevronRight, ChevronDown, SlidersHorizontal, AlertTriangle, ExternalLink } from 'lucide-react';
import { useIsMobile } from '../hooks/useIsMobile';
import { usePanelSwipe } from '../hooks/usePanelSwipe';
import { getRouteColor, BUS_BLUE } from '../lib/routeColors';
import { asTransportMode, type ModeFlags } from '../lib/modes';
import { headwayColor, lineRegularity, regularityIssues } from '../lib/headways';
import { LineSpacing } from './LineSpacing';

interface FilterPanelProps {
  trams: Record<string, VehiclePosition>;
  selectedLines: string[];
  onToggleLine: (line: string) => void;
  onClearFilters: () => void;
  connectionStatus: string;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  /** Mode visibility, used to keep the line list in step with the map. The
      switches themselves live in the map's corner chip groups. */
  modes: ModeFlags;
  alerts: Alert[];
  selectedTram: VehiclePosition | null;
  selectedStop: { id: string; name: string; code: string; } | null;
  selectedStopRoutes: string[];
  /** Select a vehicle by its key: what picking a bunch or a gap does. */
  onSelectVehicle: (veh: string) => void;
}

export const FilterPanel: React.FC<FilterPanelProps> = ({
  trams,
  selectedLines,
  onToggleLine,
  onClearFilters,
  connectionStatus,
  isCollapsed,
  onToggleCollapse,
  modes,
  alerts = [],
  selectedTram = null,
  selectedStop = null,
  selectedStopRoutes = [],
  onSelectVehicle,
}) => {
  const [isAlertsExpanded, setIsAlertsExpanded] = useState(false);
  const isMobile = useIsMobile();
  const swipe = usePanelSwipe('left', isCollapsed, onToggleCollapse);

  // Filter alerts contextually
  const filteredAlerts = alerts.filter(alert => {
    // 1. Vehicle selected: show alerts affecting that vehicle's line
    if (selectedTram) {
      return alert.entities?.some(entity =>
        entity.type === 'Route' && (entity.gtfsId === selectedTram.route || entity.shortName === selectedTram.desi)
      );
    }
    
    // 2. Stop selected: show alerts affecting the stop or serving lines
    if (selectedStop) {
      return alert.entities?.some(entity =>
        (entity.type === 'Stop' && entity.gtfsId === selectedStop.id) ||
        (entity.type === 'Route' && selectedStopRoutes.includes(entity.shortName || ''))
      );
    }

    // 3. Line filters active: show alerts affecting checked lines
    if (selectedLines.length > 0) {
      return alert.entities?.some(entity =>
        entity.type === 'Route' && selectedLines.includes(entity.shortName || '')
      );
    }

    // 4. No active selection: show ONLY global/system-wide alerts
    const hasSpecificRouteOrStop = alert.entities?.some(
      entity => entity.type === 'Route' || entity.type === 'Stop'
    );
    return !hasSpecificRouteOrStop;
  });

  const severeAlerts = filteredAlerts.filter((a) => a.severityLevel === 'SEVERE');
  const warningAlerts = filteredAlerts.filter((a) => a.severityLevel === 'WARNING');
  const filteredCount = filteredAlerts.length;

  // What the alerts are about, in the summary row. Only rendered while there
  // is at least one alert to show.
  let widgetLabel: string;
  if (selectedTram) {
    widgetLabel = `Line ${selectedTram.desi}`;
  } else if (selectedStop) {
    widgetLabel = selectedStop.name;
  } else if (selectedLines.length > 0) {
    widgetLabel = `Line${selectedLines.length > 1 ? 's' : ''} ${selectedLines.join(', ')}`;
  } else {
    widgetLabel = 'Network';
  }

  const worstSeverity = severeAlerts.length > 0 ? 'severe' : warningAlerts.length > 0 ? 'warning' : 'info';
  // Bunches and gaps on the lines the map is showing — narrowed, like the alerts
  // above, to the reader's own lines once they have picked some.
  const spacingIssues = useMemo(() => {
    const shown = Object.fromEntries(
      Object.entries(trams).filter(([, t]) => {
        const mode = asTransportMode(t.mode);
        return mode === null || modes[mode];
      }),
    );
    const issues = regularityIssues(shown);
    return selectedLines.length > 0 ? issues.filter((i) => selectedLines.includes(i.line)) : issues;
  }, [trams, modes, selectedLines]);
  const lineSpacing = lineRegularity(spacingIssues);

  const activeLines = Array.from(
    new Set(
      Object.values(trams)
        .filter((t) => {
          const mode = asTransportMode(t.mode);
          return mode === null || modes[mode];
        })
        .map((t) => t.desi)
    )
  ).sort((a, b) => {
    const numA = parseInt(a);
    const numB = parseInt(b);
    if (isNaN(numA) && isNaN(numB)) return a.localeCompare(b);
    if (isNaN(numA)) return 1;
    if (isNaN(numB)) return -1;
    return numA - numB;
  });

  return (
    <div
      className={`glass-panel filter-panel ${isCollapsed ? 'collapsed' : ''}`}
      style={{
        pointerEvents: 'auto',
      }}
      {...swipe}
      onClick={() => {
        if (isCollapsed) {
          onToggleCollapse();
        }
      }}
    >
      {/* Drag handle affordance (mobile bottom-sheet only) */}
      <div className="sheet-handle" onClick={() => !isCollapsed && onToggleCollapse()} />

      {/* Collapse/Expand Toggle Tab */}
      <button
        className="filter-toggle-tab"
        onClick={onToggleCollapse}
        aria-label={isCollapsed ? 'Show Filters' : 'Hide Filters'}
      >
        <span className="icon-desktop">
          {isCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </span>
        <span className="icon-mobile">
          {isCollapsed ? <SlidersHorizontal size={14} /> : <ChevronDown size={14} />}
        </span>
      </button>

      {/* Header */}
      <div className="panel-header" style={{ paddingBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: '6px', margin: 0 }}>
          HSL - LIVE
          <span
            className={`status-dot ${
              connectionStatus === 'connected'
                ? 'connected'
                : connectionStatus === 'connecting'
                ? 'connecting'
                : 'disconnected'
            }`}
            title={`WebSocket: ${connectionStatus}`}
            style={{ width: '8px', height: '8px', borderRadius: '50%', display: 'inline-block' }}
          />
        </h1>
        {!isCollapsed && (
          <button
            className="mobile-close-btn"
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
            {isMobile ? <ChevronDown size={16} /> : <ChevronLeft size={16} />}
          </button>
        )}
      </div>

      {/* Service alerts — a summary row naming the worst alert, which unfolds
          into the full list. */}
      {filteredCount > 0 && (
        <section className="panel-alerts" aria-label="Service alerts">
          <button
            type="button"
            className={`panel-alerts-summary severity-${worstSeverity}`}
            onClick={() => setIsAlertsExpanded(!isAlertsExpanded)}
            aria-expanded={isAlertsExpanded}
          >
            <AlertTriangle size={16} className="panel-alerts-icon" />
            <span className="panel-alerts-text">
              <span className="panel-alerts-label">
                {filteredCount === 1 ? '1 alert' : `${filteredCount} alerts`}
                <span className="panel-alerts-scope"> · {widgetLabel}</span>
              </span>
              {!isAlertsExpanded && (
                <span className="panel-alerts-preview">{filteredAlerts[0].headerText}</span>
              )}
            </span>
            <ChevronDown
              size={16}
              className="panel-alerts-chevron"
              style={{ transform: isAlertsExpanded ? 'rotate(180deg)' : 'none' }}
            />
          </button>

          {isAlertsExpanded && (
            <div className="panel-alerts-list">
              {filteredAlerts.map((alert, idx) => {
                const routes = alert.entities?.filter((e) => e.type === 'Route' && e.shortName) ?? [];
                const stops = alert.entities?.filter((e) => e.type === 'Stop' && e.name) ?? [];
                return (
                  <article key={idx} className={`panel-alert severity-${alert.severityLevel.toLowerCase()}`}>
                    <h4 className="panel-alert-title">{alert.headerText}</h4>
                    {alert.descriptionText && alert.descriptionText !== alert.headerText && (
                      <p className="panel-alert-desc">{alert.descriptionText}</p>
                    )}

                    {routes.length > 0 && (
                      <div className="panel-alert-tags">
                        <span className="panel-alert-tags-label">Lines</span>
                        {routes.map((e, eIdx) => (
                          <span
                            key={eIdx}
                            className="panel-alert-line"
                            style={{ backgroundColor: e.mode === 'BUS' ? BUS_BLUE : getRouteColor(e.shortName) }}
                          >
                            {e.shortName}
                          </span>
                        ))}
                      </div>
                    )}

                    {stops.length > 0 && (
                      <div className="panel-alert-tags">
                        <span className="panel-alert-tags-label">Stops</span>
                        {stops.slice(0, 3).map((e, eIdx) => (
                          <span key={eIdx} className="panel-alert-stop" title={`${e.name} (${e.code})`}>
                            {e.name}
                          </span>
                        ))}
                        {stops.length > 3 && (
                          <span className="panel-alert-tags-label">+{stops.length - 3} more</span>
                        )}
                      </div>
                    )}

                    {alert.url && (
                      <a className="panel-alert-link" href={alert.url} target="_blank" rel="noopener noreferrer">
                        Read more <ExternalLink size={11} />
                      </a>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      <LineSpacing issues={spacingIssues} onSelectVehicle={onSelectVehicle} />

      {/* Filter Section */}
      <div className="filter-scroll-area" style={{ marginTop: '8px' }}>
        {selectedLines.length > 0 && (
          <div className="panel-header-row">
            <div style={{ flexGrow: 1 }} />
            <button onClick={onClearFilters} className="clear-filters-btn">
              Show All
            </button>
          </div>
        )}

        {activeLines.length === 0 ? (
          <div style={{ fontSize: '0.75rem', color: '#64748b', padding: '16px 0', textAlign: 'center' }}>
            Waiting for live vehicle stream...
          </div>
        ) : (
          <div className="line-grid" style={{ marginTop: '8px' }}>
            {activeLines.map((line) => {
              const isSelected = selectedLines.includes(line);
              const routeColor = getRouteColor(line);
              const spacing = lineSpacing[line];
              const spacingLabel = spacing === 'bunched' ? 'Bunched' : spacing === 'gap' ? 'Gap in service' : null;
              return (
                <button
                  key={line}
                  onClick={() => onToggleLine(line)}
                  className={`line-btn ${isSelected ? 'active' : ''}`}
                  aria-label={spacingLabel ? `Line ${line}, ${spacingLabel.toLowerCase()}` : undefined}
                  title={spacingLabel ?? undefined}
                  style={{
                    // Tint each chip by its route colour: filled when active,
                    // a colour accent (left bar + border) when idle.
                    backgroundColor: isSelected ? routeColor : undefined,
                    borderColor: routeColor,
                    boxShadow: isSelected ? 'none' : `inset 3px 0 0 ${routeColor}`,
                  }}
                >
                  <span
                    className="line-btn-label"
                    style={{ color: isSelected ? '#ffffff' : undefined }}
                  >
                    {line}
                  </span>
                  {spacing && (
                    <span
                      className="line-btn-pip"
                      style={{ '--pip-color': headwayColor(spacing) } as React.CSSProperties}
                      aria-hidden="true"
                    />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
