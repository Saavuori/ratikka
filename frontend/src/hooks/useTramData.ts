import { useState, useCallback } from 'react';
import type { VehiclePosition } from '../types';

export function useTramData() {
  const [trams, setTrams] = useState<Record<string, VehiclePosition>>({});

  const handleUpdate = useCallback((newVehicles: Record<string, VehiclePosition>) => {
    setTrams(newVehicles);
  }, []);

  return {
    trams,
    handleUpdate,
  };
}
