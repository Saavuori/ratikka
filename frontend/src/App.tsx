/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { useTramData } from './hooks/useTramData';
import { Map } from './components/Map';
import { FilterPanel } from './components/FilterPanel';
import { TramPopup } from './components/TramPopup';
import { TramCard } from './components/TramCard';
import { StopPopup } from './components/StopPopup';
import { BikePopup } from './components/BikePopup';
import { VersionBadge } from './components/VersionBadge';
import { fetchRouteDetails } from './lib/api';
import { areTripsEquivalent } from './lib/trip';
import type { VehiclePosition } from './types';

function App() {
  const { trams, handleUpdate } = useTramData();
  const { status: connectionStatus } = useWebSocket({ onMessage: (data) => handleUpdate(data.vehicles) });

  // Map settings states with localStorage persistence
  const [mapTheme, setMapTheme] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem('mapTheme') as 'light' | 'dark') || 'light';
  });
  const [showRouteNetwork, setShowRouteNetwork] = useState<boolean>(() => {
    return localStorage.getItem('showRouteNetwork') === 'true';
  });
  const [is3D, setIs3D] = useState<boolean>(() => {
    return localStorage.getItem('is3D') === 'true';
  });
  const [showTrams, setShowTrams] = useState<boolean>(() => {
    return localStorage.getItem('showTrams') !== 'false';
  });
  const [showBuses, setShowBuses] = useState<boolean>(() => {
    return localStorage.getItem('showBuses') !== 'false';
  });

  useEffect(() => {
    localStorage.setItem('mapTheme', mapTheme);
    document.documentElement.setAttribute('data-theme', mapTheme);
  }, [mapTheme]);

  useEffect(() => {
    localStorage.setItem('showRouteNetwork', String(showRouteNetwork));
  }, [showRouteNetwork]);

  useEffect(() => {
    localStorage.setItem('is3D', String(is3D));
  }, [is3D]);

  useEffect(() => {
    localStorage.setItem('showTrams', String(showTrams));
  }, [showTrams]);

  useEffect(() => {
    localStorage.setItem('showBuses', String(showBuses));
  }, [showBuses]);

  // UI Selection States
  const [selectedTram, setSelectedTram] = useState<VehiclePosition | null>(null);
  const [selectedStop, setSelectedStop] = useState<{
    id: string;
    name: string;
    code: string;
  } | null>(null);
  const [selectedBikeStation, setSelectedBikeStation] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const [isFollowing, setIsFollowing] = useState<boolean>(false);

  // Reset following mode when selected tram changes
  useEffect(() => {
    setIsFollowing(false);
  }, [selectedTram?.veh]);



  // Detail panel collapse state: defaults to true (hidden/collapsed when item is selected)
  const [isDetailCollapsed, setIsDetailCollapsed] = useState<boolean>(true);

  // Sidebar collapse state: defaults to collapsed on mobile, open on desktop
  const [isFilterCollapsed, setIsFilterCollapsed] = useState<boolean>(
    typeof window !== 'undefined' ? window.innerWidth <= 768 : false
  );

  // Auto-collapse sidebar when a tram, stop, or bike station is selected on mobile
  useEffect(() => {
    if ((selectedTram || selectedStop || selectedBikeStation) && window.innerWidth <= 768) {
      setIsFilterCollapsed(true);
    }
  }, [selectedTram, selectedStop, selectedBikeStation]);
  // Slide (swipe) gesture detection for left and right panels on touch devices
  useEffect(() => {
    let touchStartX = 0;
    let touchStartY = 0;
    const edgeThreshold = 45; // px from screen edge to trigger edge swipes
    const swipeThreshold = 55; // px of horizontal movement to trigger swipe

    const handleTouchStart = (e: TouchEvent) => {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (e.changedTouches.length === 0) return;
      const touchEndX = e.changedTouches[0].clientX;
      const touchEndY = e.changedTouches[0].clientY;
      const deltaX = touchEndX - touchStartX;
      const deltaY = touchEndY - touchStartY;

      // Ensure it's mostly a horizontal swipe
      if (Math.abs(deltaX) > Math.abs(deltaY) * 1.5 && Math.abs(deltaX) > swipeThreshold) {
        const screenWidth = window.innerWidth;

        // Left Panel (FilterPanel) Swipes
        if (deltaX > 0) {
          // Swipe right: Open left panel if swipe started near left edge
          if (touchStartX < edgeThreshold) {
            setIsFilterCollapsed(false);
          }
        } else {
          // Swipe left: Close left panel if it is currently open and swipe started inside it
          if (!isFilterCollapsed && touchStartX < 250) {
            setIsFilterCollapsed(true);
          }
        }

        // Right Panel (DetailPopup / StopPopup / BikePopup) Swipes
        if (deltaX < 0) {
          // Swipe left: Open right panel if swipe started near right edge
          if (screenWidth - touchStartX < edgeThreshold) {
            setIsDetailCollapsed(false);
          }
        } else {
          // Swipe right: Close right panel if it is currently open and swipe started inside it
          if (!isDetailCollapsed && screenWidth - touchStartX < 350) {
            setIsDetailCollapsed(true);
          }
        }
      }
    };

    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isFilterCollapsed, isDetailCollapsed]);
  const [selectedLines, setSelectedLines] = useState<string[]>([]);
  const [selectedStopRoutes, setSelectedStopRoutes] = useState<string[]>([]);
  const [mapBearing, setMapBearing] = useState<number>(0);
  const [routeGeometries, setRouteGeometries] = useState<Record<string, { geometries: string[]; color?: string; stops?: string[] }>>({});

  // Fetch route geometries when selectedLines filter, selectedTram, or selectedStopRoutes changes
  useEffect(() => {
    const linesToHighlight = [...selectedLines];
    if (selectedTram && !linesToHighlight.includes(selectedTram.desi)) {
      linesToHighlight.push(selectedTram.desi);
    }
    selectedStopRoutes.forEach((line) => {
      if (!linesToHighlight.includes(line)) {
        linesToHighlight.push(line);
      }
    });

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
                stops: data.stops,
              },
            }));
          })
          .catch((err) => {
            console.error(`Failed to fetch route details for ${line}:`, err);
          });
      }
    });
  }, [selectedLines, selectedTram, selectedStopRoutes]);

  const handleSelectTram = (tram: VehiclePosition | null) => {
    setSelectedStop(null);
    setSelectedBikeStation(null);
    setSelectedTram(tram);
  };

  const handleSelectStop = (stopId: string, name: string, code: string) => {
    if (selectedStop?.id === stopId) {
      setIsDetailCollapsed(false); // Auto-expand if collapsed
      return;
    }
    setSelectedTram(null);
    setSelectedBikeStation(null);
    setSelectedStopRoutes([]); // Reset selected stop routes!
    setSelectedStop({ id: stopId, name, code });
    setIsDetailCollapsed(false); // Auto-expand detail panel to show schedule
  };

  const handleSelectBikeStation = (station: { id: string; name: string } | null) => {
    setSelectedTram(null);
    setSelectedStop(null);
    setSelectedBikeStation(station);
    if (station) {
      setIsDetailCollapsed(false); // Auto-expand detail panel to show bike capacity
    }
  };

  const handleCloseStop = () => {
    setSelectedStop(null);
    setSelectedStopRoutes([]);
  };

  const handleCloseBikeStation = () => {
    setSelectedBikeStation(null);
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
    const matchedTram = Object.values(trams).find((t) => areTripsEquivalent(t.tripId, tripId));
    if (matchedTram) {
      setSelectedStop(null);
      setSelectedTram(matchedTram);
    } else {
      // Tram not online yet — build a stub so we can still show the schedule
      const dummyTram: VehiclePosition = {
        veh: '0',
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
        mode: 'tram',
      };
      setSelectedStop(null);
      setSelectedTram(dummyTram);
    }
  };

  // Stop route filter: only filter after routes are loaded.
  // While loading (selectedStop set but selectedStopRoutes not yet arrived) keep all trams visible.
  const displayedTrams = Object.fromEntries(
    Object.entries(trams).filter((entry) => {
      const tram = entry[1];
      if (tram.mode === 'tram' && !showTrams) return false;
      if (tram.mode === 'bus' && !showBuses) return false;
      if (selectedLines.length > 0 && !selectedLines.includes(tram.desi)) {
        return false;
      }
      // Filter by stop routes if a stop is selected
      if (selectedStop && selectedStopRoutes.length > 0 && !selectedStopRoutes.includes(tram.desi)) {
        return false;
      }
      return true;
    })
  );

  // The live tram being tracked (prefer live data over stale selectedTram snapshot)
  const liveTram = selectedTram
    ? (selectedTram.veh && selectedTram.veh !== '0' ? trams[selectedTram.veh] || selectedTram : selectedTram)
    : null;

  const handleCloseTram = () => {
    setSelectedTram(null);
  };

  return (
    <div className="dashboard-container">
      {/* Fullscreen Map Canvas */}
      <Map
        trams={displayedTrams}
        selectedTramId={selectedTram?.veh && selectedTram.veh !== '0' ? selectedTram.veh : selectedTram?.tripId || null}
        selectedStopId={selectedStop?.id || null}
        selectedBikeStationId={selectedBikeStation?.id || null}
        onSelectTram={handleSelectTram}
        onSelectStop={handleSelectStop}
        onSelectBikeStation={handleSelectBikeStation}
        lineFilters={selectedLines}
        routeGeometries={routeGeometries}
        mapTheme={mapTheme}
        showRouteNetwork={showRouteNetwork}
        is3D={is3D}
        isFollowing={isFollowing}
        onDisableFollowing={() => setIsFollowing(false)}
        onMapBearingChange={setMapBearing}
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
        mapTheme={mapTheme}
        setMapTheme={setMapTheme}
        showRouteNetwork={showRouteNetwork}
        setShowRouteNetwork={setShowRouteNetwork}
        is3D={is3D}
        setIs3D={setIs3D}
        showTrams={showTrams}
        setShowTrams={setShowTrams}
        showBuses={showBuses}
        setShowBuses={setShowBuses}
      />

      {/* Floating top-center tram telemetry card */}
      {liveTram && liveTram.veh !== '0' && (
        <TramCard
          tram={liveTram}
          mapBearing={mapBearing}
          onClose={handleCloseTram}
          isFollowing={isFollowing}
          onToggleFollow={() => setIsFollowing(!isFollowing)}
        />
      )}

      {/* Schedule detail panel (right side) */}
      {selectedTram && (
        <TramPopup
          tram={liveTram!}
          onClose={handleCloseTram}
          isCollapsed={isDetailCollapsed}
          onToggleCollapse={() => setIsDetailCollapsed(!isDetailCollapsed)}
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
          onStopRoutesLoaded={setSelectedStopRoutes}
          isCollapsed={isDetailCollapsed}
          onToggleCollapse={() => setIsDetailCollapsed(!isDetailCollapsed)}
        />
      )}

      {/* Selected Bike Station Capacity Panel */}
      {selectedBikeStation && (
        <BikePopup
          stationId={selectedBikeStation.id}
          stationName={selectedBikeStation.name}
          onClose={handleCloseBikeStation}
          isCollapsed={isDetailCollapsed}
          onToggleCollapse={() => setIsDetailCollapsed(!isDetailCollapsed)}
        />
      )}

      {/* Version Badge */}
      <VersionBadge />
    </div>
  );
}

export default App;
