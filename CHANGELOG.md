# HSL-LIVE Changelog

All notable changes to this project will be documented in this file.

## [v0.44.3] - 2026-07-21

### Fixed
- **Tram icon did not indicate when it was stopped**: the per-frame vehicle features carried a computed `stopped` flag (doors open or speed 0) and the filter-panel legend advertised a coral "Stopped" state, but no map layer ever consumed it. The only stop-related cues were the amber door-pulse (doors open) and the motion aura *fading to nothing* at a standstill — so a tram halted with its doors shut (waiting at a light, stuck in traffic, sitting at a terminus) had no positive indicator and read the same as one crawling slowly. Added a `trams-stopped` layer that draws a static coral (`#e17055`) ring under any stopped vehicle, matching the legend swatch, and collapses to nothing the moment it starts moving.

## [v0.44.2] - 2026-07-21

### Changed
- **Disabled the next-stop route highlight**: the gold line segment drawn from a selected vehicle to its next stop (`next-stop-route-layer`) is turned off behind the `HIGHLIGHT_NEXT_STOP_ROUTE` flag in `Map.tsx`. It relied on closest-point matching against the trip polyline, which produced unreliable back-tracking/jumping paths. The next-stop signpost highlight itself is unchanged and still shown.

---

## [v0.44.1] - 2026-07-21

