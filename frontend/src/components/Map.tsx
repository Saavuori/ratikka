import React, { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { VehiclePosition, TripDetailsResponse } from '../types';
import { lerp, lerpAngle } from '../lib/lerp';
import { decodePolyline } from '../lib/polyline';
import { fetchTripDetails } from '../lib/api';

interface MapProps {
  trams: Record<string, VehiclePosition>;
  selectedTramId: string | null;
  selectedStopId: string | null;
  selectedBikeStationId: string | null;
  onSelectTram: (tram: VehiclePosition | null) => void;
  onSelectStop: (stopId: string, name: string, code: string) => void;
  onSelectBikeStation: (station: { id: string; name: string } | null) => void;
  lineFilters: string[];
  routeGeometries: Record<string, { geometries: string[]; color?: string; stops?: string[] }>;
  mapTheme: 'light' | 'dark';
  showRouteNetwork: boolean;
  is3D: boolean;
  isFollowing: boolean;
  onDisableFollowing: () => void;
  onMapBearingChange?: (bearing: number) => void;
}

interface RenderPosition {
  lat: number;
  lng: number;
  hdg: number;
}

export const Map: React.FC<MapProps> = ({
  trams,
  selectedTramId,
  selectedStopId,
  selectedBikeStationId,
  onSelectTram,
  onSelectStop,
  onSelectBikeStation,
  lineFilters,
  routeGeometries,
  mapTheme,
  showRouteNetwork,
  is3D,
  isFollowing,
  onDisableFollowing,
  onMapBearingChange,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  const [selectedTripDetails, setSelectedTripDetails] = React.useState<TripDetailsResponse | null>(null);
  const selectedTripDetailsRef = useRef<TripDetailsResponse | null>(null);

  useEffect(() => {
    selectedTripDetailsRef.current = selectedTripDetails;
  }, [selectedTripDetails]);

  const [apiKey, setApiKey] = React.useState<string | null>(null);

  useEffect(() => {
    fetch('/api/v1/config')
      .then((res) => res.json())
      .then((data) => {
        setApiKey(data.digitransit_map_key || '');
      })
      .catch((err) => {
        console.error('Failed to fetch map key config:', err);
        setApiKey('');
      });
  }, []);

  // References to keep state fresh in map event handlers and tick loop without closure issues
  const latestTramsRef = useRef<Record<string, VehiclePosition>>(trams);
  const callbacksRef = useRef({ onSelectTram, onSelectStop, onSelectBikeStation, onDisableFollowing, onMapBearingChange });
  const routeGeometriesRef = useRef<Record<string, { geometries: string[]; color?: string; stops?: string[] }>>(routeGeometries);
  const selectedTramIdRef = useRef<string | null>(selectedTramId);
  const selectedStopIdRef = useRef<string | null>(selectedStopId);
  const selectedBikeStationIdRef = useRef<string | null>(selectedBikeStationId);
  const showRouteNetworkRef = useRef<boolean>(showRouteNetwork);
  const is3DRef = useRef<boolean>(is3D);
  const mapThemeRef = useRef<'light' | 'dark'>(mapTheme);
  const isFollowingRef = useRef<boolean>(isFollowing);
  const isInteractingRef = useRef<boolean>(false);

  const lastSeenStopIdRef = useRef<string | null>(null);

  useEffect(() => {
    lastSeenStopIdRef.current = null;
  }, [selectedTramId]);

  useEffect(() => {
    latestTramsRef.current = trams;
  }, [trams]);

  useEffect(() => {
    callbacksRef.current = { onSelectTram, onSelectStop, onSelectBikeStation, onDisableFollowing, onMapBearingChange };
  }, [onSelectTram, onSelectStop, onSelectBikeStation, onDisableFollowing, onMapBearingChange]);

  useEffect(() => {
    routeGeometriesRef.current = routeGeometries;
  }, [routeGeometries]);

  useEffect(() => {
    selectedTramIdRef.current = selectedTramId;
  }, [selectedTramId]);

  useEffect(() => {
    selectedStopIdRef.current = selectedStopId;
  }, [selectedStopId]);

  useEffect(() => {
    selectedBikeStationIdRef.current = selectedBikeStationId;
  }, [selectedBikeStationId]);

  useEffect(() => {
    showRouteNetworkRef.current = showRouteNetwork;
  }, [showRouteNetwork]);

  useEffect(() => {
    is3DRef.current = is3D;
  }, [is3D]);

  useEffect(() => {
    mapThemeRef.current = mapTheme;
  }, [mapTheme]);

  useEffect(() => {
    isFollowingRef.current = isFollowing;
  }, [isFollowing]);

  // Helper to toggle visibility of HSL background route layers
  const updateRouteVisibility = (map: maplibregl.Map, show: boolean) => {
    const routeLayers = [
      'route_bus_case',
      'route_bus',
      'route_bus_inner',
      'route_tram_case',
      'route_tram',
      'route_tram_inner',
      'route_trunk_case',
      'route_trunk',
      'route_trunk_inner',
      'route_lrail_case',
      'route_lrail',
      'route_lrail_inner',
      'route_ferry',
      'route_subway_case',
      'route_subway',
      'route_subway_underground',
      'route_rail_case',
      'route_rail',
    ];
    routeLayers.forEach((layerId) => {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, 'visibility', show ? 'visible' : 'none');
      }
    });
  };

  // Helper to toggle 3D tilt and buildings extrusion
  const update3DMode = (map: maplibregl.Map, active: boolean, theme: 'light' | 'dark') => {
    // 1. Set pitch
    map.easeTo({
      pitch: active ? 45 : 0,
      duration: 800,
    });

    // 2. Toggle light-mode built-in 3D buildings
    if (map.getLayer('building_3d')) {
      map.setLayoutProperty('building_3d', 'visibility', active ? 'visible' : 'none');
    }
    if (map.getLayer('building')) {
      map.setLayoutProperty('building', 'visibility', active ? 'none' : 'visible');
    }
    if (map.getLayer('building_shadow')) {
      map.setLayoutProperty('building_shadow', 'visibility', active ? 'none' : 'visible');
    }

    // 3. Toggle dark-mode programmatic 3D buildings
    const custom3DId = 'custom-3d-buildings';
    if (active) {
      if (theme === 'dark') {
        if (!map.getLayer(custom3DId)) {
          if (map.getSource('carto')) {
            map.addLayer({
              id: custom3DId,
              source: 'carto',
              'source-layer': 'building',
              type: 'fill-extrusion',
              paint: {
                'fill-extrusion-color': '#2a2d30',
                'fill-extrusion-height': ['coalesce', ['get', 'render_height'], ['get', 'height'], 15],
                'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0],
                'fill-extrusion-opacity': 0.85,
              },
            });
          }
        } else {
          map.setLayoutProperty(custom3DId, 'visibility', 'visible');
        }
      } else {
        // In light mode, hide custom dark mode buildings
        if (map.getLayer(custom3DId)) {
          map.setLayoutProperty(custom3DId, 'visibility', 'none');
        }
      }
    } else {
      // If inactive, hide both light-mode and custom 3D buildings
      if (map.getLayer('building_3d')) {
        map.setLayoutProperty('building_3d', 'visibility', 'none');
      }
      if (map.getLayer(custom3DId)) {
        map.setLayoutProperty(custom3DId, 'visibility', 'none');
      }
    }
  };

  // Helper to draw route geometries on the map
  const drawRouteGeometries = (map: maplibregl.Map, geometries: Record<string, { geometries: string[]; color?: string }>) => {
    const source = map.getSource('route-lines') as maplibregl.GeoJSONSource;
    if (!source) return;

    const features: { type: 'Feature'; geometry: { type: 'LineString'; coordinates: [number, number][] }; properties: { line: string; color: string } }[] = [];
    Object.entries(geometries).forEach(([line, data]) => {
      const colorHex = data.color
        ? (data.color.startsWith('#') ? data.color : `#${data.color}`)
        : '#10b981'; // HSL Green fallback

      data.geometries.forEach((poly) => {
        const coords = decodePolyline(poly);
        features.push({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: coords,
          },
          properties: {
            line: line,
            color: colorHex,
          },
        });
      });
    });

    source.setData({
      type: 'FeatureCollection',
      features,
    });
  };

  // Animation references to run independent of React re-renders
  const prevPositionsRef = useRef<Record<string, RenderPosition>>({});
  const targetPositionsRef = useRef<Record<string, RenderPosition>>({});
  const lastUpdateRef = useRef<number>(0);
  const animationFrameRef = useRef<number | null>(null);

  // Interpolation and GeoJSON updates loop
  function startAnimationLoop() {
    const tick = () => {
      const map = mapRef.current;
      if (!map || !map.getSource('trams')) {
        animationFrameRef.current = requestAnimationFrame(tick);
        return;
      }

      const now = performance.now();
      // Snapshot updates are expected every 1000ms. Clamp delta to 1.0.
      const elapsed = now - lastUpdateRef.current;
      const t = Math.min(elapsed / 1000, 1.0);

      const features = Object.entries(targetPositionsRef.current).map(([id, target]) => {
        const prev = prevPositionsRef.current[id] || target;
        
        // Lerp position coordinates
        const lat = lerp(prev.lat, target.lat, t);
        const lng = lerp(prev.lng, target.lng, t);
        const hdg = lerpAngle(prev.hdg, target.hdg, t);

        const tramInfo = latestTramsRef.current[id];

        return {
          type: 'Feature' as const,
          geometry: {
            type: 'Point' as const,
            coordinates: [lng, lat],
          },
          properties: {
            veh: id,
            desi: tramInfo?.desi || '',
            hdg: hdg,
            stopped: tramInfo?.drst === 1 || tramInfo?.spd === 0,
            mode: tramInfo?.mode || 'tram',
          },
        };
      });

      const source = map.getSource('trams') as maplibregl.GeoJSONSource;
      if (source) {
        source.setData({
          type: 'FeatureCollection',
          features,
        });
      }

      // Update next stop highlight and route line segment
      let selectedVehiclePos: [number, number] | null = null;
      let nextStopCoords: [number, number] | null = null;
      let routeSegmentCoords: [number, number][] = [];

      if (selectedTramIdRef.current && selectedTripDetailsRef.current) {
        const selectedTram = latestTramsRef.current[selectedTramIdRef.current];
        if (selectedTram) {
          const activeFeature = features.find((f) => f.properties.veh === selectedTramIdRef.current);
          if (activeFeature) {
            selectedVehiclePos = activeFeature.geometry.coordinates as [number, number];
          }

          const isStopped = selectedTram.drst === 1;
          if (selectedTram.stop) {
            lastSeenStopIdRef.current = selectedTram.stop;
          }
          const stopIdToMatch = selectedTram.stop || lastSeenStopIdRef.current;
          const tripStops = selectedTripDetailsRef.current.stops;

          let lastKnownIndex = -1;
          if (stopIdToMatch) {
            const cleanToMatch = stopIdToMatch.replace(/^HSL:/, '');
            lastKnownIndex = tripStops.findIndex(s => s.gtfsId === stopIdToMatch || s.gtfsId?.replace(/^HSL:/, '') === cleanToMatch);
          }

          if (lastKnownIndex === -1) {
            // Fallback: Estimate position based on arrival times
            const now = new Date();
            const currentMinutes = now.getHours() * 60 + now.getMinutes();

            const nextIndex = tripStops.findIndex(stop => {
              const [h, m] = stop.realtimeArrival.split(':').map(Number);
              const stopMinutes = h * 60 + m;
              return stopMinutes >= currentMinutes;
            });

            if (nextIndex !== -1) {
              lastKnownIndex = nextIndex > 0 ? nextIndex - 1 : 0;
            } else {
              lastKnownIndex = tripStops.length - 1;
            }
          }

          let nextStopIndex = -1;
          if (isStopped) {
            // Doors open: we are currently at lastKnownIndex, next is lastKnownIndex + 1
            nextStopIndex = lastKnownIndex + 1 < tripStops.length ? lastKnownIndex + 1 : -1;
          } else {
            // Moving: departed lastKnownIndex, next is lastKnownIndex + 1
            nextStopIndex = lastKnownIndex + 1 < tripStops.length ? lastKnownIndex + 1 : lastKnownIndex;
          }

          if (nextStopIndex !== -1) {
            const matchedStop = tripStops[nextStopIndex];
            nextStopCoords = [matchedStop.lon, matchedStop.lat];

            if (selectedVehiclePos && selectedTripDetailsRef.current.geometry) {
              const polylineCoords = decodePolyline(selectedTripDetailsRef.current.geometry);

              if (polylineCoords.length > 0) {
                const getClosestPointIndex = (coords: [number, number][], target: [number, number]): number => {
                  let minD = Infinity;
                  let index = 0;
                  for (let i = 0; i < coords.length; i++) {
                    const d = Math.pow(coords[i][0] - target[0], 2) + Math.pow(coords[i][1] - target[1], 2);
                    if (d < minD) {
                      minD = d;
                      index = i;
                    }
                  }
                  return index;
                };

                const idxTram = getClosestPointIndex(polylineCoords, selectedVehiclePos);
                const idxStop = getClosestPointIndex(polylineCoords, nextStopCoords);

                const startIdx = Math.min(idxTram, idxStop);
                const endIdx = Math.max(idxTram, idxStop);
                const slice = polylineCoords.slice(startIdx, endIdx + 1);

                routeSegmentCoords = [selectedVehiclePos, ...slice, nextStopCoords];
              } else {
                routeSegmentCoords = [selectedVehiclePos, nextStopCoords];
              }
            }
          }
        }
      }

      // Update next stop highlight source
      const nextStopSource = map.getSource('next-stop-highlight-source') as maplibregl.GeoJSONSource;
      if (nextStopSource) {
        nextStopSource.setData({
          type: 'FeatureCollection',
          features: nextStopCoords ? [{
            type: 'Feature',
            geometry: {
              type: 'Point',
              coordinates: nextStopCoords,
            },
            properties: {},
          }] : [],
        });
      }

      // Update route line source
      const routeSource = map.getSource('next-stop-route') as maplibregl.GeoJSONSource;
      if (routeSource) {
        routeSource.setData({
          type: 'FeatureCollection',
          features: routeSegmentCoords.length > 0 ? [{
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: routeSegmentCoords,
            },
            properties: {},
          }] : [],
        });
      }

      // Smooth camera tracking
      if (isFollowingRef.current && selectedTramIdRef.current) {
        const activeFeature = features.find((f) => f.properties.veh === selectedTramIdRef.current);
        if (activeFeature && !isInteractingRef.current) {
          const [lng, lat] = activeFeature.geometry.coordinates;
          const hdg = activeFeature.properties.hdg;
          map.jumpTo({
            center: [lng, lat],
            bearing: hdg,
          });
        }
      }

      animationFrameRef.current = requestAnimationFrame(tick);
    };

    animationFrameRef.current = requestAnimationFrame(tick);
  }

  // Sync incoming tram data to animation refs
  useEffect(() => {
    const now = performance.now();
    const newPrev: Record<string, RenderPosition> = {};
    const newTarget: Record<string, RenderPosition> = {};

    // Filter trams based on line filters
    const filteredTrams = Object.entries(trams).filter((entry) => {
      const tram = entry[1];
      if (lineFilters.length === 0) return true;
      return lineFilters.includes(tram.desi);
    });

    filteredTrams.forEach(([id, tram]) => {
      // If we already have a previous target, that becomes the start position for the next transition
      const currentPrev = targetPositionsRef.current[id];
      if (currentPrev) {
        newPrev[id] = currentPrev;
      } else {
        newPrev[id] = { lat: tram.lat, lng: tram.lng, hdg: tram.hdg };
      }
      newTarget[id] = { lat: tram.lat, lng: tram.lng, hdg: tram.hdg };
    });

    prevPositionsRef.current = newPrev;
    targetPositionsRef.current = newTarget;
    lastUpdateRef.current = now;
  }, [trams, lineFilters]);

  // Setup programmatically created sources, layers, and images
  const setupCustomMapElements = (map: maplibregl.Map) => {
    if (!apiKey) return;

    // 1. Create Arrow Symbol Image for Heading (Tram: sleek circle with thin sharp pointer)
    if (!map.hasImage('tram-arrow')) {
      const arrowSvg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36" fill="none">
          <path d="M18,0 L24.5,10.5 L11.5,10.5 Z" fill="#00b894" stroke="#1e293b" stroke-width="3.5" stroke-linejoin="round"/>
          <path d="M18,0 L24.5,10.5 L11.5,10.5 Z" fill="#00b894" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"/>
          <circle cx="18" cy="18" r="12.5" stroke="#00b894" stroke-width="2.5" fill="none"/>
          <circle cx="18" cy="18" r="12.5" stroke="#ffffff" stroke-width="0.8" fill="none"/>
        </svg>
      `;
      const arrowImg = new Image(36, 36);
      arrowImg.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(arrowSvg);
      arrowImg.onload = () => {
        if (!map.hasImage('tram-arrow')) map.addImage('tram-arrow', arrowImg);
      };
    }

    // 1b. Create Bus Arrow Symbol Image for Heading (Bus: boxy rounded-square with wide pointer)
    if (!map.hasImage('bus-arrow')) {
      const arrowSvg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36" fill="none">
          <path d="M18,0 L25.5,10.5 L10.5,10.5 Z" fill="#0984e3" stroke="#1e293b" stroke-width="3.5" stroke-linejoin="round"/>
          <path d="M18,0 L25.5,10.5 L10.5,10.5 Z" fill="#0984e3" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"/>
          <rect x="5.5" y="5.5" width="25" height="25" rx="5" stroke="#0984e3" stroke-width="2.5" fill="none"/>
          <rect x="5.5" y="5.5" width="25" height="25" rx="5" stroke="#ffffff" stroke-width="0.8" fill="none"/>
        </svg>
      `;
      const arrowImg = new Image(36, 36);
      arrowImg.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(arrowSvg);
      arrowImg.onload = () => {
        if (!map.hasImage('bus-arrow')) map.addImage('bus-arrow', arrowImg);
      };
    }

    // 2. Create Selected Tram Highlight Image
    if (!map.hasImage('tram-selected')) {
      const selectedSvg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44" fill="none">
          <circle cx="22" cy="22" r="18" stroke="#fdcb6e" stroke-width="4" fill="none"/>
        </svg>
      `;
      const selectedImg = new Image(44, 44);
      selectedImg.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(selectedSvg);
      selectedImg.onload = () => {
        if (!map.hasImage('tram-selected')) map.addImage('tram-selected', selectedImg);
      };
    }

    // 3. Add Live Trams Source (GeoJSON)
    if (!map.getSource('trams')) {
      map.addSource('trams', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [],
        },
      });
    }

    // 5. Add Route Lines Source
    if (!map.getSource('route-lines')) {
      map.addSource('route-lines', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [],
        },
      });
    }

    // 6. Add Tram Text Circle Layer (Line labels) - ADDED FIRST so it renders underneath the pointers/arrows
    if (!map.getLayer('trams-circles')) {
      map.addLayer({
        id: 'trams-circles',
        type: 'circle',
        source: 'trams',
        paint: {
          'circle-radius': 11,
          'circle-color': [
            'case',
            ['get', 'stopped'],
            '#e17055', // stopped/door open -> coral red
            '#0984e3', // moving -> blue
          ],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2.5,
        },
      });
    }

    // 7. Add Tram Arrow Direction Layer (on top of circles)
    if (!map.getLayer('trams-arrows')) {
      map.addLayer({
        id: 'trams-arrows',
        type: 'symbol',
        source: 'trams',
        layout: {
          'icon-image': [
            'case',
            ['==', ['get', 'mode'], 'bus'],
            'bus-arrow',
            'tram-arrow'
          ],
          'icon-rotate': ['get', 'hdg'],
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      });
    }

    // 8. Add Route Lines Layer (Rendered before trams-circles so it is underneath)
    if (!map.getLayer('route-lines-layer')) {
      map.addLayer({
        id: 'route-lines-layer',
        type: 'line',
        source: 'route-lines',
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': ['coalesce', ['get', 'color'], '#10b981'],
          'line-width': 4.5,
          'line-opacity': 0.75,
        },
      }, 'trams-circles');
    }

    // 9. Add Tram Text Label Layer (on top of arrows/circles)
    if (!map.getLayer('trams-labels')) {
      map.addLayer({
        id: 'trams-labels',
        type: 'symbol',
        source: 'trams',
        layout: {
          'text-field': '{desi}',
          'text-font': ['Gotham Rounded Medium'],
          'text-size': 10,
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: {
          'text-color': '#ffffff',
        },
      });
    }

    // 10. Add Selection Highlight Ring (circle style, rendered under labels, on top of circles)
    if (!map.getLayer('trams-selected-layer')) {
      map.addLayer({
        id: 'trams-selected-layer',
        type: 'circle',
        source: 'trams',
        paint: {
          'circle-radius': 16,
          'circle-color': 'rgba(253, 203, 110, 0.15)',
          'circle-stroke-color': '#fdcb6e',
          'circle-stroke-width': 3,
        },
        filter: ['==', ['get', 'veh'], selectedTramIdRef.current || ''],
      }, 'trams-labels');
    }

    // 11. Add HSL Transit Stops Source and Layers if missing (e.g. in dark mode CartoDB basemap)
    if (!map.getSource('stops')) {
      map.addSource('stops', {
        type: 'vector',
        tiles: [
          'https://api.digitransit.fi/map/v3/hsl/fi/stops/{z}/{x}/{y}.pbf',
        ],
        minzoom: 13,
        maxzoom: 16,
      });
    }

    if (!map.getLayer('stops_case')) {
      map.addLayer({
        id: 'stops_case',
        type: 'circle',
        source: 'stops',
        'source-layer': 'stops',
        minzoom: 13,
        filter: ['match', ['get', 'mode'], 'RAIL', false, true],
        paint: {
          'circle-color': '#ffffff',
          'circle-radius': [
            'interpolate',
            ['exponential', 1.15],
            ['zoom'],
            12, 1.5,
            22, 26
          ]
        }
      }, 'trams-circles');
    }

    if (!map.getLayer('stops_bus')) {
      map.addLayer({
        id: 'stops_bus',
        type: 'circle',
        source: 'stops',
        'source-layer': 'stops',
        minzoom: 13,
        filter: [
          'all',
          ['!', ['get', 'isTrunkStop']],
          ['match', ['get', 'mode'], 'BUS', true, false]
        ],
        paint: {
          'circle-color': '#007ac9',
          'circle-radius': [
            'interpolate',
            ['exponential', 1.15],
            ['zoom'],
            12, 1,
            22, 24
          ]
        }
      }, 'trams-circles');
    }

    if (!map.getLayer('stops_trunk')) {
      map.addLayer({
        id: 'stops_trunk',
        type: 'circle',
        source: 'stops',
        'source-layer': 'stops',
        minzoom: 13,
        filter: ['all', ['get', 'isTrunkStop'], ['match', ['get', 'mode'], 'BUS', true, false]],
        paint: {
          'circle-color': '#CA4300',
          'circle-radius': [
            'interpolate',
            ['exponential', 1.15],
            ['zoom'],
            12, 1,
            22, 24
          ]
        }
      }, 'trams-circles');
    }

    if (!map.getLayer('stops_tram')) {
      map.addLayer({
        id: 'stops_tram',
        type: 'circle',
        source: 'stops',
        'source-layer': 'stops',
        minzoom: 13,
        filter: ['match', ['get', 'mode'], 'TRAM', true, false],
        paint: {
          'circle-color': '#00985f',
          'circle-radius': [
            'interpolate',
            ['exponential', 1.15],
            ['zoom'],
            12, 1,
            22, 24
          ]
        }
      }, 'trams-circles');
    }



    // 12. Add Citybike Source
    if (!map.getSource('citybike')) {
      map.addSource('citybike', {
        type: 'vector',
        tiles: [
          `https://api.digitransit.fi/map/v3/hsl/fi/rentalStations/{z}/{x}/{y}.pbf?digitransit-subscription-key=${apiKey}`,
        ],
        minzoom: 13,
        maxzoom: 16,
      });
    }

    // 13. Add Citybike stops case
    if (!map.getLayer('citybike_stops_case')) {
      map.addLayer({
        id: 'citybike_stops_case',
        type: 'circle',
        source: 'citybike',
        'source-layer': 'rentalStations',
        minzoom: 13,
        maxzoom: 14,
        paint: {
          'circle-color': '#ffffff',
          'circle-radius': [
            'interpolate',
            ['exponential', 1.15],
            ['zoom'],
            12, 1.5,
            22, 26
          ]
        }
      });
    }

    // 14. Add Citybike stops circle
    if (!map.getLayer('citybike_stops')) {
      map.addLayer({
        id: 'citybike_stops',
        type: 'circle',
        source: 'citybike',
        'source-layer': 'rentalStations',
        minzoom: 13,
        maxzoom: 14,
        paint: {
          'circle-color': '#fcbc19',
          'circle-radius': [
            'interpolate',
            ['exponential', 1.15],
            ['zoom'],
            12, 1,
            22, 24
          ]
        }
      });
    }

    // 15. Create Citybike Icon Image if missing
    if (!map.hasImage('icon-citybike-station')) {
      const bikeSvg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30" fill="none">
          <circle cx="15" cy="15" r="12" fill="#fcbc19" stroke="#ffffff" stroke-width="2"/>
          <path d="M19.5 17.5a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm-9 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM10.5 17.5h5m-2.5 0v-4.5h4.5m-4.5 2L15 11h2.5" stroke="#1e293b" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      `;
      const bikeImg = new Image(30, 30);
      bikeImg.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(bikeSvg);
      bikeImg.onload = () => {
        if (!map.hasImage('icon-citybike-station')) map.addImage('icon-citybike-station', bikeImg);
      };
    }

    // 16. Add Citybike Icon layer
    if (!map.getLayer('citybike_icon')) {
      map.addLayer({
        id: 'citybike_icon',
        type: 'symbol',
        source: 'citybike',
        'source-layer': 'rentalStations',
        minzoom: 14,
        layout: {
          'icon-image': 'icon-citybike-station',
          'icon-offset': [0, -6],
          'icon-allow-overlap': true,
          'icon-size': [
            'interpolate',
            ['linear'],
            ['zoom'],
            13, 0.8,
            20, 1.2
          ]
        }
      });
    }

    // Source for selected vehicle to next stop route
    if (!map.getSource('next-stop-route')) {
      map.addSource('next-stop-route', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [],
        },
      });
    }

    // Source for selected vehicle next stop highlight
    if (!map.getSource('next-stop-highlight-source')) {
      map.addSource('next-stop-highlight-source', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [],
        },
      });
    }

    // Selected stop highlight halo layer
    if (!map.getLayer('stops-selected-highlight')) {
      map.addLayer({
        id: 'stops-selected-highlight',
        type: 'circle',
        source: 'stops',
        'source-layer': 'stops',
        paint: {
          'circle-radius': [
            'interpolate',
            ['exponential', 1.15],
            ['zoom'],
            12, 12,
            22, 45
          ],
          'circle-color': 'rgba(253, 203, 110, 0.25)', // glowing gold halo
          'circle-stroke-color': '#fdcb6e',
          'circle-stroke-width': 3.5,
        },
        filter: ['==', ['to-string', ['coalesce', ['get', 'gtfsId'], ['get', 'stopId'], '']], '']
      }, 'trams-circles');
    }

    // Selected bike station highlight halo layer
    if (!map.getLayer('citybike-selected-highlight')) {
      map.addLayer({
        id: 'citybike-selected-highlight',
        type: 'circle',
        source: 'citybike',
        'source-layer': 'rentalStations',
        paint: {
          'circle-radius': [
            'interpolate',
            ['exponential', 1.15],
            ['zoom'],
            12, 14,
            22, 48
          ],
          'circle-color': 'rgba(253, 203, 110, 0.25)', // glowing gold halo
          'circle-stroke-color': '#fdcb6e',
          'circle-stroke-width': 3.5,
        },
        filter: ['==', ['to-string', ['coalesce', ['get', 'stationId'], ['get', 'id'], '']], '']
      }, 'citybike_icon');
    }

    // Next stop highlight halo layer
    if (!map.getLayer('next-stop-highlight')) {
      map.addLayer({
        id: 'next-stop-highlight',
        type: 'circle',
        source: 'next-stop-highlight-source',
        paint: {
          'circle-radius': [
            'interpolate',
            ['exponential', 1.15],
            ['zoom'],
            12, 12,
            22, 45
          ],
          'circle-color': 'rgba(255, 71, 87, 0.25)', // glowing neon red halo
          'circle-stroke-color': '#ff4757',
          'circle-stroke-width': 3.5,
        }
      }, 'trams-circles');
    }

    // Route segment to next stop layer (rendered under trams-circles)
    if (!map.getLayer('next-stop-route-layer')) {
      map.addLayer({
        id: 'next-stop-route-layer',
        type: 'line',
        source: 'next-stop-route',
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': '#ff4757', // glowing neon red
          'line-width': 7.5,
          'line-opacity': 0.9,
        },
      }, 'trams-circles');
    }

    // Draw route geometries now that style and layer are loaded
    drawRouteGeometries(map, routeGeometriesRef.current);

    // Hide default bus stops from the vector style
    const busStopLayers = ['stops_bus', 'stops_trunk'];
    busStopLayers.forEach((layerId) => {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, 'visibility', 'none');
      }
    });

    // Apply stops route filters to built-in vector stops
    if (map.getLayer('stops_tram') || map.getLayer('stops_case')) {
      const activeRoutes = [...lineFilters];
      const selectedTram = selectedTramIdRef.current ? latestTramsRef.current[selectedTramIdRef.current] : null;
      if (selectedTram && !activeRoutes.includes(selectedTram.desi)) {
        activeRoutes.push(selectedTram.desi);
      }
      const allowedStopIdsSet = new Set<string>();
      activeRoutes.forEach((line) => {
        const routeData = routeGeometriesRef.current[line];
        if (routeData && routeData.stops) {
          routeData.stops.forEach((id) => {
            allowedStopIdsSet.add(id);
            allowedStopIdsSet.add(id.replace(/^HSL:/, ''));
          });
        }
      });
      const allowedStopIds = Array.from(allowedStopIdsSet);

      if (map.getLayer('stops_tram')) {
        if (activeRoutes.length === 0) {
          map.setFilter('stops_tram', ['match', ['get', 'mode'], 'TRAM', true, false]);
        } else if (allowedStopIds.length === 0) {
          map.setFilter('stops_tram', ['match', ['get', 'mode'], 'TRAM', false, false]);
        } else {
          map.setFilter('stops_tram', [
            'all',
            ['match', ['get', 'mode'], 'TRAM', true, false],
            ['match', ['to-string', ['coalesce', ['get', 'gtfsId'], ['get', 'stopId'], '']], allowedStopIds, true, false]
          ] as any);
        }
      }

      if (map.getLayer('stops_case')) {
        if (activeRoutes.length === 0) {
          map.setFilter('stops_case', ['match', ['get', 'mode'], 'RAIL', false, true]);
        } else if (allowedStopIds.length === 0) {
          map.setFilter('stops_case', ['match', ['get', 'mode'], 'RAIL', false, false]);
        } else {
          map.setFilter('stops_case', [
            'all',
            ['match', ['get', 'mode'], 'RAIL', false, true],
            ['match', ['to-string', ['coalesce', ['get', 'gtfsId'], ['get', 'stopId'], '']], allowedStopIds, true, false]
          ] as any);
        }
      }
    }

    // Apply active route visibility and 3D mode setting
    updateRouteVisibility(map, showRouteNetworkRef.current);
    update3DMode(map, is3DRef.current, mapThemeRef.current);

    // Register all layer-specific interactions here so they persist style/theme changes
    map.on('click', 'trams-circles', (e) => {
      if (!e.features || e.features.length === 0) return;
      const feat = e.features[0];
      const vehId = feat.properties?.veh;
      const matchingTram = latestTramsRef.current[vehId];
      if (matchingTram) {
        callbacksRef.current.onSelectTram(matchingTram);
      }
    });

    const handleStopClick = (e: any) => {
      if (!e.features || e.features.length === 0) return;
      const feat = e.features[0];
      // Support both Digitransit tile properties (gtfsId, name, code)
      // and JORE tile properties (stopId, nameFi, shortId)
      const rawId = feat.properties?.gtfsId || feat.properties?.stopId || feat.properties?.id || feat.id;
      const name = feat.properties?.name || feat.properties?.nameFi || 'Unknown Stop';
      const code = feat.properties?.code || feat.properties?.shortId || '';
      
      if (rawId) {
        let stopId = rawId.toString();
        if (!stopId.startsWith('HSL:')) {
          stopId = 'HSL:' + stopId;
        }
        callbacksRef.current.onSelectStop(stopId, name, code);
      }
    };

    map.on('click', 'stops_case', handleStopClick);
    map.on('click', 'stops_tram', handleStopClick);
    map.on('click', 'stops_bus', handleStopClick);
    map.on('click', 'stops_trunk', handleStopClick);

    const handleBikeClick = (e: any) => {
      if (!e.features || e.features.length === 0) return;
      const feat = e.features[0];
      const stationId = feat.properties?.id || feat.properties?.stationId;
      const name = feat.properties?.name || 'Bike Station';
      if (stationId) {
        callbacksRef.current.onSelectBikeStation({ id: stationId, name });
      }
    };

    map.on('click', 'citybike_icon', handleBikeClick);
    map.on('click', 'citybike_stops', handleBikeClick);

    // Mouse Hover Effects
    const setCursorPointer = () => (map.getCanvas().style.cursor = 'pointer');
    const resetCursor = () => (map.getCanvas().style.cursor = '');

    map.on('mouseenter', 'trams-circles', setCursorPointer);
    map.on('mouseleave', 'trams-circles', resetCursor);
    map.on('mouseenter', 'stops_case', setCursorPointer);
    map.on('mouseleave', 'stops_case', resetCursor);
    map.on('mouseenter', 'stops_tram', setCursorPointer);
    map.on('mouseleave', 'stops_tram', resetCursor);
    map.on('mouseenter', 'stops_bus', setCursorPointer);
    map.on('mouseleave', 'stops_bus', resetCursor);
    map.on('mouseenter', 'stops_trunk', setCursorPointer);
    map.on('mouseleave', 'stops_trunk', resetCursor);
    map.on('mouseenter', 'citybike_icon', setCursorPointer);
    map.on('mouseleave', 'citybike_icon', resetCursor);
    map.on('mouseenter', 'citybike_stops', setCursorPointer);
    map.on('mouseleave', 'citybike_stops', resetCursor);
  };

  // Initial Map Setup
  useEffect(() => {
    if (apiKey === null) return;
    if (!mapContainerRef.current) return;

    const initialTheme = mapThemeRef.current;
    const initialStyleUrl = initialTheme === 'light'
      ? `${window.location.origin}/style.json`
      : 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: initialStyleUrl,
      center: [24.9414, 60.1699], // Helsinki center
      zoom: 14,
      maxZoom: 18,
      minZoom: 10,
      attributionControl: false,
      transformRequest: (url: string) => {
        if (url.includes('digitransit.fi')) {
          const separator = url.includes('?') ? '&' : '?';
          return {
            url: `${url}${separator}digitransit-subscription-key=${apiKey}`,
          };
        }
        return { url };
      },
    });

    mapRef.current = map;

    // Add GeolocateControl for mobile/user self-location tracking
    const geolocate = new maplibregl.GeolocateControl({
      positionOptions: {
        enableHighAccuracy: true,
      },
      trackUserLocation: true,
      showUserLocation: true,
    });
    map.addControl(geolocate, 'bottom-right');

    map.on('style.load', () => {
      setupCustomMapElements(map);
    });

    // Disable follow mode on drag
    map.on('dragstart', () => {
      callbacksRef.current.onDisableFollowing();
    });

    // Handle zoom, rotate, and pitch start/end events via direct DOM events on the container.
    // This immediately stops the 60fps centering loop from fighting with user interaction.
    const mapContainer = mapContainerRef.current;
    let wheelTimeout: any = null;

    const handleWheel = () => {
      isInteractingRef.current = true;
      if (wheelTimeout) clearTimeout(wheelTimeout);
      wheelTimeout = setTimeout(() => {
        isInteractingRef.current = false;
      }, 800); // Resume tracking 800ms after last scroll tick
    };

    const handleInteractionStart = () => {
      isInteractingRef.current = true;
    };

    const handleInteractionEnd = () => {
      isInteractingRef.current = false;
    };

    if (mapContainer) {
      mapContainer.addEventListener('wheel', handleWheel, { passive: true });
      mapContainer.addEventListener('mousedown', handleInteractionStart);
      mapContainer.addEventListener('touchstart', handleInteractionStart, { passive: true });
    }
    window.addEventListener('mouseup', handleInteractionEnd);
    window.addEventListener('touchend', handleInteractionEnd);

    // Report initial bearing and listen to map rotate events
    if (onMapBearingChange) {
      onMapBearingChange(map.getBearing());
    }
    map.on('rotate', () => {
      if (callbacksRef.current.onMapBearingChange) {
        callbacksRef.current.onMapBearingChange(map.getBearing());
      }
    });

    // Start interpolation tick loop
    startAnimationLoop();

    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (wheelTimeout) clearTimeout(wheelTimeout);
      if (mapContainer) {
        mapContainer.removeEventListener('wheel', handleWheel);
        mapContainer.removeEventListener('mousedown', handleInteractionStart);
        mapContainer.removeEventListener('touchstart', handleInteractionStart);
      }
      window.removeEventListener('mouseup', handleInteractionEnd);
      window.removeEventListener('touchend', handleInteractionEnd);
      map.remove();
    };
  }, [apiKey]);

  // Handle map style (theme) changes dynamically
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const styleUrl = mapTheme === 'light'
      ? `${window.location.origin}/style.json`
      : 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
    map.setStyle(styleUrl);
  }, [mapTheme]);

  // Update selection ring filter
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    console.log('[Map] Selection ring filter update — selectedTramId:', selectedTramId);
    if (map.getStyle() && map.getLayer('trams-selected-layer')) {
      map.setFilter('trams-selected-layer', ['==', ['get', 'veh'], selectedTramId || '']);
    } else {
      console.warn('[Map] trams-selected-layer not found');
    }
  }, [selectedTramId]);

  // Update selected stop highlight filter
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getStyle()) return;

    if (map.getLayer('stops-selected-highlight')) {
      const rawId = selectedStopId || '';
      const cleanId = rawId.replace(/^HSL:/, '');
      if (rawId === '') {
        map.setFilter('stops-selected-highlight', ['==', ['to-string', ['coalesce', ['get', 'gtfsId'], ['get', 'stopId'], '']], '']);
      } else {
        map.setFilter('stops-selected-highlight', [
          'match',
          ['to-string', ['coalesce', ['get', 'gtfsId'], ['get', 'stopId'], '']],
          [rawId, cleanId],
          true,
          false
        ]);
      }
    }
  }, [selectedStopId]);

  // Update selected bike station highlight filter
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getStyle()) return;

    if (map.getLayer('citybike-selected-highlight')) {
      const rawId = selectedBikeStationId || '';
      if (rawId === '') {
        map.setFilter('citybike-selected-highlight', ['==', ['to-string', ['coalesce', ['get', 'stationId'], ['get', 'id'], '']], '']);
      } else {
        map.setFilter('citybike-selected-highlight', [
          'match',
          ['to-string', ['coalesce', ['get', 'stationId'], ['get', 'id'], '']],
          [rawId],
          true,
          false
        ]);
      }
    }
  }, [selectedBikeStationId]);

  // Fetch trip details when selected vehicle changes
  useEffect(() => {
    if (!selectedTramId) {
      setSelectedTripDetails(null);
      return;
    }

    const selectedTram = trams[selectedTramId];
    const tripId = selectedTram?.tripId || (selectedTramId.startsWith('HSL:') ? selectedTramId : null);
    
    if (!tripId) {
      setSelectedTripDetails(null);
      return;
    }

    // Don't refetch if we already have the details for this tripId
    if (selectedTripDetailsRef.current && selectedTripDetailsRef.current.tripId === tripId) {
      return;
    }

    console.log('[Map] Fetching trip details for selected vehicle:', selectedTramId, 'trip:', tripId);
    fetchTripDetails(tripId)
      .then((data) => {
        setSelectedTripDetails(data);
      })
      .catch((err) => {
        console.error('Failed to load trip details for map highlights:', err);
        setSelectedTripDetails(null);
      });
  }, [selectedTramId, trams]);

  // Center, orient and tilt map on selected tram
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedTramId) return;

    const selectedTram = latestTramsRef.current[selectedTramId];
    console.log('[Map] Center on tram — selectedTramId:', selectedTramId, 'found:', !!selectedTram, 'latestTramsRef keys sample:', Object.keys(latestTramsRef.current).slice(0, 5));
    if (selectedTram) {
      const easeOptions: maplibregl.EaseToOptions = {
        center: [selectedTram.lng, selectedTram.lat],
        duration: 500,
        zoom: Math.max(map.getZoom(), 16),
      };

      if (isFollowing) {
        easeOptions.bearing = selectedTram.hdg;
        easeOptions.pitch = 55;
      }

      map.easeTo(easeOptions);
    }
  }, [selectedTramId, isFollowing]);

  // Update route geometries on map
  useEffect(() => {
    const map = mapRef.current;
    if (map && map.getStyle() && map.getSource('route-lines')) {
      drawRouteGeometries(map, routeGeometries);
    }
  }, [routeGeometries]);

  // Dynamic 3D Mode changes
  useEffect(() => {
    const map = mapRef.current;
    if (map && map.getStyle()) {
      update3DMode(map, is3D, mapTheme);
    }
  }, [is3D, mapTheme]);

  // Dynamic Route visibility changes
  useEffect(() => {
    const map = mapRef.current;
    if (map && map.getStyle()) {
      updateRouteVisibility(map, showRouteNetwork);
    }
  }, [showRouteNetwork]);

  // Dynamic Stop Route Filtering
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getStyle()) return;

    // Build the list of active lines we want to show stops for
    const activeRoutes = [...lineFilters];
    const selectedTram = selectedTramId ? trams[selectedTramId] : null;
    if (selectedTram && !activeRoutes.includes(selectedTram.desi)) {
      activeRoutes.push(selectedTram.desi);
    }

    const allowedStopIdsSet = new Set<string>();
    activeRoutes.forEach((line) => {
      const routeData = routeGeometries[line];
      if (routeData && routeData.stops) {
        routeData.stops.forEach((id) => {
          allowedStopIdsSet.add(id);
          allowedStopIdsSet.add(id.replace(/^HSL:/, ''));
        });
      }
    });
    const allowedStopIds = Array.from(allowedStopIdsSet);

    // 1. Tram Stops
    if (map.getLayer('stops_tram')) {
      if (activeRoutes.length === 0) {
        map.setFilter('stops_tram', ['match', ['get', 'mode'], 'TRAM', true, false]);
      } else if (allowedStopIds.length === 0) {
        map.setFilter('stops_tram', ['match', ['get', 'mode'], 'TRAM', false, false]);
      } else {
        map.setFilter('stops_tram', [
          'all',
          ['match', ['get', 'mode'], 'TRAM', true, false],
          ['match', ['to-string', ['coalesce', ['get', 'gtfsId'], ['get', 'stopId'], '']], allowedStopIds, true, false]
        ] as any);
      }
    }

    // 2. Stops Case Outline
    if (map.getLayer('stops_case')) {
      if (activeRoutes.length === 0) {
        map.setFilter('stops_case', ['match', ['get', 'mode'], 'RAIL', false, true]);
      } else if (allowedStopIds.length === 0) {
        map.setFilter('stops_case', ['match', ['get', 'mode'], 'RAIL', false, false]);
      } else {
        map.setFilter('stops_case', [
          'all',
          ['match', ['get', 'mode'], 'RAIL', false, true],
          ['match', ['to-string', ['coalesce', ['get', 'gtfsId'], ['get', 'stopId'], '']], allowedStopIds, true, false]
        ] as any);
      }
    }

    // 3. Bus and Trunk Stop POIs
    const busStopLayers = ['stops_bus', 'stops_trunk'];
    busStopLayers.forEach((layerId) => {
      if (map.getLayer(layerId)) {
        if (activeRoutes.length === 0) {
          map.setLayoutProperty(layerId, 'visibility', 'none');
        } else if (allowedStopIds.length === 0) {
          map.setLayoutProperty(layerId, 'visibility', 'none');
        } else {
          map.setLayoutProperty(layerId, 'visibility', 'visible');
          map.setFilter(layerId, [
            'match',
            ['to-string', ['coalesce', ['get', 'gtfsId'], ['get', 'stopId'], '']],
            allowedStopIds,
            true,
            false
          ] as any);
        }
      }
    });
  }, [lineFilters, selectedTramId, trams, routeGeometries]);

  return (
    <div className="map-wrapper">
      <div ref={mapContainerRef} className="map-container" />
    </div>
  );
};
