import React, { useState, useMemo } from 'react';
import type { Alert } from '../types';
import { useCollapsiblePanel } from '../hooks/useCollapsiblePanel';
import { ChevronLeft, ChevronDown, Sun, Moon, Box, Route, Train, Bus, AlertTriangle, ExternalLink } from 'lucide-react';

interface FilterPanelProps {
  /**
   * Distinct line designators currently on the map, pre-sorted by App.
   * Deliberately not the full vehicle map — that changes identity on every position
   * frame and would re-render this whole panel several times a second.
   */
  activeLines: string[];
  selectedLines: string[];
  onToggleLine: (line: string) => void;
  onClearFilters: () => void;
  connectionStatus: string;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  mapTheme: 'light' | 'dark';
  setMapTheme: (theme: 'light' | 'dark') => void;
  showRouteNetwork: boolean;
  setShowRouteNetwork: (show: boolean) => void;
  is3D: boolean;
  setIs3D: (is3D: boolean) => void;
  showTrams: boolean;
  setShowTrams: (show: boolean) => void;
  showBuses: boolean;
  setShowBuses: (show: boolean) => void;
  alerts: Alert[];
  /** Line designator of the selected vehicle, if any — used only for alert filtering. */
  selectedTramDesi: string | null;
  /** GTFS route id of the selected vehicle, if any — used only for alert filtering. */
  selectedTramRoute: string | null;
  selectedStop: { id: string; name: string; code: string; } | null;
  selectedStopRoutes: string[];
}