### Changed
- **Route network is always on and driven by the line filter**: removed the Settings "Routes" toggle. The route network is now shown by default — all routes are visible whenever no line filter is active — and selecting one or more lines narrows the map to just those routes (drawn in their per-line palette colours). This makes the network behave like "Show All": there is no separate on/off switch to get out of sync with the filter. Tram vs bus routes still follow the **Trams**/**Buses** mode toggles.

### Fixed
- **Route network invisible in dark theme**: with the network shown by default, it previously still drew nothing while the map was in dark mode. The HSL background route network (the JORE `routes` vector source and its tram/bus/light-rail/trunk line layers) was defined only in the light-theme `style.json`; the dark theme loads Carto's dark-matter basemap, which has neither, so no route colours appeared. The map now recreates that source and those layers whenever the base style lacks them, so the route network — green trams, blue buses, teal light rail, orange trunk — is drawn in both themes.

---

## [v0.44.0] - 2026-07-21

### Changed
- **Routes network follows the mode toggles**: the settings "Routes" toggle now draws only the tram and bus route network — tram routes appear when **Trams** is enabled and bus/trunk routes appear when **Buses** is enabled, instead of always showing every mode (rail, subway, ferry are no longer drawn as background routes). The network keeps HSL's mode colours (green trams, blue buses) rather than the per-line palette. The toggle now also defaults to **on**, so the tram route network is visible on first load.

---

## [v0.43.1] - 2026-07-21

### Fixed
- **Production-Readiness Audit**: A full sweep of the Go backend and React frontend for release, fixing every error-level lint finding and a set of real runtime defects found by review:
  - **Backend — WebSocket hub**: replaced the unbuffered register/unregister channels with mutex-guarded map operations. Previously, once the hub loop stopped at shutdown, every connected client's handler goroutine blocked forever on unregister (a permanent goroutine leak), and clients whose 16-message send buffer stayed full were skipped forever but never disconnected — they are now dropped with a `slow consumer` close.
  - **Backend — alerts endpoint**: no longer holds a write mutex across the upstream GraphQL round-trip (up to 10s), which serialized *all* concurrent alert requests behind one fetch. Alerts now use the same singleflight + response-cache pattern as the other endpoints.
  - **Backend — hardening**: the in-memory response cache now evicts expired entries (previously unbounded growth from distinct geocode/plan keys); `http.Server` gained `ReadHeaderTimeout`/`IdleTimeout` (slowloris guard); the `.env` loader no longer prints secret values into logs; the `?departures=` parameter is capped at 50; vehicles reporting a missing HFP timestamp are no longer purged as stale on the next sweep; removed the stray `backend/query_trip.go` debug script. `/api/v1/config` can now serve a dedicated `DIGITRANSIT_MAP_API_KEY` to browsers so the server-side routing key can stay private.
  - **Frontend — map**: layer click/hover handlers were re-registered on every theme change and never removed, so after N theme toggles a single tap fired N+1 selection events — they now bind once per map instance. The two bus-stop layer filters used `'and'`, which is not a MapLibre expression operator, and are corrected to `'all'`. Deferred SVG `onload` callbacks no longer touch a removed map, and the 60fps interpolation loop now survives a thrown frame instead of freezing every vehicle for the rest of the session.
  - **Frontend — stale-response races**: stop, bike-station, and route-geometry fetches now ignore responses that arrive after the selection has changed, so a slow response can no longer show the wrong stop's timetable, the wrong station's capacity, or re-draw a deselected line's route.
  - **Frontend — resilience**: all `localStorage` access goes through guarded helpers (Safari Private Browsing / blocked-storage no longer crashes the app) and the app is wrapped in an error boundary with a reload fallback instead of white-screening on an unexpected error. Removed leftover `console.log` noise; `eslint` and `tsc` now pass with zero errors.

---

## [v0.43.0] - 2026-07-21

### Added
- **Per-Route Colour Palette**: Every tram rendered in the same HSL green because HSL colours vehicles by *mode*, not by line — both the GTFS `route.color` field and the JORE vector tiles return one shared green for the whole tram network, so line 4 was indistinguishable from line 9 at a glance. Introduced a curated palette (`lib/routeColors.ts`) that assigns each Helsinki tram line (incl. the line 15 Raide-Jokeri light rail) its own visually distinct colour, with a deterministic hash fallback so any unlisted or new line still gets a stable, unique hue instead of the ambiguous mode green.
  - **On the map**: each moving tram's carriage is now tinted by its line colour (line-specific body images, open/closed door variants), and a highlighted/selected route's path is drawn in that same colour instead of green.
  - **In the UI**: line-number badges are tinted per route across the vehicle card, the detail popup header, the stop popup's "lines serving" chips and departure badges, the filter panel's line chips, and route badges in service alerts — turning the filter grid into a colour legend for the network.
  - Buses keep their mode blue; the palette is documented and centralised so colours stay consistent everywhere a line number appears.

---

## [v0.42.1] - 2026-07-21

### Changed
- **Larger On-Map Vehicle Icons**: The redesigned tram/bus carriage markers rendered a touch small and were easy to lose against the basemap. Bumped the vehicle body's zoom-based `icon-size` (~30% larger across zooms) and scaled the upright line-number label and the selection ring to match, so vehicles read clearly at a glance without crowding each other.

---

## [v0.42.0] - 2026-07-21

### Changed
- **Redesigned Vehicle Markers with Motion & Door Animation**: Live trams and buses were a plain coloured dot with a separate rotating arrow, and the only motion cue was a linear slide between the ~1s position updates — nothing conveyed how fast a vehicle was going, whether it was speeding up or braking, or that it was letting passengers on. Each vehicle is now a small directional carriage: a rounded body with a windshield and nose nub that rotates to its heading (sleek green for trams, boxier blue for buses), with the line number sitting upright on top.
  - **Speed & acceleration**: a soft aura beneath each vehicle grows with its speed and is tinted by acceleration — green while pulling away, red while braking, mode-neutral while cruising — fading to nothing at a standstill. Position interpolation is now acceleration-shaped (`easeByAccel`), so a marker visibly eases out as it rolls into a stop and eases in as it pulls away, instead of gliding at a constant rate.
  - **Doors opening**: while a vehicle's doors are open (`drst === 1`) the body swaps to a variant with amber door gaps and an amber "boarding" ring expands and fades on a ~1.5s loop. Both the door pulse and the aura animate off the existing 60fps interpolation loop via data-driven paint (no extra timers).
  - Added tested `clamp`, `smoothstep` and `easeByAccel` easing helpers to `lib/lerp.ts`.

---

## [v0.41.2] - 2026-07-21

### Changed
- **CHANGELOG Drives the Release Version**: The deployed version and the changelog could drift because the release tag was auto-bumped from conventional-commit prefixes while the `## [vX.Y.Z]` heading was written by hand — a mismatched guess (e.g. a `fix:` commit under a minor-bump heading) shipped a version the changelog never named, and docs-only pushes minted entry-less tags. CI now reads the release version straight from the top `## [vX.Y.Z]` heading in `CHANGELOG.md`, tags the commit to match, and skips the build when that version is unchanged. The changelog heading is now the single source of truth, so the running version always equals the changelog's latest entry. Versioning/committing workflow docs updated to match.

---

## [v0.41.1] - 2026-07-21

### Fixed
- **On-Map Bike Availability Always Zero**: The city-bike markers read `bikesAvailable` straight from the Digitransit rental-station **vector tiles**, but those tiles carry no live availability — only station id, name and location. The count therefore always fell back to `0`, so every station showed "0" and was greyed out as if empty. The map now sources live counts from the realtime API instead of the tiles (see below), so availability is accurate again.

### Added
- **Live Bike Availability Gauge**: Replaced the plain gold dot + bare number with an at-a-glance availability gauge. Each station is a small donut whose coloured arc shows how full it is (bikes ÷ total docks) and whose colour flags scarcity — grey when empty, red when critically low, amber when middling, green when there are plenty — with the available-bike count in the centre once you're zoomed in enough to read it. Empty stations still read instantly from colour alone, even at the wide overview zoom where the number is hidden.
- **`GET /api/v1/bike-stations` Endpoint**: New backend proxy returning every HSL city-bike station with live bike/dock counts as a GeoJSON `FeatureCollection` (Digitransit key stays server-side, coalesced via `singleflight`, cached 20s). The map polls it every 30s and feeds it straight into a MapLibre source. Counts reuse the same resilient `total`/`byType` resolution as the station panel, so map and panel agree.

---

## [v0.41.0] - 2026-07-21

### Added
- **Changelog Link in Version Badge**: The version badge in the map's bottom-left corner is now a clickable link that opens the live changelog (GitHub Pages) in a new tab, so riders can jump straight from the running version to its release history. The badge keeps its existing appearance and hover affordance.

---

## [v0.40.1] - 2026-07-21

### Fixed
- **City Bike Free Docks Always Zero**: The station panel always showed "0 Free Docks" for every city bike station. The backend counted only `availableSpaces` entries whose vehicle form factor was `BICYCLE`, but HSL reports empty docks without a per-type breakdown (only a station-wide total), so the filter never matched and the count collapsed to zero. The backend now reads the authoritative `total` field, counts untyped docks alongside `BICYCLE` ones, and falls back to `total` when the per-type breakdown is absent. Available bikes used the same resilient path now.

---

## [v0.40.0] - 2026-07-21

### Added
- **Bike Availability on the Map**: City-bike station markers now show how many bikes are left directly on the map. Previously only the fully zoomed-in bike sign (zoom ≥ 15.5) carried a count; at the default zoom level (14) stations were just plain gold dots with no indication of availability. The mid-zoom circle markers were enlarged and now display the available-bike count as a label (fading in from zoom 13.5 so the wide overview stays clean), and stations with no bikes left are greyed out so an empty station reads at a glance even before the number is visible. Clicking the number opens the station panel, same as clicking the marker.

---

## [v0.39.0] - 2026-07-20

### Added
- **Journey Line Filtering**: Choosing a route in the "Where to?" destination search now restricts the map to the vehicles running on that journey's transit legs, mirroring how selecting a line filter narrows the map. Clearing the journey restores the full set of vehicles.

---

## [v0.38.1] - 2026-07-19

### Fixed
- **Collapsible Journey Planner on Mobile**: The expanded "Where to?" panel covered the whole map on mobile, and the only way out (the X) cleared the journey — so riders could never see the route they had just planned. Picking an itinerary now auto-collapses the planner to a compact top summary bar (route chips + duration), revealing the highlighted route and stops underneath; tapping the bar re-expands it, while the X still fully clears the journey. Added a minimize control to the expanded header (desktop too) and capped the expanded panel to 60dvh so the map peeks through even before collapsing.

---

## [v0.38.0] - 2026-07-19

### Added
- **Destination Journey Search**: A new top-center "Where to?" search lets riders pick a destination and instantly see the routes that get them there. The origin defaults to the device's current location (with a one-tap "Use current location" option and a manual origin field for when GPS is unavailable), destinations are found via a debounced geocoding autocomplete, and the planner returns ranked itineraries showing departure/arrival times, total duration, transfers, and a colour-coded leg-by-leg breakdown. The planner collapses to a compact summary bar (automatically on mobile once a route is picked) so the highlighted route on the map stays visible without losing the journey — closing it clears the journey.
- **On-Map Journey Highlighting**: Selecting an itinerary draws its legs on the map — solid route-coloured lines for transit legs, dashed grey for walking — with origin/destination markers and highlighted stops the rider would actually use: green for the boarding stop, coral for the final stop, gold for transfers, and small dots for intermediate stops. The camera fits the whole journey into view.
- **Backend Geocoding & Routing Proxies**: Added `GET /api/v1/geocode` (Digitransit Pelias place search, HSL-region constrained, 60s cache) and `GET /api/v1/plan` (Digitransit routing `plan` query, 20s cache), both proxied server-side so the Digitransit subscription key never reaches the browser. Requests are coalesced via `singleflight` and share the existing response cache.

---

## [v0.37.0] - 2026-07-19

### Added
- **Mobile Bottom-Sheet UI**: Replaced the desktop side-drawer layout (previously stretched onto small screens) with a mobile-first pattern. The filter panel and the vehicle/stop/bike detail panels become full-width bottom sheets (Google Maps/Transit style), and a new bottom tab bar (Map / Lines / Details) drives which sheet is expanded — only one at a time, so opening one collapses the other. Desktop layout and interactions are untouched; the behavior is gated entirely behind a `max-width: 768px` media query and a `useIsMobile()` hook.

---

## [v0.36.1] - 2026-07-19

### Fixed
- **Collapsed Sidebar Theme Leak**: The `.filter-panel.collapsed:hover` and `.detail-popup.collapsed:hover` rules hardcoded a dark background, overriding the theme-aware `var(--bg-panel)` inherited from `.glass-panel`. Since the collapsed peek strip is click-to-expand, hovering it in light theme flipped the sidebars to near-black on every open/close. Added a `--bg-panel-hover` design token to both theme blocks and pointed the hover rules at it; the dark theme keeps its previous colour.

---

## [v0.36.0] - 2026-07-18

### Added
- **Global Glass Peeking Layout**: Enforced the peeking sidebar collapsed style globally on all screen sizes, hiding the toggle buttons `.filter-toggle-tab` and `.detail-toggle-tab` globally.
- **Right Sidebar Peeking & Gestures**: Added right sidebar peek offset (16px) when collapsed, click-to-expand onClick support, touch swipe controls (swipe left to expand, swipe right to collapse), and a ChevronRight close header button on `TramPopup`, `StopPopup`, and `BikePopup`.

---

## [v0.35.2] - 2026-07-18

### Fixed
- **Legend Horizontal Alignment**: Changed the legend list items to align compactly side-by-side on the left using `justify-content: flex-start` and `gap: 12px`, removing the empty middle space.
- **Service Alerts Widget Spacing**: Wrapped the alerts widget in a conditional check so it completely disappears from the layout when there are no disruptions, fully reclaiming vertical sidebar space.

---

## [v0.35.1] - 2026-07-18

### Fixed
- **Changelog Alignment**: Aligned the changelog version entry headers to match the actual conventional tags generated by GitHub Actions CI/CD.

---

## [v0.35.0] - 2026-07-18

### Added
- **Compact Alerts Bar**: Hid the checkmark icon and the "OK" badge in clean state to dramatically reduce visual clutter and maximize vertical space in the sidebar.
- **Mobile Sidebar Collapsed Peek**: Hidden the toggle tab button on mobile. The sidebar now leaves a subtle 16px glass edge peeking out when collapsed, allowing users to intuitively click or swipe it out.
- **Swipe Gestures on Mobile**: Enabled touch gestures to swipe the sidebar open (swipe right) and closed (swipe left).
- **Mobile Close Header Chevron**: Added a clear collapse chevron inside the header on mobile when the panel is open.
- **Removed Irrelevant Legend Key**: Removed the "Next Stop" legend key to free up additional vertical space.

---

## [v0.34.0] - 2026-07-18

### Added
- **Dynamic Contextual Alert Filtering**: Sidebar Service Alerts now adapt dynamically to user map selections. Shows alerts only for the selected vehicle, selected stop (itself and all serving routes), or checked line filters.
- **Noise-Free Global Announcement Fallback**: If no selection or filter is active, the sidebar feed displays *only* general/system-wide announcements (e.g. weather delays, network strikes) that affect all lines, filtering out minor line-specific alerts.
- **Positive Status indicators**: Shows clean states like `Line 9 is clear` or `All systems normal` to reassure users of clear service statuses.

---

## [v0.33.2] - 2026-07-13

### Fixed
- **Next Stop ETA and Highlighting**: Resolved bug where previous stops were highlighted or shown as next stops when the vehicle was moving.
- **Map & UI State Sync**: Unified next stop index resolution logic across `Map.tsx`, `TramCard.tsx`, and `TramPopup.tsx` so highlighted route segments always match the information overlays.
- **Premature Next Stop Jumps**: Prevented next stop indicators from jumping to the subsequent stop prematurely when the vehicle is entering/arriving at a stop before doors open.

---

## [v0.33.1] - 2026-07-13

### Fixed
- **Changelog Sync**: Aligned conventional tag versions with release logs.

---

## [v0.33.0] - 2026-07-13

### Added
- **API Request Coalescing (Singleflight)**: Integrated Go's `singleflight.Group` to merge concurrent queries for the same Route, Trip, Stop, or Bike Station into a single upstream Digitransit GraphQL API request.
- **Thread-Safe In-Memory Response Caching**: Added a backend cache with custom TTLs: 1 hour for Route Details (static geometries and stop lists), 10 seconds for Trip and Stop timetables, and 15 seconds for Bike Stations.

### Changed
- **Lifting State Up (Fetch Deduplication)**: Lifted the `selectedTripDetails` fetch logic and state up to `App.tsx`, sharing it via props across `Map.tsx`, `TramCard.tsx`, and `TramPopup.tsx` to eliminate redundant concurrent HTTP requests on vehicle selection.

---

## [v0.32.0] - 2026-07-13

### Added
- **HSL Service Disruption Alerts**: Integrated real-time service disruptions from Digitransit's Routing API.
- **Normalized Multi-lingual Caching**: Added server-side caching (60s TTL) in Go backend keyed by `Accept-Language` headers (`fi`, `sv`, `en`) to prevent API rate limiting while maintaining localized alert messages.
- **Sidebar Alerts Feed**: Implemented a collapsible, interactive Service Alerts feed inside the left `FilterPanel` listing active alerts with severity-colored left borders (INFO, WARNING, SEVERE), affected routes, and stops.
- **Context-Aware Timetable Warnings**: Highlighted specific service disruptions inside `TramPopup` and `StopPopup` if they affect the selected transit vehicle line or the stop timetable.

---

## [v0.31.0] - 2026-07-13

### Fixed
- **Verbose Ingestion Logging**: Commented out verbose MQTT ingestion log output to clean up server console logs.

---

## [v0.30.0] - 2026-06-17

### Added
- **Traffic Sign Pole Map Symbols**: Replaced standard circular dots for tram, standard bus, and trunk bus stops with custom sign-on-a-pole traffic sign symbols when zoomed in (zoom >= 15.5) on the map ([Map.tsx](file:///c:/Antigravity/ratikka/frontend/src/components/Map.tsx)).
- **Dynamic City Bike Counts & Bubble Overlay**: Rendered city bike stations on a pole with a yellow bicycle sign, plus a dynamic green overlay bubble showing the live number of available bikes (`bikesAvailable`) at the top right of the station circle.
- **Interpolated Selection Highlight Translation**: Implemented zoom-based `'circle-translate'` interpolation for stops and city bike selection halo highlights, dynamically shifting the halos upwards by 28px as the map zooms in to frame the sign boards.

---

## [v0.29.2] - 2026-06-17

### Fixed
- **Mobile Viewport & Navigation Bar Overlaps**: Implemented dynamic viewport height rules (`100dvh` / `calc(100dvh - ...)`) across all main layout panels and lists. Configured safe-area bottom insets and mobile-specific offsets for MapLibre map control buttons and the version badge to prevent them from being obstructed by Android OS virtual navigation buttons or iOS Home indicators.

---

## [v0.29.1] - 2026-06-16

### Fixed
- **Legend Layout Overflow**: Repositioned and resized the Legend items (`Moving`, `Stopped`, `Next Stop`) in the left sidebar filter panel to fit horizontally on a single line. Scaled down indicator dots and text sizes to prevent vertical wrapping and overlap with the settings section.

---

## [v0.29.0] - 2026-06-16

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
