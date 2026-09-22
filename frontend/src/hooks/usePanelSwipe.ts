import { useRef } from 'react';
import type React from 'react';
import { useIsMobile } from './useIsMobile';

/** How far a finger must travel sideways across a panel to fold or unfold it. */
const SWIPE_THRESHOLD = 45;

type PanelSwipeHandlers = Pick<
  React.DOMAttributes<HTMLElement>,
  'onTouchStart' | 'onTouchMove' | 'onTouchEnd'
>;

/**
 * Fold a side panel away by swiping it towards its own edge, and unfold it by
 * swiping it back out. Spread the result onto the panel's root element.
 *
 * `side` is the edge the panel is docked to: the lines panel sits on the left,
 * the detail panels on the right. On a phone the panels are bottom sheets the
 * tab bar drives, so no handlers are returned there.
 *
 * The start of the touch is a ref rather than state: nothing is drawn from it,
 * so there is no reason for a touch to re-render the panel.
 */
export function usePanelSwipe(
  side: 'left' | 'right',
  isCollapsed: boolean,
  onToggleCollapse: () => void,
): PanelSwipeHandlers {
  const isMobile = useIsMobile();
  const startX = useRef<number | null>(null);
  if (isMobile) return {};

  return {
    onTouchStart: (e) => {
      startX.current = e.touches[0].clientX;
    },
    onTouchMove: (e) => {
      if (startX.current === null) return;
      const diff = e.touches[0].clientX - startX.current;
      const towardsEdge = side === 'left' ? diff < -SWIPE_THRESHOLD : diff > SWIPE_THRESHOLD;
      const awayFromEdge = side === 'left' ? diff > SWIPE_THRESHOLD : diff < -SWIPE_THRESHOLD;
      if ((towardsEdge && !isCollapsed) || (awayFromEdge && isCollapsed)) {
        onToggleCollapse();
        startX.current = null;
      }
    },
    onTouchEnd: () => {
      startX.current = null;
    },
  };
}
