import type * as maplibregl from 'maplibre-gl';
import type { VehiclePosition } from '../../types';
import type { ModeFlags, TransportMode } from '../../lib/modes';
import { STOP_MODE } from '../layers';

// The sign-board layer filters on GTFS mode names, in the order the style
// stacks them.
const GTFS_SIGN_MODES: Array<{ mode: TransportMode; gtfs: string }> = [
  { mode: 'tram', gtfs: 'TRAM' },
  { mode: 'bus', gtfs: 'BUS' },
  { mode: 'metro', gtfs: 'SUBWAY' },
  { mode: 'train', gtfs: 'RAIL' },
  { mode: 'ferry', gtfs: 'FERRY' },
];

/** What decides which stops are drawn right now. */
export interface StopVisibility {
  /** Which vehicle modes are on; a stop follows its mode's toggle. */
  modes: ModeFlags;
  /** Lines the reader has narrowed to; empty means all of them. */
  lineFilters: string[];
  /** The selected vehicle, whose line's stops are shown as context. */
  selectedVehicleId: string | null;
  vehicles: Record<string, VehiclePosition>;
  /** Fetched pattern geometry, which names the stops each line serves. */
  routeGeometries: Record<string, { geometries: string[]; color?: string; stops?: string[] }>;
  /** The open stop, drawn by its own selection layer rather than as a disc. */
  selectedStopId: string | null;
}

/**
 * Point the basemap's stop layers at the stops that should be visible.
 *
 * Stops follow their mode's toggle, and narrow to the highlighted lines' stops
 * while a line filter or a vehicle selection is active. The selected stop is
 * excluded throughout: it is drawn by its own layer, and drawing it twice puts
 * a disc under its marker.
 */
export function updateStopVisibility(
  map: maplibregl.Map,
  view: StopVisibility,
): void {
  const { modes, lineFilters, selectedTramId, trams, routeGeometries, selectedStopId } = {
    modes: view.modes,
    lineFilters: view.lineFilters,
    selectedTramId: view.selectedVehicleId,
    trams: view.vehicles,
    routeGeometries: view.routeGeometries,
    selectedStopId: view.selectedStopId,
  };

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

    const cleanStopId = selectedStopId ? selectedStopId.replace(/^HSL:/, '') : '';
    const excludeSelectedStopFilter: maplibregl.ExpressionSpecification = selectedStopId
      ? [
          '!',
          [
            'any',
            ['in', ['to-string', ['coalesce', ['get', 'gtfsId'], ['get', 'stopId'], ['get', 'id'], ['id'], '']], ['literal', [selectedStopId, cleanStopId]]],
            ['==', ['to-string', ['id']], selectedStopId],
            ['==', ['to-string', ['id']], cleanStopId]
          ]
        ]
      : ['literal', true]; // Always true when no stop is selected


    // Stops follow their mode's toggle, and narrow to the highlighted lines'
    // stops while a line filter or vehicle selection is active. Disc size is
    // not settled here — a quay takes the street-stop radius and a station the
    // larger one, both from where the layers are styled.
    //
    // The bus layers are hidden by visibility rather than by an impossible
    // filter: they are the only ones the style also draws at other zooms.
    const stopLayers: Array<{
      id: string;
      match: maplibregl.ExpressionSpecification;
      show: boolean;
      hideWith?: 'visibility';
    }> = [
      { id: 'stops_tram', match: ['==', ['get', 'mode'], 'TRAM'], show: modes.tram },
      { id: 'stops_metro', match: ['==', STOP_MODE, 'SUBWAY'], show: modes.metro },
      { id: 'stops_train', match: ['==', STOP_MODE, 'RAIL'], show: modes.train },
      { id: 'stops_ferry', match: ['==', STOP_MODE, 'FERRY'], show: modes.ferry },
      { id: 'stops_bus', match: ['==', ['get', 'mode'], 'BUS'], show: modes.bus, hideWith: 'visibility' },
      { id: 'stops_trunk', match: ['==', ['get', 'mode'], 'BUS'], show: modes.bus, hideWith: 'visibility' },
    ];

    const NOTHING: maplibregl.FilterSpecification = ['==', '1', '2'];

    for (const { id, match, show, hideWith } of stopLayers) {
      if (!map.getLayer(id)) continue;
      // Narrowed to specific lines, but none of their stops are in view: there
      // is nothing to draw, which is not the same as the mode being off.
      const narrowedToNothing = activeRoutes.length > 0 && allowedStopIds.length === 0;
      const visible = show && !narrowedToNothing;

      if (hideWith === 'visibility') {
        map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
        if (!visible) continue;
      } else if (!visible) {
        map.setFilter(id, NOTHING);
        continue;
      }

      const clauses: maplibregl.ExpressionSpecification[] = [match];
      if (activeRoutes.length > 0) {
        clauses.push([
          'in',
          ['to-string', ['coalesce', ['get', 'gtfsId'], ['get', 'stopId'], ['get', 'id'], ['id'], '']],
          ['literal', allowedStopIds],
        ]);
      }
      clauses.push(excludeSelectedStopFilter as maplibregl.ExpressionSpecification);
      map.setFilter(id, ['all', ...clauses]);
    }

    // 4. Stops Signs Symbol Layer
    const signModes = GTFS_SIGN_MODES.filter(({ mode }) => modes[mode]).map(({ gtfs }) => gtfs);

    if (map.getLayer('stops_signs')) {
      if (signModes.length === 0) {
        map.setFilter('stops_signs', ['==', '1', '2']);
      } else if (activeRoutes.length === 0) {
        map.setFilter('stops_signs', [
          'all',
          ['in', STOP_MODE, ['literal', signModes]],
          excludeSelectedStopFilter
        ]);
      } else if (allowedStopIds.length === 0) {
        map.setFilter('stops_signs', ['==', '1', '2']);
      } else {
        map.setFilter('stops_signs', [
          'all',
          ['in', STOP_MODE, ['literal', signModes]],
          ['in', ['to-string', ['coalesce', ['get', 'gtfsId'], ['get', 'stopId'], ['get', 'id'], ['id'], '']], ['literal', allowedStopIds]],
          excludeSelectedStopFilter
        ]);
      }
    }
}
