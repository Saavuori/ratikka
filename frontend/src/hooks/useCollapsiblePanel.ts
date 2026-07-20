import type { KeyboardEvent, MouseEvent } from 'react';

/**
 * Props for a glass panel that expands when its collapsed sliver is activated.
 *
 * The collapsed sliver is a `div`, so it needs an explicit role, a tab stop and key
 * handling to be reachable without a pointer. When expanded it returns to being plain
 * markup with no interactive semantics.
 */
export function useCollapsiblePanel(
  isCollapsed: boolean,
  onToggleCollapse: () => void,
  expandLabel: string
) {
  if (!isCollapsed) {
    return { className: '', role: undefined, tabIndex: undefined };
  }

  return {
    className: 'collapsed',
    role: 'button' as const,
    tabIndex: 0,
    'aria-expanded': false,
    'aria-label': expandLabel,
    onClick: () => onToggleCollapse(),
    onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onToggleCollapse();
      }
    },
  };
}

/** Stops a click inside an expanded panel from bubbling to the panel's expand handler. */
export function stopPanelClick(e: MouseEvent) {
  e.stopPropagation();
}
