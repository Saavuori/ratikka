import React, { useId } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { usePersistedFlag } from '../hooks/usePersisted';

interface CornerToggleGroupProps {
  /** Which top corner the row is pinned to; the fold button sits on that edge. */
  side: 'left' | 'right';
  /** Names the group for screen readers, and the fold button after it. */
  label: string;
  /** The localStorage key the folded state is remembered under. */
  storageKey: string;
  /** What the folded row shows in place of its chips. */
  icon: React.ReactNode;
  /** Faded out and taken out of the tab order while a mobile bottom sheet covers the map. */
  hidden?: boolean;
  className: string;
  children: React.ReactNode;
}

const ICON_SIZE = 16;

/**
 * The floating chip row shared by ModeToggles and ViewToggles, with a button
 * on its outer edge that folds the row down to that one button. Both rows grew
 * long enough to sit over a fair share of the map, and most of the time they
 * are set once and left alone, so the reader can put them away and bring them
 * back with a tap. The fold button stays where the corner is, folded or not, so
 * it is always under the same thumb; whether each row is folded is remembered.
 */
export const CornerToggleGroup: React.FC<CornerToggleGroupProps> = ({
  side,
  label,
  storageKey,
  icon,
  hidden = false,
  className,
  children,
}) => {
  const [collapsed, setCollapsed] = usePersistedFlag(storageKey, false);
  const chipsId = useId();
  const action = `${collapsed ? 'Show' : 'Hide'} ${label.toLowerCase()}`;
  // Expanded, the chevron points at the corner the row folds into.
  const Chevron = side === 'right' ? ChevronRight : ChevronLeft;

  return (
    <div
      className={[
        'corner-toggles',
        className,
        collapsed ? 'corner-toggles--collapsed' : '',
        hidden ? 'corner-toggles--hidden' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      role="group"
      aria-label={label}
    >
      <button
        type="button"
        className="corner-toggle corner-toggles__fold"
        onClick={() => setCollapsed(!collapsed)}
        aria-expanded={!collapsed}
        aria-controls={chipsId}
        aria-label={action}
        title={action}
      >
        {collapsed ? icon : <Chevron size={ICON_SIZE} />}
      </button>
      <div id={chipsId} className="corner-toggles__chips" hidden={collapsed}>
        {children}
      </div>
    </div>
  );
};
