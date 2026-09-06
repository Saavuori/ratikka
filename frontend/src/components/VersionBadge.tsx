import React, { useEffect, useRef, useState } from 'react';
import { fetchVersionInfo } from '../lib/api';
import type { VersionResponse } from '../types';
import { badgeTitle, DOUBLE_CLICK_GRACE_MS } from '../lib/replay';

interface VersionBadgeProps {
  /**
   * Opens the timelapse controls. Reached by double-clicking the badge: the
   * archive is a curiosity rather than part of riding a tram, and a map that
   * offers to replay the week in its own chrome asks a question most people
   * opening it did not have. Undefined when the server records no history, and
   * the badge is then only its link.
   */
  onReveal?: () => void;
}

/**
 * The version tag in the map's corner. Ordinarily a link to the changelog;
 * double-clicked, it opens the timelapse panel.
 *
 * The two gestures share one element, so the click has to be held back until it
 * is known not to be half of a double: the browser fires `click` before
 * `dblclick`, and following the link immediately would navigate away from the
 * panel the second click was asking for.
 */
export const VersionBadge: React.FC<VersionBadgeProps> = ({ onReveal }) => {
  const [info, setInfo] = useState<VersionResponse | null>(null);
  const clickTimerRef = useRef<number | null>(null);

  useEffect(() => {
    fetchVersionInfo()
      .then(setInfo)
      .catch((err) => console.error('Failed to load version:', err));
  }, []);

  useEffect(() => () => {
    if (clickTimerRef.current) window.clearTimeout(clickTimerRef.current);
  }, []);

  if (!info) return null;

  const href = 'https://saavuori.github.io/ratikka/';

  const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!onReveal) return; // no history to reveal; the link behaves normally
    // A modified click is the reader deliberately opening the changelog in a
    // new tab or window, and is never half of a double.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    event.preventDefault();
    if (clickTimerRef.current) window.clearTimeout(clickTimerRef.current);
    clickTimerRef.current = window.setTimeout(() => {
      clickTimerRef.current = null;
      window.open(href, '_blank', 'noopener,noreferrer');
    }, DOUBLE_CLICK_GRACE_MS);
  };

  const handleDoubleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!onReveal) return;
    event.preventDefault();
    if (clickTimerRef.current) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    onReveal();
  };

  return (
    <a
      className="version-badge"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      title={badgeTitle(Boolean(onReveal))}
    >
      <span className="version-badge__tag">{info.version}</span>
    </a>
  );
};
