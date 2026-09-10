import React from 'react';
import { TramFront, Bus, TrainFrontTunnel, TrainFront, Ship } from 'lucide-react';
import { TRAM_GREEN, BUS_BLUE, METRO_ORANGE, TRAIN_PURPLE, FERRY_CYAN } from '../lib/routeColors';
import { TRANSPORT_MODES, type ModeFlags, type TransportMode } from '../lib/modes';

interface ModeTogglesProps {
  /** Faded out and taken out of the tab order while a mobile bottom sheet covers the map. */
  hidden?: boolean;
  modes: ModeFlags;
  onToggle: (mode: TransportMode, on: boolean) => void;
}

const ICON_SIZE = 16;

/** How each mode presents itself in the row: its accent, its icon, its name. */
const MODE_CHIPS: Record<TransportMode, { label: string; color: string; icon: React.ReactNode }> = {
  tram: { label: 'trams', color: TRAM_GREEN, icon: <TramFront size={ICON_SIZE} /> },
  bus: { label: 'buses', color: BUS_BLUE, icon: <Bus size={ICON_SIZE} /> },
  metro: { label: 'metro', color: METRO_ORANGE, icon: <TrainFrontTunnel size={ICON_SIZE} /> },
  train: { label: 'commuter trains', color: TRAIN_PURPLE, icon: <TrainFront size={ICON_SIZE} /> },
  ferry: { label: 'ferries', color: FERRY_CYAN, icon: <Ship size={ICON_SIZE} /> },
};

/**
 * Floating corner shortcut for the five vehicle-mode toggles, and the only place
 * they live: switching a mode on or off is the single most-used control (it is
 * also what makes the backend subscribe to that mode's HFP feed), so it belongs
 * one tap away on the map rather than behind a drawer. ViewToggles mirrors it in
 * the opposite corner with the theme and 3D switches.
 */
export const ModeToggles: React.FC<ModeTogglesProps> = ({ hidden = false, modes, onToggle }) => (
  <div
    className={`corner-toggles mode-toggles${hidden ? ' corner-toggles--hidden' : ''}`}
    role="group"
    aria-label="Vehicle modes"
  >
    {TRANSPORT_MODES.map((mode) => {
      const chip = MODE_CHIPS[mode];
      const active = modes[mode];
      const action = `${active ? 'Hide' : 'Show'} ${chip.label}`;
      return (
        <button
          key={mode}
          type="button"
          className={`corner-toggle ${active ? 'active' : ''}`}
          onClick={() => onToggle(mode, !active)}
          aria-pressed={active}
          aria-label={action}
          title={action}
          style={
            active
              ? {
                  // Tint the chip with the mode's own accent when it is on, so
                  // the row reads as a legend as well as a set of switches.
                  color: chip.color,
                  borderColor: chip.color,
                  background: `${chip.color}26`,
                }
              : undefined
          }
        >
          {chip.icon}
        </button>
      );
    })}
  </div>
);
