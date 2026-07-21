# Tram & Bus Icons and Animations

This document catalogues every tram- and bus-related **icon** and **animation** in
the frontend, where each one lives, what drives it, and the exact source that
produces it. It complements [.agents/workflows/map-features.md](../.agents/workflows/map-features.md),
which covers the broader map-layer architecture.

Two families of visuals are described here:

1. **Map symbols** — SVG images registered with MapLibre and drawn as `symbol`/`circle`
   layers on the live map ([`frontend/src/components/Map.tsx`](../frontend/src/components/Map.tsx)).
2. **Panel graphics** — the animated vehicle schematic, gauges, and inline glyphs
   rendered in React for the selected-vehicle sidebar and info card
   ([`TramPopup.tsx`](../frontend/src/components/TramPopup.tsx),
   [`TramCard.tsx`](../frontend/src/components/TramCard.tsx),
   [`FilterPanel.tsx`](../frontend/src/components/FilterPanel.tsx)).

All colours reference the per-line palette in
[`frontend/src/lib/routeColors.ts`](../frontend/src/lib/routeColors.ts) and the HSL
mode colours: tram green `#00985f`, bus blue `#007ac9`, trunk-bus orange `#CA4300`,
selection gold `#fdcb6e`, boarding amber `#ffb020`, stopped coral `#e17055`.

---

## Table of Contents

