import { useState, useEffect } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { useTramData } from './hooks/useTramData';
import { Map } from './components/Map';
import { FilterPanel } from './components/FilterPanel';
import { TramPopup } from './components/TramPopup';
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

  // Line & Stop filtering states
  const [selectedLines, setSelectedLines] = useState<string[]>([]);
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
    setSelectedStop(null); // Mutually exclusive view
    setStopTripIds(null);
    setSelectedTram(tram);
  };

  const handleSelectStop = (stopId: string, name: string, code: string) => {
    setSelectedTram(null); // Mutually exclusive view
    setStopTripIds(null);
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

  const handleSelectTripFromStop = (tripId: string) => {
    // Find if the tram for this trip is currently online in our live cache
    const matchedTram = Object.values(trams).find((t) => t.tripId === tripId);
    setStopTripIds(null);
    if (matchedTram) {
      setSelectedStop(null);
      setSelectedTram(matchedTram);
    } else {
      // If the vehicle is not online, we can still construct a temporary mock tram view to query details
      const dummyTram: VehiclePosition = {
        veh: 0,
        desi: 'T',
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

  // Filter trams displayed on the map by selected line AND selected stop departures
  const displayedTrams = Object.fromEntries(
    Object.entries(trams).filter(([_, tram]) => {
      // Filter by selected lines if any
      if (selectedLines.length > 0 && !selectedLines.includes(tram.desi)) {
        return false;
      }
      // Filter by stop departures if active
      if (stopTripIds !== null && !stopTripIds.includes(tram.tripId)) {
        return false;
      }
      return true;
    })
  );

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

      {/* Sidebar Filters Panel - receives unfiltered trams to show total counts */}
      <FilterPanel
        trams={trams}
        selectedLines={selectedLines}
        onToggleLine={handleToggleLine}
        onClearFilters={handleClearFilters}
        connectionStatus={connectionStatus}
      />

      {selectedTram && (
        <TramPopup
          tram={trams[selectedTram.veh] || selectedTram}
          onClose={() => {
            setSelectedTram(null);
            setStopTripIds(null);
          }}
        />
      )}

      {/* Selected Stop Timetable Panel */}
      {selectedStop && (
        <StopPopup
          stopId={selectedStop.id}
          stopName={selectedStop.name}
          stopCode={selectedStop.code}
          onClose={handleCloseStop}
          onSelectTripId={handleSelectTripFromStop}
          onStopDeparturesLoaded={setStopTripIds}
        />
      )}

      {/* Subtle Version/Commit Footer */}
      <VersionBadge />
    </div>
  );
}

export default App;
