import { BIKE_STATION_LAYER } from '../lib/bikeStationModels';
import { STOP_FURNITURE_LAYER } from '../lib/stopModels';
import { TRAFFIC_LIGHT_ICON_LAYER } from '../lib/trafficLightModels';
import type * as maplibregl from 'maplibre-gl';
import type { BikeStationsFeatureCollection, VehiclePosition } from '../types';

/** What a click on the map turns into. */
export interface InteractionHandlers {
  onSelectTram: (tram: VehiclePosition | null) => void;
  onSelectStop: (
    stopId: string,
    name: string,
    code: string,
    lat?: number,
    lng?: number,
    mode?: string,
    isTrunkStop?: boolean
  ) => void;
  onSelectBikeStation: (station: { id: string; name: string } | null) => void;
  onSelectJunction: (junctionId: number | null) => void;
}

/**
 * What a handler needs to look up to answer a click. Functions rather than
 * values: a handler fires long after it was bound and must see what is true
 * then.
 */
export interface InteractionLookups {
  vehicles: () => Record<string, VehiclePosition>;
  /** Name, code and mode per stop carrying 3D furniture. */
  stopFurnitureMeta: () => Record<string, { name: string; code: string; mode: string }>;
  bikeStations: () => BikeStationsFeatureCollection | null;
}

/** Maps that already have handlers, so a style reload does not stack a second set. */
const bound = new WeakSet<maplibregl.Map>();

/**
 * Bind the map's clicks, hovers and settle handling.
 *
 * Layer events are delegated by layer id, so these survive a style or theme
 * swap and are bound once per map rather than once per style load — binding
 * again would stack duplicate handlers, and every click would fire twice.
 *
 * `onViewSettled` runs when the view stops moving rather than per frame:
 * `idle` rather than `moveend`, because the platform polygons the 3D furniture
 * orients itself from arrive with the tiles, which land after the move ended.
 */
