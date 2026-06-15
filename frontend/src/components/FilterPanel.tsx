import React from 'react';
import type { VehiclePosition } from '../types';
import { Filter, Eye, EyeOff, ChevronLeft, ChevronRight, ChevronDown, SlidersHorizontal } from 'lucide-react';

interface FilterPanelProps {
  trams: Record<string, VehiclePosition>;
  selectedLines: string[];
  onToggleLine: (line: string) => void;
  onClearFilters: () => void;
  connectionStatus: string;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export const FilterPanel: React.FC<FilterPanelProps> = ({
  trams,
  selectedLines,
  onToggleLine,
  onClearFilters,
  connectionStatus,
  isCollapsed,
  onToggleCollapse,
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

  const activeVehiclesCount = Object.keys(trams).length;

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
      <div className="panel-header">
        <div>
          <h1 className="panel-title">Ratikka Live</h1>
          <p className="panel-subtitle">Helsinki Live Tram Map</p>
        </div>

        {/* Connection status indicator */}
        <div className="status-pill">
          <span
            className={`status-dot ${
              connectionStatus === 'connected'
                ? 'connected'
                : connectionStatus === 'connecting'
                ? 'connecting'
                : 'disconnected'
            }`}
          />
          <span className="status-text">{connectionStatus}</span>
        </div>
      </div>

      {/* Stats */}
      <div className="panel-stats">
        <span className="stats-active-vehicles">Active Vehicles: <strong style={{ color: '#e2e8f0' }}>{activeVehiclesCount}</strong></span>
        <span className="stats-active-vehicles-compact">Active: <strong style={{ color: '#e2e8f0' }}>{activeVehiclesCount}</strong></span>
        {selectedLines.length > 0 && (
          <button
            onClick={onClearFilters}
            className="clear-filters-btn"
          >
            Show All
          </button>
        )}
      </div>

      {/* Filter Section */}
      <div className="filter-scroll-area">
        <div className="filter-section-title">
          <Filter size={12} />
          <span>Filter by Line</span>
        </div>

        {activeLines.length === 0 ? (
          <div style={{ fontSize: '0.75rem', color: '#64748b', padding: '16px 0', textAlign: 'center' }}>
            Waiting for live vehicle stream...
          </div>
        ) : (
          <div className="line-grid">
            {activeLines.map((line) => {
              const isSelected = selectedLines.includes(line);
              const lineCount = Object.values(trams).filter((t) => t.desi === line).length;

              return (
                <button
                  key={line}
                  onClick={() => onToggleLine(line)}
                  className={`line-btn ${isSelected ? 'active' : ''}`}
                >
                  <span className="line-btn-label">{line}</span>
                  <span className="line-btn-count">
                    {lineCount} {lineCount === 1 ? 'tram' : 'trams'}
                  </span>
                  <span className="line-btn-icon">
                    {isSelected ? <Eye size={10} /> : <EyeOff size={10} />}
                  </span>
                  <span className="mobile-line-badge">{lineCount}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="legend-section">
        <div className="legend-title">Map Legend</div>
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
    </div>
  );
};
