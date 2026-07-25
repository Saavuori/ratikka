import React from 'react';
import { Settings, Route, Info } from 'lucide-react';

export type MobileTab = 'settings' | 'lines' | 'details';

interface BottomNavProps {
  /** Currently expanded sheet, or null when the map is unobstructed. */
  active: MobileTab | null;
  hasDetails: boolean;
  /** Toggles the sheet: selecting the active one closes it. */
  onSelect: (tab: MobileTab) => void;
}

export const BottomNav: React.FC<BottomNavProps> = ({ active, hasDetails, onSelect }) => {
  return (
    <nav className="bottom-nav" aria-label="Main navigation">
      <button
        aria-expanded={active === 'settings'}
        className={`bottom-nav-btn ${active === 'settings' ? 'active' : ''}`}
        onClick={() => onSelect('settings')}
      >
        <Settings size={19} />
        <span>Settings</span>
      </button>
      <button
        aria-expanded={active === 'lines'}
        className={`bottom-nav-btn ${active === 'lines' ? 'active' : ''}`}
        onClick={() => onSelect('lines')}
      >
        <Route size={19} />
        <span>Lines</span>
      </button>
      {hasDetails && (
        <button
          aria-expanded={active === 'details'}
          className={`bottom-nav-btn ${active === 'details' ? 'active' : ''}`}
          onClick={() => onSelect('details')}
        >
          <Info size={19} />
          <span>Details</span>
        </button>
      )}
    </nav>
  );
};
