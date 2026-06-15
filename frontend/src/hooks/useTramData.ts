import { useState, useEffect, useRef } from 'react';
import type { VehiclePosition } from '../types';

export function useTramData() {
  const [trams, setTrams] = useState<Record<string, VehiclePosition>>({});
  const tramsRef = useRef<Record<string, VehiclePosition>>({});

  const handleUpdate = (newVehicles: Record<string, VehiclePosition>) => {
    // Merge new positions with existing, keeping track of timestamps
    const merged = { ...tramsRef.current };
    
    Object.entries(newVehicles).forEach(([id, veh]) => {
      merged[id] = veh;
    });

    tramsRef.current = merged;
    setTrams(merged);
  };

  // Periodic cleanup of stale trams (no updates for > 15 seconds)
  useEffect(() => {
    const interval = setInterval(() => {
      const nowEpoch = Math.floor(Date.now() / 1000);
      const active: Record<string, VehiclePosition> = {};
      let changed = false;

      Object.entries(tramsRef.current).forEach(([id, veh]) => {
        // If the vehicle timestamp is within 15 seconds, keep it
        // Note: Sometimes the broker timestamp might have clock drift, so we can also check against local server time
        // but since we receive it live, checking veh.ts (which is epoch seconds) is standard.
        // Wait, we can compare with our own tracking or just check if nowEpoch - veh.ts < 15
        if (nowEpoch - veh.ts < 15) {
          active[id] = veh;
        } else {
          changed = true;
        }
      });

      if (changed) {
        tramsRef.current = active;
        setTrams(active);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  return {
    trams,
    handleUpdate,
  };
}
