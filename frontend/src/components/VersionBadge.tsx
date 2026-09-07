import React, { useEffect, useRef, useState } from 'react';
import { fetchVersionInfo } from '../lib/api';
import type { VersionResponse } from '../types';
import { badgeGesture, badgeTitle, DOUBLE_CLICK_GRACE_MS } from '../lib/replay';

interface VersionBadgeProps {
  /**
   * Opens the timelapse controls. Reached by double-clicking (or double-tapping)
   * the badge: the archive is a curiosity rather than part of riding a tram, and
   * a map that offers to replay the week in its own chrome asks a question most
   * people opening it did not have. Undefined when the server records no
   * history, and the badge is then only its link.
   */
  onReveal?: () => void;
}

/**
 * The version tag in the map's corner. Ordinarily a link to the changelog;
 * double-clicked, it opens the timelapse panel.
 *
 * Both gestures live on one element, and the second half of the double has to
 * win: the link is held back until the grace period shows the click was not
 * half of a pair. The pairing is counted from `click` alone rather than from
 * `dblclick`, because touch browsers synthesize a click per tap but do not
 * reliably emit `dblclick` — counting clicks is the one path both a mouse and a
 * finger travel.
 */
export const VersionBadge: React.FC<VersionBadgeProps> = ({ onReveal }) => {
  const [info, setInfo] = useState<VersionResponse | null>(null);
  const clickTimerRef = useRef<number | null>(null);
  const lastClickRef = useRef(0);

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

  /**
   * Follows the link from a timer, once the second click has failed to arrive.
   * A popup opened this late is often blocked — no gesture is in progress any
   * more — so a refused window falls back to navigating this one.
   */
  const openChangelog = () => {
    const opened = window.open(href, '_blank', 'noopener,noreferrer');
    if (!opened) window.location.assign(href);
  };

  const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!onReveal) return; // no history to reveal; the link behaves normally
    // A modified click is the reader deliberately opening the changelog in a
    // new tab or window, and is never half of a double.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    event.preventDefault();

    const now = Date.now();
    const pending = clickTimerRef.current;
    if (pending !== null) window.clearTimeout(pending);
    clickTimerRef.current = null;

    if (badgeGesture(now, pending === null ? null : lastClickRef.current) === 'reveal') {
      lastClickRef.current = 0;
      onReveal();
      return;
    }

    lastClickRef.current = now;
    clickTimerRef.current = window.setTimeout(() => {
      clickTimerRef.current = null;
      lastClickRef.current = 0;
      openChangelog();
    }, DOUBLE_CLICK_GRACE_MS);
  };

  // Desktop still fires dblclick after the pair of clicks. The clicks have
  // already revealed the panel by then; swallowing it keeps the browser from
  // treating the double as a text selection over the badge.
  const handleDoubleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!onReveal) return;
    event.preventDefault();
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
