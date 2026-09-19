/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { useReplay } from './hooks/useReplay';
import { useIsMobile } from './hooks/useIsMobile';
import { useEdgeSwipe } from './hooks/useEdgeSwipe';
import { useTripDetails } from './hooks/useTripDetails';
import { useRouteGeometries } from './hooks/useRouteGeometries';
import { Map } from './components/Map';
import { RIBBONED_MODES } from './map/routeNetwork';
import type {
  ArrivalOverlay,
  JourneyOverlay,
  MapCallbacks,
  MapSelection,
  MapView,
} from './map/props';
import { FilterPanel } from './components/FilterPanel';
import { TramPopup } from './components/TramPopup';
import { TramCard } from './components/TramCard';
import { StopPopup } from './components/StopPopup';
import { BikePopup } from './components/BikePopup';
import { TrafficLightPopup } from './components/TrafficLightPopup';
import { VersionBadge } from './components/VersionBadge';
import { TimelapsePanel } from './components/TimelapsePanel';
import { ModeToggles } from './components/ModeToggles';
import { ViewToggles } from './components/ViewToggles';
import { BottomNav, type MobileTab } from './components/BottomNav';
import { JourneySearch, type JourneySelection } from './components/JourneySearch';
import { DeparturesPanel } from './components/DeparturesPanel';
import { RidePanel } from './components/RidePanel';
import { AlightBanner } from './components/AlightBanner';
import { fetchAlerts, fetchStopsArrivals, fetchMapConfig } from './lib/api';
import type { MapTheme } from './lib/stopPlatforms';
import { usePersistedFlag, usePersistedLines, usePersistedModes, usePersistedState } from './hooks/usePersisted';
import {
  NO_MODES,
  anyMode,
  asTransportMode,
  modeFlags,
  withMode,
  type TransportMode,
} from './lib/modes';
import {
  findTripVehicle,
  selectionKey,
  stopSelection,
  tripSelection,
  type PickedStop,
  type Selection,
  type StopSelection,
} from './lib/selection';
import { findJourneyVehicle, journeyVehicleModes } from './lib/journeyVehicles';
import { alightAlert } from './lib/alightAlert';
import { useTrafficLights } from './hooks/useTrafficLights';
import { useRideDetection } from './hooks/useRideDetection';
import { useAlightNotifications } from './hooks/useAlightNotifications';
import { signalPriorityIndex } from './lib/trafficLightModels';
import { arrivalLabel, nextArrivals } from './lib/stopArrivals';
import { pollDepartures } from './lib/departures';
import { getRouteColor } from './lib/routeColors';
import type { StopsArrivalsResponse } from './types';
import type { VehiclePosition, Alert } from './types';

