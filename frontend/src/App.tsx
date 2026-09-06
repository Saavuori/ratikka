/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { useTramData } from './hooks/useTramData';
import { useReplay } from './hooks/useReplay';
import { useIsMobile } from './hooks/useIsMobile';
import { Map } from './components/Map';
import { FilterPanel } from './components/FilterPanel';
import { TramPopup } from './components/TramPopup';
import { TramCard } from './components/TramCard';
import { StopPopup } from './components/StopPopup';
import { BikePopup } from './components/BikePopup';
import { VersionBadge } from './components/VersionBadge';
import { TimelapsePanel } from './components/TimelapsePanel';
import { ModeToggles } from './components/ModeToggles';
import { ViewToggles } from './components/ViewToggles';
import { BottomNav, type MobileTab } from './components/BottomNav';
import { JourneySearch, type JourneySelection } from './components/JourneySearch';
import { DeparturesPanel } from './components/DeparturesPanel';
import { fetchRouteDetails, fetchAlerts, fetchTripDetails, fetchStopsArrivals, fetchMapConfig } from './lib/api';
import type { MapTheme } from './lib/stopPlatforms';
import { readStorage, writeStorage } from './lib/storage';
import { areTripsEquivalent } from './lib/trip';
import { findJourneyVehicle, journeyVehicleModes } from './lib/journeyVehicles';
import { arrivalLabel, nextArrivals } from './lib/stopArrivals';
import type { ArrivalFocus } from './lib/stopArrivals';
import { pollDepartures } from './lib/departures';
import { getRouteColor } from './lib/routeColors';
import type { StopsArrivalsResponse } from './types';
import type { VehiclePosition, Alert, TripDetailsResponse } from './types';

