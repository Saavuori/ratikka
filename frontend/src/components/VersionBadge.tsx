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

  const buildDate = info.build_date && info.build_date !== 'unknown'
    ? new Date(info.build_date).toLocaleDateString('fi-FI', { day: '2-digit', month: '2-digit', year: '2-digit' })
    : null;

  return (
    <div className="version-badge">
      <span className="version-badge__tag">{info.version}</span>
      <span className="version-badge__sep">·</span>
      <span className="version-badge__sha">{info.git_sha.substring(0, 7)}</span>
      {buildDate && (
        <>
          <span className="version-badge__sep">·</span>
          <span className="version-badge__date">{buildDate}</span>
        </>
      )}
    </div>
  );
};
