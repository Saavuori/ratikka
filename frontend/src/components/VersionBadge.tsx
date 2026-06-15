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
    <div className="version-badge">
      <span>{info.version}</span>
      <span className="mx-1.5 opacity-50">|</span>
      <span>{info.git_sha.substring(0, 7)}</span>
    </div>
  );
};
