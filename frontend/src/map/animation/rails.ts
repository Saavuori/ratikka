import type { VehiclePosition } from '../../types';
import {
  buildPatternTracks,
  hfpDirectionId,
  isHelsinkiCentralStationZone,
  isSnappedMode,
  orientOnTracks,
  placeOnTracks,
  pointOnTrack,
} from '../../lib/railTracks';
import type { PlaceOptions, RailTrack, TrackPlacement } from '../../lib/railTracks';
import { advanceAlongHeading } from '../../lib/geo';
import { predictedAdvance } from '../../lib/deadReckon';
import {
  METRO_SNAP_MAX_OFFSET,
  TRAM_SNAP_MAX_OFFSET,
  TRAIN_SNAP_MAX_OFFSET,
  TRAIN_ORIENT_MAX_OFFSET,
  TRAM_TRACK_SWITCH_MARGIN,
  TRAM_CONTINUITY_SLACK,
} from './types';
import type { AnimationState, RenderPosition, VehicleFix } from './types';

export const placeOnRails = (
  tram: VehiclePosition,
  previous: TrackPlacement | undefined,
  // How long the previous placement has had to go stale, in seconds. It sets
  // how far along the route the vehicle may have got since, which is what the
  // junction test is measured against.
  age: number,
  /** Rail geometry per line, built from the fetched patterns. */
  trackIndex: Record<string, RailTrack[]>,
) => {
  if (!isSnappedMode(tram.mode)) return null;
  const tracks = trackIndex[tram.desi];
  if (!tracks || tracks.length === 0) return null;

  // Helsinki Central has twenty-odd platform tracks and reversing movements
  // inside one compact area, and which platform a train is standing at is not
  // something its route polyline knows. Until Fintraffic track events are
  // integrated, the reported position is more honest than a route-polyline
  // guess there — but the *heading* is not a guess at all, because every track
  // in the throat runs parallel to every other, so the polyline's bearing is
  // the bearing of whichever track the train is really on. Turning the train
  // without moving it is what stops a 75 m body lying diagonally across the
  // station's tracks on whatever heading the last GPS fix that moved reported.
  if (tram.mode === 'train' && isHelsinkiCentralStationZone(tram.lng, tram.lat)) {
    return orientOnTracks(tracks, tram, {
      maxOffset: TRAIN_ORIENT_MAX_OFFSET,
      direction: hfpDirectionId(tram.dir),
      heading: tram.hdg,
    });
  }

  if (tram.mode === 'metro') {
    return placeOnTracks(tram.desi, tracks, tram, previous, {
      maxOffset: METRO_SNAP_MAX_OFFSET,
    });
  }

  if (tram.mode === 'train') {
    const travelled = Math.abs(tram.spd ?? 0) * Math.max(age, 0);
    return placeOnTracks(tram.desi, tracks, tram, previous, {
      maxOffset: TRAIN_SNAP_MAX_OFFSET,
      direction: hfpDirectionId(tram.dir),
      heading: tram.hdg,
      expectedAdvance: travelled,
      continuityWindow: travelled + 100,
    });
  }

  // How far the tram can have gone since it was last placed, from the speed
  // it reported. The window is that plus a fixed allowance, so a tram running
  // normally always finds itself inside it and only a fix somewhere else on
  // the route falls out.
  const travelled = Math.abs(tram.spd ?? 0) * Math.max(age, 0);
  const options: PlaceOptions = {
    maxOffset: TRAM_SNAP_MAX_OFFSET,
    direction: hfpDirectionId(tram.dir),
    heading: tram.hdg,
    // The pair of tracks is only metres apart, so the hysteresis that holds a
    // metro on its pattern would instead pin a tram to the wrong rail of the
    // two. Just wide enough to absorb GPS jitter along one track, not wide
    // enough to hold it on the other.
    switchMargin: TRAM_TRACK_SWITCH_MARGIN,
    expectedAdvance: travelled,
    continuityWindow: TRAM_CONTINUITY_SLACK + travelled,
  };
  return placeOnTracks(tram.desi, tracks, tram, previous, options);
};

export const predictPosition = (
  fix: VehicleFix,
  age: number,
  /** How far prediction may carry a vehicle into the current window. */
  dataWindowSec: number,
  trackIndex: Record<string, RailTrack[]>,
): RenderPosition | null => {
  const advance = predictedAdvance(
    fix.spd,
    fix.acc,
    0,
    age + dataWindowSec,
    fix.limits
  );
  if (advance <= 0) return null;

  if (fix.track) {
    const track = trackIndex[fix.track.line]?.[fix.track.index];
    if (!track) return null;
    // `distance` is arc length along the pattern polyline; a train running
    // against that polyline's own direction covers it backwards.
    const distance = fix.track.distance + (fix.track.forward ? advance : -advance);
    const point = pointOnTrack(track, distance);
    return {
      lat: point.lat,
      lng: point.lng,
      hdg: fix.track.forward ? point.bearing : (point.bearing + 180) % 360,
      track: { ...fix.track, distance },
    };
  }

  const moved = advanceAlongHeading(fix.lat, fix.lng, fix.hdg, advance);
  return { lat: moved.lat, lng: moved.lng, hdg: fix.hdg };
};
/**
 * Index the rail geometry for every line currently being snapped.
 *
 * Indexing walks every point of every pattern, so a line is rebuilt only when
 * the patterns it was built from actually change; lines that have left the feed
 * drop out rather than being carried forever.
 */
export function rebuildTracks(
  state: AnimationState,
  routePatterns: Record<string, unknown[] | undefined>,
): void {
  const tracks: Record<string, RailTrack[]> = {};
  for (const [line, patterns] of Object.entries(routePatterns)) {
    if (!patterns || patterns.length === 0) continue;
    if (state.trackSources[line] === patterns) {
      tracks[line] = state.tracks[line];
      continue;
    }
    state.trackSources[line] = patterns;
    tracks[line] = buildPatternTracks(patterns as Parameters<typeof buildPatternTracks>[0]);
  }
  state.tracks = tracks;
}

/** How fast history is playing back. One while the live feed is on. */
export function setTimeScale(state: AnimationState, timeScale: number): void {
  state.timeScale = timeScale;
}
