/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { useTramData } from './hooks/useTramData';
import { useIsMobile } from './hooks/useIsMobile';
import { Map } from './components/Map';
import { FilterPanel } from './components/FilterPanel';
import { TramPopup } from './components/TramPopup';
import { TramCard } from './components/TramCard';
import { StopPopup } from './components/StopPopup';
import { BikePopup } from './components/BikePopup';
import { VersionBadge } from './components/VersionBadge';
import { BottomNav, type MobileTab } from './components/BottomNav';
import { JourneySearch, type JourneySelection } from './components/JourneySearch';
import { fetchRouteDetails, fetchAlerts, fetchTripDetails } from './lib/api';
import { readStorage, writeStorage } from './lib/storage';
import { areTripsEquivalent } from './lib/trip';
import type { VehiclePosition, Alert, TripDetailsResponse } from './types';

function App() {
  const { trams, handleUpdate } = useTramData();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const isMobile = useIsMobile();

  useEffect(() => {
    const getAlerts = () => {
      fetchAlerts()
        .then((data) => {
          setAlerts(data.alerts || []);
        })
        .catch((err) => {
          console.error('Failed to fetch service alerts:', err);
        });
    };

    getAlerts();
    const interval = setInterval(getAlerts, 60000);
    return () => clearInterval(interval);
  }, []);

  // Map settings states with localStorage persistence
  const [mapTheme, setMapTheme] = useState<'light' | 'dark'>(() => {
    return readStorage('mapTheme') === 'dark' ? 'dark' : 'light';
  });
  const [is3D, setIs3D] = useState<boolean>(() => {
    return readStorage('is3D') === 'true';
  });
  const [showTrams, setShowTrams] = useState<boolean>(() => {
    return readStorage('showTrams') !== 'false';
  });
  const [showBuses, setShowBuses] = useState<boolean>(() => {
    // Buses default OFF: they are ~80% of the vehicle feed, so the backend only
    // ingests them once a user opts in. Respect a prior explicit choice.
    return readStorage('showBuses') === 'true';
  });

  // Drive the WebSocket here (after showBuses is declared) so the backend knows
  // whether to stream buses. Trams always stream.
  const { status: connectionStatus } = useWebSocket({
    onMessage: (data) => handleUpdate(data.vehicles),
    wantsBuses: showBuses,
  });

  useEffect(() => {
    writeStorage('mapTheme', mapTheme);
    document.documentElement.setAttribute('data-theme', mapTheme);
  }, [mapTheme]);

  useEffect(() => {
    writeStorage('is3D', String(is3D));
  }, [is3D]);

  useEffect(() => {
    writeStorage('showTrams', String(showTrams));
  }, [showTrams]);

  useEffect(() => {
    writeStorage('showBuses', String(showBuses));
  }, [showBuses]);

  // UI Selection States
  const [selectedTram, setSelectedTram] = useState<VehiclePosition | null>(null);
  const [selectedStop, setSelectedStop] = useState<{
    id: string;
    name: string;
    code: string;
    lat?: number;
    lng?: number;
    mode?: string;
    isTrunkStop?: boolean;
  } | null>(null);
  const [selectedBikeStation, setSelectedBikeStation] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const [isFollowing, setIsFollowing] = useState<boolean>(false);

  // Journey planning (destination search) state
  const [journey, setJourney] = useState<JourneySelection | null>(null);

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
    if ((selectedTram || selectedStop || selectedBikeStation) && isMobile) {
      setIsFilterCollapsed(true);
    }
  }, [selectedTram, selectedStop, selectedBikeStation, isMobile]);

  // On mobile the filter and detail panels render as bottom sheets that occupy the
  // same slot, so only one may be expanded at a time (opening one closes the other).
  useEffect(() => {
    if (isMobile && !isFilterCollapsed) {
      setIsDetailCollapsed(true);
    }
  }, [isFilterCollapsed, isMobile]);

  useEffect(() => {
    if (isMobile && !isDetailCollapsed) {
      setIsFilterCollapsed(true);
    }
  }, [isDetailCollapsed, isMobile]);

  // Slide (swipe) gesture detection for left and right panels on touch devices.
  // Desktop-only: on mobile the panels are bottom sheets driven by the bottom nav.
  useEffect(() => {
    if (isMobile) return;
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
  }, [isFilterCollapsed, isDetailCollapsed, isMobile]);
  const [selectedLines, setSelectedLines] = useState<string[]>(() => {
    try {
      const stored = readStorage('selectedLines');
      const parsed = stored ? JSON.parse(stored) : [];
      return Array.isArray(parsed) ? parsed.filter((l): l is string => typeof l === 'string') : [];
    } catch {
      return [];
    }
  });

  // Persist the line filter (favorite lines) across reloads
  useEffect(() => {
    writeStorage('selectedLines', JSON.stringify(selectedLines));
  }, [selectedLines]);

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

    // Cancellation guard: without it, a geometry response arriving after the
    // line was deselected would re-insert the line and leave its polyline
    // drawn on the map with no filter selected.
    let cancelled = false;
    linesToHighlight.forEach((line) => {
      if (!routeGeometries[line]) {
        fetchRouteDetails(line)
          .then((data) => {
            if (cancelled) return;
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

    return () => {
      cancelled = true;
    };
  }, [selectedLines, selectedTram, selectedStopRoutes]);

  const handleSelectTram = (tram: VehiclePosition | null) => {
    setSelectedStop(null);
    setSelectedBikeStation(null);
    setSelectedTram(tram);
  };

  const handleSelectStop = (
    stopId: string,
    name: string,
    code: string,
    lat?: number,
    lng?: number,
    mode?: string,
    isTrunkStop?: boolean
  ) => {
    if (selectedStop?.id === stopId) {
      setIsDetailCollapsed(false); // Auto-expand if collapsed
      return;
    }
    setSelectedTram(null);
    setSelectedBikeStation(null);
    setSelectedStopRoutes([]); // Reset selected stop routes!
    setSelectedStop({ id: stopId, name, code, lat, lng, mode, isTrunkStop });
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

  // Lines used by the currently selected journey's transit legs. When a route is
  // picked in the destination search, we filter the map down to just these lines —
  // the same way selecting a line filter does.
  const journeyLines = journey
    ? journey.itinerary.legs
        .filter((leg) => leg.transit && leg.route?.shortName)
        .map((leg) => leg.route!.shortName)
    : [];

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
      // Filter by the selected journey's lines so only vehicles running the
      // planned route(s) stay visible on the map.
      if (journeyLines.length > 0 && !journeyLines.includes(tram.desi)) {
        return false;
      }
      return true;
    })
  );

  // The live tram being tracked (prefer live data over stale selectedTram snapshot)
  const liveTram = selectedTram
    ? (selectedTram.veh && selectedTram.veh !== '0' ? trams[selectedTram.veh] || selectedTram : selectedTram)
    : null;

  const [selectedTripDetails, setSelectedTripDetails] = useState<TripDetailsResponse | null>(null);
  const [isLoadingTripDetails, setIsLoadingTripDetails] = useState<boolean>(false);
  const [tripDetailsError, setTripDetailsError] = useState<string | null>(null);

  useEffect(() => {
    const tripId = liveTram?.tripId;
    if (!tripId) {
      setSelectedTripDetails(null);
      setIsLoadingTripDetails(false);
      setTripDetailsError(null);
      return;
    }

    // Don't refetch if we already have the details for this tripId
    if (selectedTripDetails && selectedTripDetails.tripId === tripId) {
      return;
    }

    setIsLoadingTripDetails(true);
    setTripDetailsError(null);
    setSelectedTripDetails(null);

    let active = true;
    fetchTripDetails(tripId)
      .then((data) => {
        if (active) {
          setSelectedTripDetails(data);
          setTripDetailsError(null);
        }
      })
      .catch((err) => {
        if (active) {
          console.error('Failed to fetch trip details:', err);
          setTripDetailsError('Failed to load trip timetable');
          setSelectedTripDetails(null);
        }
      })
      .finally(() => {
        if (active) {
          setIsLoadingTripDetails(false);
        }
      });

    return () => {
      active = false;
    };
  }, [liveTram?.tripId]);

  const handleCloseTram = () => {
    setSelectedTram(null);
  };

  // Opening the journey planner clears any vehicle/stop/bike selection so the
  // map is dedicated to the planned route; closing it clears the journey.
  const handleJourneyOpenChange = (open: boolean) => {
    if (open) {
      setSelectedTram(null);
      setSelectedStop(null);
      setSelectedBikeStation(null);
      setSelectedStopRoutes([]);
    } else {
      setJourney(null);
    }
  };

  // Bottom tab bar state (mobile only): drives which bottom sheet is expanded.
  const hasDetailSelection = !!(selectedTram || selectedStop || selectedBikeStation);
  const activeMobileTab: MobileTab = !isFilterCollapsed
    ? 'filters'
    : hasDetailSelection && !isDetailCollapsed
    ? 'details'
    : 'map';

  const handleMobileTabSelect = (tab: MobileTab) => {
    if (tab === 'map') {
      setIsFilterCollapsed(true);
      setIsDetailCollapsed(true);
    } else if (tab === 'filters') {
      setIsFilterCollapsed(false);
    } else {
      setIsDetailCollapsed(false);
    }
  };

  return (
    <div className="dashboard-container">
      {/* Fullscreen Map Canvas */}
      <Map
        trams={displayedTrams}
        selectedTramId={selectedTram?.veh && selectedTram.veh !== '0' ? selectedTram.veh : selectedTram?.tripId || null}
        selectedStopId={selectedStop?.id || null}
        selectedBikeStationId={selectedBikeStation?.id || null}
        selectedStopCoords={selectedStop?.lat && selectedStop?.lng ? [selectedStop.lng, selectedStop.lat] : null}
        selectedStopMode={selectedStop?.mode || null}
        selectedStopIsTrunk={selectedStop?.isTrunkStop || false}
        onSelectTram={handleSelectTram}
        onSelectStop={handleSelectStop}
        onSelectBikeStation={handleSelectBikeStation}
        lineFilters={selectedLines}
        routeGeometries={routeGeometries}
        mapTheme={mapTheme}
        is3D={is3D}
        isFollowing={isFollowing}
        onDisableFollowing={() => setIsFollowing(false)}
        onMapBearingChange={setMapBearing}
        showTrams={showTrams}
        showBuses={showBuses}
        selectedTripDetails={selectedTripDetails}
        journeyLegs={journey?.itinerary.legs ?? null}
        journeyEndpoints={journey ? { from: journey.from, to: journey.to } : null}
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
        is3D={is3D}
        setIs3D={setIs3D}
        showTrams={showTrams}
        setShowTrams={setShowTrams}
        showBuses={showBuses}
        setShowBuses={setShowBuses}
        alerts={alerts}
        selectedTram={liveTram}
        selectedStop={selectedStop}
        selectedStopRoutes={selectedStopRoutes}
      />

      {/* Floating top-center tram telemetry card */}
      {liveTram && liveTram.veh !== '0' && (
        <TramCard
          tram={liveTram}
          mapBearing={mapBearing}
          onClose={handleCloseTram}
          isFollowing={isFollowing}
          onToggleFollow={() => setIsFollowing(!isFollowing)}
          tripDetails={selectedTripDetails}
        />
      )}

      {/* Schedule detail panel (right side) */}
      {selectedTram && (
        <TramPopup
          tram={liveTram!}
          onClose={handleCloseTram}
          isCollapsed={isDetailCollapsed}
          onToggleCollapse={() => setIsDetailCollapsed(!isDetailCollapsed)}
          alerts={alerts}
          tripDetails={selectedTripDetails}
          loading={isLoadingTripDetails}
          error={tripDetailsError}
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
          onStopCoordsLoaded={(lat, lng) => {
            setSelectedStop((prev) =>
              prev && prev.id === selectedStop.id ? { ...prev, lat, lng } : prev
            );
          }}
          isCollapsed={isDetailCollapsed}
          onToggleCollapse={() => setIsDetailCollapsed(!isDetailCollapsed)}
          alerts={alerts}
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

      {/* Destination search / journey planner (top-center) */}
      <JourneySearch
        onSelectionChange={setJourney}
        onOpenChange={handleJourneyOpenChange}
        hidden={!!(liveTram && liveTram.veh !== '0')}
        isMobile={isMobile}
      />

      {/* Version Badge */}
      <VersionBadge />

      {/* Mobile bottom tab bar: switches between the map, filters, and details sheets */}
      {isMobile && (
        <BottomNav
          active={activeMobileTab}
          hasDetails={hasDetailSelection}
          onSelect={handleMobileTabSelect}
        />
      )}
    </div>
  );
}

export default App;
