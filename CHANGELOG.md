# HSL-LIVE Changelog

All notable changes to this project will be documented in this file.

## [v0.28.0] - 2026-06-16

### Added
- **Selected-Vehicle Diagnostics & Telemetry Dashboard**: Introduced a premium, multi-tab layout (`Telemetry`, `Schedule`, and `Diagnostics`) inside the selected vehicle sidebar details panel ([TramPopup.tsx](file:///c:/Antigravity/ratikka/frontend/src/components/TramPopup.tsx)).
- **Animated 2D Vehicle Schematic**: Created interactive 2D vector layouts for both trams (3 door pairs) and buses (2 door pairs). Visualizes live doors opening/closing (`drst`), blinking passenger boarding indicators, and spinning wheels at speeds proportional to vehicle velocity.
- **Arc Speedometer & Brake/Acceleration Gauges**: Developed custom SVG speedometer and schedule deviation dials, along with a bidirectional accelerometer bar that dynamically updates to show cruising, positive acceleration, or active braking (G-force).
- **Expanded Live Telemetry API Parsing**: Updated Go backend ingestion worker ([ingestion.go](file:///c:/Antigravity/ratikka/backend/internal/mqtt/ingestion.go)) to parse raw HSL HFP v2 MQTT parameters (`odo` odometer, `loc` coordinates tracking source, `oper` operator registry ID, `jrn` journey ID, `occu` passenger occupancy percentage, `dir` schedule direction ID, `oday` operating day, and `start` planned departure time).

---

## [v0.27.0] - 2026-06-16

### Added
- **Self-Location (GPS)**: Integrated a Geolocate Control button in the bottom-right corner of the map. This allows mobile and desktop users to locate themselves, display a GPS marker on the map, and automatically track and center the view. The geolocation control button inherits the application's glassmorphic dark theme styles.

### Changed
- **Filter Panel Alignment**: Updated the left side filter panel height to `calc(100vh - 160px)`. Combined with the `80px` top positioning, this leaves an equal `80px` margin at the top and bottom of the viewport for vertical symmetry.

---

## [v0.26.3] - 2026-06-16

### Fixed
- **Layout Jitter**: Allocated a fixed-size container for the acceleration indicator in the top telemetry card, preventing constant resizing and layout shifts when vehicles fluctuate between cruising and active acceleration/braking.
- **Direction Markers Visibility**: Enhanced heading indicator arrows for both trams and buses on the map and top telemetry card. Added double-stroking (white inner outline, dark outer boundary) and dynamic vehicle-mode coloring (green for trams, blue for buses) for better contrast against green parkland/forest maps.
- **Next Stop Calculation**: Refactored the `getStopIndices` helper function in both `TramCard` and `TramPopup` to correctly treat the GTFS stop telemetry field as the upcoming next stop rather than the last passed stop when the vehicle is moving. Fixed rendering behavior when moving towards the very first stop of a journey.
- **Filter Panel Constraints**: Refactored the left-side filter panel to use 2 columns instead of 3, widening the label buttons. Set a fixed height (`calc(100vh - 96px)`) so that it doesn't stretch or shift vertically when bus lines are loaded.

---

## [v0.25.0] - 2026-06-15

### Added
- **Acceleration Telemetry**: Parsed and displayed live vehicle acceleration/deceleration on the top telemetry card using Paho MQTT ingestion.

### Fixed
- **Relative ETAs**: Changed top telemetry display card to show relative ETA minutes (e.g., "now", "3 min") instead of static clock times for better readability.
- **Next Stop Resolution**: Resolved next stop coordinates using the full GTFS schedule timeline logic rather than local geometry estimations.
- **Next Stop Visuals**: Redesigned next stop highlight visibility with a glowing neon coral-red color and custom MapLibre vector circles.

---

## [v0.24.0] - 2026-06-12

### Added
- **60fps Map Highlights**: Enabled high-performance, smooth 60fps rendering of highlights for selected stops, city bike stations, next stops, and active routing path segments.
- **Light/Dark Custom 3D Buildings**: Custom 3D building extrusion filters to cleanly toggle building visibilities depending on dark/light map themes.
