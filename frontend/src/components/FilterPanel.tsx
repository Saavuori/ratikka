import React, { useState } from 'react';
import type { VehiclePosition, Alert } from '../types';
import { ChevronLeft, ChevronRight, ChevronDown, SlidersHorizontal, Sun, Moon, Box, Route, Train, Bus, AlertTriangle, ExternalLink } from 'lucide-react';

interface FilterPanelProps {
  trams: Record<string, VehiclePosition>;
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
  selectedTram: VehiclePosition | null;
  selectedStop: { id: string; name: string; code: string; } | null;
  selectedStopRoutes: string[];
}

export const FilterPanel: React.FC<FilterPanelProps> = ({
  trams,
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
  selectedTram = null,
  selectedStop = null,
  selectedStopRoutes = [],
}) => {
  const [isAlertsExpanded, setIsAlertsExpanded] = useState(false);
  const [touchStart, setTouchStart] = useState<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStart(e.touches[0].clientX);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStart === null) return;
    const currentX = e.touches[0].clientX;
    const diff = currentX - touchStart;

    // Swipe left (at least 45px) to collapse
    if (diff < -45 && !isCollapsed) {
      onToggleCollapse();
      setTouchStart(null);
    }
    // Swipe right (at least 45px) to expand
    else if (diff > 45 && isCollapsed) {
      onToggleCollapse();
      setTouchStart(null);
    }
  };

  const handleTouchEnd = () => {
    setTouchStart(null);
  };

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

  // Determine widget text and badge label context
  let widgetLabel = 'All services normal';
  let badgeText = '';

  if (selectedTram) {
    widgetLabel = filteredCount > 0 ? `Alerts for Line ${selectedTram.desi}` : `Line ${selectedTram.desi} is clear`;
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
  const activeLines = Array.from(
    new Set(
      Object.values(trams)
        .filter((t) => {
          if (t.mode === 'tram' && !showTrams) return false;
          if (t.mode === 'bus' && !showBuses) return false;
          return true;
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
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onClick={() => {
        if (isCollapsed) {
          onToggleCollapse();
        }
      }}
    >
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
            <ChevronLeft size={16} />
          </button>
        )}
      </div>

      {/* Service Alerts Widget */}
      {filteredCount > 0 && (
        <div className="settings-section" style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)', paddingBottom: '12px', marginTop: '4px' }}>
          <button
            onClick={() => filteredCount > 0 && setIsAlertsExpanded(!isAlertsExpanded)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid rgba(255, 255, 255, 0.06)',
              padding: filteredCount > 0 ? '8px 10px' : '5px 8px',
              borderRadius: '8px',
              cursor: filteredCount > 0 ? 'pointer' : 'default',
              color: '#f8fafc',
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
                      background: 'rgba(255, 255, 255, 0.01)',
                      border: `1px solid rgba(255, 255, 255, 0.03)`,
                      borderLeft: `3px solid ${severityColor}`,
                      padding: '8px',
                      borderRadius: '4px',
                      fontSize: '0.65rem',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '4px' }}>
                      <h4 style={{ margin: 0, fontWeight: 700, color: '#f1f5f9', fontSize: '0.65rem' }}>
                        {alert.headerText}
                      </h4>
                    </div>
                    <p style={{ margin: '4px 0', color: '#94a3b8', lineHeight: 1.3 }}>
                      {alert.descriptionText}
                    </p>
                    
                    {/* Affected lines */}
                    {alert.entities && alert.entities.some(e => e.type === 'Route') && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px' }}>
                        <span style={{ color: '#64748b', fontSize: '0.55rem', alignSelf: 'center' }}>Lines:</span>
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
                        <span style={{ color: '#64748b', fontSize: '0.55rem', alignSelf: 'center' }}>Stops:</span>
                        {alert.entities
                          .filter(e => e.type === 'Stop' && e.name)
                          .slice(0, 3)
                          .map((e, eIdx) => (
                            <span
                              key={eIdx}
                              style={{
                                fontSize: '0.55rem',
                                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                                color: '#cbd5e1',
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
                          <span style={{ color: '#64748b', fontSize: '0.55rem', alignSelf: 'center' }}>
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
          <div style={{ fontSize: '0.75rem', color: '#64748b', padding: '16px 0', textAlign: 'center' }}>
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
            <span className="legend-color" style={{ backgroundColor: '#e17055' }} />
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
