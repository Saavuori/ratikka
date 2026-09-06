import { useEffect, useState } from 'react';
import { fetchRouteDetails } from '../lib/api';
import type { RoutePattern } from '../lib/railTracks';

// Pattern geometry for every rail line in the feed, fetched for all of them
// rather than only for the lines the user happens to have highlighted.
//
// The map's `routeGeometries` exist to *draw* route ribbons, so App only fetches
// them for a selected line, a selected vehicle's line, or a selected stop's
// routes. The vehicle animation needs the same polylines for a different
// reason: they are the rails a metro train or tram is snapped to, and the ones
// a metro is dead-reckoned along while the tunnel feed is silent (see
// lib/railTracks and lib/deadReckon). Sharing the drawing-driven state meant
// that in the ordinary view — nothing selected — there were no tracks, so
// nothing was ever snapped, no fix was ever recorded and no train was ever
// carried forward. Every metro train sat still for the seconds between reports
// and then jumped, which is exactly the motion the dead reckoning was written
// to remove.
//
// So this is deliberately a second, separate channel: it never reaches the map
// style, it just keeps each line's polylines around. They are static (the
// server caches route details for an hour) and there are a couple of dozen at
// most — two metro lines and the tram network — so each line is fetched once
// per page load and memoized at module scope.
//
// Unlike the ribbons, these carry the direction each polyline belongs to, which
// is what puts a tram on its own side of the street rather than on the nearest
// rail. A backend that does not report patterns (an older build) still answers
// with bare geometries, and those are used with no direction: a tram then snaps
// to the nearest track of either direction, as it did before.
const cached: Record<string, RoutePattern[]> = {};
const inflight: Record<string, Promise<RoutePattern[]>> = {};

function loadPatterns(line: string): Promise<RoutePattern[]> {
  if (cached[line]) return Promise.resolve(cached[line]);
  if (!inflight[line]) {
    inflight[line] = fetchRouteDetails(line)
      .then((data) => {
        const patterns: RoutePattern[] =
          data.patterns && data.patterns.length > 0
            ? data.patterns.map((p) => ({ points: p.points, directionId: p.directionId }))
            : (data.geometries ?? []).map((points) => ({ points }));
        if (patterns.length > 0) cached[line] = patterns;
        return patterns;
      })
      .catch((err) => {
        delete inflight[line]; // allow a retry on the next snapshot
        throw err;
      });
  }
  return inflight[line];
}

/**
 * Pattern polylines for each of `lines`, keyed by line number.
 *
 * `lines` must be a stable, sorted list (see `snappedLinesInFeed`) — it is
 * joined into the effect's dependency, so an unstable order would refetch on
 * every feed snapshot.
 */
export function useRoutePatterns(lines: string[]): Record<string, RoutePattern[]> {
  const [patterns, setPatterns] = useState<Record<string, RoutePattern[]>>(() => ({ ...cached }));
  const key = lines.join(',');

  useEffect(() => {
    const wanted = key ? key.split(',') : [];
    let cancelled = false;

    wanted.forEach((line) => {
      loadPatterns(line)
        .then((data) => {
          if (cancelled || data.length === 0) return;
          setPatterns((prev) => (prev[line] === data ? prev : { ...prev, [line]: data }));
        })
        .catch((err) => {
          console.error(`Failed to fetch route track geometry for ${line}:`, err);
        });
    });

    return () => {
      cancelled = true;
    };
  }, [key]);

  return patterns;
}
