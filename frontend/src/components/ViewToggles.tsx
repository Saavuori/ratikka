import React from 'react';
import { Sun, Moon, Box, Route } from 'lucide-react';

interface ViewTogglesProps {
  mapTheme: 'light' | 'dark';
  setMapTheme: (theme: 'light' | 'dark') => void;
  is3D: boolean;
  setIs3D: (is3D: boolean) => void;
  showRoutes: boolean;
  setShowRoutes: (show: boolean) => void;
}

const ICON_SIZE = 16;

/** The accent the view chips light up with when they are on. */
const VIEW_ACCENT = '#34d399';

/**
 * Floating corner shortcut for the three map-view switches — light/dark
 * basemap, route lines on/off, and 2D/3D pitch. It mirrors ModeToggles on the
 * opposite corner, and together
 * the two rows carry everything the old settings section held, which is why
 * that section (and the mobile "Settings" sheet behind it) is gone.
 */
export const ViewToggles: React.FC<ViewTogglesProps> = ({
  mapTheme,
  setMapTheme,
  is3D,
  setIs3D,
  showRoutes,
  setShowRoutes,
}) => {
  const isDark = mapTheme === 'dark';

  const toggles = [
    {
      key: 'theme',
      // The chip shows the theme you are in, and switching is the other one.
      icon: isDark ? <Moon size={ICON_SIZE} /> : <Sun size={ICON_SIZE} />,
      label: `Switch to ${isDark ? 'light' : 'dark'} map`,
      active: isDark,
      toggle: () => setMapTheme(isDark ? 'light' : 'dark'),
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
  ];

  return (
    <div className="corner-toggles view-toggles" role="group" aria-label="Map view">
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
    </div>
  );
};
