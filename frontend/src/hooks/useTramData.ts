import { useState, useRef } from 'react';
import type { VehiclePosition } from '../types';

export function useTramData() {
  const [trams, setTrams] = useState<Record<string, VehiclePosition>>({});
  const tramsRef = useRef<Record<string, VehiclePosition>>({});

  const handleUpdate = (newVehicles: Record<string, VehiclePosition>) => {
    tramsRef.current = newVehicles;
    setTrams(newVehicles);
  };

  return {
    trams,
    handleUpdate,
  };
}
