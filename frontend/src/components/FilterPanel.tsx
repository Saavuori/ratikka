import React from 'react';
import type { VehiclePosition } from '../types';
import { Filter, ChevronLeft, ChevronRight, ChevronDown, SlidersHorizontal, Sun, Moon, Box, Route } from 'lucide-react';

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
}) => {
  const activeLines = Array.from(
    new Set(Object.values(trams).map((t) => t.desi))
  ).sort((a, b) => {
    const numA = parseInt(a);
    const numB = parseInt(b);
    if (isNaN(numA) && isNaN(numB)) return a.localeCompare(b);
    if (isNaN(numA)) return 1;
    if (isNaN(numB)) return -1;
    return numA - numB;
  });

  return (
    <div className={`glass-panel filter-panel ${isCollapsed ? 'collapsed' : ''}`}>
      {/* Collapse/Expand Toggle Tab */}
      <button
        className="filter-toggle-tab"
        onClick={onToggleCollapse}
        aria-label={isCollapsed ? 'Show Filters' : 'Hide Filters'}
      >
        <span className="icon-desktop">
          {isCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </span>
        <span className="icon-mobile">
          {isCollapsed ? <SlidersHorizontal size={18} /> : <ChevronDown size={18} />}
        </span>
      </button>

      {/* Header */}
      <div className="panel-header" style={{ paddingBottom: '8px' }}>
        <h1 className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: '6px', margin: 0 }}>
          Ratikka
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
      </div>

      {/* Filter Section */}
      <div className="filter-scroll-area" style={{ marginTop: '8px' }}>
        <div className="panel-header-row">
          <div className="filter-section-title" style={{ marginBottom: 0 }}>
            <Filter size={12} />
            <span>Lines</span>
          </div>
          {selectedLines.length > 0 && (
            <button onClick={onClearFilters} className="clear-filters-btn">
              Show All
            </button>
          )}
        </div>

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
          <div className="legend-item">
            <span className="legend-color" style={{ backgroundColor: '#20bf6b' }} />
            <span>Stop</span>
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
        </div>
      </div>
    </div>
  );
};