function App() {
  const { trams: liveTrams, handleUpdate } = useTramData();
  const replay = useReplay();
  // The map draws whichever source is playing. A replayed vehicle carries the
  // same fields as a live one, so nothing downstream of here knows the
  // difference — filtering, selection, the telemetry panels and the animation
  // all work on history exactly as they work on now.
  const trams = replay.active ? replay.vehicles : liveTrams;
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const isMobile = useIsMobile();
  const [journey, setJourney] = useState<JourneySelection | null>(null);
  const [journeyOpen, setJourneyOpen] = useState(false);
  const [departuresOpen, setDeparturesOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const hasJourney = journey !== null;

  // Stops close enough to the middle of a zoomed-in map to carry a label, and
  // the departures fetched for them. Reported by the map when the view
  // settles, so panning around the city is not a request per frame.
  const [labelStopIds, setLabelStopIds] = useState<string[]>([]);
  const [stopArrivalData, setStopArrivalData] = useState<StopsArrivalsResponse | null>(null);
  const labelStopKey = labelStopIds.join(',');
  const hasLabelStops = labelStopIds.length > 0;

  useEffect(() => {
    if (!hasJourney && !hasLabelStops) return;
    setNow(Date.now());
    // Once the map is labelling stops the clock has to tick at the resolution
    // the labels are read at, not the journey panel's.
    const timer = setInterval(() => setNow(Date.now()), hasLabelStops ? 1000 : 5000);
    return () => clearInterval(timer);
  }, [hasJourney, hasLabelStops]);

  useEffect(() => {
    if (!hasLabelStops) {
      setStopArrivalData(null);
      return;
    }
    const ids = labelStopKey.split(',');
    return pollDepartures(
      (signal) => fetchStopsArrivals(ids, signal),
      (data) => setStopArrivalData(data),
      () => setStopArrivalData(null),
    );
  }, [labelStopKey, hasLabelStops]);

  /**
   * What each labelled stop says: its soonest departure, in the line's own
   * colour. Deliberately computed without the live vehicle feed — the
   * countdown has always come from the prediction, so a label needs no vehicle
   * located and turns on no extra feed just to be drawn.
   */
  const arrivalLabels = useMemo(() => {
    const labels: Record<string, { label: string; color: string }> = {};
    for (const [gtfsId, entry] of Object.entries(stopArrivalData?.stops ?? {})) {
      const arrival = nextArrivals(entry.departures, [], now, { limit: 1 })[0];
      const label = arrivalLabel(arrival);
      if (!label) continue;
      labels[gtfsId.replace(/^HSL:/, '')] = { label, color: getRouteColor(arrival.departure.line) };
    }
    return labels;
  }, [stopArrivalData, now]);

  const journeyModes = journeyVehicleModes(journey?.itinerary.legs);

  // Which optional feeds the selected stop's own departures need. Selecting a
  // bus stop turns the bus feed on for as long as the stop is open: without it
  // there is no vehicle to match an arrival to in the first place.
  const [stopModes, setStopModes] = useState({ bus: false, metro: false, train: false, tram: false });
  // The arrival the map is following, published by the stop panel.
  const [arrivalFocus, setArrivalFocus] = useState<ArrivalFocus | null>(null);

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
  const [mapTheme, setMapTheme] = useState<MapTheme>(() => {
    const stored = readStorage('mapTheme');
    return stored === 'dark' || stored === 'satellite' ? stored : 'light';
  });
  // The satellite basemap needs a National Land Survey key, which the
  // deployment may not have. Without one the mode is not offered at all --
  // better than a chip that switches the map to a grid of 401s. A stored
  // preference for it is honoured only once the key is known to exist.
  const [satelliteAvailable, setSatelliteAvailable] = useState(false);
  useEffect(() => {
    fetchMapConfig().then((config) => {
      const available = Boolean(config.mml_api_key);
      setSatelliteAvailable(available);
      if (!available) setMapTheme((theme) => (theme === 'satellite' ? 'dark' : theme));
    });
  }, []);
  const [is3D, setIs3D] = useState<boolean>(() => {
    return readStorage('is3D') === 'true';
  });
  const [always3DVehicles, setAlways3DVehicles] = useState<boolean>(() => {
    return readStorage('always3DVehicles') === 'true';
  });
  const [showTrams, setShowTrams] = useState<boolean>(() => {
    return readStorage('showTrams') !== 'false';
  });
  const [showBuses, setShowBuses] = useState<boolean>(() => {
    // Buses default OFF: they are ~80% of the vehicle feed, so the backend only
    // ingests them once a user opts in. Respect a prior explicit choice.
    return readStorage('showBuses') === 'true';
  });
  // Metro and commuter trains ride the same HFP feed as trams and buses and are
  // opt-in for the same reason: the backend only subscribes to a mode while
  // somebody is looking at it.
  const [showMetro, setShowMetro] = useState<boolean>(() => {
    return readStorage('showMetro') === 'true';
  });
  const [showTrains, setShowTrains] = useState<boolean>(() => {
    return readStorage('showTrains') === 'true';
  });
  // Route lines (the JORE background network and the highlighted per-line
  // ribbons) are the map's densest ink: handy for seeing where a line goes,
  // in the way when you only want the vehicles and the streets under them.
  // On by default — hiding them is the deliberate choice.
  const [showRoutes, setShowRoutes] = useState<boolean>(() => {
    return readStorage('showRoutes') !== 'false';
  });

  // Drive the WebSocket here (after the mode toggles are declared) so the
  // backend knows which optional feeds to ingest. Trams always stream.
  const wantsModes = useMemo(
    () => ({
      bus: showBuses || journeyModes.bus || stopModes.bus,
      metro: showMetro || journeyModes.metro || stopModes.metro,
      train: showTrains || journeyModes.train || stopModes.train,
    }),
    [showBuses, showMetro, showTrains, journeyModes.bus, journeyModes.metro, journeyModes.train,
      stopModes.bus, stopModes.metro, stopModes.train]
  );
  const { status: connectionStatus } = useWebSocket({
    onMessage: (data) => handleUpdate(data.vehicles),
    wantsModes,
  });

  useEffect(() => {
    writeStorage('mapTheme', mapTheme);
    // The app's own chrome has two skins, not three: over the orthophotos the
    // dark one is the readable pairing.
    document.documentElement.setAttribute('data-theme', mapTheme === 'light' ? 'light' : 'dark');
  }, [mapTheme]);

  useEffect(() => {
    writeStorage('is3D', String(is3D));
  }, [is3D]);

  useEffect(() => {
    writeStorage('always3DVehicles', String(always3DVehicles));
  }, [always3DVehicles]);

  useEffect(() => {
    writeStorage('showTrams', String(showTrams));
  }, [showTrams]);

  useEffect(() => {
    writeStorage('showBuses', String(showBuses));
  }, [showBuses]);

  useEffect(() => {
    writeStorage('showMetro', String(showMetro));
  }, [showMetro]);

  useEffect(() => {
    writeStorage('showTrains', String(showTrains));
  }, [showTrains]);

  useEffect(() => {
    writeStorage('showRoutes', String(showRoutes));
  }, [showRoutes]);

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
    /** Walking distance from the reader's location, metres — nearby stops only. */
    distance?: number;
    /** Start following the next arrival as soon as one can be located. */
    autoTrack?: boolean;
  } | null>(null);
  const [selectedBikeStation, setSelectedBikeStation] = useState<{

    id: string;
    name: string;
  } | null>(null);

  // Everything the map shows beside the vehicles — departures, alerts, journey
  // plans, bike capacity — is fetched for right now, so beside an hour-old tram
  // it would be quietly wrong. Leaving a replay puts them all back.
  useEffect(() => {
    if (!replay.active) return;
    setSelectedTram(null);
    setSelectedStop(null);
    setSelectedBikeStation(null);
    setJourney(null);
    setJourneyOpen(false);
    setDeparturesOpen(false);
    setArrivalFocus(null);
  }, [replay.active]);

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

  // Every rail line currently running — trams plus, when their toggle is on,
  // the metro and commuter-train lines. These are the lines the map draws as
  // highlighted ribbons, so they are also the ones whose geometry is fetched.
  // Joined into a string first so the effect below re-runs when a line enters or
  // leaves service, not on every position update.
  const ribbonModes = useMemo(() => {
    const modes = new Set<string>();
    if (showTrams) modes.add('tram');
    if (showMetro) modes.add('metro');
    if (showTrains) modes.add('train');
    return modes;
  }, [showTrams, showMetro, showTrains]);

  const activeRibbonLinesKey = useMemo(
    () =>
      Array.from(
        new Set(
          Object.values(trams)
            .filter((t) => ribbonModes.has(t.mode) && t.desi)
            .map((t) => t.desi)
        )
      )
        .sort()
        .join(','),
    [trams, ribbonModes]
  );

  // Fetch route geometries when selectedLines filter, selectedTram, or selectedStopRoutes changes.
  //
  // With no filter — the panel's "Show All" — that is every running tram, metro
  // and train line whose mode is switched on, so the map draws the same fanned,
  // per-line-coloured ribbons it would if the user had ticked every chip by
  // hand, rather than dropping to the flat mode-coloured tile network
  // underneath. Buses are left to that network: there are hundreds of bus lines,
  // far too many to fetch a pattern each.
  useEffect(() => {
    const linesToHighlight =
      selectedLines.length > 0
        ? [...selectedLines]
        : activeRibbonLinesKey
        ? activeRibbonLinesKey.split(',')
        : [];
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
  }, [selectedLines, selectedTram, selectedStopRoutes, activeRibbonLinesKey]);

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
    isTrunkStop?: boolean,
    extras?: { distance?: number; autoTrack?: boolean }
  ) => {
    if (selectedStop?.id === stopId) {
      setIsDetailCollapsed(false); // Auto-expand if collapsed
      return;
    }
    setSelectedTram(null);
    setSelectedBikeStation(null);
    setSelectedStopRoutes([]); // Reset selected stop routes!
    setStopModes({ bus: false, metro: false, train: false, tram: false });
    setArrivalFocus(null);
    setSelectedStop({ id: stopId, name, code, lat, lng, mode, isTrunkStop, ...extras });
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
    setStopModes({ bus: false, metro: false, train: false, tram: false });
    setArrivalFocus(null);
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

  // A schedule can be selected just before its vehicle enters the live feed.
  // Replace the temporary selection as soon as the matching vehicle appears.
  useEffect(() => {
    if (!selectedTram || selectedTram.veh !== '0' || !selectedTram.tripId) return;
    const matchedTram = Object.values(trams).find((t) => areTripsEquivalent(t.tripId, selectedTram.tripId));
    if (matchedTram) setSelectedTram(matchedTram);
  }, [selectedTram, trams]);

  // Lines used by the currently selected journey's transit legs. When a route is
  // picked in the destination search, we filter the map down to just these lines —
  // the same way selecting a line filter does.
  const journeyLines = journey
    ? journey.itinerary.legs
        .filter((leg) => leg.transit && leg.route?.shortName)
        .map((leg) => leg.route!.shortName)
    : [];
  const vehicles = useMemo(() => Object.values(trams), [trams]);
  const journeyVehicleIds = useMemo(() => {
    return [...new Set(journey?.itinerary.legs.flatMap((leg) => {
      const vehicle = findJourneyVehicle(leg, vehicles, now);
      return vehicle ? [vehicle.veh] : [];
    }) ?? [])];
  }, [journey, vehicles, now]);

  // Stop route filter: only filter after routes are loaded.
  // While loading (selectedStop set but selectedStopRoutes not yet arrived) keep all trams visible.
  const displayedTrams = Object.fromEntries(
    Object.entries(trams).filter((entry) => {
      const tram = entry[1];
      if (journeyVehicleIds.includes(tram.veh)) return true;
      // The arrival being tracked stays on the map even when its mode or line
      // is filtered out — hiding it is exactly what tracking is meant to stop.
      if (arrivalFocus?.vehicleId === tram.veh) return true;
      if (tram.mode === 'tram' && !showTrams && !journeyModes.tram) return false;
      if (tram.mode === 'bus' && !wantsModes.bus) return false;
      if (tram.mode === 'metro' && !wantsModes.metro) return false;
      if (tram.mode === 'train' && !wantsModes.train) return false;
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

  // Pattern geometry for the arrival being tracked, so the map can draw its
  // approach along the street rather than as a bearing across the blocks.
  const [arrivalTripDetails, setArrivalTripDetails] = useState<TripDetailsResponse | null>(null);
  const arrivalTripId = arrivalFocus?.tripId ?? null;

  useEffect(() => {
    if (!arrivalTripId) {
      setArrivalTripDetails(null);
      return;
    }
    let active = true;
    fetchTripDetails(arrivalTripId)
      .then((data) => { if (active) setArrivalTripDetails(data); })
      .catch(() => { if (active) setArrivalTripDetails(null); });
    return () => { active = false; };
  }, [arrivalTripId]);

  const handleCloseTram = () => {
    setSelectedTram(null);
  };

  // Opening the journey planner clears any vehicle/stop/bike selection so the
  // map is dedicated to the planned route; closing it clears the journey.
  const handleJourneyOpenChange = useCallback((open: boolean) => {
    setJourneyOpen(open);
    if (open) {
      setSelectedTram(null);
      setSelectedStop(null);
      setSelectedBikeStation(null);
      setSelectedStopRoutes([]);
    } else {
      setJourney(null);
    }
  }, []);

  // Bottom tab bar state (mobile only): drives which bottom sheet is expanded, and
  // null when none is — the map is then fully visible.
  const hasDetailSelection = !!(selectedTram || selectedStop || selectedBikeStation);
  const activeMobileTab: MobileTab | null = !isFilterCollapsed
    ? 'lines'
    : hasDetailSelection && !isDetailCollapsed
    ? 'details'
    : null;

  // A bottom sheet covers most of the screen on a phone, and the corner chips
  // float above it — so they get out of the way while one is open rather than
  // sitting on top of the sheet's own header.
  const mobileSheetOpen = isMobile && activeMobileTab !== null;

  // Every bar button toggles: tapping the open sheet closes it back to the map.
  const handleMobileTabSelect = (tab: MobileTab) => {
    if (tab === 'details') {
      setIsDetailCollapsed(!isDetailCollapsed);
      return;
    }
    setIsFilterCollapsed(!isFilterCollapsed);
  };

  return (
    <div className="dashboard-container">
      {/* Fullscreen Map Canvas */}
      <Map
        trams={displayedTrams}
        selectedTramId={selectedTram?.veh && selectedTram.veh !== '0' ? selectedTram.veh : selectedTram?.tripId || null}
        journeyVehicleIds={journeyVehicleIds}
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
        selectedLine={selectedTram?.desi || null}
        mapTheme={mapTheme}
        is3D={is3D}
        always3DVehicles={always3DVehicles}
        isFollowing={isFollowing}
        onDisableFollowing={() => setIsFollowing(false)}
        onMapBearingChange={setMapBearing}
        showTrams={showTrams || journeyModes.tram}
        showBuses={wantsModes.bus}
        showMetro={wantsModes.metro}
        showTrains={wantsModes.train}
        showRoutes={showRoutes}
        selectedTripDetails={selectedTripDetails}
        journeyLegs={journey?.itinerary.legs ?? null}
        journeyEndpoints={journey ? { from: journey.from, to: journey.to } : null}
        arrivalFocus={arrivalFocus}
        arrivalTripDetails={arrivalTripDetails}
        arrivalLabels={arrivalLabels}
        onVisibleStopsChange={setLabelStopIds}
        timeScale={replay.timeScale}
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
        showTrams={showTrams}
        showBuses={showBuses}
        showMetro={showMetro}
        showTrains={showTrains}
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
          vehicles={vehicles}
          walkDistance={selectedStop.distance}
          autoTrack={selectedStop.autoTrack}
          onArrivalModesLoaded={setStopModes}
          onArrivalFocusChange={setArrivalFocus}
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
        hidden={departuresOpen || !!(liveTram && liveTram.veh !== '0')}
        isMobile={isMobile}
        alerts={alerts}
        vehicles={vehicles}
        onSelectVehicle={(vehicle) => {
          handleSelectTram(vehicle);
          setIsDetailCollapsed(false);
        }}
      />
      <DeparturesPanel
        isMobile={isMobile}
        hidden={journeyOpen || !!(liveTram && liveTram.veh !== '0')}
        onOpenChange={setDeparturesOpen}
        onSelectStop={(stop, extras) =>
          handleSelectStop(stop.gtfsId, stop.name, stop.code, stop.lat, stop.lon, undefined, undefined, extras)}
      />

      {/* Quick vehicle-mode shortcuts (top-right corner) */}
      <ModeToggles
        hidden={mobileSheetOpen}
        showTrams={showTrams}
        setShowTrams={setShowTrams}
        showBuses={showBuses}
        setShowBuses={setShowBuses}
        showMetro={showMetro}
        setShowMetro={setShowMetro}
        showTrains={showTrains}
        setShowTrains={setShowTrains}
      />

      {/* Map view shortcuts: light/dark and 3D (top-left corner) */}
      <ViewToggles
        hidden={mobileSheetOpen}
        mapTheme={mapTheme}
        setMapTheme={setMapTheme}
        satelliteAvailable={satelliteAvailable}
        is3D={is3D}
        setIs3D={setIs3D}
        always3DVehicles={always3DVehicles}
        setAlways3DVehicles={setAlways3DVehicles}
        showRoutes={showRoutes}
        setShowRoutes={setShowRoutes}
      />

      {/* Version Badge — double-clicking it reveals the timelapse controls */}
      <VersionBadge onReveal={replay.available ? () => replay.controls.enter() : undefined} />

      {replay.active && (
        <TimelapsePanel
          cursor={replay.cursor}
          range={replay.range}
          playing={replay.playing}
          speed={replay.speed}
          loading={replay.loading}
          inGap={replay.inGap}
          error={replay.error}
          days={replay.index?.days ?? null}
          retentionDays={replay.index?.retentionDays ?? 0}
          onSeek={replay.controls.seek}
          onToggle={replay.controls.toggle}
          onSpeed={replay.controls.setSpeed}
          onExit={replay.controls.exit}
        />
      )}

      {/* Mobile bottom tab bar: toggles the settings, lines, and details sheets */}
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
