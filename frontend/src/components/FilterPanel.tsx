import React from 'react';
import type { VehiclePosition } from '../types';
import { Filter, Eye, EyeOff } from 'lucide-react';

interface FilterPanelProps {
  trams: Record<string, VehiclePosition>;
  selectedLines: string[];
  onToggleLine: (line: string) => void;
  onClearFilters: () => void;
  connectionStatus: string;
}

export const FilterPanel: React.FC<FilterPanelProps> = ({
  trams,
  selectedLines,
  onToggleLine,
  onClearFilters,
  connectionStatus,
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
    <div className="glass-panel filter-panel">
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', fontSize: '0.75rem', color: '#94a3b8' }}>
        <span>Active Vehicles: <strong style={{ color: '#e2e8f0' }}>{activeVehiclesCount}</strong></span>
        {selectedLines.length > 0 && (
          <button
            onClick={onClearFilters}
            style={{ background: 'none', border: 'none', color: '#34d399', cursor: 'pointer', fontWeight: 600, padding: 0 }}
          >
            Show All
          </button>
        )}
      </div>

      {/* Filter Section */}
      <div style={{ flex: 1, overflowY: 'auto', marginTop: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', marginBottom: '12px', letterSpacing: '0.05em' }}>
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
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="legend-section">
        <div className="legend-title">Map Legend</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div className="legend-item">
            <span className="legend-color" style={{ backgroundColor: '#0984e3' }} />
            <span>Tram moving</span>
          </div>
          <div className="legend-item">
            <span className="legend-color" style={{ backgroundColor: '#e17055' }} />
            <span>Tram stopped / doors open</span>
          </div>
          <div className="legend-item">
            <span className="legend-color" style={{ backgroundColor: '#20bf6b' }} />
            <span>Tram stop (click for departures)</span>
          </div>
        </div>
      </div>
    </div>
  );
};
