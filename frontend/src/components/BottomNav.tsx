import React from 'react';
import { Map as MapIcon, SlidersHorizontal, Info } from 'lucide-react';

export type MobileTab = 'map' | 'filters' | 'details';

interface BottomNavProps {
  active: MobileTab;
  hasDetails: boolean;
  onSelect: (tab: MobileTab) => void;
}

export const BottomNav: React.FC<BottomNavProps> = ({ active, hasDetails, onSelect }) => {
  return (
    <nav className="bottom-nav" role="tablist" aria-label="Main navigation">
      <button
        role="tab"
        aria-selected={active === 'map'}
        className={`bottom-nav-btn ${active === 'map' ? 'active' : ''}`}
        onClick={() => onSelect('map')}
      >
        <MapIcon size={19} />
        <span>Map</span>
      </button>
      <button
        role="tab"
        aria-selected={active === 'filters'}
        className={`bottom-nav-btn ${active === 'filters' ? 'active' : ''}`}
        onClick={() => onSelect('filters')}
      >
        <SlidersHorizontal size={19} />
        <span>Lines</span>
      </button>
      {hasDetails && (
        <button
          role="tab"
          aria-selected={active === 'details'}
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
