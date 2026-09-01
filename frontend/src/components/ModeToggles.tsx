import React from 'react';
import { TramFront, Bus, TrainFrontTunnel, TrainFront } from 'lucide-react';
import { TRAM_GREEN, BUS_BLUE, METRO_ORANGE, TRAIN_PURPLE } from '../lib/routeColors';

interface ModeTogglesProps {
  showTrams: boolean;
  setShowTrams: (show: boolean) => void;
  showBuses: boolean;
  setShowBuses: (show: boolean) => void;
  showMetro: boolean;
  setShowMetro: (show: boolean) => void;
  showTrains: boolean;
  setShowTrains: (show: boolean) => void;
}

const ICON_SIZE = 16;

/**
 * Floating corner shortcut for the four vehicle-mode toggles. These live in the
 * filter panel's settings section too, but that is two taps away behind a
 * drawer (a bottom sheet on mobile) — and switching a mode on or off is the
 * single most-used control, since it is also what makes the backend subscribe
 * to that mode's HFP feed. Same state, same effect: this is a shortcut, not a
 * second source of truth.
 */
export const ModeToggles: React.FC<ModeTogglesProps> = ({
  showTrams,
  setShowTrams,
  showBuses,
  setShowBuses,
  showMetro,
  setShowMetro,
  showTrains,
  setShowTrains,
}) => {
  const modes = [
    {
      key: 'tram',
      label: 'trams',
      color: TRAM_GREEN,
      icon: <TramFront size={ICON_SIZE} />,
      active: showTrams,
      toggle: () => setShowTrams(!showTrams),
    },
    {
      key: 'bus',
      label: 'buses',
      color: BUS_BLUE,
      icon: <Bus size={ICON_SIZE} />,
      active: showBuses,
      toggle: () => setShowBuses(!showBuses),
    },
    {
      key: 'metro',
      label: 'metro',
      color: METRO_ORANGE,
      icon: <TrainFrontTunnel size={ICON_SIZE} />,
      active: showMetro,
      toggle: () => setShowMetro(!showMetro),
    },
    {
      key: 'train',
      label: 'commuter trains',
      color: TRAIN_PURPLE,
      icon: <TrainFront size={ICON_SIZE} />,
      active: showTrains,
      toggle: () => setShowTrains(!showTrains),
    },
  ];

  return (
    <div className="mode-toggles" role="group" aria-label="Vehicle modes">
      {modes.map((mode) => (
        <button
          key={mode.key}
          type="button"
          className={`mode-toggle ${mode.active ? 'active' : ''}`}
          onClick={mode.toggle}
          aria-pressed={mode.active}
          aria-label={`${mode.active ? 'Hide' : 'Show'} ${mode.label}`}
          title={`${mode.active ? 'Hide' : 'Show'} ${mode.label}`}
          style={
            mode.active
              ? {
                  // Tint the chip with the mode's own accent when it is on, so
                  // the row reads as a legend as well as a set of switches.
                  color: mode.color,
                  borderColor: mode.color,
                  background: `${mode.color}26`,
                }
              : undefined
          }
        >
          {mode.icon}
        </button>
      ))}
    </div>
  );
};
