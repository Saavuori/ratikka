import type { TrafficLightFeature, VehiclePosition } from '../types';

// A stopped tram closer than this to a known junction is considered "at" it.
// Helsinki tram tracks generally sit within a few meters of the stop line, so
// this stays tight enough to not bleed into the next junction down the street.
const NEARBY_JUNCTION_METERS = 35;

// Mean Earth radius in meters, standard for the haversine great-circle formula.
const EARTH_RADIUS_METERS = 6371000;

// Great-circle distance between two WGS84 points, in meters.
export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)));
}

export interface NearestJunction {
  feature: TrafficLightFeature;
  distanceMeters: number;
}

/**
 * Find the closest known signalized junction to a point, if any is within
 * range. The dataset is small (~500-600 points citywide) so a linear scan is
 * cheap enough to run on every popup render without a spatial index.
 */
export function findNearestJunction(
  lat: number,
  lon: number,
  features: TrafficLightFeature[],
  maxDistanceMeters = NEARBY_JUNCTION_METERS
): NearestJunction | null {
  let nearest: NearestJunction | null = null;
  for (const feature of features) {
    const [flon, flat] = feature.geometry.coordinates;
    const distanceMeters = haversineMeters(lat, lon, flat, flon);
    if (distanceMeters <= maxDistanceMeters && (!nearest || distanceMeters < nearest.distanceMeters)) {
      nearest = { feature, distanceMeters };
    }
  }
  return nearest;
}

/** The junction a vehicle names in its own priority request, by ID. */
export function findJunctionById(
  junctionId: number | undefined,
  features: TrafficLightFeature[]
): TrafficLightFeature | null {
  if (typeof junctionId !== 'number') return null;
  return features.find((f) => f.properties.id === junctionId) ?? null;
}

export type StopReason = 'at_stop' | 'traffic_light' | 'stopped' | 'moving';

export interface StopReasonInfo {
  reason: StopReason;
  junction?: TrafficLightFeature;
  /**
   * True when the vehicle itself named this junction — it has a live priority
   * request there — rather than us having found it by looking for the nearest
   * one. That is the difference between knowing and guessing, and the popup
   * says which it is.
   */
  confirmed?: boolean;
}

/**
 * Classify why a tram appears stopped. Door state is definitive for "at a
 * stop", and after that there are two grades of answer about traffic lights:
 * the tram's own live priority request, which names the junction it is dealing
 * with, and — where there is no request to read — proximity to a known
 * signalized junction, which is a plausible explanation for the stop rather
 * than a confirmed one. `confirmed` says which of the two this is.
 */
export function classifyStopReason(
  tram: Pick<VehiclePosition, 'spd' | 'drst' | 'lat' | 'lng' | 'tlp'>,
  trafficLights: TrafficLightFeature[]
): StopReasonInfo {
  if (tram.drst === 1) {
    return { reason: 'at_stop' };
  }
  if (tram.spd !== 0) {
    return { reason: 'moving' };
  }
  // The vehicle's own priority exchange outranks the geometry: a tram standing
  // still while asking junction 75 for a green is not "probably near some
  // traffic lights", it is waiting at those ones, and it said so itself.
  const named = findJunctionById(tram.tlp?.junction, trafficLights);
  if (named) {
    return { reason: 'traffic_light', junction: named, confirmed: true };
  }
  const nearest = findNearestJunction(tram.lat, tram.lng, trafficLights);
  if (nearest) {
    return { reason: 'traffic_light', junction: nearest.feature, confirmed: false };
  }
  return { reason: 'stopped' };
}
