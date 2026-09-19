import type * as maplibregl from 'maplibre-gl';
import { lerp, lerpAngle, clamp, smoothstep, easeByAccel } from '../../lib/lerp';
import { tripProgress, isBoardingAt } from '../../lib/nextStop';
import { ferryIconBucket } from '../../lib/ferryIcon';
import { occupancyFraction } from '../../lib/occupancy';
import { pointOnTrack, trackSpine } from '../../lib/railTracks';
import { glideFraction } from '../../lib/deadReckon';
import { advanceDoors, isVehicleBraking, vehicles3DEnabled } from '../../lib/vehicleAnimation';
import { vehicleExtrusionCollection } from '../../lib/vehicleModels';
import { VEHICLE_3D_MIN_ZOOM } from '../../lib/vehicleModels';
import type { BodySpine, VehicleState } from '../../lib/vehicleModels';
import type { DoorAnimation } from '../../lib/vehicleAnimation';
import type { TrackPlacement } from '../../lib/railTracks';
import { MAX_WINDOW_SEC } from './windows';
import type { AnimationState, FrameEffects, FrameInputs, RenderPosition, VehicleFeature } from './types';

/**
 * Drive the vehicle animation: glide every vehicle from its last reported
 * position towards its next one, sixty times a second, and keep everything
 * that hangs off a vehicle — doors, brake lights, the 3D bodies, the next-stop
 * highlight, the camera when it is following — in step with it.
 *
 * `read` is called once per frame rather than captured, because the loop
 * outlives the render that started it and must see what is true now.
 *
 * Returns the teardown.
 */
