import React from 'react';
import { Sun, Moon, Box, Route, TramFront, Satellite, CloudRain, Layers } from 'lucide-react';
import type { MapTheme } from '../lib/stopPlatforms';
import { CornerToggleGroup } from './CornerToggleGroup';

interface ViewTogglesProps {
  /** Faded out and taken out of the tab order while a mobile bottom sheet covers the map. */
  hidden?: boolean;
  mapTheme: MapTheme;
  setMapTheme: (theme: MapTheme) => void;
  /** False where the deployment has no National Land Survey key; the chip is then not shown. */
  satelliteAvailable?: boolean;
  is3D: boolean;
  setIs3D: (is3D: boolean) => void;
  always3DVehicles: boolean;
  setAlways3DVehicles: (always: boolean) => void;
  showRoutes: boolean;
  setShowRoutes: (show: boolean) => void;
  showRainRadar: boolean;
  setShowRainRadar: (show: boolean) => void;
}

const ICON_SIZE = 16;

/** The accent the view chips light up with when they are on. */
const VIEW_ACCENT = '#34d399';

/**
 * Floating corner shortcut for the map-view switches — light/dark basemap,
 * rain radar, route lines, 2D/3D pitch, and pitch-independent vehicles. It mirrors ModeToggles on the
 * opposite corner, and together
 * the two rows carry everything the old settings section held, which is why
 * that section (and the mobile "Settings" sheet behind it) is gone.
 */
export const ViewToggles: React.FC<ViewTogglesProps> = ({
  hidden = false,
  mapTheme,
  setMapTheme,
  satelliteAvailable = false,
  is3D,
  setIs3D,
  always3DVehicles,
  setAlways3DVehicles,
  showRoutes,
  setShowRoutes,
  showRainRadar,
  setShowRainRadar,
}) => {
  const isSatellite = mapTheme === 'satellite';
  // Satellite is drawn on the dark style, so it counts as dark for the chip:
  // leaving the imagery from there lands on the map it was already wearing.
  const isDark = mapTheme !== 'light';

  const toggles = [
    {
      key: 'theme',
      // The chip shows the theme you are in, and switching is the other one.
      icon: isDark ? <Moon size={ICON_SIZE} /> : <Sun size={ICON_SIZE} />,
      label: `Switch to ${isDark ? 'light' : 'dark'} map`,
      active: isDark,
      toggle: () => setMapTheme(isDark ? 'light' : 'dark'),
    },
    // Aerial imagery is a third basemap rather than a fourth theme, and it
    // gets its own chip rather than a third stop on the theme chip: one button
    // cycling three maps hides two of them behind a guess. Switching it off
    // lands on the dark map the photo was drawn over.
    ...(satelliteAvailable ? [{
      key: 'satellite',
      icon: <Satellite size={ICON_SIZE} />,
      label: `${isSatellite ? 'Hide' : 'Show'} aerial imagery`,
      active: isSatellite,
      toggle: () => setMapTheme(isSatellite ? 'dark' : 'satellite'),
    }] : []),
    // An overlay, not a basemap: rain draws over whichever map is showing.
    {
      key: 'rain',
      icon: <CloudRain size={ICON_SIZE} />,
      label: `${showRainRadar ? 'Hide' : 'Show'} rain radar`,
      active: showRainRadar,
      toggle: () => setShowRainRadar(!showRainRadar),
    },
    {
      key: 'routes',
      icon: <Route size={ICON_SIZE} />,
      label: `${showRoutes ? 'Hide' : 'Show'} route lines`,
      active: showRoutes,
      toggle: () => setShowRoutes(!showRoutes),
    },
    {
      key: '3d',
      icon: <Box size={ICON_SIZE} />,
      label: `${is3D ? 'Disable' : 'Enable'} 3D map`,
      active: is3D,
      toggle: () => setIs3D(!is3D),
    },
    {
      key: '3d-vehicles',
      icon: <TramFront size={ICON_SIZE} />,
      label: 'Always show 3D vehicles, including on the flat map',
      active: always3DVehicles,
      toggle: () => setAlways3DVehicles(!always3DVehicles),
    },
  ];

  return (
    <CornerToggleGroup
      side="left"
      className="view-toggles"
      label="Map view settings"
      storageKey="viewTogglesCollapsed"
      icon={<Layers size={ICON_SIZE} />}
      hidden={hidden}
    >
      {toggles.map((t) => (
        <button
          key={t.key}
          type="button"
          className={`corner-toggle ${t.active ? 'active' : ''}`}
          onClick={t.toggle}
          aria-pressed={t.active}
          aria-label={t.label}
          title={t.label}
          style={
            t.active
              ? {
                  color: VIEW_ACCENT,
                  borderColor: VIEW_ACCENT,
                  background: `${VIEW_ACCENT}26`,
                }
              : undefined
          }
        >
          {t.icon}
        </button>
      ))}
    </CornerToggleGroup>
  );
};
