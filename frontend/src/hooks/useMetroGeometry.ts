import { useEffect, useState } from 'react';
import { fetchRouteDetails } from '../lib/api';

// Metro track geometry, fetched for every metro line in the feed rather than
// only for the lines the user happens to have highlighted.
//
// The map's `routeGeometries` exist to *draw* route ribbons, so App only fetches
// them for a selected line, a selected vehicle's line, or a selected stop's
// routes. The metro animation needs the same polylines for a different reason:
// they are the rails a train is snapped to and dead-reckoned along while the
// tunnel feed is silent (see lib/metroTracks and lib/deadReckon). Sharing the
// drawing-driven state meant that in the ordinary view — metro switched on,
// nothing selected — there were no tracks, so nothing was ever snapped, no fix
// was ever recorded and no train was ever carried forward. Every metro train
// sat still for the seconds between reports and then jumped, which is exactly
// the motion the dead reckoning was written to remove.
//
// So this is deliberately a second, separate channel: it never reaches the map
// style, it just keeps the two metro lines' polylines around. They are static
// (the server caches route details) and there are only ever a couple of them,
// so each line is fetched once per page load and memoized at module scope.
const cached: Record<string, string[]> = {};
const inflight: Record<string, Promise<string[]>> = {};

function loadGeometry(line: string): Promise<string[]> {
  if (cached[line]) return Promise.resolve(cached[line]);
  if (!inflight[line]) {
    inflight[line] = fetchRouteDetails(line)
      .then((data) => {
        const geometries = data.geometries ?? [];
        if (geometries.length > 0) cached[line] = geometries;
        return geometries;
      })
      .catch((err) => {
        delete inflight[line]; // allow a retry on the next snapshot
        throw err;
      });
  }
  return inflight[line];
}

/**
 * Encoded pattern polylines for each of `lines`, keyed by line number.
 *
 * `lines` must be a stable, sorted list (see `metroLinesInFeed`) — it is joined
 * into the effect's dependency, so an unstable order would refetch on every
 * feed snapshot.
 */
export function useMetroGeometry(lines: string[]): Record<string, string[]> {
  const [geometries, setGeometries] = useState<Record<string, string[]>>(() => ({ ...cached }));
  const key = lines.join(',');

  useEffect(() => {
    const wanted = key ? key.split(',') : [];
    let cancelled = false;

    wanted.forEach((line) => {
      loadGeometry(line)
        .then((data) => {
          if (cancelled || data.length === 0) return;
          setGeometries((prev) => (prev[line] === data ? prev : { ...prev, [line]: data }));
        })
        .catch((err) => {
          console.error(`Failed to fetch metro track geometry for ${line}:`, err);
        });
    });

    return () => {
      cancelled = true;
    };
  }, [key]);

  return geometries;
}
