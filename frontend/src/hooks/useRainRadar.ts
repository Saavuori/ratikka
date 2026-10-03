import { useEffect, useState } from 'react';
import { RADAR_CAPABILITIES_URL, RADAR_POLL_MS, latestRadarFrame } from '../lib/rainRadar';

/**
 * The newest rain radar frame FMI has published, kept current while the
 * overlay is switched on; null while it is off or before the first answer.
 *
 * Nothing is asked of FMI while the overlay is off or the tab is hidden, and a
 * returning tab checks at once rather than showing a frame from before it
 * went away. A failed check keeps the frame already shown.
 */
export function useRainRadar(enabled: boolean): string | null {
  const [frame, setFrame] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const check = () => {
      if (document.hidden) return;
      fetch(RADAR_CAPABILITIES_URL)
        .then((res) => (res.ok ? res.text() : Promise.reject(new Error(`HTTP ${res.status}`))))
        .then((xml) => {
          const latest = latestRadarFrame(xml);
          if (!cancelled && latest) setFrame(latest);
        })
        .catch((err) => console.warn('Rain radar frame check failed:', err));
    };

    check();
    const interval = setInterval(check, RADAR_POLL_MS);
    const onVisibility = () => {
      if (!document.hidden) check();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled]);

  return enabled ? frame : null;
}
