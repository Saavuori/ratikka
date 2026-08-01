import React, { useEffect, useState } from 'react';
import { fetchVersionInfo } from '../lib/api';
import type { VersionResponse } from '../types';

export const VersionBadge: React.FC = () => {
  const [info, setInfo] = useState<VersionResponse | null>(null);

  useEffect(() => {
    fetchVersionInfo()
      .then(setInfo)
      .catch((err) => console.error('Failed to load version:', err));
  }, []);

  if (!info) return null;

  return (
    <a
      className="version-badge"
      href="https://saavuori.github.io/ratikka/"
      target="_blank"
      rel="noopener noreferrer"
      title="View changelog · Traffic-light junctions: Helsingin kaupunkiympäristön toimiala / Kaupunkimittauspalvelut, CC BY 4.0"
    >
      <span className="version-badge__tag">{info.version}</span>
    </a>
  );
};
