import React, { useEffect, useState } from 'react';
import { fetchVersionInfo } from '../lib/api';
import type { VersionResponse } from '../types';
import { badgeTitle } from '../lib/replay';

interface VersionBadgeProps {
  /**
   * Opens the timelapse controls. Undefined when the server records no history,
   * and the badge is then only its changelog link.
   */
  onReveal?: () => void;
}

/**
 * The version tag in the map's corner. Where there is history to play, one
 * click or tap on it opens the timelapse.
 *
 * It was a double-click for a while, on the reasoning that the archive is a
 * curiosity rather than part of riding a tram. A double-click is not a gesture
 * a touchscreen has, though, and the thing behind it turned out to be worth
 * finding: a single press opens it now, on every device, with no timer between
 * the press and the panel.
 *
 * The element stays an anchor to the changelog, so the link survives where a
 * click is not a plain one — a modified or middle click, or the long-press menu
 * on a phone — and is all the badge does on an instance with no archive.
 */
export const VersionBadge: React.FC<VersionBadgeProps> = ({ onReveal }) => {
  const [info, setInfo] = useState<VersionResponse | null>(null);

  useEffect(() => {
    fetchVersionInfo()
      .then(setInfo)
      .catch((err) => console.error('Failed to load version:', err));
  }, []);

  if (!info) return null;

  const href = 'https://saavuori.github.io/ratikka/';

  const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!onReveal) return; // no history to reveal; the link behaves normally
    // A modified click is the reader deliberately opening the changelog in a
    // new tab or window, and is not a request for the timelapse.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onReveal();
  };

  return (
    <a
      className="version-badge"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={handleClick}
      title={badgeTitle(Boolean(onReveal))}
    >
      <span className="version-badge__tag">{info.version}</span>
    </a>
  );
};
