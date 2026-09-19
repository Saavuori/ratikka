import { useEffect } from 'react';

/** How near an edge a swipe must start to count as opening that side's panel. */
const EDGE_THRESHOLD = 45;
/** How far a swipe must travel horizontally to count at all. */
const SWIPE_THRESHOLD = 55;
/** How far into the screen a swipe may start and still be closing that panel. */
const FILTER_PANEL_REACH = 250;
const DETAIL_PANEL_REACH = 350;

interface EdgeSwipePanels {
  filterCollapsed: boolean;
  setFilterCollapsed: (collapsed: boolean) => void;
  detailCollapsed: boolean;
  setDetailCollapsed: (collapsed: boolean) => void;
  /**
   * Whether the layout is the phone one. On a phone the panels are bottom
   * sheets driven by the tab bar, so edge swipes would fight it.
   */
  isMobile: boolean;
}

/**
 * Open and close the side panels by swiping.
 *
 * A swipe from an edge opens that side's panel; a swipe back towards the edge,
 * started inside an open panel, closes it. Vertical drags are ignored — the
 * panels scroll — so a gesture only counts when it is clearly sideways.
 */
export function useEdgeSwipe({
  filterCollapsed,
  setFilterCollapsed,
  detailCollapsed,
  setDetailCollapsed,
  isMobile,
}: EdgeSwipePanels): void {
  useEffect(() => {
    if (isMobile) return;
    let startX = 0;
    let startY = 0;

    const onTouchStart = (e: TouchEvent) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.changedTouches.length === 0) return;
      const deltaX = e.changedTouches[0].clientX - startX;
      const deltaY = e.changedTouches[0].clientY - startY;

      // Mostly sideways, and far enough to mean it.
      if (Math.abs(deltaX) <= Math.abs(deltaY) * 1.5) return;
      if (Math.abs(deltaX) <= SWIPE_THRESHOLD) return;

      const fromRightEdge = window.innerWidth - startX;

      if (deltaX > 0) {
        if (startX < EDGE_THRESHOLD) setFilterCollapsed(false);
        if (!detailCollapsed && fromRightEdge < DETAIL_PANEL_REACH) setDetailCollapsed(true);
      } else {
        if (!filterCollapsed && startX < FILTER_PANEL_REACH) setFilterCollapsed(true);
        if (fromRightEdge < EDGE_THRESHOLD) setDetailCollapsed(false);
      }
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, [filterCollapsed, setFilterCollapsed, detailCollapsed, setDetailCollapsed, isMobile]);
}