const FilterPanelComponent: React.FC<FilterPanelProps> = ({
  activeLines,
  selectedLines,
  onToggleLine,
  onClearFilters,
  connectionStatus,
  isCollapsed,
  onToggleCollapse,
  mapTheme,
  setMapTheme,
  showRouteNetwork,
  setShowRouteNetwork,
  is3D,
  setIs3D,
  showTrams,
  setShowTrams,
  showBuses,
  setShowBuses,
  alerts = [],
  selectedTramDesi = null,
  selectedTramRoute = null,
  selectedStop = null,
  selectedStopRoutes = [],
}) => {
  const [isAlertsExpanded, setIsAlertsExpanded] = useState(false);

  const collapseProps = useCollapsiblePanel(isCollapsed, onToggleCollapse, 'Show filters');

  // Filter alerts contextually
  const filteredAlerts = useMemo(() => alerts.filter(alert => {
    // 1. Vehicle selected: show alerts affecting that vehicle's line
    if (selectedTramDesi) {
      return alert.entities?.some(entity =>
        entity.type === 'Route' && (entity.gtfsId === selectedTramRoute || entity.shortName === selectedTramDesi)
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
  }), [alerts, selectedTramDesi, selectedTramRoute, selectedStop, selectedStopRoutes, selectedLines]);

  const severeAlerts = filteredAlerts.filter((a) => a.severityLevel === 'SEVERE');
  const warningAlerts = filteredAlerts.filter((a) => a.severityLevel === 'WARNING');
  const filteredCount = filteredAlerts.length;

  // Determine widget text and badge label context
  let widgetLabel: string;
  let badgeText: string;

  if (selectedTramDesi) {
    widgetLabel = filteredCount > 0 ? `Alerts for Line ${selectedTramDesi}` : `Line ${selectedTramDesi} is clear`;
    badgeText = filteredCount > 0 ? 'ALERT' : 'OK';
  } else if (selectedStop) {
    widgetLabel = filteredCount > 0 ? `Alerts for ${selectedStop.name}` : `${selectedStop.name} is clear`;
    badgeText = filteredCount > 0 ? 'ALERT' : 'OK';
  } else if (selectedLines.length > 0) {
    const linesStr = selectedLines.join(', ');
    widgetLabel = filteredCount > 0 ? `Alerts for Line ${linesStr}` : `Selected lines are clear`;
    badgeText = filteredCount > 0 ? 'ALERT' : 'OK';
  } else {
    // No selection: Show global/system-wide alerts
    widgetLabel = filteredCount > 0 
      ? `${filteredCount} System Alert${filteredCount > 1 ? 's' : ''}` 
      : 'All systems normal';
    badgeText = filteredCount > 0 ? 'SYSTEM' : 'OK';
  }

  const getAlertBadgeColor = () => {
    if (severeAlerts.length > 0) return 'rgba(239, 68, 68, 0.2)';
    if (warningAlerts.length > 0) return 'rgba(245, 158, 11, 0.2)';
    return 'rgba(59, 130, 246, 0.2)';
  };

  const getAlertTextColor = () => {
    if (severeAlerts.length > 0) return '#f87171';
    if (warningAlerts.length > 0) return '#fbbf24';
    return '#60a5fa';
  };
  return (
    <div
      {...collapseProps}
      className={`glass-panel filter-panel ${collapseProps.className}`}
      style={{
        pointerEvents: 'auto',
      }}
    >

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
            role="status"
            aria-label={`Live feed ${connectionStatus}`}
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
            <ChevronLeft size={16} />
          </button>
        )}
      </div>

      {/* Service Alerts Widget */}
      {filteredCount > 0 && (
        <div className="settings-section" style={{ borderBottom: '1px solid var(--border-faint)', paddingBottom: '12px', marginTop: '4px' }}>
          <button
            onClick={() => filteredCount > 0 && setIsAlertsExpanded(!isAlertsExpanded)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'var(--surface-faint)',
              border: '1px solid var(--border-faint)',
              padding: filteredCount > 0 ? '8px 10px' : '5px 8px',
              borderRadius: '8px',
              cursor: filteredCount > 0 ? 'pointer' : 'default',
              color: 'var(--text-primary)',
              textAlign: 'left',
              outline: 'none',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {filteredCount > 0 && (
                <AlertTriangle size={14} style={{ color: getAlertTextColor() }} />
              )}
              <span style={{ fontSize: '0.7rem', fontWeight: 700 }}>
                {widgetLabel}
              </span>
            </div>
            {badgeText && badgeText !== 'OK' && (
              <span
                style={{
                  fontSize: '0.55rem',
                  backgroundColor: getAlertBadgeColor(),
                  color: getAlertTextColor(),
                  padding: '2px 6px',
                  borderRadius: '4px',
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '2px',
                }}
              >
                {badgeText}
                <ChevronDown
                  size={10}
                  style={{
                    transform: isAlertsExpanded ? 'rotate(180deg)' : 'none',
                    transition: 'transform 0.2s ease',
                    marginLeft: '2px',
                  }}
                />
              </span>
            )}
          </button>

          {isAlertsExpanded && filteredCount > 0 && (
            <div
              style={{
                marginTop: '8px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                maxHeight: '220px',
                overflowY: 'auto',
                paddingRight: '4px',
              }}
            >
              {filteredAlerts.map((alert, idx) => {
                const severityColor =
                  alert.severityLevel === 'SEVERE'
                    ? '#ef4444'
                    : alert.severityLevel === 'WARNING'
                    ? '#f59e0b'
                    : '#3b82f6';
                return (
                  <div
                    key={idx}
                    style={{
                      background: 'var(--surface-faint)',
                      border: `1px solid var(--border-faint)`,
                      borderLeft: `3px solid ${severityColor}`,
                      padding: '8px',
                      borderRadius: '4px',
                      fontSize: '0.65rem',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '4px' }}>
                      <h4 style={{ margin: 0, fontWeight: 700, color: 'var(--text-strong)', fontSize: '0.65rem' }}>
                        {alert.headerText}
                      </h4>
                    </div>
                    <p style={{ margin: '4px 0', color: 'var(--text-secondary)', lineHeight: 1.3 }}>
                      {alert.descriptionText}
                    </p>
                    
                    {/* Affected lines */}
                    {alert.entities && alert.entities.some(e => e.type === 'Route') && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px' }}>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.55rem', alignSelf: 'center' }}>Lines:</span>
                        {alert.entities
                          .filter(e => e.type === 'Route' && e.shortName)
                          .map((e, eIdx) => (
                            <span
                              key={eIdx}
                              style={{
                                fontSize: '0.55rem',
                                backgroundColor: e.mode === 'BUS' ? '#0984e3' : '#00b894',
                                color: '#fff',
                                padding: '1px 4px',
                                borderRadius: '3px',
                                fontWeight: 800,
                              }}
                            >
                              {e.shortName}
                            </span>
                          ))}
                      </div>
                    )}

                    {/* Affected stops */}
                    {alert.entities && alert.entities.some(e => e.type === 'Stop') && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.55rem', alignSelf: 'center' }}>Stops:</span>
                        {alert.entities
                          .filter(e => e.type === 'Stop' && e.name)
                          .slice(0, 3)
                          .map((e, eIdx) => (
                            <span
                              key={eIdx}
                              style={{
                                fontSize: '0.55rem',
                                backgroundColor: 'var(--border-faint)',
                                color: 'var(--text-body)',
                                padding: '1px 4px',
                                borderRadius: '3px',
                                maxWidth: '80px',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                              }}
                              title={`${e.name} (${e.code})`}
                            >
                              {e.name}
                            </span>
                          ))}
                        {alert.entities.filter(e => e.type === 'Stop').length > 3 && (
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.55rem', alignSelf: 'center' }}>
                            +{alert.entities.filter(e => e.type === 'Stop').length - 3} more
                          </span>
                        )}
                      </div>
                    )}

                    {alert.url && (
                      <a
                        href={alert.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '2px',
                          color: '#38bdf8',
                          textDecoration: 'none',
                          marginTop: '6px',
                          fontWeight: 600,
                          fontSize: '0.55rem',
                        }}
                      >
                        Read more <ExternalLink size={8} />
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

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
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', padding: '16px 0', textAlign: 'center' }}>
            Waiting for live vehicle stream...
          </div>
        ) : (
          <div className="line-grid" style={{ marginTop: '8px' }}>
            {activeLines.map((line) => {
              const isSelected = selectedLines.includes(line);
              return (
                <button
                  key={line}
                  onClick={() => onToggleLine(line)}
                  className={`line-btn ${isSelected ? 'active' : ''}`}
                  aria-pressed={isSelected}
                  aria-label={`Line ${line}`}
                >
                  <span className="line-btn-label">{line}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="legend-section">
        <div className="legend-title">Legend</div>
        <div className="legend-list">
          <div className="legend-item">
            <span className="legend-color" style={{ backgroundColor: '#0984e3' }} />
            <span>Moving</span>
          </div>
          <div className="legend-item">
            <span className="legend-color is-stopped" style={{ backgroundColor: '#e17055' }} />
            <span>Stopped</span>
          </div>
        </div>
      </div>

      {/* Map Settings */}
      <div className="settings-section">
        <div className="legend-title">Settings</div>
        <div className="settings-grid">
          {/* Theme Toggle */}
          <button
            className={`settings-btn ${mapTheme === 'dark' ? 'active' : ''}`}
            aria-pressed={mapTheme === 'dark'}
            onClick={() => setMapTheme(mapTheme === 'light' ? 'dark' : 'light')}
            title="Toggle light/dark theme"
          >
            <span className="settings-btn-icon">
              {mapTheme === 'light' ? <Sun size={12} /> : <Moon size={12} />}
            </span>
            <span>{mapTheme === 'light' ? 'Light' : 'Dark'}</span>
          </button>

          {/* 3D Map Toggle */}
          <button
            className={`settings-btn ${is3D ? 'active' : ''}`}
            aria-pressed={is3D}
            onClick={() => setIs3D(!is3D)}
            title="Toggle 3D map mode"
          >
            <span className="settings-btn-icon">
              <Box size={12} />
            </span>
            <span>3D Map</span>
          </button>

          {/* Route Network Toggle */}
          <button
            className={`settings-btn ${showRouteNetwork ? 'active' : ''}`}
            aria-pressed={showRouteNetwork}
            onClick={() => setShowRouteNetwork(!showRouteNetwork)}
            title="Toggle background route network"
          >
            <span className="settings-btn-icon">
              <Route size={12} />
            </span>
            <span>Routes</span>
          </button>

          {/* Trams Toggle */}
          <button
            className={`settings-btn ${showTrams ? 'active' : ''}`}
            aria-pressed={showTrams}
            onClick={() => setShowTrams(!showTrams)}
            title="Toggle Trams"
          >
            <span className="settings-btn-icon">
              <Train size={12} />
            </span>
            <span>Trams</span>
          </button>

          {/* Buses Toggle */}
          <button
            className={`settings-btn ${showBuses ? 'active' : ''}`}
            aria-pressed={showBuses}
            onClick={() => setShowBuses(!showBuses)}
            title="Toggle Buses"
          >
            <span className="settings-btn-icon">
              <Bus size={12} />
            </span>
            <span>Buses</span>
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * Memoised: the panel's props are all scalars, stable callbacks or content-stable arrays,
 * so it no longer re-renders on every vehicle position frame.
 */
export const FilterPanel = React.memo(FilterPanelComponent);
