import { describe, it, expect } from 'vitest';
import { haversineMeters, findNearestJunction, classifyStopReason } from './trafficLights';
import type { TrafficLightFeature } from '../types';

function junction(lon: number, lat: number, junction = 'Test/Junction', type: 'traffic_light' | 'warning_light' = 'traffic_light'): TrafficLightFeature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: { id: 1, type, junction },
  };
}

describe('haversineMeters', () => {
  it('returns 0 for the same point', () => {
    expect(haversineMeters(60.169, 24.9384, 60.169, 24.9384)).toBe(0);
  });

  it('returns a small positive distance for nearby points', () => {
    // ~0.0003 degrees of latitude is roughly 33 meters.
    const d = haversineMeters(60.169, 24.9384, 60.1693, 24.9384);
    expect(d).toBeGreaterThan(20);
    expect(d).toBeLessThan(45);
  });
});

describe('findNearestJunction', () => {
  const lights = [
    junction(24.9384, 60.169, 'Close/Junction'),
    junction(25.0, 60.2, 'Far/Junction'),
  ];

  it('finds the closest junction within range', () => {
    const nearest = findNearestJunction(60.169, 24.9384, lights);
    expect(nearest?.feature.properties.junction).toBe('Close/Junction');
    expect(nearest?.distanceMeters).toBe(0);
  });

  it('returns null when nothing is within range', () => {
    const nearest = findNearestJunction(61, 25.5, lights, 35);
    expect(nearest).toBeNull();
  });

  it('respects a custom max distance', () => {
    const nearest = findNearestJunction(60.169, 24.9384, lights, 0);
    expect(nearest?.distanceMeters).toBe(0);
    const none = findNearestJunction(60.1693, 24.9384, lights, 1);
    expect(none).toBeNull();
  });
});

describe('classifyStopReason', () => {
  const nearbyLight = [junction(24.9384, 60.169, 'Mannerheimintie/Runeberginkatu')];

  it('classifies doors-open trams as at_stop regardless of position', () => {
    const info = classifyStopReason({ spd: 0, drst: 1, lat: 60.169, lng: 24.9384 }, nearbyLight);
    expect(info.reason).toBe('at_stop');
    expect(info.junction).toBeUndefined();
  });

  it('classifies a moving tram as moving even near a junction', () => {
    const info = classifyStopReason({ spd: 5, drst: 0, lat: 60.169, lng: 24.9384 }, nearbyLight);
    expect(info.reason).toBe('moving');
  });

  it('classifies a stopped tram near a junction as waiting at traffic lights', () => {
    const info = classifyStopReason({ spd: 0, drst: 0, lat: 60.169, lng: 24.9384 }, nearbyLight);
    expect(info.reason).toBe('traffic_light');
    expect(info.junction?.properties.junction).toBe('Mannerheimintie/Runeberginkatu');
  });

  it('classifies a stopped tram far from any junction as generically stopped', () => {
    const info = classifyStopReason({ spd: 0, drst: 0, lat: 61, lng: 25.5 }, nearbyLight);
    expect(info.reason).toBe('stopped');
    expect(info.junction).toBeUndefined();
  });
});