export function bindMapInteractions(
  map: maplibregl.Map,
  handlers: InteractionHandlers,
  lookups: InteractionLookups,
  onViewSettled: (map: maplibregl.Map) => void,
): void {
  if (bound.has(map)) return;
  bound.add(map);

    const handleTramClick = (e: maplibregl.MapLayerMouseEvent) => {
      if (!e.features || e.features.length === 0) return;
      const feat = e.features[0];
      const vehId = feat.properties?.veh;
      const matchingTram = lookups.vehicles()[vehId];
      if (matchingTram) {
        handlers.onSelectTram(matchingTram);
      }
    };
    // The body symbol is the primary hit target; the aura circle is often
    // faint/zero-opacity for stationary vehicles, so bind both.
    map.on('click', 'trams-body', handleTramClick);
    map.on('click', 'trams-circles', handleTramClick);
    map.on('click', 'vehicles-3d', handleTramClick);

    const handleStopClick = (e: maplibregl.MapLayerMouseEvent) => {
      if (!e.features || e.features.length === 0) return;
      const feat = e.features[0];
      // Support both Digitransit tile properties (gtfsId, name, code)
      // and JORE tile properties (stopId, nameFi, shortId)
      const rawId = feat.properties?.gtfsId || feat.properties?.stopId || feat.properties?.id || feat.id;
      const name = feat.properties?.name || feat.properties?.nameFi || 'Unknown Stop';
      const code = feat.properties?.code || feat.properties?.shortId || '';

      const coordinates = feat.geometry.type === 'Point' ? feat.geometry.coordinates : undefined;
      const lng = coordinates ? coordinates[0] : undefined;
      const lat = coordinates ? coordinates[1] : undefined;
      // JORE tiles call it `mode`, Digitransit v3 stops call it `type`.
      const mode = feat.properties?.mode || feat.properties?.type || 'TRAM';
      const isTrunkStop = feat.properties?.isTrunkStop === true || feat.properties?.isTrunkStop === 'true';

      if (rawId) {
        let stopId = rawId.toString();
        if (!stopId.startsWith('HSL:')) {
          stopId = 'HSL:' + stopId;
        }
        handlers.onSelectStop(stopId, name, code, lat, lng, mode, isTrunkStop);
      }
    };

    map.on('click', 'stops_tram', handleStopClick);
    map.on('click', 'stops_metro', handleStopClick);
    map.on('click', 'stops_train', handleStopClick);
    map.on('click', 'stops_bus', handleStopClick);
    map.on('click', 'stops_trunk', handleStopClick);
    map.on('click', 'stops_signs', handleStopClick);

    // A click on the 3D furniture opens the same popup as its sign. The
    // extrusions carry only a stop id, so the rest comes from the meta table
    // built alongside them.
    map.on('click', STOP_FURNITURE_LAYER, (e: maplibregl.MapLayerMouseEvent) => {
      const stopId = e.features?.[0]?.properties?.stopId;
      if (!stopId) return;
      const info = lookups.stopFurnitureMeta()[String(stopId)];
      if (!info) return;
      handlers.onSelectStop(
        `HSL:${stopId}`, info.name, info.code, e.lngLat.lat, e.lngLat.lng, info.mode, false,
      );
    });

    const handleBikeClick = (e: maplibregl.MapLayerMouseEvent) => {
      if (!e.features || e.features.length === 0) return;
      const feat = e.features[0];
      const stationId = feat.properties?.id || feat.properties?.stationId;
      const name = feat.properties?.name || 'Bike Station';
      if (stationId) {
        handlers.onSelectBikeStation({ id: stationId, name });
      }
    };

    map.on('click', 'citybike_gauge', handleBikeClick);

    // Up close the rack is the station, so clicking one opens the same panel.
    // The name lives in the availability payload rather than in the extrusion
    // properties, which carry only what the geometry needs.
    map.on('click', BIKE_STATION_LAYER, (e: maplibregl.MapLayerMouseEvent) => {
      if (!e.features || e.features.length === 0) return;
      const stationId = e.features[0].properties?.stationId;
      if (!stationId) return;
      const id = String(stationId);
      const known = lookups.bikeStations()?.features
        .find((f) => f.properties.stationId === id);
      handlers.onSelectBikeStation({ id, name: known?.properties.name || 'Bike Station' });
    });

    // A junction is a thing you can select, because the exchange it is having
    // has two sides: the vehicle panel says what this tram is asking, and the
    // junction panel says who is asking *this crossing* and who it has
    const handleJunctionClick = (e: maplibregl.MapLayerMouseEvent) => {
      const raw = e.features?.[0]?.properties?.id;
      const junctionId = Number(raw);
      if (!Number.isFinite(junctionId)) return;
      handlers.onSelectJunction(junctionId);
    };

    map.on('click', TRAFFIC_LIGHT_ICON_LAYER, handleJunctionClick);

    // Mouse Hover Effects
    const setCursorPointer = () => (map.getCanvas().style.cursor = 'pointer');
    const resetCursor = () => (map.getCanvas().style.cursor = '');

    map.on('mouseenter', 'trams-body', setCursorPointer);
    map.on('mouseleave', 'trams-body', resetCursor);
    map.on('mouseenter', 'trams-circles', setCursorPointer);
    map.on('mouseleave', 'trams-circles', resetCursor);
    map.on('mouseenter', 'vehicles-3d', setCursorPointer);
    map.on('mouseleave', 'vehicles-3d', resetCursor);
    map.on('mouseenter', 'stops_tram', setCursorPointer);
    map.on('mouseleave', 'stops_tram', resetCursor);
    map.on('mouseenter', 'stops_metro', setCursorPointer);
    map.on('mouseleave', 'stops_metro', resetCursor);
    map.on('mouseenter', 'stops_train', setCursorPointer);
    map.on('mouseleave', 'stops_train', resetCursor);
    map.on('mouseenter', 'stops_bus', setCursorPointer);
    map.on('mouseleave', 'stops_bus', resetCursor);
    map.on('mouseenter', 'stops_trunk', setCursorPointer);
    map.on('mouseleave', 'stops_trunk', resetCursor);
    map.on('mouseenter', 'stops_signs', setCursorPointer);
    map.on('mouseleave', 'stops_signs', resetCursor);
    map.on('mouseenter', STOP_FURNITURE_LAYER, setCursorPointer);
    map.on('mouseleave', STOP_FURNITURE_LAYER, resetCursor);
    map.on('mouseenter', 'citybike_gauge', setCursorPointer);
    map.on('mouseleave', 'citybike_gauge', resetCursor);
    map.on('mouseenter', BIKE_STATION_LAYER, setCursorPointer);
    map.on('mouseleave', BIKE_STATION_LAYER, resetCursor);
    map.on('mouseenter', TRAFFIC_LIGHT_ICON_LAYER, setCursorPointer);
    map.on('mouseleave', TRAFFIC_LIGHT_ICON_LAYER, resetCursor);

    // Stop furniture is rebuilt when the view settles, not per frame. `idle`
    // rather than `moveend` because the platform polygons it orients itself
    // from arrive with the tiles, which land after the move has ended.
    const settled = () => onViewSettled(map);
    map.on('moveend', settled);
    map.on('idle', settled);
}
