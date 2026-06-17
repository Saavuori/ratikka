# Map Features & Styling Guide

This guide describes how the MapLibre GL map, vector tiles, stops, and vehicles are structured, styled, and filtered in [Map.tsx](file:///c:/Antigravity/ratikka/frontend/src/components/Map.tsx). Refer to this documentation when debugging or extending map behaviors.

---

## 1. Vector Tiles & Stop ID Coalescing
The map loads vector tiles containing transit stops from different providers depending on the theme:
- **Light Theme**: HSL JORE tile server (`kartat.hsl.fi/jore/tiles/stops/...`).
- **Dark Theme**: Digitransit tile server (`api.digitransit.fi/map/v3/...`).

### Critical ID Mapping
Because of schema differences between JORE and Digitransit, features store the stop ID in different property names. Always resolve stop IDs using this comprehensive `coalesce` expression list:
```typescript
['coalesce', ['get', 'gtfsId'], ['get', 'stopId'], ['get', 'id'], ['id'], '']
```

---

## 2. Dynamic Route & Stops Filtering
When routes are filtered in the sidebar, stop markers on the map must filter dynamically to show only the stops belonging to those routes.

### MapLibre Expression Constraints
1. **Never use `match` for array-membership**: MapLibre's `match` expression compiler does not allow arrays (e.g. `['literal', allowedStopIds]`) in its branch label positions, throwing a compile-time `Branch labels must be numbers or strings` error in the browser console.
2. **Use `in` and `==` instead**:
   - Check if a value is contained in a dynamic array using `in`:
     ```typescript
     ['in', input_value, ['literal', array_variable]]
     ```
   - Check simple equality using `==`:
     ```typescript
     ['==', ['get', 'mode'], 'TRAM']
     ```
3. **TypeScript Typings**: Dynamic or complex expressions passed as layer filters must be cast `as any` to prevent build failures against strict MapLibre definitions.
4. **Selected Stop Exclusion**:
   - The active selected stop is excluded from the main stop layers to prevent duplicate overlaps. 
   - Ensure the exclusion filter (`excludeSelectedStopFilter`) defaults to `['literal', true]` when no stop is selected. Do NOT evaluate empty arrays inside the filter, as it will hide all stops from the map.

---

## 3. Stop Markers Styling Rules
Stops have two distinct representation modes depending on the camera zoom:

### Zoom < 15.5 (Zoomed Out)
* Stops render as solid, full-color circles (`stops_tram`, `stops_bus`, `stops_trunk`).
* All bus stops (including trunk bus stops) must be colored blue (`#007ac9`) to avoid orange/red warning tones.
* All hub and casing layers (`stops_case`, `stops_hub`, etc.) are hidden to prevent default white outlines.
* Between zoom `15.0` and `15.5`, circle-opacity fades out to `0.0`.

### Zoom >= 15.5 (Zoomed In)
* Circle layers are completely invisible.
* Custom pole-and-sign symbol icons are rendered (layer: `stops_signs`).
  - Tram: `sign-tram`
  - Bus/Trunk Bus: `sign-bus` (blue)

### Selected Stop Highlight
* The selected stop is rendered from a dedicated GeoJSON source `selected-stop-source` (layer: `selected-stop-icon`).
* It is always rendered as a gold-bordered symbol icon (`sign-tram-selected` or `sign-bus-selected`) at **all zoom levels**.
* Its icon size scales dynamically to remain clearly visible:
  ```typescript
  'icon-size': [
    'interpolate',
    ['linear'],
    ['zoom'],
    10, 0.5,
    14, 0.8,
    16, 1.0,
    20, 1.5
  ]
  ```

---

## 4. Vehicles & Next-Stop Routing
* Live vehicle positions are animated at 60fps in `startAnimationLoop()` by linear-interpolating (lerp) coordinates and heading (hdg) between update ticks.
* When a vehicle is selected:
  1. A route path segment connecting the vehicle's position to its next upcoming stop is calculated.
  2. The path is rendered in yellow/gold (`#fdcb6e`) via `next-stop-route-layer` to match selected stop highlights (avoiding red warning colors).
  3. The next stop is highlighted in gold-bordered signpost style (layer: `next-stop-icon`) at all zoom levels, mirroring the selected stop practice.
