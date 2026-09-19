import type * as maplibregl from 'maplibre-gl';
import type { MapTheme } from '../../lib/stopPlatforms';
import type { BikeStationsFeatureCollection, TrafficLightFeature } from '../../types';

/** The state the layers are seeded with, so they start out already correct. */
export interface LayerSeed {
  theme: MapTheme;
  is3D: boolean;
  always3DVehicles: boolean;
  /** Signs an orthophoto tile request; absent when the deployment has no key. */
  mmlKey: string;
  /** Vehicles the 3D bodies start out drawn for. */
  journeyVehicleIds: string[];
  selectedVehicleId: string | null;
  bikeStations: BikeStationsFeatureCollection | null;
  trafficLights: TrafficLightFeature[];
  /**
   * Whether the map these layers are being added to is still the live one. An
   * icon that finishes loading after a theme swap belongs to a style that no
   * longer exists, and registering it would throw.
   */
  isCurrent: (map: maplibregl.Map) => boolean;
}
