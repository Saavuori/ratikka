import React, { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { VehiclePosition } from '../types';
import { lerp, lerpAngle } from '../lib/lerp';
import { decodePolyline } from '../lib/polyline';

interface MapProps {
  trams: Record<string, VehiclePosition>;
  selectedTramId: string | null;
  onSelectTram: (tram: VehiclePosition | null) => void;
  onSelectStop: (stopId: string, name: string, code: string) => void;
  lineFilters: string[];
  routeGeometries: Record<string, { geometries: string[]; color?: string }>;
}

interface RenderPosition {
  lat: number;
  lng: number;
  hdg: number;
}

export const Map: React.FC<MapProps> = ({
  trams,
  selectedTramId,
  onSelectTram,
  onSelectStop,
  lineFilters,
  routeGeometries,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  // References to keep state fresh in map event handlers and tick loop without closure issues
  const latestTramsRef = useRef<Record<string, VehiclePosition>>(trams);
  const callbacksRef = useRef({ onSelectTram, onSelectStop });
  const routeGeometriesRef = useRef<Record<string, { geometries: string[]; color?: string }>>(routeGeometries);

  useEffect(() => {
    latestTramsRef.current = trams;
  }, [trams]);

  useEffect(() => {
    callbacksRef.current = { onSelectTram, onSelectStop };
  }, [onSelectTram, onSelectStop]);

  useEffect(() => {
    routeGeometriesRef.current = routeGeometries;
  }, [routeGeometries]);

  // Helper to draw route geometries on the map
  const drawRouteGeometries = (map: maplibregl.Map, geometries: Record<string, { geometries: string[]; color?: string }>) => {
    const source = map.getSource('route-lines') as maplibregl.GeoJSONSource;
    if (!source) return;

    const features: any[] = [];
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
  const lastUpdateRef = useRef<number>(performance.now());
  const animationFrameRef = useRef<number | null>(null);

  // Sync incoming tram data to animation refs
  useEffect(() => {
    const now = performance.now();
    const newPrev: Record<string, RenderPosition> = {};
    const newTarget: Record<string, RenderPosition> = {};

    // Filter trams based on line filters
    const filteredTrams = Object.entries(trams).filter(([_, tram]) => {
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

  // Initial Map Setup
  useEffect(() => {
    if (!mapContainerRef.current) return;

    const apiKey = import.meta.env.VITE_DIGITRANSIT_MAP_KEY || '';

    const style: maplibregl.StyleSpecification = {
      version: 8,
      sources: {
        'hsl-raster-source': {
          type: 'raster',
          tiles: [
            `https://cdn.digitransit.fi/map/v3/hsl-map-greyscale/{z}/{x}/{y}@2x.png?digitransit-subscription-key=${apiKey}`
          ],
          tileSize: 512,
        }
      },
      layers: [
        {
          id: 'hsl-raster-layer',
          type: 'raster',
          source: 'hsl-raster-source',
          minzoom: 0,
          maxzoom: 22,
        }
      ],
      glyphs: 'https://hslstoragestatic.azureedge.net/mapfonts/{fontstack}/{range}.pbf'
    };

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: style,
      center: [24.9414, 60.1699], // Helsinki center
      zoom: 14,
      maxZoom: 18,
      minZoom: 10,
    });

    mapRef.current = map;

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');

    map.on('load', () => {
      // 1. Create Arrow Symbol Image for Heading
      const arrowSvg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30" fill="none">
          <polygon points="15,2 27,27 15,20 3,27" fill="#00b894" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/>
        </svg>
      `;
      const arrowImg = new Image(30, 30);
      arrowImg.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(arrowSvg);
      arrowImg.onload = () => {
        if (map.addImage) map.addImage('tram-arrow', arrowImg);
      };

      // 2. Create Selected Tram Highlight Image
      const selectedSvg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44" fill="none">
          <circle cx="22" cy="22" r="18" stroke="#fdcb6e" stroke-width="4" fill="none"/>
        </svg>
      `;
      const selectedImg = new Image(44, 44);
      selectedImg.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(selectedSvg);
      selectedImg.onload = () => {
        if (map.addImage) map.addImage('tram-selected', selectedImg);
      };

      // 3. Add Live Trams Source (GeoJSON)
      map.addSource('trams', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [],
        },
      });

      // 4. Add Live Stops Source (Vector tiles)
      map.addSource('stops-poi', {
        type: 'vector',
        tiles: [
          `https://cdn.digitransit.fi/map/v3/hsl/fi/stops/{z}/{x}/{y}.pbf?digitransit-subscription-key=${apiKey}`,
        ],
        minzoom: 13,
        maxzoom: 16,
      });

      // 5. Add Route Lines Source
      map.addSource('route-lines', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [],
        },
      });

      // 6. Add Tram Arrow Direction Layer
      map.addLayer({
        id: 'trams-arrows',
        type: 'symbol',
        source: 'trams',
        layout: {
          'icon-image': 'tram-arrow',
          'icon-rotate': ['get', 'hdg'],
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      });

      // 7. Add Tram Text Circle Layer (Line labels)
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

      // 8. Add Route Lines Layer (Rendered before trams-circles so it is underneath)
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

      // 9. Add Tram Text Label Layer
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

      // 10. Add Selection Highlight Ring (circle style, rendered under labels, on top of circles)
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
        filter: ['==', ['get', 'veh'], selectedTramId || ''],
      }, 'trams-labels');

      // 11. Add Stops Layer
      map.addLayer({
        id: 'stops-points',
        type: 'circle',
        source: 'stops-poi',
        'source-layer': 'stops',
        paint: {
          'circle-radius': 5.5,
          'circle-color': '#20bf6b', // green Stop marker
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1.5,
        },
        filter: ['==', ['get', 'type'], 'TRAM'], // Only show tram stops
      });

      // Map Click Interactions
      map.on('click', 'trams-circles', (e) => {
        if (!e.features || e.features.length === 0) return;
        const feat = e.features[0];
        const vehId = feat.properties?.veh;
        const matchingTram = latestTramsRef.current[vehId];
        if (matchingTram) {
          callbacksRef.current.onSelectTram(matchingTram);
        }
      });

      map.on('click', 'stops-points', (e) => {
        if (!e.features || e.features.length === 0) return;
        const feat = e.features[0];
        const stopId = feat.properties?.gtfsId || feat.properties?.id;
        const name = feat.properties?.name || 'Unknown Stop';
        const code = feat.properties?.code || '';
        if (stopId) {
          callbacksRef.current.onSelectStop(stopId, name, code);
        }
      });

      // Mouse Hover Effects
      const setCursorPointer = () => (map.getCanvas().style.cursor = 'pointer');
      const resetCursor = () => (map.getCanvas().style.cursor = '');

      map.on('mouseenter', 'trams-circles', setCursorPointer);
      map.on('mouseleave', 'trams-circles', resetCursor);
      map.on('mouseenter', 'stops-points', setCursorPointer);
      map.on('mouseleave', 'stops-points', resetCursor);

      // Draw route geometries now that style and layer are loaded
      drawRouteGeometries(map, routeGeometriesRef.current);

      // Start interpolation tick loop
      startAnimationLoop();
    });

    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      map.remove();
    };
  }, []);

  // Update selection ring filter
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (map.getStyle() && map.getLayer('trams-selected-layer')) {
      map.setFilter('trams-selected-layer', ['==', ['get', 'veh'], selectedTramId || '']);
    }
  }, [selectedTramId]);

  // Center map on selected tram
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedTramId) return;

    const selectedTram = latestTramsRef.current[selectedTramId];
    if (selectedTram) {
      map.easeTo({
        center: [selectedTram.lng, selectedTram.lat],
        duration: 500,
        zoom: Math.max(map.getZoom(), 14.5),
      });
    }
  }, [selectedTramId]);

  // Update route geometries on map
  useEffect(() => {
    const map = mapRef.current;
    if (map) {
      drawRouteGeometries(map, routeGeometries);
    }
  }, [routeGeometries]);

  // Interpolation and GeoJSON updates loop
  const startAnimationLoop = () => {
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

      animationFrameRef.current = requestAnimationFrame(tick);
    };

    animationFrameRef.current = requestAnimationFrame(tick);
  };

  return (
    <div className="map-wrapper">
      <div ref={mapContainerRef} className="map-container" />
    </div>
  );
};
