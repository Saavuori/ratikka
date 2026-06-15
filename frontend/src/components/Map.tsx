import React, { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { VehiclePosition } from '../types';
import { lerp, lerpAngle } from '../lib/lerp';

interface MapProps {
  trams: Record<string, VehiclePosition>;
  selectedTramId: string | null;
  onSelectTram: (tram: VehiclePosition | null) => void;
  onSelectStop: (stopId: string, name: string, code: string) => void;
  lineFilters: string[];
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
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

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

    const apiKey = import.meta.env.VITE_DIGITRANSIT_MAP_KEY || '631fd3dbd1b84f55904e1de6fcfebf1a';
    const styleUrl = `https://cdn.digitransit.fi/map/v3/styles/hsl-map/style.json?digitransit-subscription-key=${apiKey}`;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: styleUrl,
      center: [24.9414, 60.1699], // Helsinki center
      zoom: 13,
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

      // 5. Add Tram Selection Ring Layer
      map.addLayer({
        id: 'trams-selected-layer',
        type: 'symbol',
        source: 'trams',
        layout: {
          'icon-image': 'tram-selected',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
        filter: ['==', ['get', 'veh'], selectedTramId || ''],
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

      // 8. Add Tram Text Label Layer
      map.addLayer({
        id: 'trams-labels',
        type: 'symbol',
        source: 'trams',
        layout: {
          'text-field': '{desi}',
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-size': 10,
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: {
          'text-color': '#ffffff',
        },
      });

      // 9. Add Stops Layer
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
        filter: ['==', ['get', 'type'], 'tram'], // Only show tram stops
      });

      // Map Click Interactions
      map.on('click', 'trams-circles', (e) => {
        if (!e.features || e.features.length === 0) return;
        const feat = e.features[0];
        const vehId = feat.properties?.veh;
        const matchingTram = trams[vehId];
        if (matchingTram) {
          onSelectTram(matchingTram);
        }
      });

      map.on('click', 'stops-points', (e) => {
        if (!e.features || e.features.length === 0) return;
        const feat = e.features[0];
        const stopId = feat.properties?.gtfsId || feat.properties?.id;
        const name = feat.properties?.name || 'Unknown Stop';
        const code = feat.properties?.code || '';
        if (stopId) {
          onSelectStop(stopId, name, code);
        }
      });

      // Mouse Hover Effects
      const setCursorPointer = () => (map.getCanvas().style.cursor = 'pointer');
      const resetCursor = () => (map.getCanvas().style.cursor = '');

      map.on('mouseenter', 'trams-circles', setCursorPointer);
      map.on('mouseleave', 'trams-circles', resetCursor);
      map.on('mouseenter', 'stops-points', setCursorPointer);
      map.on('mouseleave', 'stops-points', resetCursor);

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
    if (!map || !map.isStyleLoaded()) return;

    if (map.getLayer('trams-selected-layer')) {
      map.setFilter('trams-selected-layer', ['==', ['get', 'veh'], selectedTramId || '']);
    }
  }, [selectedTramId]);

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

        const tramInfo = trams[id];

        return {
          type: 'Feature' as const,
          geometry: {
            type: 'Point' as const,
            coordinates: [lng, lat],
          },
          properties: {
            veh: parseInt(id),
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
    <div className="relative w-full h-full">
      <div ref={mapContainerRef} className="w-full h-full" />
    </div>
  );
};
