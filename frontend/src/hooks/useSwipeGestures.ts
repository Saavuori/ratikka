import { useEffect, useRef } from 'react';

interface UseSwipeGesturesOptions {
  isFilterCollapsed: boolean;
  isDetailCollapsed: boolean;
  setFilterCollapsed: (collapsed: boolean) => void;
  setDetailCollapsed: (collapsed: boolean) => void;
}

const EDGE_THRESHOLD = 45; // px from a screen edge that counts as an edge swipe
const SWIPE_THRESHOLD = 55; // px of horizontal travel before we treat it as a swipe
const HORIZONTAL_RATIO = 1.5; // how much more horizontal than vertical the swipe must be

/**
 * Single owner of the panel swipe gestures.
 *
 * This used to live in App alongside duplicate per-panel `onTouchMove` handlers with a
 * different threshold, so one drag could fire both and toggle a panel twice. Listeners are
 * registered once and read live state through refs, so a collapse no longer re-binds them.
 */
export function useSwipeGestures({
  isFilterCollapsed,
  isDetailCollapsed,
  setFilterCollapsed,
  setDetailCollapsed,
}: UseSwipeGesturesOptions) {
  const stateRef = useRef({
    isFilterCollapsed,
    isDetailCollapsed,
    setFilterCollapsed,
    setDetailCollapsed,
  });

  useEffect(() => {
    stateRef.current = {
      isFilterCollapsed,
      isDetailCollapsed,
      setFilterCollapsed,
      setDetailCollapsed,
    };
  }, [isFilterCollapsed, isDetailCollapsed, setFilterCollapsed, setDetailCollapsed]);

  useEffect(() => {
    let touchStartX = 0;
    let touchStartY = 0;

    const handleTouchStart = (e: TouchEvent) => {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (e.changedTouches.length === 0) return;

      const deltaX = e.changedTouches[0].clientX - touchStartX;
      const deltaY = e.changedTouches[0].clientY - touchStartY;

      if (Math.abs(deltaX) <= Math.abs(deltaY) * HORIZONTAL_RATIO) return;
      if (Math.abs(deltaX) <= SWIPE_THRESHOLD) return;

      const screenWidth = window.innerWidth;
      const distanceFromRight = screenWidth - touchStartX;
      const current = stateRef.current;

      if (deltaX > 0) {
        // Rightward: open the left panel from the edge, or close the open right panel.
        if (touchStartX < EDGE_THRESHOLD) {
          current.setFilterCollapsed(false);
        } else if (!current.isDetailCollapsed && distanceFromRight < 350) {
          current.setDetailCollapsed(true);
        }
      } else {
        // Leftward: open the right panel from the edge, or close the open left panel.
        if (distanceFromRight < EDGE_THRESHOLD) {
          current.setDetailCollapsed(false);
        } else if (!current.isFilterCollapsed && touchStartX < 250) {
          current.setFilterCollapsed(true);
        }
      }
    };

    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, []);
}
