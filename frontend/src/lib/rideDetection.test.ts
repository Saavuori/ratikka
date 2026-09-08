import { describe, expect, it } from 'vitest';
import type { VehiclePosition } from '../types';
import {
  rideEnded,
  rideVerdict,
  riderSpeed,
  separationTolerance,
  updateRideTracks,
  type LocationSample,
  type RideTrack,
} from './rideDetection';

const START_TS = 1_788_706_622_000;
/** Metres per degree of latitude, close enough at Helsinki's latitude. */
const M_PER_DEG_LAT = 111_320;

function vehicle(overrides: Partial<VehiclePosition> = {}): VehiclePosition {
  return {
    veh: '40-456', desi: '9', lat: 60.17, lng: 24.94, hdg: 90, spd: 8, dl: 0, drst: 0,
    route: '1009', stop: null, nextStop: null, ts: START_TS / 1000, mode: 'tram',
    tripId: 'HSL:1009_20260906_Su_1_1150',
    ...overrides,
  };
}

function sample(overrides: Partial<LocationSample> = {}): LocationSample {
  return { lat: 60.17, lon: 24.94, accuracy: 15, speed: 8, ts: START_TS, ...overrides };
}

/** Offset a latitude by a number of metres, so distances read as metres. */
function north(lat: number, metres: number): number {
  return lat + metres / M_PER_DEG_LAT;
}

/**
 * Ride a vehicle for `samples` fixes five seconds apart, both moving north at
 * the vehicle's speed with the reader `separation` metres from the aerial.
 */
function ride(options: {
  samples: number;
  separation?: number;
  speed?: number;
  vehicles?: (step: number) => VehiclePosition[];
}): { tracks: Map<string, RideTrack>; lastTs: number } {
  const speed = options.speed ?? 8;
  const separation = options.separation ?? 5;
  let tracks = new Map<string, RideTrack>();
  let previous: LocationSample | null = null;
  let ts = START_TS;
  for (let step = 0; step < options.samples; step++) {
    ts = START_TS + step * 5_000;
    const travelled = step * 5 * speed;
    const vehicleLat = north(60.17, travelled);
    const current = sample({ lat: north(vehicleLat, separation), ts, speed });
    const fleet = options.vehicles
      ? options.vehicles(step)
      : [vehicle({ lat: vehicleLat, spd: speed, ts: ts / 1000 })];
    tracks = updateRideTracks(tracks, fleet, current, previous);
    previous = current;
  }
  return { tracks, lastTs: ts };
}

describe('separationTolerance', () => {
  it('allows for the vehicle body, the phone error and the distance since the last report', () => {
    const now = START_TS + 4_000;
    // 20 m of body + 15 m of accuracy + 4 s at 10 m/s.
    expect(separationTolerance(sample(), vehicle({ spd: 10, ts: START_TS / 1000 }), now)).toBeCloseTo(75, 5);
  });

  it('stops widening for a hopeless fix rather than swallowing the whole street', () => {
    const wide = separationTolerance(sample({ accuracy: 400 }), vehicle({ spd: 0 }), START_TS);
    expect(wide).toBe(80);
  });
});

describe('riderSpeed', () => {
  it('prefers the figure the device reports', () => {
    expect(riderSpeed(sample({ speed: 7.5 }), null)).toBe(7.5);
  });

  it('derives one from two fixes when the device reports none', () => {
    const first = sample({ speed: null });
    const second = sample({ lat: north(60.17, 50), speed: null, ts: START_TS + 10_000 });
    expect(riderSpeed(second, first)).toBeCloseTo(5, 1);
  });

  it('refuses to derive a speed from a GPS jump', () => {
    const first = sample({ speed: null });
    const second = sample({ lat: north(60.17, 2_000), speed: null, ts: START_TS + 5_000 });
    expect(riderSpeed(second, first)).toBeNull();
  });
});

describe('updateRideTracks', () => {
  it('accumulates hits, shared distance and separation for the vehicle alongside', () => {
    const { tracks } = ride({ samples: 3, separation: 6 });
    const track = tracks.get('40-456')!;
    expect(track.hits).toBe(3);
    expect(track.misses).toBe(0);
    // Two five-second steps at 8 m/s.
    expect(track.sharedMeters).toBeCloseTo(80, 0);
    expect(track.separationSum / track.hits).toBeCloseTo(6, 0);
  });

  it('ignores a vehicle whose last report is too old to say where it is', () => {
    const tracks = updateRideTracks(
      new Map(), [vehicle({ ts: (START_TS - 60_000) / 1000 })], sample(), null);
    expect(tracks.size).toBe(0);
  });

  it('ignores a fix too vague to place anyone', () => {
    const { size } = updateRideTracks(new Map(), [vehicle()], sample({ accuracy: 400 }), null);
    expect(size).toBe(0);
  });

  it('counts a miss for a vehicle that was alongside and no longer is', () => {
    const { tracks, lastTs } = ride({ samples: 3 });
    const departed = updateRideTracks(
      tracks,
      [vehicle({ lat: north(60.17, 5_000), ts: (lastTs + 5_000) / 1000 })],
      sample({ ts: lastTs + 5_000 }),
      null,
    );
    expect(departed.get('40-456')!.misses).toBe(1);
  });

  it('starts the evidence over when the vehicle begins a different trip', () => {
    const { tracks } = ride({
      samples: 4,
      vehicles: (step) => [vehicle({
        lat: north(60.17, step * 5 * 8),
        ts: (START_TS + step * 5_000) / 1000,
        tripId: step < 2 ? 'HSL:1009_20260906_Su_1_1150' : 'HSL:1009_20260906_Su_2_1230',
      })],
    });
    const track = tracks.get('40-456')!;
    expect(track.hits).toBe(2);
    expect(track.tripId).toBe('HSL:1009_20260906_Su_2_1230');
  });

  it('forgets evidence once the vehicle has been gone for minutes', () => {
    const { tracks, lastTs } = ride({ samples: 3 });
    const later = updateRideTracks(tracks, [], sample({ ts: lastTs + 200_000 }), null);
    expect(later.size).toBe(0);
  });
});

