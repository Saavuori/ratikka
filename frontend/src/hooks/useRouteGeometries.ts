import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchRouteDetails } from '../lib/api';
import type { RouteGeometries } from '../map/props';

/**
 * The pattern geometry of every line the map highlights.
 *
 * Each line is fetched the first time it is asked for and kept, so the answer
 * is a view of that cache: a line that stops being highlighted simply drops
 * out of it, and a response arriving after its line was let go has nothing to
 * redraw. A failed fetch is forgotten, so the line is asked for again the next
 * time the set changes.
 */
export function useRouteGeometries(lines: string[]): RouteGeometries {
  const [loaded, setLoaded] = useState<RouteGeometries>({});
  const requested = useRef(new Set<string>());
  // Joined so the effect runs when a line enters or leaves the set, not on
  // every render that rebuilds the same list.
  const key = lines.join(',');

  useEffect(() => {
    for (const line of key ? key.split(',') : []) {
      if (requested.current.has(line)) continue;
      requested.current.add(line);
      fetchRouteDetails(line)
        .then(({ geometries, color, stops }) => {
          setLoaded((previous) => ({ ...previous, [line]: { geometries, color, stops } }));
        })
        .catch((err) => {
          requested.current.delete(line);
          console.error(`Failed to fetch route details for ${line}:`, err);
        });
    }
  }, [key]);

  return useMemo(() => {
    const shown: RouteGeometries = {};
    for (const line of key ? key.split(',') : []) {
      if (loaded[line]) shown[line] = loaded[line];
    }
    return shown;
  }, [key, loaded]);
}
