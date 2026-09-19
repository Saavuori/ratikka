import type * as maplibregl from 'maplibre-gl';
import type { Feature, LineString } from 'geojson';
import type { HeadwayIssue, HeadwayPair } from '../../lib/headways';
import { metersBetween } from '../../lib/geo';
import { trackBetween } from '../../lib/railTracks';
import type { RailTrack } from '../../lib/railTracks';
import type { RenderPosition } from '../animation/types';

/** Source the bunch links and gap stretches are drawn from. */
export const HEADWAY_SOURCE = 'headway-links';

// A bunched pair that is not on one shared polyline — a bus, which is never
// snapped, or two trams either side of a junction — is joined by a straight
// line instead. Bunched vehicles are close by definition, so this only guards
// against a vehicle ahead that has jumped somewhere odd.
const MAX_STRAIGHT_LINK_METRES = 1500;

export type HeadwayLink = Feature<LineString, { state: HeadwayIssue }>;

/**
 * What the map draws between vehicles running too close or too far apart.
 *
 * A bunch is a short link between the two, always drawn: it is the thing a
 * reader looking at the map wants pointed out, and it is small. A gap is the
 * stretch of rail between the vehicle ahead and the one behind, where the stops
 * are waiting, and that can be kilometres of the city — so it is drawn only on
 * the lines the reader has picked out (`gapLines`), and only along rails both
 * vehicles are placed on: there is no honest straight line for a hole in the
 * service.
 *
 * Read off the positions the animation has just drawn, so the links move with
 * the vehicles rather than a second behind them.
 */
export function headwayLinks(
  pairs: HeadwayPair[],
  rendered: Record<string, RenderPosition>,
  tracks: Record<string, RailTrack[]>,
  gapLines: string[],
): HeadwayLink[] {
  const links: HeadwayLink[] = [];
  for (const pair of pairs) {
    if (pair.state === 'gap' && !gapLines.includes(pair.line)) continue;
    const back = rendered[pair.follower];
    const front = rendered[pair.leader];
    if (!back || !front) continue;

    let coordinates: [number, number][] | null = null;
    if (
      back.track &&
      front.track &&
      back.track.line === front.track.line &&
      back.track.index === front.track.index
    ) {
      const track = tracks[back.track.line]?.[back.track.index];
      if (track) coordinates = trackBetween(track, back.track.distance, front.track.distance);
    }
    if (!coordinates && pair.state === 'bunched') {
      const a: [number, number] = [back.lng, back.lat];
      const b: [number, number] = [front.lng, front.lat];
      if (metersBetween(a, b) <= MAX_STRAIGHT_LINK_METRES) coordinates = [a, b];
    }
    if (!coordinates || coordinates.length < 2) continue;

    links.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates },
      properties: { state: pair.state },
    });
  }
  return links;
}

/**
 * Push this frame's links to the map. An empty frame after an empty frame is
 * skipped, so a map with nothing bunched pays nothing for the feature.
 * Returns whether anything is now drawn.
 */
export function drawHeadwayLinks(map: maplibregl.Map, links: HeadwayLink[], drawn: boolean): boolean {
  if (links.length === 0 && !drawn) return false;
  const source = map.getSource(HEADWAY_SOURCE) as maplibregl.GeoJSONSource | undefined;
  if (!source) return false;
  source.setData({ type: 'FeatureCollection', features: links });
  return links.length > 0;
}
