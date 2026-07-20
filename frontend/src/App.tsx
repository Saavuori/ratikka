import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { useTramData } from './hooks/useTramData';
import { useSwipeGestures } from './hooks/useSwipeGestures';
import { Map } from './components/Map';
import { FilterPanel } from './components/FilterPanel';
import { TramPopup } from './components/TramPopup';
import { TramCard } from './components/TramCard';
import { StopPopup } from './components/StopPopup';
import { BikePopup } from './components/BikePopup';
import { VersionBadge } from './components/VersionBadge';
import { fetchRouteDetails, fetchAlerts, fetchTripDetails } from './lib/api';
import { areTripsEquivalent } from './lib/trip';
import type { VehiclePosition, Alert, TripDetailsResponse } from './types';

function App() {
  const { trams, handleUpdate } = useTramData();
  const { status: connectionStatus } = useWebSocket({ onMessage: (data) => handleUpdate(data.vehicles) });
  const [alerts, setAlerts] = useState<Alert[]>([]);

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

  // Detail panel collapse state: defaults to true (hidden/collapsed when item is selected)
  const [isDetailCollapsed, setIsDetailCollapsed] = useState<boolean>(true);

  // Sidebar collapse state: defaults to collapsed on mobile, open on desktop
  const [isFilterCollapsed, setIsFilterCollapsed] = useState<boolean>(
    typeof window !== 'undefined' ? window.innerWidth <= 768 : false
  );

  // Shared consequences of picking something on the map. This is event-driven, so it
  // lives in the selection handlers rather than an effect watching the selection —
  // an effect would cost an extra render pass per selection.
  const onSelectionMade = useCallback(() => {
    setIsFollowing(false);
    if (window.innerWidth <= 768) {
      setIsFilterCollapsed(true);
    }
  }, []);

  useSwipeGestures({
    isFilterCollapsed,
    isDetailCollapsed,
    setFilterCollapsed: setIsFilterCollapsed,
    setDetailCollapsed: setIsDetailCollapsed,
  });

  const [selectedLines, setSelectedLines] = useState<string[]>([]);
  const [selectedStopRoutes, setSelectedStopRoutes] = useState<string[]>([]);
  const [mapBearing, setMapBearing] = useState<number>(0);
  const [routeGeometries, setRouteGeometries] = useState<Record<string, { geometries: string[]; color?: string; stops?: string[] }>>({});

  // Mirrors of route-fetch state, read by the effect below without becoming deps of it.
  const loadedRoutesRef = useRef(routeGeometries);
  const inFlightRoutesRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    loadedRoutesRef.current = routeGeometries;
  }, [routeGeometries]);

  // Only the selected vehicle's line matters here, not its live position.
  const selectedTramDesi = selectedTram?.desi ?? null;

  // Fetch route geometries when the line filter, selected vehicle's line, or the
  // routes serving the selected stop change.
  useEffect(() => {
    const linesToHighlight = [...selectedLines];
    if (selectedTramDesi && !linesToHighlight.includes(selectedTramDesi)) {
      linesToHighlight.push(selectedTramDesi);
    }
    selectedStopRoutes.forEach((line) => {
      if (!linesToHighlight.includes(line)) {
        linesToHighlight.push(line);
      }
    });

    if (linesToHighlight.length === 0) {
      // Same as above: this effect's whole job is keeping the cached geometries in
      // step with the current selection, including clearing them.
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
      // `routeGeometries` is deliberately not a dep (it changes as fetches land, which
      // would re-run this effect), so consult the ref mirror plus an in-flight set
      // instead of the stale render closure.
      if (loadedRoutesRef.current[line] || inFlightRoutesRef.current.has(line)) return;

      inFlightRoutesRef.current.add(line);
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
        })
        .finally(() => {
          inFlightRoutesRef.current.delete(line);
        });
    });
  }, [selectedLines, selectedTramDesi, selectedStopRoutes]);

  const handleSelectTram = useCallback((tram: VehiclePosition | null) => {
    setSelectedStop(null);
    setSelectedBikeStation(null);
    setSelectedTram(tram);
    if (tram) onSelectionMade();
  }, [onSelectionMade]);

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
    onSelectionMade();
  };

  const handleSelectBikeStation = useCallback((station: { id: string; name: string } | null) => {
    setSelectedTram(null);
    setSelectedStop(null);
    setSelectedBikeStation(station);
    if (station) {
      setIsDetailCollapsed(false); // Auto-expand detail panel to show bike capacity
      onSelectionMade();
    }
  }, [onSelectionMade]);

  const handleCloseStop = useCallback(() => {
    setSelectedStop(null);
    setSelectedStopRoutes([]);
  }, []);

  const handleCloseBikeStation = useCallback(() => {
    setSelectedBikeStation(null);
  }, []);

  const handleToggleLine = useCallback((line: string) => {
    setSelectedLines((prev) =>
      prev.includes(line) ? prev.filter((l) => l !== line) : [...prev, line]
    );
  }, []);

  const handleClearFilters = useCallback(() => {
    setSelectedLines([]);
  }, []);

  const handleSelectTripFromStop = (tripId: string, lineDesi: string) => {
    // Find if the tram for this trip is currently online
    const matchedTram = Object.values(trams).find((t) => areTripsEquivalent(t.tripId, tripId));
    onSelectionMade();
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
  // Memoised because a new object identity here re-runs Map's layer-filter effects on every
  // position frame, which is several `setFilter` calls per WebSocket message.
  const displayedTrams = useMemo(
    () =>
      Object.fromEntries(
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
      ),
    [trams, showTrams, showBuses, selectedLines, selectedStop, selectedStopRoutes]
  );

  // Distinct line designators for the filter grid. The set of lines in service changes
  // rarely, so we hold the array identity steady across position frames — that is what
  // lets the memoised FilterPanel skip re-rendering.
  const activeLinesKey = useMemo(() => {
    const lines = new Set<string>();
    for (const tram of Object.values(trams)) {
      if (tram.mode === 'tram' && !showTrams) continue;
      if (tram.mode === 'bus' && !showBuses) continue;
      lines.add(tram.desi);
    }
    return Array.from(lines)
      .sort((a, b) => {
        const numA = parseInt(a);
        const numB = parseInt(b);
        if (isNaN(numA) && isNaN(numB)) return a.localeCompare(b);
        if (isNaN(numA)) return 1;
        if (isNaN(numB)) return -1;
        return numA - numB;
      })
      .join(' ');
  }, [trams, showTrams, showBuses]);

  const activeLines = useMemo(
    () => (activeLinesKey === '' ? [] : activeLinesKey.split(' ')),
    [activeLinesKey]
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
      // Clearing the previous trip's data is the synchronisation this effect exists for;
      // there is no external event to hang it off.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedTripDetails(null);
      setIsLoadingTripDetails(false);
      setTripDetailsError(null);
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

  const handleCloseTram = useCallback(() => {
    setSelectedTram(null);
  }, []);

  // Stable so StopPopup's fetch effect can list it as a dependency without refetching.
  const handleStopCoordsLoaded = useCallback((lat: number, lng: number) => {
    setSelectedStop((prev) => (prev ? { ...prev, lat, lng } : prev));
  }, []);

  // Stable identities so the memoised panels aren't invalidated every render.
  const toggleFilterCollapsed = useCallback(() => setIsFilterCollapsed((v) => !v), []);
  const toggleDetailCollapsed = useCallback(() => setIsDetailCollapsed((v) => !v), []);
  const toggleFollowing = useCallback(() => setIsFollowing((v) => !v), []);
  const disableFollowing = useCallback(() => setIsFollowing(false), []);

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
        showRouteNetwork={showRouteNetwork}
        is3D={is3D}
        isFollowing={isFollowing}
        onDisableFollowing={disableFollowing}
        onMapBearingChange={setMapBearing}
        showTrams={showTrams}
        showBuses={showBuses}
        selectedTripDetails={selectedTripDetails}
      />

      {/* Sidebar Filters Panel */}
      <FilterPanel
        activeLines={activeLines}
        selectedLines={selectedLines}
        onToggleLine={handleToggleLine}
        onClearFilters={handleClearFilters}
        connectionStatus={connectionStatus}
        isCollapsed={isFilterCollapsed}
        onToggleCollapse={toggleFilterCollapsed}
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
        alerts={alerts}
        selectedTramDesi={liveTram?.desi ?? null}
        selectedTramRoute={liveTram?.route ?? null}
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
          onToggleFollow={toggleFollowing}
          tripDetails={selectedTripDetails}
        />
      )}

      {/* Schedule detail panel (right side) */}
      {selectedTram && (
        <TramPopup
          tram={liveTram!}
          onClose={handleCloseTram}
          isCollapsed={isDetailCollapsed}
          onToggleCollapse={toggleDetailCollapsed}
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
          onSelectTripId={handleSelectTripFromStop}
          onStopRoutesLoaded={setSelectedStopRoutes}
          onStopCoordsLoaded={handleStopCoordsLoaded}
          isCollapsed={isDetailCollapsed}
          onToggleCollapse={toggleDetailCollapsed}
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
          onToggleCollapse={toggleDetailCollapsed}
        />
      )}

      {/* Version Badge */}
      <VersionBadge />
    </div>
  );
}

export default App;