function App() {
  const [liveTrams, setLiveTrams] = useState<Record<string, VehiclePosition>>({});
  const replay = useReplay();
  // The map draws whichever source is playing. A replayed vehicle carries the
  // same fields as a live one, so nothing downstream of here knows the
  // difference — filtering, selection, the telemetry panels and the animation
  // all work on history exactly as they work on now.
  const trams = replay.active ? replay.vehicles : liveTrams;
  const vehicles = useMemo(() => Object.values(trams), [trams]);

  // Which vehicle the reader is actually inside, worked out from their own
  // position. Declared here because the answer decides which feeds the backend
  // is asked for: while it is still looking, every mode has to be streaming or
  // the bus the reader is sitting on is not on the map to be found.
  //
  // It is matched against the *live* feed, never the replayed one: where the
  // reader is now says nothing about where a tram was on Tuesday, so a replay
  // simply suspends the search until the map is about now again.
  const rideCandidates = useMemo(
    () => (replay.active ? [] : Object.values(liveTrams)), [replay.active, liveTrams]);
  const ride = useRideDetection(rideCandidates);
  const rideVehicle = ride.rideVehicleId ? liveTrams[ride.rideVehicleId] ?? null : null;
  const rideSearching = ride.status === 'scanning' || ride.status === 'suggesting';
  const rideModes = useMemo(
    () => modeFlags((mode) => rideSearching || ride.rideMode === mode),
    [rideSearching, ride.rideMode]
  );
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

  // What the detail panel is about: a vehicle, a stop, a bike station or a
  // junction, never two at once.
  const [selection, setSelection] = useState<Selection | null>(null);
  const openStop = selection?.kind === 'stop' ? selection : null;
  const stopRoutes = openStop?.routes ?? [];
  const arrivalFocus = openStop?.arrivalFocus ?? null;
  // Which optional feeds the open stop's own departures need. Selecting a
  // bus stop turns the bus feed on for as long as the stop is open: without it
  // there is no vehicle to match an arrival to in the first place.
  const stopModes = openStop?.modes ?? NO_MODES;
  const selectedBikeStation = selection?.kind === 'bikeStation' ? selection.station : null;
  const selectedJunctionId = selection?.kind === 'junction' ? selection.junctionId : null;
  // The selected vehicle as the panels show it: the live copy while it is in
  // the feed, else the last one seen — or a scheduled trip's placeholder.
  const selectedVehicle =
    selection?.kind === 'vehicle'
      ? trams[selection.vehicle.veh] ?? selection.vehicle
      : selection?.kind === 'scheduledTrip'
      ? selection.placeholder
      : null;
  // Only a vehicle in the feed has a position to draw, show or follow.
  const trackedVehicle = selection?.kind === 'vehicle' ? selectedVehicle : null;
  const trackedVehicleId = selection?.kind === 'vehicle' ? selection.vehicle.veh : null;

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

  // Map settings, remembered across reloads.
  const [mapTheme, setMapTheme] = usePersistedState<MapTheme>(
    'mapTheme',
    'light',
    (raw) => (raw === 'dark' || raw === 'satellite' || raw === 'light' ? raw : null),
    String
  );
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
    // setMapTheme is a useState setter passed through usePersistedState, so it
    // is stable; the rule cannot see that through a custom hook's return, and
    // listing it is both truthful and free.
  }, [setMapTheme]);
  const [is3D, setIs3D] = usePersistedFlag('is3D', false);
  const [always3DVehicles, setAlways3DVehicles] = usePersistedFlag('always3DVehicles', false);
  // The reader's own mode switches. Every mode but trams defaults OFF: buses
  // alone are ~80% of the vehicle feed, and the backend only subscribes to a
  // mode while somebody is looking at it. Ferries are the smallest feed of the
  // five — one year-round crossing — but they are opt-in on the same principle.
  const [showModes, setShowModes] = usePersistedModes('showModes', {
    ...NO_MODES,
    tram: true,
  });
  const toggleMode = useCallback(
    (mode: TransportMode, on: boolean) => setShowModes((current) => withMode(current, mode, on)),
    [setShowModes]
  );
  // Route lines (the JORE background network and the highlighted per-line
  // ribbons) are the map's densest ink: handy for seeing where a line goes,
  // in the way when you only want the vehicles and the streets under them.
  // On by default — hiding them is the deliberate choice.
  const [showRoutes, setShowRoutes] = usePersistedFlag('showRoutes', true);

  // What the map draws: the reader's own toggles, plus the modes a selected
  // journey or stop needs in order to answer for itself.
  const shownModes = useMemo(
    () => anyMode(showModes, journeyModes, stopModes),
    [showModes, journeyModes, stopModes]
  );
  // What the backend is asked to ingest, declared here (after the mode toggles)
  // so the WebSocket below knows which optional feeds to subscribe to; trams
  // always stream. It is not the same set as what is drawn: the ride
  // search needs every mode on the wire to find the bus the reader is sitting
  // in, but that is the detector's business and not a decision to draw a
  // mode somebody has switched off. So the extra feeds stream and stay
  // invisible; the one vehicle the search settles on is drawn whatever the
  // toggles say (see `displayedTrams`), which is the only marker the reader
  // actually asked for.
  const wantsModes = useMemo(() => anyMode(shownModes, rideModes), [shownModes, rideModes]);
  const { status: connectionStatus } = useWebSocket({
    onMessage: (data) => setLiveTrams(data.vehicles),
    wantsModes,
  });

  useEffect(() => {
    // The app's own chrome has two skins, not three: over the orthophotos the
    // dark one is the readable pairing.
    document.documentElement.setAttribute('data-theme', mapTheme === 'light' ? 'light' : 'dark');
  }, [mapTheme]);

  // Everything the map shows beside the vehicles — departures, alerts, journey
  // plans, bike capacity — is fetched for right now, so beside an hour-old tram
  // it would be quietly wrong. Leaving a replay puts them all back.
  useEffect(() => {
    if (!replay.active) return;
    setSelection(null);
    setJourney(null);
    setJourneyOpen(false);
    setDeparturesOpen(false);
  }, [replay.active]);

  const [isFollowing, setIsFollowing] = useState<boolean>(false);
  // Whether the map's locate control is on. Riding along is an answer about
  // where the reader is, so it is only offered once they have asked the map
  // that question themselves.
  const [locating, setLocating] = useState<boolean>(false);

  // Reset following mode when the selected vehicle changes
  useEffect(() => {
    setIsFollowing(false);
  }, [trackedVehicleId]);

  // Detail panel collapse state: defaults to true (hidden/collapsed when item is selected)
  const [isDetailCollapsed, setIsDetailCollapsed] = useState<boolean>(true);

  // A detected ride takes the map over: the vehicle the reader is inside
  // becomes the selection, so its route, its stops and its telemetry are what
  // the panels are about. For as long as the ride lasts it is also what the
  // panels come back to — closing whatever the reader looked at in the
  // meantime returns them to it. The first effect empties the selection when a
  // ride begins; the second fills an empty one.
  useEffect(() => {
    if (!ride.rideVehicleId) return;
    setSelection(null);
    setIsDetailCollapsed(false);
  }, [ride.rideVehicleId]);

  useEffect(() => {
    if (!rideVehicle) return;
    setSelection((current) => current ?? { kind: 'vehicle', vehicle: rideVehicle });
  }, [rideVehicle]);

  // Riding along means the camera rides too. This runs after the reset above,
  // so a ride's own selection keeps its follow instead of having it cleared —
  // and dragging the map still releases the camera, as it does for any follow.
  // When the ride ends the camera is let go rather than left chasing a vehicle
  // the reader has stepped off.
  const previousRideRef = useRef<string | null>(null);
  useEffect(() => {
    if (ride.rideVehicleId && trackedVehicleId === ride.rideVehicleId) setIsFollowing(true);
    else if (previousRideRef.current && !ride.rideVehicleId) setIsFollowing(false);
    previousRideRef.current = ride.rideVehicleId;
  }, [ride.rideVehicleId, trackedVehicleId]);

  // Sidebar collapse state: defaults to collapsed on mobile, open on desktop
  const [isFilterCollapsed, setIsFilterCollapsed] = useState<boolean>(
    typeof window !== 'undefined' ? window.innerWidth <= 768 : false
  );

  // Auto-collapse sidebar when something is selected on mobile. Keyed on what
  // is selected rather than on the selection itself, so the open stop's panel
  // reporting its departures does not shut the sidebar again on every poll.
  const selectedKey = selectionKey(selection);
  useEffect(() => {
    if (selectedKey !== null && isMobile) {
      setIsFilterCollapsed(true);
    }
  }, [selectedKey, isMobile]);

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

  useEdgeSwipe({
    filterCollapsed: isFilterCollapsed,
    setFilterCollapsed: setIsFilterCollapsed,
    detailCollapsed: isDetailCollapsed,
    setDetailCollapsed: setIsDetailCollapsed,
    isMobile,
  });
  // The line filter (favourite lines), remembered across reloads.
  const [selectedLines, setSelectedLines] = usePersistedLines('selectedLines');

  const [mapBearing, setMapBearing] = useState<number>(0);

  // Every rail line currently running — trams plus, when their toggle is on,
  // the metro and commuter-train lines. Sorted so the list reads the same from
  // one position update to the next while the same lines are in service.
  const ribbonModes = useMemo(
    () => new Set<string>(RIBBONED_MODES.filter((mode) => showModes[mode])),
    [showModes]
  );
  const activeRibbonLines = useMemo(
    () =>
      [...new Set(vehicles.filter((t) => ribbonModes.has(t.mode) && t.desi).map((t) => t.desi))].sort(),
    [vehicles, ribbonModes]
  );

  // The lines the map draws as highlighted ribbons, and so the ones whose
  // geometry is fetched: the line filter, the selected vehicle's line and the
  // open stop's lines.
  //
  // With no filter — the panel's "Show All" — that is every running tram, metro
  // and train line whose mode is switched on, so the map draws the same fanned,
  // per-line-coloured ribbons it would if the user had ticked every chip by
  // hand, rather than dropping to the flat mode-coloured tile network
  // underneath. Buses are left to that network: there are hundreds of bus lines,
  // far too many to fetch a pattern each.
  const routeGeometries = useRouteGeometries([
    ...new Set([
      ...(selectedLines.length > 0 ? selectedLines : activeRibbonLines),
      ...(selectedVehicle ? [selectedVehicle.desi] : []),
      ...stopRoutes,
    ]),
  ]);

  const handleSelectTram = (tram: VehiclePosition | null) => {
    setSelection(tram ? { kind: 'vehicle', vehicle: tram } : null);
  };

  const handleSelectStop = (stop: PickedStop) => {
    if (openStop?.stop.id !== stop.id) setSelection(stopSelection(stop));
    setIsDetailCollapsed(false); // Auto-expand detail panel to show schedule
  };

  const handleSelectBikeStation = (station: { id: string; name: string } | null) => {
    setSelection(station ? { kind: 'bikeStation', station } : null);
    if (station) {
      setIsDetailCollapsed(false); // Auto-expand detail panel to show bike capacity
    }
  };

  const handleSelectJunction = (junctionId: number | null) => {
    setSelection(junctionId !== null ? { kind: 'junction', junctionId } : null);
    if (junctionId !== null) {
      setIsDetailCollapsed(false); // Auto-expand to show who is asking
    }
  };

  const clearSelection = () => setSelection(null);

  // What the open stop's panel reports back about it, kept only while that
  // stop is still the one open.
  const updateStop = (id: string, update: (stop: StopSelection) => StopSelection) =>
    setSelection((current) =>
      current?.kind === 'stop' && current.stop.id === id ? update(current) : current
    );

  const handleToggleLine = (line: string) => {
    setSelectedLines((prev) =>
      prev.includes(line) ? prev.filter((l) => l !== line) : [...prev, line]
    );
  };

  const handleClearFilters = () => {
    setSelectedLines([]);
  };

  // A schedule can be selected just before its vehicle enters the live feed.
  // Replace the placeholder as soon as the matching vehicle appears.
  useEffect(() => {
    if (selection?.kind !== 'scheduledTrip') return;
    const vehicle = findTripVehicle(selection.placeholder.tripId, vehicles);
    if (vehicle) setSelection({ kind: 'vehicle', vehicle });
  }, [selection, vehicles]);

  // Lines used by the currently selected journey's transit legs. When a route is
  // picked in the destination search, we filter the map down to just these lines —
  // the same way selecting a line filter does.
  const journeyLines = journey
    ? journey.itinerary.legs
        .filter((leg) => leg.transit && leg.route?.shortName)
        .map((leg) => leg.route!.shortName)
    : [];
  const journeyVehicleIds = useMemo(() => {
    return [...new Set(journey?.itinerary.legs.flatMap((leg) => {
      const vehicle = findJourneyVehicle(leg, vehicles, now);
      return vehicle ? [vehicle.veh] : [];
    }) ?? [])];
  }, [journey, vehicles, now]);

  // Stop route filter: only filter after routes are loaded.
  // While loading (a stop is open but its routes have not arrived) keep all trams visible.
  const displayedTrams = Object.fromEntries(
    Object.entries(trams).filter((entry) => {
      const tram = entry[1];
      if (journeyVehicleIds.includes(tram.veh)) return true;
      // The arrival being tracked stays on the map even when its mode or line
      // is filtered out — hiding it is exactly what tracking is meant to stop.
      if (arrivalFocus?.vehicleId === tram.veh) return true;
      // The vehicle the reader is riding in outranks every filter, for the
      // same reason: hiding it is exactly what riding along is meant to stop.
      if (ride.rideVehicleId === tram.veh) return true;
      const mode = asTransportMode(tram.mode);
      if (mode !== null && !shownModes[mode]) return false;
      if (selectedLines.length > 0 && !selectedLines.includes(tram.desi)) {
        return false;
      }
      // Filter by the open stop's routes
      if (stopRoutes.length > 0 && !stopRoutes.includes(tram.desi)) {
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

  // The timetable behind the selected vehicle's journey.
  const {
    details: selectedTripDetails,
    loading: isLoadingTripDetails,
    error: tripDetailsError,
  } = useTripDetails(selectedVehicle?.tripId);

  // Pattern geometry for the arrival being tracked, so the map can draw its
  // approach along the street rather than as a bearing across the blocks.
  const { details: arrivalTripDetails } = useTripDetails(arrivalFocus?.tripId);

  // Opening the journey planner clears any selection so the map is dedicated
  // to the planned route; closing it clears the journey.
  const handleJourneyOpenChange = useCallback((open: boolean) => {
    setJourneyOpen(open);
    if (open) setSelection(null);
    else setJourney(null);
  }, []);

  // The junction panel reads the same two things the map's markers do: the
  // static junction locations, and the live priority exchanges folded out of
  // the vehicles' own `tlp` field. Both are already in hand, so the panel costs
  // no fetch of its own.
  const trafficLightFeatures = useTrafficLights();
  const junctionPriorities = useMemo(
    () => signalPriorityIndex(vehicles),
    [vehicles],
  );
  const selectedJunction = useMemo(
    () => (selectedJunctionId === null
      ? null
      : trafficLightFeatures.find((f) => f.properties.id === selectedJunctionId) ?? null),
    [selectedJunctionId, trafficLightFeatures],
  );

  // Bottom tab bar state (mobile only): drives which bottom sheet is expanded, and
  // null when none is — the map is then fully visible.
  const hasDetailSelection = selection !== null;
  const activeMobileTab: MobileTab | null = !isFilterCollapsed
    ? 'lines'
    : hasDetailSelection && !isDetailCollapsed
    ? 'details'
    : null;

  // A bottom sheet covers most of the screen on a phone, and the corner chips
  // float above it — so they get out of the way while one is open rather than
  // sitting on top of the sheet's own header.
  const mobileSheetOpen = isMobile && activeMobileTab !== null;

  // The timelapse takes the whole map over. Everything that belongs to *now* —
  // the line filters, the mode and view chips, the journey planner, the
  // departures board, the phone's tab bar — steps aside while history plays, so
  // the scrubber is the only control on screen and nothing offers a live answer
  // beside an hour-old tram. They all come back on exit.
  const replayActive = replay.active;

  // When to get off. A planned journey already names the stop the reader
  // leaves the vehicle at; this is the app saying so at the moment it matters,
  // counted off the vehicle running the leg rather than off the clock.
  const alight = useMemo(
    () => (journey && !replayActive
      ? alightAlert(journey.itinerary, vehicles, now, ride.rideVehicleId)
      : null),
    [journey, vehicles, now, ride.rideVehicleId, replayActive]);
  const alightNotifications = useAlightNotifications(alight);

  // What the ride strip says while it is following: the line, and the stop the
  // vehicle is running to, in words rather than as a GTFS id.
  const rideNextStop = useMemo(() => {
    const target = rideVehicle?.nextStop?.replace(/^HSL:/, '');
    if (!target || selectedTripDetails?.tripId !== rideVehicle?.tripId) return null;
    return selectedTripDetails?.stops.find(
      (stop) => stop.gtfsId?.replace(/^HSL:/, '') === target)?.name ?? null;
  }, [rideVehicle, selectedTripDetails]);

  // Every bar button toggles: tapping the open sheet closes it back to the map.
  const handleMobileTabSelect = (tab: MobileTab) => {
    if (tab === 'details') {
      setIsDetailCollapsed(!isDetailCollapsed);
      return;
    }
    setIsFilterCollapsed(!isFilterCollapsed);
  };

  // What the map is told, grouped by what it is about. Assembled here rather
  // than spread across thirty-seven attributes on the element below.
  const mapSelection: MapSelection = {
    // A scheduled trip has no vehicle of its own yet, so it is identified by
    // the trip it is running.
    vehicleId:
      selection?.kind === 'scheduledTrip' ? selection.placeholder.tripId : trackedVehicleId,
    line: selectedVehicle?.desi || null,
    tripDetails: selectedTripDetails,
    stop: openStop
      ? {
          id: openStop.stop.id,
          coords:
            openStop.stop.lat && openStop.stop.lng ? [openStop.stop.lng, openStop.stop.lat] : null,
          mode: openStop.stop.mode || null,
          isTrunk: openStop.stop.isTrunkStop || false,
        }
      : null,
    bikeStationId: selectedBikeStation?.id || null,
    junctionId: selectedJunctionId,
  };

  const mapView: MapView = {
    theme: mapTheme,
    is3D,
    always3DVehicles,
    modes: shownModes,
    showRoutes,
    lineFilters: selectedLines,
  };

  const journeyOverlay: JourneyOverlay = {
    legs: journey?.itinerary.legs ?? null,
    endpoints: journey ? { from: journey.from, to: journey.to } : null,
    vehicleIds: journeyVehicleIds,
  };

  const arrivalOverlay: ArrivalOverlay = {
    focus: arrivalFocus,
    tripDetails: arrivalTripDetails,
    labels: arrivalLabels,
  };

  const mapCallbacks: MapCallbacks = {
    onSelectTram: handleSelectTram,
    onSelectStop: handleSelectStop,
    onSelectBikeStation: handleSelectBikeStation,
    onSelectJunction: handleSelectJunction,
    onDisableFollowing: () => setIsFollowing(false),
    onMapBearingChange: setMapBearing,
    onLocatingChange: setLocating,
    onVisibleStopsChange: setLabelStopIds,
  };

  return (
    <div className="dashboard-container">
      {/* Fullscreen Map Canvas */}
      <Map
        trams={displayedTrams}
        routeGeometries={routeGeometries}
        isFollowing={isFollowing}
        timeScale={replay.timeScale}
        selection={mapSelection}
        view={mapView}
        journey={journeyOverlay}
        arrivals={arrivalOverlay}
        callbacks={mapCallbacks}
      />

      {/* Sidebar Filters Panel — hidden while the timelapse owns the screen */}
      {!replayActive && (
        <FilterPanel
          trams={trams}
          selectedLines={selectedLines}
          onToggleLine={handleToggleLine}
          onClearFilters={handleClearFilters}
          connectionStatus={connectionStatus}
          isCollapsed={isFilterCollapsed}
          onToggleCollapse={() => setIsFilterCollapsed(!isFilterCollapsed)}
          modes={showModes}
          alerts={alerts}
          selectedTram={selectedVehicle}
          selectedStop={openStop?.stop ?? null}
          selectedStopRoutes={stopRoutes}
        />
      )}

      {/* Floating top-center tram telemetry card */}
      {trackedVehicle && (
        <TramCard
          tram={trackedVehicle}
          mapBearing={mapBearing}
          onClose={clearSelection}
          isFollowing={isFollowing}
          onToggleFollow={() => setIsFollowing(!isFollowing)}
          tripDetails={selectedTripDetails}
        />
      )}

      {/* Schedule detail panel (right side) */}
      {selectedVehicle && (
        <TramPopup
          tram={selectedVehicle}
          isCollapsed={isDetailCollapsed}
          onToggleCollapse={() => setIsDetailCollapsed(!isDetailCollapsed)}
          alerts={alerts}
          tripDetails={selectedTripDetails}
          loading={isLoadingTripDetails}
          error={tripDetailsError}
        />
      )}

      {/* Selected Stop Timetable Panel */}
      {openStop && (
        <StopPopup
          stopId={openStop.stop.id}
          stopName={openStop.stop.name}
          stopCode={openStop.stop.code}
          onClose={clearSelection}
          onSelectTripId={(tripId, lineDesi) => setSelection(tripSelection(tripId, lineDesi, vehicles))}
          onStopRoutesLoaded={(routes) => updateStop(openStop.stop.id, (stop) => ({ ...stop, routes }))}
          vehicles={vehicles}
          walkDistance={openStop.stop.distance}
          autoTrack={openStop.stop.autoTrack}
          onArrivalModesLoaded={(modes) => updateStop(openStop.stop.id, (stop) => ({ ...stop, modes }))}
          onArrivalFocusChange={(focus) =>
            updateStop(openStop.stop.id, (stop) => ({ ...stop, arrivalFocus: focus }))}
          onStopCoordsLoaded={(lat, lng) =>
            updateStop(openStop.stop.id, (stop) => ({ ...stop, stop: { ...stop.stop, lat, lng } }))}
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
          onClose={clearSelection}
          isCollapsed={isDetailCollapsed}
          onToggleCollapse={() => setIsDetailCollapsed(!isDetailCollapsed)}
        />
      )}

      {/* Selected Junction — who is asking these lights for a green */}
      {selectedJunction && (
        <TrafficLightPopup
          junction={selectedJunction}
          activity={junctionPriorities.get(selectedJunction.properties.id) ?? null}
          onSelectVehicle={(veh) => {
            const vehicle = vehicles.find((v) => v.veh === veh);
            if (vehicle) handleSelectTram(vehicle);
          }}
          onClose={clearSelection}
          isCollapsed={isDetailCollapsed}
          onToggleCollapse={() => setIsDetailCollapsed(!isDetailCollapsed)}
        />
      )}

      {/* Destination search / journey planner (top-center) */}
      <JourneySearch
        onSelectionChange={setJourney}
        onOpenChange={handleJourneyOpenChange}
        hidden={replayActive || departuresOpen || trackedVehicle !== null}
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
        hidden={replayActive || journeyOpen || trackedVehicle !== null}
        onOpenChange={setDeparturesOpen}
        onSelectStop={(stop, extras) =>
          handleSelectStop({ id: stop.gtfsId, name: stop.name, code: stop.code, lat: stop.lat, lng: stop.lon, ...extras })}
      />

      {/* The bottom dock: when to get off, and which vehicle you are in */}
      <div className="map-bottom-dock">
        <AlightBanner
          alert={alight}
          notifications={alightNotifications}
          hidden={replayActive || mobileSheetOpen}
        />
        <RidePanel
          detection={ride}
          hidden={replayActive || mobileSheetOpen}
          locating={locating}
          rideLine={rideVehicle?.desi ?? null}
          rideNextStop={rideNextStop}
        />
      </div>

      {/* Quick vehicle-mode shortcuts (top-right corner) */}
      <ModeToggles
        hidden={mobileSheetOpen || replayActive}
        modes={showModes}
        onToggle={toggleMode}
      />

      {/* Map view shortcuts: light/dark and 3D (top-left corner) */}
      <ViewToggles
        hidden={mobileSheetOpen || replayActive}
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

      {/* Version Badge — clicking it reveals the timelapse controls. Once they
          are open the panel carries its own exit, so the badge steps aside too. */}
      {!replayActive && (
        <VersionBadge onReveal={replay.available ? () => replay.controls.enter() : undefined} />
      )}

      {replayActive && (
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
      {isMobile && !replayActive && (
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