1. [Map Vehicle Icons](#1-map-vehicle-icons)
   - [Tram carriage body](#tram-carriage-body)
   - [Bus carriage body](#bus-carriage-body)
   - [Per-line tinting & doors-open variants](#per-line-tinting--doors-open-variants)
   - [Selection ring](#selection-ring)
2. [Map Stop-Sign Icons](#2-map-stop-sign-icons)
   - [Tram sign](#tram-sign)
   - [Bus sign](#bus-sign)
   - [Trunk-bus sign](#trunk-bus-sign)
   - [Selected / next-stop gold variants](#selected--next-stop-gold-variants)
3. [Map Vehicle Animations](#3-map-vehicle-animations)
   - [60 fps position & heading interpolation](#60-fps-position--heading-interpolation)
   - [Motion aura](#motion-aura-trams-circles)
   - [Doors-open boarding pulse](#doors-open-boarding-pulse-trams-door-pulse)
   - [Stopped ring](#stopped-ring-trams-stopped)
   - [Doors-open body swap](#doors-open-body-swap)
   - [Chase / follow camera](#chase--follow-camera)
4. [Panel Vehicle Schematic & Animations](#4-panel-vehicle-schematic--animations)
   - [Tram schematic](#tram-schematic)
   - [Bus schematic](#bus-schematic)
   - [Spinning wheels](#spinning-wheels)
   - [Sliding doors & blinking indicators](#sliding-doors--blinking-indicator-lights)
   - [Speedometer & schedule-deviation dials](#speedometer--schedule-deviation-dials)
   - [Accelerometer bar](#accelerometer-bar)
5. [Inline Glyphs & Badges](#5-inline-glyphs--badges)
6. [Colour & State Reference](#6-colour--state-reference)

---

## 1. Map Vehicle Icons

Each live vehicle is drawn as a small top-down carriage rather than a bare dot, so
its **heading** reads at a glance (the icon rotates to the reported `hdg`). The SVGs
are generated in `setupCustomMapElements()` and registered with
`registerVehicleImage(name, svg)`, which rasterises the SVG at `pixelRatio: 2` (40 px
art shown at ~20 CSS px) so bodies stay crisp on retina displays.

```ts
const registerVehicleImage = (name: string, svg: string) => {
  if (map.hasImage(name)) return;
  const img = new Image(40, 40);
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  img.onload = () => {
    if (mapRef.current !== map) return;            // map may have unmounted
    if (!map.hasImage(name)) map.addImage(name, img, { pixelRatio: 2 });
  };
};
```

### Tram carriage body

A sleek rounded body (large corner radius) with a windshield band, a nose nub
pointing in the direction of travel, and a shadow strip. Tinted by the line colour
(`color`, default `TRAM_GREEN`); window/door/shadow accents stay neutral so any hue
reads cleanly. The `open` flag swaps the flush side windows for amber door gaps.

```ts
const tramBody = (open: boolean, color: string = TRAM_GREEN) => `
  <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40" fill="none">
    <path d="M20 3.2 L24 8.4 L16 8.4 Z" fill="${color}" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round"/>
    <rect x="12.5" y="7.5" width="15" height="26" rx="6.5" fill="${color}" stroke="#ffffff" stroke-width="2"/>
    <rect x="15" y="10" width="10" height="4.6" rx="2" fill="rgba(255,255,255,0.9)"/>
    ${open
      ? `<rect x="11.9" y="18.4" width="4.4" height="7.6" rx="1.3" fill="#ffb020" stroke="#ffffff" stroke-width="0.7"/>
         <rect x="23.7" y="18.4" width="4.4" height="7.6" rx="1.3" fill="#ffb020" stroke="#ffffff" stroke-width="0.7"/>`
      : `<rect x="14.7" y="17.5" width="4" height="9" rx="1.2" fill="rgba(0,0,0,0.4)"/>
         <rect x="21.3" y="17.5" width="4" height="9" rx="1.2" fill="rgba(0,0,0,0.4)"/>`}
    <rect x="15" y="29" width="10" height="3" rx="1.5" fill="rgba(0,0,0,0.3)"/>
  </svg>
`;
```

### Bus carriage body

A boxier body (small corner radius) in HSL bus blue `#0984e3`, with a lighter blue
windshield and darker `#08355c` accents.

```ts
const busBody = (open: boolean) => `
  <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40" fill="none">
    <path d="M20 3.2 L24.6 8.4 L15.4 8.4 Z" fill="#0984e3" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round"/>
    <rect x="12" y="7.5" width="16" height="26" rx="4" fill="#0984e3" stroke="#ffffff" stroke-width="2"/>
    <rect x="14.5" y="10" width="11" height="4.6" rx="1.5" fill="#dbeeff"/>
    ${open
      ? `<rect x="11.4" y="18.4" width="4.4" height="7.6" rx="1.1" fill="#ffb020" stroke="#ffffff" stroke-width="0.7"/>
         <rect x="24.2" y="18.4" width="4.4" height="7.6" rx="1.1" fill="#ffb020" stroke="#ffffff" stroke-width="0.7"/>`
      : `<rect x="14.3" y="17.5" width="4.2" height="9" rx="1.1" fill="#08355c" opacity="0.5"/>
         <rect x="21.5" y="17.5" width="4.2" height="9" rx="1.1" fill="#08355c" opacity="0.5"/>`}
    <rect x="14.5" y="29" width="11" height="3" rx="1.2" fill="#08355c" opacity="0.35"/>
  </svg>
`;
```

### Per-line tinting & doors-open variants

Because HSL colours all trams the same mode green, the app registers **one tinted
body per known line** (plus generic fallbacks) so routes are distinguishable on the
map. Each body also has a closed and an `-open` (amber door) variant:

```ts
// Generic (unknown-line) tram bodies fall back to HSL green.
registerVehicleImage('tram-body', tramBody(false));
registerVehicleImage('tram-body-open', tramBody(true));

// One tinted body per known line, e.g. tram-body-4, tram-body-4-open, ...
Object.entries(ROUTE_COLORS).forEach(([line, color]) => {
  registerVehicleImage(`tram-body-${line}`, tramBody(false, color));
  registerVehicleImage(`tram-body-${line}-open`, tramBody(true, color));
});

registerVehicleImage('bus-body', busBody(false));
registerVehicleImage('bus-body-open', busBody(true));
```

The `trams-body` symbol layer picks the right image per feature via a data
expression on `mode`, `doorsOpen`, and `desi`:

```ts
'icon-image': [
  'case',
  ['==', ['get', 'mode'], 'bus'],
  ['case', ['get', 'doorsOpen'], 'bus-body-open', 'bus-body'],
  ['get', 'doorsOpen'],
  ['match', ['get', 'desi'],
    ...Object.keys(ROUTE_COLORS).flatMap((l) => [l, `tram-body-${l}-open`]),
    'tram-body-open'],
  ['match', ['get', 'desi'],
    ...Object.keys(ROUTE_COLORS).flatMap((l) => [l, `tram-body-${l}`]),
    'tram-body'],
],
'icon-rotate': ['get', 'hdg'],
'icon-rotation-alignment': 'map',
'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 1.3, 14, 1.55, 17, 2.0],
```

### Selection ring

A gold circle registered as `tram-selected` (44×44). In practice the live selection
highlight is drawn by the `trams-selected-layer` **circle** layer (a translucent gold
fill with a `#fdcb6e` stroke, filtered to the selected `veh` id), but the image is
kept for symbol-based use:

```ts
const selectedSvg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44" fill="none">
    <circle cx="22" cy="22" r="18" stroke="#fdcb6e" stroke-width="4" fill="none"/>
  </svg>
`;
```

```ts
// trams-selected-layer — the live selection ring
paint: {
  'circle-radius': 20,
  'circle-color': 'rgba(253, 203, 110, 0.15)',
  'circle-stroke-color': '#fdcb6e',
  'circle-stroke-width': 3,
},
filter: ['==', ['get', 'veh'], selectedTramIdRef.current || ''],
```

---

## 2. Map Stop-Sign Icons

From zoom **15.5** the map swaps flat stop dots for sign-on-a-pole symbols
(`stops_signs` layer), colour-coded per mode. Each sign is a 32×42 SVG: a dark pole
and a coloured disc bearing a white tram/bus glyph.

### Tram sign

Green disc (`#00985f`) with a stylised tram front (windshield, headlights, and a
pantograph tick on the roof). Registered as `sign-tram`.

```ts
const tramSvg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="42" viewBox="0 0 32 42" fill="none">
    <line x1="16" y1="26" x2="16" y2="40" stroke="#111827" stroke-width="2.5" stroke-linecap="round"/>
    <circle cx="16" cy="14" r="11" fill="#00985f" stroke="#ffffff" stroke-width="2"/>
    <rect x="11.5" y="8" width="9" height="10" rx="1.5" fill="white"/>
    <rect x="12.5" y="9.5" width="7" height="3" fill="#00985f"/>
    <circle cx="13.5" cy="15.2" r="0.8" fill="#00985f"/>
    <circle cx="18.5" cy="15.2" r="0.8" fill="#00985f"/>
    <path d="M16,8 L16,5.5 M13.5,5.5 L18.5,5.5" stroke="white" stroke-width="0.8"/>
  </svg>
`;
```

### Bus sign

Blue disc (`#007ac9`) with a wider bus front (no pantograph). Registered as `sign-bus`.

```ts
const busSvg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="42" viewBox="0 0 32 42" fill="none">
    <line x1="16" y1="26" x2="16" y2="40" stroke="#111827" stroke-width="2.5" stroke-linecap="round"/>
    <circle cx="16" cy="14" r="11" fill="#007ac9" stroke="#ffffff" stroke-width="2"/>
    <rect x="10.5" y="9" width="11" height="9" rx="1.5" fill="white"/>
    <rect x="11.5" y="10.5" width="9" height="3" fill="#007ac9"/>
    <circle cx="12.5" cy="15.7" r="0.8" fill="#007ac9"/>
    <circle cx="19.5" cy="15.7" r="0.8" fill="#007ac9"/>
  </svg>
`;
```

### Trunk-bus sign

Identical to the bus sign but in trunk orange (`#CA4300`). Registered as
`sign-bus-trunk`.

```ts
const busTrunkSvg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="42" viewBox="0 0 32 42" fill="none">
    <line x1="16" y1="26" x2="16" y2="40" stroke="#111827" stroke-width="2.5" stroke-linecap="round"/>
    <circle cx="16" cy="14" r="11" fill="#CA4300" stroke="#ffffff" stroke-width="2"/>
    <rect x="10.5" y="9" width="11" height="9" rx="1.5" fill="white"/>
    <rect x="11.5" y="10.5" width="9" height="3" fill="#CA4300"/>
    <circle cx="12.5" cy="15.7" r="0.8" fill="#CA4300"/>
    <circle cx="19.5" cy="15.7" r="0.8" fill="#CA4300"/>
  </svg>
`;
```

The `stops_signs` layer chooses the sign per feature mode:

```ts
'icon-image': ['match', ['get', 'mode'], 'TRAM', 'sign-tram', 'BUS', 'sign-bus', 'sign-bus'],
'icon-anchor': 'bottom',
'icon-size': ['interpolate', ['linear'], ['zoom'], 15, 0.8, 20, 1.2],
```

### Selected / next-stop gold variants

The selected stop (`selected-stop-icon`) and a selected vehicle's next stop
(`next-stop-icon`) use gold-bordered variants — `sign-tram-selected`,
`sign-bus-selected`, `sign-bus-trunk-selected` — drawn at **all** zoom levels. They
are identical to the base signs except the disc stroke is selection gold `#fdcb6e`
at `stroke-width` 2.8. Example (tram):

```ts
const tramSelectedSvg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="42" viewBox="0 0 32 42" fill="none">
    <line x1="16" y1="26" x2="16" y2="40" stroke="#111827" stroke-width="2.5" stroke-linecap="round"/>
    <circle cx="16" cy="14" r="11" fill="#00985f" stroke="#fdcb6e" stroke-width="2.8"/>
    <rect x="11.5" y="8" width="9" height="10" rx="1.5" fill="white"/>
    <rect x="12.5" y="9.5" width="7" height="3" fill="#00985f"/>
    <circle cx="13.5" cy="15.2" r="0.8" fill="#00985f"/>
    <circle cx="18.5" cy="15.2" r="0.8" fill="#00985f"/>
    <path d="M16,8 L16,5.5 M13.5,5.5 L18.5,5.5" stroke="white" stroke-width="0.8"/>
  </svg>
`;
```

Both layers scale up as you zoom in so the highlight stays visible:

```ts
'icon-image': ['match', ['get', 'mode'],
  'TRAM', 'sign-tram-selected', 'BUS', 'sign-bus-selected', 'sign-bus-selected'],
'icon-anchor': 'bottom',
'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 14, 0.8, 16, 1.0, 20, 1.5],
```

---

## 3. Map Vehicle Animations

Every vehicle is a small **stack** of layers, all reading the `trams` GeoJSON
source. The tick loop in `startAnimationLoop()` rewrites each feature's properties
(`hdg`, `mode`, `spd`, `acc`, `speedNorm`, `doorsOpen`, `stopped`, `pulse`) every
animation frame, so the data-driven paint expressions below animate off a single
`requestAnimationFrame` loop with no per-marker timers.

Layer order (bottom → top): `trams-circles` (aura) → `trams-door-pulse` →
`trams-stopped` → `trams-body` → `trams-selected-layer` → `trams-labels`.

### 60 fps position & heading interpolation

HSL broadcasts each vehicle roughly once per second. Between snapshots the tick loop
interpolates position and heading so movement is smooth. Position is
**acceleration-shaped** (`easeByAccel`) so the marker eases *in* while pulling away
from a stop and eases *out* while braking; heading uses `smoothstep`. Helpers live in
[`frontend/src/lib/lerp.ts`](../frontend/src/lib/lerp.ts):

```ts
export function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

export function lerpAngle(start: number, end: number, t: number): number {
  let diff = (end - start) % 360;
  if (diff < -180) diff += 360;
  if (diff > 180) diff -= 360;
  return (start + diff * t + 360) % 360;
}

export function smoothstep(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

// Ease-in while accelerating (acc > 0), ease-out while braking (acc < 0),
// smoothstep while cruising. `acc` is m/s²; curve strength saturates so a single
// hard reading can't distort the whole second of travel.
export function easeByAccel(t: number, acc: number): number {
  const x = clamp(t, 0, 1);
  const DEADBAND = 0.15;
  if (acc > DEADBAND) {
    const k = 1 + clamp(acc / 1.5, 0, 1) * 0.9;
    return Math.pow(x, k);
  }
  if (acc < -DEADBAND) {
    const k = 1 + clamp(-acc / 1.5, 0, 1) * 0.9;
    return 1 - Math.pow(1 - x, k);
  }
  return smoothstep(x);
}
```

Per-frame usage in the tick loop:

```ts
const tPos = easeByAccel(t, acc);
const lat = lerp(prev.lat, target.lat, tPos);
const lng = lerp(prev.lng, target.lng, tPos);
const hdg = lerpAngle(prev.hdg, target.hdg, smoothstep(t));
```

### Motion aura (`trams-circles`)

A soft blurred glow under each vehicle that visualises how it is moving: it grows
with speed (`speedNorm`, where ~13 m/s ≈ 47 km/h caps it) and is tinted by
acceleration — green pulling away, red braking, mode-neutral cruising. At a
standstill it fades to nothing.

```ts
map.addLayer({
  id: 'trams-circles',
  type: 'circle',
  source: 'trams',
  paint: {
    'circle-radius': ['interpolate', ['linear'], ['get', 'speedNorm'], 0, 8, 1, 19],
    'circle-color': [
      'case',
      ['>', ['get', 'acc'], 0.35], '#22c55e',   // accelerating → green
      ['<', ['get', 'acc'], -0.35], '#ef4444',  // braking → red
      ['==', ['get', 'mode'], 'bus'], '#38bdf8',
      '#2dd4a7',                                 // tram cruising
    ],
    'circle-blur': 0.55,
    'circle-opacity': ['interpolate', ['linear'], ['get', 'speedNorm'], 0, 0.0, 0.12, 0.22, 1, 0.34],
  },
});
```

### Doors-open boarding pulse (`trams-door-pulse`)

An amber ring that expands and fades on a ~1.5 s loop while the doors are open
(`drst === 1`). It is driven by a shared `pulse` phase the tick loop writes onto
every feature each frame:

```ts
// In tickFrame(): one shared phase for every vehicle, ~1.5s period.
const doorPulse = 0.5 + 0.5 * Math.sin(now / 430);
// ... written onto each feature as `pulse: doorPulse`
```

```ts
map.addLayer({
  id: 'trams-door-pulse',
  type: 'circle',
  source: 'trams',
  paint: {
    'circle-radius': ['case', ['get', 'doorsOpen'],
      ['interpolate', ['linear'], ['get', 'pulse'], 0, 12, 1, 21], 0],
    'circle-color': '#ffb020',
    'circle-opacity': ['case', ['get', 'doorsOpen'],
      ['interpolate', ['linear'], ['get', 'pulse'], 0, 0.3, 1, 0.03], 0],
    'circle-stroke-color': '#ffb020',
    'circle-stroke-width': ['case', ['get', 'doorsOpen'], 1.6, 0],
    'circle-stroke-opacity': ['case', ['get', 'doorsOpen'],
      ['interpolate', ['linear'], ['get', 'pulse'], 0, 0.65, 1, 0.08], 0],
  },
});
```

### Stopped ring (`trams-stopped`)

A static coral (`#e17055`) ring marking a vehicle at a standstill
(`stopped = doorsOpen || spd === 0`). Because the motion aura fades to nothing at a
standstill, this supplies the positive "I'm stopped" cue for a halted vehicle (red
light, traffic, terminus) and matches the legend's coral swatch. It collapses to
radius/width 0 the moment the vehicle moves.

```ts
map.addLayer({
  id: 'trams-stopped',
  type: 'circle',
  source: 'trams',
  paint: {
    'circle-radius': ['case', ['get', 'stopped'], 13, 0],
    'circle-color': 'rgba(225, 112, 85, 0.14)',
    'circle-stroke-color': '#e17055',
    'circle-stroke-width': ['case', ['get', 'stopped'], 2, 0],
    'circle-stroke-opacity': ['case', ['get', 'stopped'], 0.9, 0],
    'circle-opacity': ['case', ['get', 'stopped'], 1, 0],
  },
});
```

### Doors-open body swap

The `trams-body` layer swaps to the `-open` art (amber door gaps) whenever
`doorsOpen` is true — see the `icon-image` expression in
[Per-line tinting & doors-open variants](#per-line-tinting--doors-open-variants).
This runs off the same `drst` flag that drives the door pulse, so the body art and
the pulse ring open together.

### Chase / follow camera

When Follow (chase mode) is active for a selected vehicle, the camera `jumpTo`s the
vehicle's interpolated position every frame and rotates the map bearing to match the
vehicle's heading, so it stays centred and pointing "up-track". It releases the
instant the user drags the map (`isInteractingRef`).

```ts
if (isFollowingRef.current && selectedTramIdRef.current) {
  const activeFeature = features.find((f) => f.properties.veh === selectedTramIdRef.current);
  if (activeFeature && !isInteractingRef.current) {
    const [lng, lat] = activeFeature.geometry.coordinates;
    const hdg = activeFeature.properties.hdg;
    map.jumpTo({ center: [lng, lat], bearing: hdg });
  }
}
```

---

## 4. Panel Vehicle Schematic & Animations

Selecting a vehicle opens the Telemetry tab in
[`TramPopup.tsx`](../frontend/src/components/TramPopup.tsx), whose header card shows a
live 2-D side-on schematic: mode-accurate door count (3 door pairs for trams, 2 for
buses), doors that slide open from the live `drst` flag, indicator lights that blink
while boarding, and wheels that spin at a rate proportional to velocity. The
animations are defined with keyframes injected locally by the component:

```tsx
<style dangerouslySetInnerHTML={{ __html: `
  @keyframes spin-wheels {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  @keyframes blink-light {
    0%, 100% { opacity: 1; filter: drop-shadow(0 0 5px #00b894); }
    50% { opacity: 0.2; filter: none; }
  }
  .rotating-wheel {
    transform-origin: center;
    animation: spin-wheels var(--wheel-speed, 1s) linear infinite;
  }
  .blinking-door-light { animation: blink-light 0.8s infinite; }
  .door-leaf-left  { transition: transform 0.5s cubic-bezier(0.4, 0, 0.2, 1); }
  .door-leaf-right { transition: transform 0.5s cubic-bezier(0.4, 0, 0.2, 1); }
` }} />
```

Live state is derived from the vehicle telemetry:

```ts
const speedKmh = Math.round(tram.spd * 3.6);
const isDoorsOpen = tram.drst === 1;
const isMoving = speedKmh > 0;
// Wheel rotation period: faster vehicle → shorter period (clamped at 0.1s).
const wheelSpeedCss = isMoving ? `${Math.max(0.1, 3.6 / tram.spd)}s` : '0s';
```

### Tram schematic

A rounded green (`#00b894`) body with a windshield at each end and **three** door
pairs, four spinning wheels, and three indicator lights.

```tsx
<svg width="220" height="70" viewBox="0 0 220 70" fill="none">
  <line x1="10" y1="58" x2="210" y2="58" stroke="rgba(255,255,255,0.08)" strokeWidth="2" strokeDasharray="4 4"/>
  <rect x="20" y="15" width="180" height="36" rx="6" fill="rgba(30, 41, 59, 0.4)" stroke="#00b894" strokeWidth="2"/>
  <path d="M20,20 L30,20 L30,35 L20,35 Z" fill="rgba(56, 189, 248, 0.15)" stroke="#38bdf8" strokeWidth="1"/>
  <path d="M200,20 L190,20 L190,35 L200,35 Z" fill="rgba(56, 189, 248, 0.15)" stroke="#38bdf8" strokeWidth="1"/>

  {/* Door Set 1 (of 3) — leaves slide apart when doors open */}
  <rect className="door-leaf-left"  style={{ transform: isDoorsOpen ? 'translateX(-5px)' : 'none', transformOrigin: '58px 15px' }} x="58" y="20" width="6" height="31" fill="#475569" stroke="#1e293b" strokeWidth="1"/>
  <rect className="door-leaf-right" style={{ transform: isDoorsOpen ? 'translateX(5px)'  : 'none', transformOrigin: '64px 15px' }} x="64" y="20" width="6" height="31" fill="#475569" stroke="#1e293b" strokeWidth="1"/>
  {/* ...Door Sets 2 & 3 at x=108/114 and x=158/164... */}

  {/* Indicator lights — green + blinking while boarding, else static red */}
  <circle cx="64"  cy="11" r="3" fill={isDoorsOpen ? '#34d399' : '#f87171'} className={isDoorsOpen ? 'blinking-door-light' : ''}/>
  <circle cx="114" cy="11" r="3" fill={isDoorsOpen ? '#34d399' : '#f87171'} className={isDoorsOpen ? 'blinking-door-light' : ''}/>
  <circle cx="164" cy="11" r="3" fill={isDoorsOpen ? '#34d399' : '#f87171'} className={isDoorsOpen ? 'blinking-door-light' : ''}/>

  {/* Spinning wheels — four bogies, each spins while moving */}
  <g className={isMoving ? 'rotating-wheel' : ''} style={{ '--wheel-speed': wheelSpeedCss, transformOrigin: '45px 54px' } as React.CSSProperties}>
    <circle cx="45" cy="54" r="6" fill="#1e293b" stroke="#64748b" strokeWidth="2"/>
    <circle cx="45" cy="54" r="6" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="0.8" strokeDasharray="2,2"/>
    <circle cx="45" cy="54" r="2" fill="#94a3b8"/>
  </g>
  {/* ...three more wheels at x=95, 145, 175... */}
</svg>
```

### Bus schematic

A boxier blue (`#0984e3`) body with a single front windshield and **two** door pairs
over **two** larger rubber tyres.

```tsx
<svg width="220" height="70" viewBox="0 0 220 70" fill="none">
  <line x1="10" y1="58" x2="210" y2="58" stroke="rgba(255,255,255,0.08)" strokeWidth="2" strokeDasharray="4 4"/>
  <rect x="25" y="15" width="170" height="36" rx="3" fill="rgba(30, 41, 59, 0.4)" stroke="#0984e3" strokeWidth="2"/>
  <path d="M25,20 L35,20 L35,35 L25,35 Z" fill="rgba(56, 189, 248, 0.15)" stroke="#38bdf8" strokeWidth="1"/>

  {/* Front + rear door leaves (2 pairs) */}
  <rect className="door-leaf-left"  style={{ transform: isDoorsOpen ? 'translateX(-5px)' : 'none', transformOrigin: '53px 15px' }} x="53" y="20" width="6" height="31" fill="#475569" stroke="#1e293b" strokeWidth="1"/>
  <rect className="door-leaf-right" style={{ transform: isDoorsOpen ? 'translateX(5px)'  : 'none', transformOrigin: '59px 15px' }} x="59" y="20" width="6" height="31" fill="#475569" stroke="#1e293b" strokeWidth="1"/>
  {/* ...rear pair at x=133/139... */}

  {/* Indicator lights */}
  <circle cx="59"  cy="11" r="3" fill={isDoorsOpen ? '#34d399' : '#f87171'} className={isDoorsOpen ? 'blinking-door-light' : ''}/>
  <circle cx="139" cy="11" r="3" fill={isDoorsOpen ? '#34d399' : '#f87171'} className={isDoorsOpen ? 'blinking-door-light' : ''}/>

  {/* Two larger rubber tyres */}
  <g className={isMoving ? 'rotating-wheel' : ''} style={{ '--wheel-speed': wheelSpeedCss, transformOrigin: '55px 54px' } as React.CSSProperties}>
    <circle cx="55" cy="54" r="8" fill="#111827" stroke="#374151" strokeWidth="2"/>
    <circle cx="55" cy="54" r="8" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1" strokeDasharray="3,3"/>
    <circle cx="55" cy="54" r="3" fill="#94a3b8"/>
  </g>
  {/* ...second tyre at x=155... */}
</svg>
```

### Spinning wheels

Each wheel `<g>` gets the `rotating-wheel` class only while `isMoving`, and its
rotation **period** is set through the `--wheel-speed` CSS variable computed from live
speed (`3.6 / tram.spd`, clamped at `0.1s`). A dashed inner ring makes the rotation
legible. A stopped vehicle drops the class and the wheels freeze.

### Sliding doors & blinking indicator lights

The door leaves are plain `<rect>`s that translate ±5 px apart when `isDoorsOpen`,
eased by the `.door-leaf-*` `transition`. The indicator light above each door pair
turns green and gains the `blinking-door-light` class (an 0.8 s opacity + green
drop-shadow pulse) while boarding, and shows static red when the doors are secured. A
text line under the schematic mirrors the state: `Boarding Active (Doors Open)` vs
`Secured (Doors Closed)`.

### Speedometer & schedule-deviation dials

Two SVG radial gauges sit below the schematic. Both are stroke-dashoffset arcs
(`r = 26`) that animate via a `stroke-dashoffset` CSS transition when the value
changes; the speedometer fills 0–60 km/h, the deviation gauge fills 0–300 s of
lateness and is coloured by delay (red late / blue early / green on-time).

```ts
const speedometerCircumference = 2 * Math.PI * 26;                       // radius 26
const speedometerOffset = speedometerCircumference
  - (Math.min(60, speedKmh) / 60) * speedometerCircumference;
```

```tsx
<svg width="64" height="64" viewBox="0 0 64 64" style={{ transform: 'rotate(-90deg)' }}>
  <circle cx="32" cy="32" r="26" stroke="rgba(255,255,255,0.04)" strokeWidth="4.5" fill="none"/>
  <circle cx="32" cy="32" r="26" stroke={tram.mode === 'bus' ? '#0984e3' : '#00b894'} strokeWidth="4.5" fill="none"
          strokeDasharray={speedometerCircumference}
          strokeDashoffset={speedometerOffset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.6s cubic-bezier(0.4, 0, 0.2, 1)' }}/>
</svg>
```

### Accelerometer bar

A bidirectional bar centred on zero: the green half grows to the right while
accelerating, the red half grows to the left while braking, both eased by a `width`
transition and lit with a matching `box-shadow`.

```ts
const accVal = tram.acc ?? 0;
const accPercent = Math.min(100, (Math.abs(accVal) / 1.5) * 100);
```

```tsx
{accVal < 0 && (
  <div style={{ position: 'absolute', right: '50%', top: 0, width: `${accPercent / 2}%`,
    height: '100%', backgroundColor: '#f87171', borderRadius: '3px 0 0 3px',
    boxShadow: '0 0 8px #f87171', transition: 'width 0.3s ease' }}/>
)}
{accVal > 0 && (
  <div style={{ position: 'absolute', left: '50%', top: 0, width: `${accPercent / 2}%`,
    height: '100%', backgroundColor: '#34d399', borderRadius: '0 3px 3px 0',
    boxShadow: '0 0 8px #34d399', transition: 'width 0.3s ease' }}/>
)}
```

---

## 5. Inline Glyphs & Badges

Beyond the map and the schematic, trams and buses appear as small
[Lucide](https://lucide.dev) glyphs and coloured badges throughout the UI:

- **Filter-panel mode toggles** ([`FilterPanel.tsx`](../frontend/src/components/FilterPanel.tsx)):
  `<Train />` for the Trams toggle and `<Bus />` for the Buses toggle, plus a per-line
  chip grid tinted by `getRouteColor(line)`.
- **Line badges** — the `desi-circle` (popup) and `tram-card-desi` (info card) round
  badges are filled with the line's palette colour so a line's map colour, badge, and
  route path all match.
- **Info-card heading arrow** ([`TramCard.tsx`](../frontend/src/components/TramCard.tsx)):
  a `<Navigation />` glyph rotated to the vehicle's heading *relative to the current
  map bearing* (`tram.hdg - mapBearing - 45`), eased with a `transform` transition,
  and tinted green for trams / blue for buses.
- **Acceleration chevrons** (info card): `<ChevronsUp/>` `<ChevronUp/>` `<ChevronDown/>`
  `<ChevronsDown/>` chosen from the live `acc` value, green for acceleration and coral
  for braking, with a tooltip giving the exact m/s².
- **Follow-mode target** (info card): a `<Target />` glyph that gains the
  `animate-pulse` class while chase mode is active.
- **Connection status dot** ([`FilterPanel.tsx`](../frontend/src/components/FilterPanel.tsx)
  + [`index.css`](../frontend/src/index.css)): a small dot that pulses amber
  (`animation: pulse 1.5s infinite`) while the WebSocket is connecting, steady green
  when connected, red when disconnected.

---

## 6. Colour & State Reference

| Colour | Hex | Used by |
|---|---|---|
| Tram green (mode) | `#00985f` | Tram body fallback, tram stop sign, tram stop dots |
| Tram green (panel) | `#00b894` | Schematic body, speedometer arc, boarding light |
| Bus blue (map sign) | `#007ac9` | Bus stop sign, bus/trunk stop dots |
| Bus blue (vehicle) | `#0984e3` | Bus carriage body, bus schematic, bus dials |
| Trunk-bus orange | `#CA4300` | Trunk-bus stop sign |
| Selection gold | `#fdcb6e` | Selected/next-stop signs, selection ring, follow accent |
| Boarding amber | `#ffb020` | Doors-open body gaps, door-pulse ring |
| Stopped coral | `#e17055` | Stopped ring, "Stopped" legend swatch |
| Accelerating green | `#22c55e` / `#34d399` | Motion aura (accel), accelerometer, accel chevrons |
| Braking red | `#ef4444` / `#f87171` | Motion aura (brake), accelerometer, brake chevrons |

| Telemetry field | Meaning | Drives |
|---|---|---|
| `hdg` | Heading in degrees | Body/arrow rotation, chase-camera bearing |
| `spd` | Speed (m/s) | `speedNorm` aura size, wheel spin period, speedometer |
| `acc` | Acceleration (m/s²) | Aura tint, ease-in/out interpolation, accelerometer, chevrons |
| `drst` | Door state (`1` = open) | `doorsOpen` body swap, door pulse, sliding doors, blinking lights |
| `spd === 0` \|\| `drst === 1` | Stopped | `trams-stopped` coral ring |
| `dl` | Schedule deviation (s) | Delay colour, schedule-deviation dial |
| `desi` | Line short name | Per-line body tint, line badges, map label |
| `mode` | `tram` / `bus` | Body/sign/schematic selection, mode colours |

---

*See also:* [.agents/workflows/map-features.md](../.agents/workflows/map-features.md)
for map-layer ordering and filtering conventions, and
[docs/API_REFERENCE.md](API_REFERENCE.md) for the raw HFP telemetry field schemas
that feed these visuals.
