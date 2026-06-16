/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { useTramData } from './hooks/useTramData';
import { Map } from './components/Map';
import { FilterPanel } from './components/FilterPanel';
import { TramPopup } from './components/TramPopup';
import { TramCard } from './components/TramCard';
import { StopPopup } from './components/StopPopup';
import { VersionBadge } from './components/VersionBadge';
import { fetchRouteDetails } from './lib/api';
import type { VehiclePosition } from './types';

function App() {
  const { trams, handleUpdate } = useTramData();
  const { status: connectionStatus } = useWebSocket({ onMessage: (data) => handleUpdate(data.vehicles) });

  // UI Selection States
  const [selectedTram, setSelectedTram] = useState<VehiclePosition | null>(null);
  const [selectedStop, setSelectedStop] = useState<{
    id: string;
    name: string;
    code: string;
  } | null>(null);

  // Route name reported back from TramPopup for the TramCard
  const [tramRouteName, setTramRouteName] = useState<string | undefined>(undefined);

  // Sidebar collapse state: defaults to collapsed on mobile, open on desktop
  const [isFilterCollapsed, setIsFilterCollapsed] = useState<boolean>(
    typeof window !== 'undefined' ? window.innerWidth <= 768 : false
  );

  // Auto-collapse sidebar when a tram or stop is selected on mobile
  useEffect(() => {
    if ((selectedTram || selectedStop) && window.innerWidth <= 768) {
      setIsFilterCollapsed(true);
    }
  }, [selectedTram, selectedStop]);

  // Clear route name when tram changes
  useEffect(() => {
    setTramRouteName(undefined);
  }, [selectedTram?.tripId]);

  // Line & Stop filtering states
  const [selectedLines, setSelectedLines] = useState<string[]>([]);
  // null = no stop filter active; string[] = only show these tripIds
  const [stopTripIds, setStopTripIds] = useState<string[] | null>(null);
  const [routeGeometries, setRouteGeometries] = useState<Record<string, { geometries: string[]; color?: string }>>({});

  // Fetch route geometries when selectedLines filter or selectedTram changes
  useEffect(() => {
    const linesToHighlight = [...selectedLines];
    if (selectedTram && !linesToHighlight.includes(selectedTram.desi)) {
      linesToHighlight.push(selectedTram.desi);
    }

    if (linesToHighlight.length === 0) {
      setRouteGeometries({});
      return;
    }

    setRouteGeometries((prev) => {
      const updated = { ...prev };
      Object.keys(updated).forEach((line) => {
        if (!linesToHighlight.includes(line)) {
          delete updated[line];
        }
      });
      return updated;
    });

    linesToHighlight.forEach((line) => {
      if (!routeGeometries[line]) {
        fetchRouteDetails(line)
          .then((data) => {
            setRouteGeometries((prev) => ({
              ...prev,
              [line]: {
                geometries: data.geometries,
                color: data.color,
              },
            }));
          })
          .catch((err) => {
            console.error(`Failed to fetch route geometry for ${line}:`, err);
          });
      }
    });
  }, [selectedLines, selectedTram]);

  const handleSelectTram = (tram: VehiclePosition | null) => {
    setSelectedStop(null);
    setStopTripIds(null);
    setSelectedTram(tram);
  };

  const handleSelectStop = (stopId: string, name: string, code: string) => {
    setSelectedTram(null);
    setStopTripIds(null); // Reset stop filter to show all trams while loading the new stop
    setSelectedStop({ id: stopId, name, code });
  };

  const handleCloseStop = () => {
    setSelectedStop(null);
    setStopTripIds(null);
  };

  const handleToggleLine = (line: string) => {
    setSelectedLines((prev) =>
      prev.includes(line) ? prev.filter((l) => l !== line) : [...prev, line]
    );
  };

  const handleClearFilters = () => {
    setSelectedLines([]);
  };

  const handleSelectTripFromStop = (tripId: string, lineDesi: string) => {
    // Find if the tram for this trip is currently online
    const matchedTram = Object.values(trams).find((t) => t.tripId === tripId);
    setStopTripIds(null);
    if (matchedTram) {
      setSelectedStop(null);
      setSelectedTram(matchedTram);
    } else {
      // Tram not online yet — build a stub so we can still show the schedule
      const dummyTram: VehiclePosition = {
        veh: 0,
        desi: lineDesi || '?',
        lat: 0,
        lng: 0,
        hdg: 0,
        spd: 0,
        dl: 0,
        drst: 0,
        route: '',
        stop: null,
        ts: Date.now() / 1000,
        tripId: tripId,
      };
      setSelectedStop(null);
      setSelectedTram(dummyTram);
    }
  };

  // Stop departure filter: only filter after trip IDs are loaded.
  // While loading (selectedStop set but stopTripIds not yet arrived) keep all trams visible.
  const displayedTrams = Object.fromEntries(
    Object.entries(trams).filter((entry) => {
      const tram = entry[1];
      if (selectedLines.length > 0 && !selectedLines.includes(tram.desi)) {
        return false;
      }
      // Only filter by stop trips when we actually have the list
      if (stopTripIds !== null && !stopTripIds.includes(tram.tripId)) {
        return false;
      }
      return true;
    })
  );

  // The live tram being tracked (prefer live data over stale selectedTram snapshot)
  const liveTram = selectedTram
    ? (selectedTram.veh ? trams[selectedTram.veh] || selectedTram : selectedTram)
    : null;

  const handleCloseTram = () => {
    setSelectedTram(null);
    setStopTripIds(null);
  };

  return (
    <div className="dashboard-container">
      {/* Fullscreen Map Canvas */}
      <Map
        trams={displayedTrams}
        selectedTramId={selectedTram?.veh ? `${selectedTram.veh}` : selectedTram?.tripId || null}
        onSelectTram={handleSelectTram}
        onSelectStop={handleSelectStop}
        lineFilters={selectedLines}
        routeGeometries={routeGeometries}
      />

      {/* Sidebar Filters Panel */}
      <FilterPanel
        trams={trams}
        selectedLines={selectedLines}
        onToggleLine={handleToggleLine}
        onClearFilters={handleClearFilters}
        connectionStatus={connectionStatus}
        isCollapsed={isFilterCollapsed}
        onToggleCollapse={() => setIsFilterCollapsed(!isFilterCollapsed)}
      />

      {/* Floating top-center tram telemetry card */}
      {liveTram && liveTram.veh !== 0 && (
        <TramCard
          tram={liveTram}
          routeName={tramRouteName}
          onClose={handleCloseTram}
        />
      )}

      {/* Schedule detail panel (right side) */}
      {selectedTram && (
        <TramPopup
          tram={liveTram!}
          onClose={handleCloseTram}
          onRouteNameReady={setTramRouteName}
        />
      )}

      {/* Selected Stop Timetable Panel */}
      {selectedStop && (
        <StopPopup
          stopId={selectedStop.id}
          stopName={selectedStop.name}
          stopCode={selectedStop.code}
          onClose={handleCloseStop}
          onSelectTripId={(tripId, lineDesi) => handleSelectTripFromStop(tripId, lineDesi)}
          onStopDeparturesLoaded={setStopTripIds}
        />
      )}

      {/* Version Badge */}
      <VersionBadge />
    </div>
  );
}

export default App;