export function startAnimationLoop(
  map: maplibregl.Map,
  state: AnimationState,
  read: () => FrameInputs,
  effects: FrameEffects,
): () => void {
  const tick = () => {
    // This loop is the sole driver of vehicle movement: an uncaught throw
    // (e.g. malformed trip data) must not stop the next frame from being
    // scheduled, or every vehicle would freeze for the rest of the session.
    try {
      tickFrame();
    } catch (err) {
      console.error('Vehicle animation frame failed', err);
    }
    state.frame = requestAnimationFrame(tick);
  };

  const tickFrame = () => {
    // The style is rebuilt on a theme change; until its sources are back there
    // is nothing to move.
    if (!map.getSource('trams')) return;

    const live = read();
    const now = performance.now();
    // How far through the current glide window we are. The window is as long
    // as the gap between the last two snapshots (normally a second), so a late
    // snapshot stretches the glide instead of leaving the vehicles standing
    // still waiting for it.
    const elapsed = now - state.lastUpdate;
    const t = Math.min(elapsed / 1000 / state.windowSec, 1.0);

    // Only what is on screen is drawn. Rebuilding a vehicle's GeoJSON feature
    // and pushing the collection through `setData` is O(n), and with buses on
    // the feed carries several hundred vehicles of which a few dozen are ever
    // in view — so the whole cost of the crowd used to be paid at the zoom
    // where the crowd is invisible anyway. Padded by a comfortable margin so a
    // vehicle is already in the collection before it reaches the edge, and
    // recomputed every frame so panning brings them in.
    //
    // Interpolated positions are still computed for every vehicle, in and out
    // of view: that keeps `rendered` complete, so a vehicle panned back into
    // view resumes its glide instead of restarting it.
    const bounds = map.getBounds();
    const padLng = (bounds.getEast() - bounds.getWest()) * 0.25;
    const padLat = (bounds.getNorth() - bounds.getSouth()) * 0.25;
    const west = bounds.getWest() - padLng;
    const east = bounds.getEast() + padLng;
    const south = bounds.getSouth() - padLat;
    const north = bounds.getNorth() + padLat;

    // Adaptive render throttle. At 60 fps with a full map the rebuild
    // dominates the frame budget and makes the whole animation stutter, and
    // the sub-pixel movement between two 1 Hz snapshots is imperceptible when
    // the map is zoomed out — so when a lot of vehicles are *visible* the
    // rebuild rate is capped. It is the visible count that matters, not the
    // size of the feed: switching buses on used to drop a close-in view of
    // three trams to ten frames a second because of several hundred vehicles
    // nowhere near the screen. Interpolation stays correct (each render still
    // computes the right position for `now`), it just updates less often.
    // Chasing a vehicle is never throttled — that view needs every frame.
    const visibleCount = state.visibleCount;
    const following = !!live.selectedVehicleId;
    if (!following && visibleCount > 25) {
      const zoom = map.getZoom();
      const minInterval = visibleCount > 60
        ? (zoom < 13.5 ? 100 : 50)
        : (zoom < 13.5 ? 66 : 33);
      if (now - state.lastRender < minInterval) {
        return;
      }
    }
    state.lastRender = now;

    // Rebuilt from scratch each frame so vehicles that left the feed do not
    // linger in it.
    const rendered: Record<string, RenderPosition> = {};
    let visible = 0;

    const features: VehicleFeature[] = [];
    // The path each vehicle's body follows this frame, for the ones being
    // drawn along their rails. Filled here rather than in the 3D block below
    // because it is only honest on the frames where the drawn position came
    // off the track itself: on the one frame after a vehicle changes pattern
    // the position is a plain interpolation, and bending the body to a track
    // the vehicle is not being drawn on would tear it away from its own icon.
    const spines: Record<string, BodySpine> = {};
    Object.entries(state.target).forEach(([id, target]) => {
      const prev = state.prev[id] || target;

      const tramInfo = live.vehicles[id];
      const spd = tramInfo?.spd ?? 0;
      const acc = tramInfo?.acc ?? 0;

      // Shape position interpolation by acceleration so the on-screen motion
      // mirrors the physical vehicle: ease-in while accelerating away from a
      // stop, ease-out while braking into one. Heading eases smoothly.
      //
      // A vehicle with a dead-reckoning anchor has something better than an
      // easing curve to follow: the speed profile its own readings imply,
      // which is also what placed this window's target. Using it here means
      // the vehicle covers the window at the rate it is actually predicted to
      // travel — and that a window opened into a gap in the feed is animated
      // with the speed it has by then, not the speed it had when it last
      // spoke. `easeByAccel` remains the fallback for a vehicle with no
      // anchor: one that has only just appeared, or a metro too far off its
      // tracks to place.
      //
      // None of that shaping survives a fast replay, though, and it should
      // not: past a couple of seconds of history per window the two ends of
      // the glide are both *measured* positions, several hundred metres
      // apart, and the honest way between them is a straight constant-rate
      // line. Easing one in and out of every one of eight windows a second
      // would make the whole city pulse.
      const longStep = state.stepSec > MAX_WINDOW_SEC;
      const glide = state.glides[id];
      const tPos = longStep
        ? t
        : glide
          ? glideFraction(
              glide.spd,
              glide.acc,
              glide.ageStart,
              t,
              glide.limits,
              state.stepSec
            )
          : easeByAccel(t, acc);
      let lat = lerp(prev.lat, target.lat, tPos);
      let lng = lerp(prev.lng, target.lng, tPos);
      let hdg = lerpAngle(prev.hdg, target.hdg, longStep ? t : smoothstep(t));
      let renderTrack: TrackPlacement | undefined;

      // A rail vehicle that stayed on the same track between two snapshots is
      // moved *along* it: interpolating arc length and reading the position
      // back off the geometry keeps a train in its tunnel and a tram on its
      // rails through curves, where interpolating the endpoints would cut
      // straight across them.
      if (
        target.track &&
        prev.track &&
        prev.track.line === target.track.line &&
        prev.track.index === target.track.index
      ) {
        const track = state.tracks[target.track.line]?.[target.track.index];
        if (track) {
          const distance = lerp(prev.track.distance, target.track.distance, tPos);
          const point = pointOnTrack(track, distance);
          lat = point.lat;
          lng = point.lng;
          // Face along the track. A standing vehicle keeps the heading it
          // had: the tangent alone cannot say which end is the front.
          hdg = target.track.forward ? point.bearing : (point.bearing + 180) % 360;
          renderTrack = { ...target.track, distance };
          spines[id] = trackSpine(track, distance, target.track.forward);
        }
      } else if (target.track) {
        // No shared track to slide along — the vehicle has only just
        // appeared, or it changed pattern — so this frame falls back to the
        // straight interpolation above. The placement is still carried forward so the
        // next snapshot can resume along-track motion immediately; a line's
        // patterns run within a few metres of each other, so the distance is
        // at most that far out for the one frame it is used.
        renderTrack = target.track;
      }

      rendered[id] = { lat, lng, hdg, track: renderTrack };

      // Off-screen vehicles keep their interpolated position but are not put
      // in the collection. The selected one always is, whatever the viewport
      // says: the popup, the next-stop highlight and the follow camera all
      // read its feature from here.
      const onScreen = lng >= west && lng <= east && lat >= south && lat <= north;
      if (onScreen) visible++;
      if (!onScreen && id !== live.selectedVehicleId) return;

      const doorsOpen = tramInfo?.drst === 1;
      // Normalise speed to 0..1 for the aura sizing. Capped low (~8 m/s ≈ 29 km/h)
      // so the aura reaches its full, clearly-visible size at ordinary city-tram
      // cruising speeds rather than only when a vehicle is racing.
      const speedNorm = clamp(spd / 8, 0, 1);
      // Passenger load, where the mode measures it — which today is the ferry
      // and nothing else. See lib/occupancy.
      const load = occupancyFraction(tramInfo?.mode, tramInfo?.occu);

      features.push({
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [lng, lat],
        },
        properties: {
          veh: id,
          desi: tramInfo?.desi || '',
          hdg: hdg,
          stopped: doorsOpen || spd === 0,
          mode: tramInfo?.mode || 'tram',
          spd: spd,
          acc: acc,
          speedNorm: speedNorm,
          doorsOpen: doorsOpen,
          occuBucket: ferryIconBucket(load),
        },
      });
    });

    state.rendered = rendered;
    state.visibleCount = visible;

    const source = map.getSource('trams') as maplibregl.GeoJSONSource;
    if (source) {
      source.setData({
        type: 'FeatureCollection',
        features,
      });
    }

    // 3D bodies from the same interpolated positions the flat icons use.
    // Built only while models are enabled and the view is close enough
    // for the layer to draw: extruding every vehicle is several polygons each,
    // and there is no point paying for it to render nothing.
    const source3d = map.getSource('vehicles-3d') as maplibregl.GeoJSONSource | undefined;
    if (source3d) {
      const draw3d = vehicles3DEnabled(live.is3D, live.always3DVehicles) &&
        map.getZoom() >= VEHICLE_3D_MIN_ZOOM;
      if (draw3d || state.vehicles3dDrawn) {
        // A detailed body has many polygons, against one point for the flat icon,
        // so only what is actually on screen is built. Padded by a body length
        // so a train is not clipped as it enters the view.
        const bounds = draw3d ? map.getBounds().toArray() : null;
        const pad = 0.0012;
        const onScreen = (lng: number, lat: number) =>
          !bounds ||
          (lng >= bounds[0][0] - pad && lng <= bounds[1][0] + pad &&
           lat >= bounds[0][1] - pad && lat <= bounds[1][1] + pad);
        const doorAnimations: Record<string, DoorAnimation> = {};
        const states: VehicleState[] = draw3d
          ? features
              .filter((f) => onScreen(f.geometry.coordinates[0], f.geometry.coordinates[1]))
              .map((f) => {
                const id = f.properties.veh;
                const telemetry = live.vehicles[id];
                const doors = advanceDoors(state.doors[id], f.properties.doorsOpen, now);
                doorAnimations[id] = doors;
                return {
                  veh: f.properties.veh,
                  lng: f.geometry.coordinates[0],
                  lat: f.geometry.coordinates[1],
                  hdg: f.properties.hdg,
                  mode: f.properties.mode,
                  desi: f.properties.desi,
                  doorsOpen: f.properties.doorsOpen,
                  doorProgress: doors.progress,
                  braking: isVehicleBraking(telemetry?.spd, telemetry?.acc, f.properties.doorsOpen),
                  selected: f.properties.veh === live.selectedVehicleId,
                  // The ferry's 3D deck gauge reads the same number the flat
                  // marker's does, so the two never disagree at the zoom
                  // where they cross over.
                  occupancy: occupancyFraction(telemetry?.mode, telemetry?.occu),
                  // A vehicle being drawn along its rails is *built* along
                  // them too: each rigid section of the body sits at its own
                  // point on the track, so an articulated tram bends through
                  // a corner instead of ploughing across it. One with no path
                  // (a bus, or a tram off its route) stays a rigid box on its
                  // single heading, exactly as before.
                  spine: spines[id],
                };
              })
          : [];
        state.doors = doorAnimations;
        source3d.setData(vehicleExtrusionCollection(states, map.getZoom() >= 16));
        state.vehicles3dDrawn = draw3d;
      }
    }

    // Update the next-stop highlight. Whether a vehicle is selected decides
    // which end the highlight is read from, below.
    let vehicleSelected = false;
    let nextStopCoords: [number, number] | null = null;
    let nextStopId: string | null = null;
    let nextStopBoarding = false;

    if (live.selectedVehicleId && live.selectedTripDetails) {
      const selectedTram = live.vehicles[live.selectedVehicleId];
      if (selectedTram) {
        vehicleSelected = features.some((f) => f.properties.veh === live.selectedVehicleId);

        if (selectedTram.stop) {
          state.lastSeenStopId = selectedTram.stop;
        }
        const tripStops = live.selectedTripDetails.stops;
        const { nextStopIndex } = tripProgress(selectedTram, tripStops, {
          lastSeenStopId: state.lastSeenStopId,
        });

        if (nextStopIndex !== -1) {
          const matchedStop = tripStops[nextStopIndex];
          nextStopCoords = [matchedStop.lon, matchedStop.lat];
          nextStopId = matchedStop.gtfsId ?? null;
          // Doors open at the stop we are pointing at: the platform edge
          // lights up while passengers are actually boarding.
          nextStopBoarding = isBoardingAt(selectedTram, nextStopId);
        }
      }
    }

    // Arrival focus: the same highlight, read from the stop's end. There is
    // no vehicle selected in this mode (App keeps the two exclusive), so the
    // stop is the one the reader is walking to and the vehicle is whichever
    // one is bringing the next departure to it.
    const focus = live.arrivalFocus;
    let focusVehicleMode: string | null = null;
    if (!vehicleSelected && focus) {
      const focusStopCoords = live.arrivalStopCoords;
      const focusFeature = features.find((f) => f.properties.veh === focus.vehicleId);
      if (focusFeature && focusStopCoords) {
        focusVehicleMode = focusFeature.properties.mode;
        nextStopCoords = focusStopCoords;
        nextStopId = focus.stopId;
        // Doors open at the stop being watched: it is boarding right now.
        nextStopBoarding = live.vehicles[focus.vehicleId]?.drst === 1;
      }
    }

    // Update next stop highlight source
    const nextStopSource = map.getSource('next-stop-highlight-source') as maplibregl.GeoJSONSource;
    if (nextStopSource) {
      let nextStopMode = focusVehicleMode ? focusVehicleMode.toUpperCase() : 'TRAM';
      if (live.selectedVehicleId) {
        const selectedTram = live.vehicles[live.selectedVehicleId];
        if (selectedTram && selectedTram.mode) {
          nextStopMode = selectedTram.mode.toUpperCase();
        }
      }
      nextStopSource.setData({
        type: 'FeatureCollection',
        features: nextStopCoords ? [{
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: nextStopCoords,
          },
          properties: {
            mode: nextStopMode,
          },
        }] : [],
      });
    }

    // Phase 4 liveness: the stop a selected vehicle is heading for takes the
    // gold of the selection ring across its furniture, and pulses. Rebuilding
    // the furniture is only worth it when the highlight actually changed.
    const highlightKey = `${nextStopId ?? ''}|${nextStopBoarding}`;
    if (highlightKey !== state.stopHighlight.key) {
      state.stopHighlight = {
        key: highlightKey,
        stopId: nextStopId,
        boarding: nextStopBoarding,
        coords: nextStopCoords,
      };
      const pulseSource = map.getSource('stop-pulse') as maplibregl.GeoJSONSource | undefined;
      if (pulseSource) {
        pulseSource.setData({
          type: 'FeatureCollection',
          features: nextStopCoords ? [{
            type: 'Feature',
            geometry: { type: 'Point', coordinates: nextStopCoords },
            properties: {},
          }] : [],
        });
      }
      effects.rebuildFurniture();
    }
    // The pulse itself, driven off the same clock as the vehicles so the two
    // beat together rather than drifting apart.
    if (map.getLayer('stop-pulse-ring') && state.stopHighlight.coords) {
      const phase = (now % 1600) / 1600;
      map.setPaintProperty('stop-pulse-ring', 'circle-radius', 14 + 16 * phase);
      map.setPaintProperty('stop-pulse-ring', 'circle-opacity', 0.28 * (1 - phase));
      map.setPaintProperty('stop-pulse-ring', 'circle-stroke-opacity', 0.9 * (1 - phase));
    }

    // Smooth camera tracking
    if (live.isFollowing && live.selectedVehicleId) {
      const activeFeature = features.find((f) => f.properties.veh === live.selectedVehicleId);
      if (activeFeature && !state.interacting) {
        const [lng, lat] = activeFeature.geometry.coordinates;
        const hdg = activeFeature.properties.hdg;
        map.jumpTo({
          center: [lng, lat],
          bearing: hdg,
        });
      }
    }
  };

  state.frame = requestAnimationFrame(tick);

  state.frame = requestAnimationFrame(tick);

  return () => {
    if (state.frame !== null) cancelAnimationFrame(state.frame);
    state.frame = null;
  };
}