describe('rideVerdict', () => {
  it('says nothing on a single fix beside a vehicle', () => {
    const { tracks, lastTs } = ride({ samples: 1 });
    expect(rideVerdict(tracks, lastTs).kind).toBe('none');
  });

  it('offers a possible ride once a vehicle has stayed alongside for a block', () => {
    const { tracks, lastTs } = ride({ samples: 3 });
    const verdict = rideVerdict(tracks, lastTs);
    expect(verdict.kind).toBe('candidate');
    if (verdict.kind !== 'candidate') return;
    expect(verdict.ride.confidence).toBe('possible');
    expect(verdict.ride.desi).toBe('9');
  });

  it('confirms the ride once the two have covered real ground together', () => {
    const { tracks, lastTs } = ride({ samples: 6 });
    const verdict = rideVerdict(tracks, lastTs);
    expect(verdict.kind).toBe('candidate');
    if (verdict.kind !== 'candidate') return;
    expect(verdict.ride.confidence).toBe('confirmed');
    expect(verdict.ride.veh).toBe('40-456');
    expect(verdict.ride.sharedMeters).toBeGreaterThan(150);
  });

  it('does not claim a ride from standing still next to a tram at its stop', () => {
    // Both parked: no ground covered together, so nothing is proven.
    const { tracks, lastTs } = ride({ samples: 8, speed: 0 });
    expect(rideVerdict(tracks, lastTs).kind).toBe('none');
  });

  it('does not claim the tram that rolls past the pavement you are standing on', () => {
    let tracks = new Map<string, RideTrack>();
    let previous: LocationSample | null = null;
    let ts = START_TS;
    for (let step = 0; step < 6; step++) {
      ts = START_TS + step * 5_000;
      // The reader has not moved; the tram passes within a few metres.
      const current = sample({ lat: 60.17, lon: 24.94, speed: 0, ts });
      tracks = updateRideTracks(
        tracks,
        [vehicle({ lat: north(60.17, step * 8 - 20), spd: 8, ts: ts / 1000 })],
        current,
        previous,
      );
      previous = current;
    }
    expect(rideVerdict(tracks, ts).kind).toBe('none');
  });

  it('refuses to pick between two lines running alongside each other', () => {
    const { tracks, lastTs } = ride({
      samples: 6,
      vehicles: (step) => {
        const lat = north(60.17, step * 5 * 8);
        const ts = (START_TS + step * 5_000) / 1000;
        return [
          vehicle({ lat, ts }),
          vehicle({ veh: '40-999', desi: '7', tripId: 'HSL:1007_20260906_Su_1_1150', lat, ts }),
        ];
      },
    });
    const verdict = rideVerdict(tracks, lastTs);
    expect(verdict.kind).toBe('ambiguous');
    if (verdict.kind !== 'ambiguous') return;
    expect(verdict.among.sort()).toEqual(['7', '9']);
  });

  it('picks a side when the two halves are the same coupled train', () => {
    const { tracks, lastTs } = ride({
      samples: 6,
      separation: 4,
      vehicles: (step) => {
        const lat = north(60.17, step * 5 * 8);
        const ts = (START_TS + step * 5_000) / 1000;
        return [
          vehicle({ mode: 'train', desi: 'I', lat, ts }),
          // The other unit of the same run, a carriage further back.
          vehicle({ veh: '40-457', mode: 'train', desi: 'I', lat: north(lat, -25), ts }),
        ];
      },
    });
    const verdict = rideVerdict(tracks, lastTs);
    expect(verdict.kind).toBe('candidate');
    if (verdict.kind !== 'candidate') return;
    expect(verdict.ride.veh).toBe('40-456');
  });

  it('drops a candidate whose vehicle has gone quiet', () => {
    const { tracks, lastTs } = ride({ samples: 6 });
    expect(rideVerdict(tracks, lastTs + 40_000).kind).toBe('none');
  });
});

describe('rideEnded', () => {
  const track = (overrides: Partial<RideTrack> = {}): RideTrack => ({
    veh: '40-456', desi: '9', mode: 'tram', tripId: 'HSL:1009_20260906_Su_1_1150',
    hits: 6, misses: 0, firstHitTs: START_TS, lastHitTs: START_TS + 30_000,
    sharedMeters: 400, separationSum: 30, lastSeparation: 5, ...overrides,
  });

  it('holds the ride through a single lost fix', () => {
    expect(rideEnded(track({ misses: 1 }), START_TS + 35_000)).toBe(false);
  });

  it('ends the ride after three samples without the vehicle alongside', () => {
    expect(rideEnded(track({ misses: 3 }), START_TS + 45_000)).toBe(true);
  });

  it('ends the ride when the vehicle stops reporting altogether', () => {
    expect(rideEnded(track(), START_TS + 120_000)).toBe(true);
    expect(rideEnded(undefined, START_TS)).toBe(true);
  });
});
