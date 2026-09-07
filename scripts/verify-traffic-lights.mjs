// Renders the traffic-light marker and the 3D signal with MapLibre and measures
// what actually lands on the canvas.
//
// Why this exists: a junction used to be a dot with a location. It is now a
// state display — the HFP `tlr`/`tla` feeds say which junction a tram is asking
// for a green and what the junction answered — and every part of showing that
// fails quietly:
//
//   1. The marker (`trafficLightIconSvg`) is an SVG rasterised through an Image
//      and handed to `map.addImage`, once per state. A malformed path or a
//      colour the encoder mangles leaves a symbol layer that "works" and draws
//      nothing; a lit lens that is not actually lit leaves a marker that is
//      *correct* about the junction and silent about the state, which is the
//      whole point of the feature.
//   2. The mast is `fill-extrusion` geometry in metres on the ground
//      (frontend/src/lib/trafficLightModels.ts), so it fails the way the
//      vehicles, the stop shelters and the bike racks do: a signal at the wrong
//      scale is still a box, and one with no height is a footprint seen from
//      above.
//
// Usage (from the repo root):
//   npx playwright@latest install chromium   # once
//   npm i --no-save playwright               # once per checkout
//   node scripts/verify-traffic-lights.mjs
import { chromium } from 'playwright';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FRONTEND = path.join(ROOT, 'frontend');
const MAPLIBRE_DIST = path.join(FRONTEND, 'node_modules', 'maplibre-gl', 'dist');

if (!fs.existsSync(path.join(MAPLIBRE_DIST, 'maplibre-gl.mjs'))) {
  console.error(`maplibre-gl not found at ${MAPLIBRE_DIST}. Run "npm install" in frontend/ first.`);
  process.exit(2);
}

// Bundle the app's own module rather than re-typing the geometry here — a copy
// would go stale in exactly the case this check exists to catch.
const { rolldown } = await import(
  pathToFileURL(path.join(FRONTEND, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href
);
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ratikka-signals-'));
process.once('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));

const bundle = await rolldown({
  input: path.join(FRONTEND, 'src', 'lib', 'trafficLightModels.ts'),
  logLevel: 'silent',
});
await bundle.write({ dir: outDir, format: 'esm', entryFileNames: 'trafficLightModels.mjs' });
await bundle.close();
const source = fs.readFileSync(path.join(outDir, 'trafficLightModels.mjs'), 'utf8');
const {
  TRAFFIC_LIGHT_ICON_VARIANTS,
  TRAFFIC_LIGHT_3D_MIN_ZOOM,
  SIGNAL,
} = await import(pathToFileURL(path.join(outDir, 'trafficLightModels.mjs')).href);

// MapLibre ships ESM only and spawns its worker from a URL relative to its own
// module, so it has to be served rather than inlined.
const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  if (urlPath.startsWith('/dist/')) {
    const file = path.join(MAPLIBRE_DIST, path.basename(urlPath));
    if (!fs.existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    res.end(fs.readFileSync(file));
    return;
  }
  if (urlPath === '/trafficLightModels.mjs') {
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    res.end(source);
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(
    '<!doctype html><meta charset="utf-8">' +
    '<style>html,body,#map{margin:0;width:800px;height:600px}</style>' +
    '<div id="map"></div>' +
    '<script type="module">' +
    "import * as maplibregl from '/dist/maplibre-gl.mjs';" +
    "import * as signals from '/trafficLightModels.mjs';" +
    'window.maplibregl = maplibregl; window.signals = signals;' +
    '</script>'
  );
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
await page.goto(base, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.maplibregl && !!window.signals, null, { timeout: 20000 });

const CENTER = [24.94, 60.17];

/**
 * Draw a junction — the flat marker, the 3D signal, or both — and report what
 * was painted, in CSS pixels. `ground` is the projected footprint of the
 * extrusion geometry, so anything painted above its top row is a box standing
 * up rather than a polygon lying down.
 */
const render = (opts) =>
  page.evaluate(async ({ light, variant, zoom, pitch, theme, marker, mast, capture, center, min3d }) => {
    const {
      trafficLightCollection, trafficLightIconSvg, trafficLightIconName,
      TRAFFIC_LIGHT_3D_FADE_IN, TRAFFIC_LIGHT_ICON_WIDTH, TRAFFIC_LIGHT_ICON_HEIGHT,
    } = window.signals;

    document.getElementById('map').innerHTML = '';
    const map = new maplibregl.Map({
      container: 'map',
      // A blank style: no key, no tiles, nothing to confuse the pixel scan.
      style: {
        version: 8,
        sources: {},
        layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#ffffff' } }],
      },
      center,
      zoom,
      pitch,
      fadeDuration: 0,
      preserveDrawingBuffer: true,
    });
    await new Promise((r) => map.on('load', r));

    if (marker) {
      // Exactly how Map.tsx registers it: SVG through a data URI and an Image.
      const name = trafficLightIconName(variant);
      const img = new Image(TRAFFIC_LIGHT_ICON_WIDTH, TRAFFIC_LIGHT_ICON_HEIGHT);
      const loaded = new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error(`signal image ${variant} failed to decode`));
      });
      img.src = 'data:image/svg+xml;charset=utf-8,' +
        encodeURIComponent(trafficLightIconSvg(variant));
      await loaded;
      map.addImage(name, img, { pixelRatio: 2 });
      map.addSource('marker', {
        type: 'geojson',
        data: { type: 'Feature', geometry: { type: 'Point', coordinates: center }, properties: {} },
      });
      map.addLayer({
        id: 'traffic-lights-icons', type: 'symbol', source: 'marker',
        // Drawn at 2x so the scan measures the art rather than the handful of
        // pixels a 13 px sprite survives as. What the app varies with zoom is
        // the size; what this checks is what is inside it.
        layout: {
          'icon-image': name, 'icon-anchor': 'bottom',
          'icon-allow-overlap': true, 'icon-size': 2,
        },
      });
    }

    let mastData = { type: 'FeatureCollection', features: [] };
    if (mast) {
      mastData = trafficLightCollection([{ ...light, lng: center[0], lat: center[1] }], theme);
      map.addSource('mast', { type: 'geojson', data: mastData });
      map.addLayer({
        id: 'traffic-lights-3d', type: 'fill-extrusion', source: 'mast',
        minzoom: min3d,
        paint: {
          'fill-extrusion-color': ['get', 'color'],
          'fill-extrusion-height': ['get', 'top'],
          'fill-extrusion-base': ['get', 'base'],
          'fill-extrusion-opacity': TRAFFIC_LIGHT_3D_FADE_IN,
        },
      });
    }
    await new Promise((r) => map.once('idle', r));

    const glCanvas = map.getCanvas();
    const scan = document.createElement('canvas');
    scan.width = glCanvas.width;
    scan.height = glCanvas.height;
    scan.getContext('2d').drawImage(glCanvas, 0, 0);
    const { data: px } = scan.getContext('2d').getImageData(0, 0, scan.width, scan.height);
    const dpr = glCanvas.width / glCanvas.clientWidth;

    let painted = 0;
    let red = 0, amber = 0, green = 0;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let y = 0; y < scan.height; y++) {
      for (let x = 0; x < scan.width; x++) {
        const i = (y * scan.width + x) * 4;
        const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
        if (r > 248 && g > 248 && b > 248) continue;
        painted++;
        // Hue tests rather than values: MapLibre shades every extruded face by
        // its orientation, so one lens colour lands at several brightnesses.
        // What separates a *lit* lens from its unlit twin is brightness, which
        // is why each test carries a floor as well as a ratio.
        if (r > 150 && g / r < 0.45 && b / r < 0.45) red++;
        if (r > 170 && g / r > 0.6 && g / r < 0.88 && b / r < 0.3) amber++;
        if (g > 130 && r / g < 0.7 && b / g < 0.8) green++;
        minX = Math.min(minX, x / dpr); maxX = Math.max(maxX, x / dpr);
        minY = Math.min(minY, y / dpr); maxY = Math.max(maxY, y / dpr);
      }
    }

    const project = (features) => {
      let top = Infinity, left = Infinity, right = -Infinity, bottom = -Infinity;
      for (const f of features) {
        for (const [lng, lat] of f.geometry.coordinates[0]) {
          const p = map.project([lng, lat]);
          top = Math.min(top, p.y); bottom = Math.max(bottom, p.y);
          left = Math.min(left, p.x); right = Math.max(right, p.x);
        }
      }
      return { top, bottom, left, right };
    };
    const ground = mastData.features.length ? project(mastData.features) : null;

    const mPerDegLat = 111320;
    const mPerDegLng = mPerDegLat * Math.cos((center[1] * Math.PI) / 180);
    const metersPerPixel = (() => {
      const a = map.project(center);
      const b = map.unproject([a.x + 100, a.y]);
      return (Math.abs(b.lng - center[0]) * mPerDegLng) / 100;
    })();

    const image = capture ? glCanvas.toDataURL('image/png') : undefined;
    map.remove();
    return {
      painted, red, amber, green, minX, maxX, minY, maxY, ground, metersPerPixel, image,
      parts: mastData.features.map((f) => f.properties.part),
    };
  }, {
    light: { junctionId: 75, kind: 'traffic_light', bearing: 90, ...(opts.light ?? {}) },
    variant: opts.variant ?? 'idle',
    zoom: opts.zoom ?? 18,
    pitch: opts.pitch ?? 0,
    theme: opts.theme ?? 'light',
    marker: opts.marker ?? false,
    mast: opts.mast ?? false,
    capture: opts.capture ?? false,
    center: CENTER,
    min3d: TRAFFIC_LIGHT_3D_MIN_ZOOM,
  });

const failures = [];
const report = [];
const check = (label, ok, detail) => {
  report.push(`${ok ? 'ok   ' : 'FAIL '} ${label}${detail ? ` -- ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

const asking = (status) => ({ priority: { status, desi: '10B', veh: '0040-407', ts: 1 } });

// 1. Every state's marker decodes and paints. An SVG the encoder mangles leaves
//    a symbol layer that renders nothing at all, with no error anywhere.
for (const variant of TRAFFIC_LIGHT_ICON_VARIANTS) {
  const r = await render({ marker: true, variant, zoom: 17 });
  check(`the ${variant} marker is drawn`, r.painted > 300, `${r.painted} px`);
}

// 2. The marker is a signal head on a mast: taller than it is wide, and about
//    icon-sized. A blob or a stretched sprite fails here.
{
  const r = await render({ marker: true, variant: 'idle', zoom: 17 });
  const w = r.maxX - r.minX;
  const h = r.maxY - r.minY;
  check(
    'the marker is a head on a mast, not a blob',
    h > w * 1.3 && w > 12 && w < 30 && h > 24 && h < 44,
    `${w.toFixed(0)}x${h.toFixed(0)} px`
  );
}

// 3. The state is *shown*, which is the whole feature: a granted request paints
//    green the idle marker does not, and a refused one paints red.
{
  const idle = await render({ marker: true, variant: 'idle', zoom: 18 });
  const granted = await render({ marker: true, variant: 'granted', zoom: 18 });
  const requesting = await render({ marker: true, variant: 'requesting', zoom: 18 });
  const denied = await render({ marker: true, variant: 'denied', zoom: 18 });
  // The unlit lenses are the same hues at a fraction of the brightness, and
  // the hue tests carry brightness floors, so an idle marker registers no lit
  // colour at all. That is the claim: a signal showing nothing looks like a
  // signal showing nothing.
  check(
    'a granted request lights the marker green, and idle lights nothing',
    granted.green > 20 && idle.green === 0,
    `${idle.green} green px idle, ${granted.green} granted`
  );
  check(
    'an open request lights the marker amber',
    requesting.amber > 20 && idle.amber === 0,
    `${idle.amber} amber px idle, ${requesting.amber} requesting`
  );
  check(
    'a refused request lights the marker red',
    denied.red > 20 && idle.red === 0,
    `${idle.red} red px idle, ${denied.red} denied`
  );
}

// 4. The mast stands up. Seen at a pitch, the extrusion must paint well above
//    the top row of its own projected footprint — the failure mode of every
//    fill-extrusion model on this map is a shape lying flat on the ground.
{
  const r = await render({ mast: true, zoom: 19, pitch: 60 });
  const standing = r.ground.top - r.minY;
  // A 3.4 m mast at this zoom and pitch is a couple of dozen pixels tall; what
  // matters is that it is painted *above* the footprint at all, because a model
  // with no height paints exactly zero there.
  check(
    'the signal stands up rather than lying on the pavement',
    standing > 20,
    `${standing.toFixed(0)} px of mast above its footprint`
  );
}

// 5. It is drawn at the size the model says. Seen from straight above with the
//    street running east-west, the painted spread across the street is the
//    cantilever arm reaching out over it.
{
  const r = await render({ mast: true, zoom: 20, pitch: 0 });
  const paintedMeters = Math.max(r.maxX - r.minX, r.maxY - r.minY) * r.metersPerPixel;
  check(
    'the arm reaches out at its modelled length',
    Math.abs(paintedMeters - SIGNAL.arm.length) < 1.2,
    `${paintedMeters.toFixed(2)} m painted, arm is ${SIGNAL.arm.length} m`
  );
}

// 6. The mast stands beside the junction, not in the middle of the crossing.
{
  const r = await render({ mast: true, zoom: 20, pitch: 0 });
  const offCentre = Math.abs((r.maxY + r.minY) / 2 - 300) * r.metersPerPixel;
  check(
    'the mast stands off the junction point',
    offCentre > 1.5,
    `${offCentre.toFixed(1)} m from the junction, offset is ${SIGNAL.offset} m`
  );
}

// 7. The 3D signal carries the same state the marker does — including the disc
//    on the ground, which is the part still legible from a rooftop angle.
{
  const idle = await render({ mast: true, zoom: 19, pitch: 55 });
  const granted = await render({ mast: true, zoom: 19, pitch: 55, light: asking('granted') });
  const denied = await render({ mast: true, zoom: 19, pitch: 55, light: asking('denied') });
  check(
    'a granted request greens the 3D signal and its ground disc',
    granted.green > idle.green + 100,
    `${idle.green} green px idle, ${granted.green} granted`
  );
  check(
    'a refused request reddens it',
    denied.red > idle.red + 100,
    `${idle.red} red px idle, ${denied.red} denied`
  );
  check(
    'the ground disc is drawn only while something is being asked',
    !idle.parts.includes('halo') && granted.parts.includes('halo'),
    `idle parts: ${[...new Set(idle.parts)].join(',')}`
  );
}

// 8. A warning light is the other object in the dataset and must not be drawn
//    as a three-lens signal.
{
  const r = await render({ mast: true, zoom: 19, pitch: 45, light: { kind: 'warning_light' } });
  check(
    'a warning light is one lamp on a pole',
    r.parts.filter((p) => p === 'lens').length === 1 && !r.parts.includes('arm'),
    `parts: ${[...new Set(r.parts)].join(',')}`
  );
  check('the warning light is visible', r.painted > 100, `${r.painted} px`);
}

// 9. Both themes paint something. The foot is theme-coloured, and a surface the
//    colour of the background is indistinguishable from a layer that never drew.
for (const theme of ['light', 'dark']) {
  const r = await render({ mast: true, zoom: 19, pitch: 45, theme });
  check(`the ${theme} signal is visible`, r.painted > 100, `${r.painted} px`);
}

// Opt-in visual artifacts; normal verification leaves no images behind.
if (process.env.SIGNAL_SCREENSHOTS === '1') {
  const screenshotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ratikka-signal-previews-'));
  for (const [name, opts] of [
    ['mast-granted', { mast: true, zoom: 19.5, pitch: 60, light: asking('granted') }],
    ['mast-idle', { mast: true, zoom: 19.5, pitch: 60 }],
    ['marker-requesting', { marker: true, zoom: 18, variant: 'requesting' }],
  ]) {
    const shot = await render({ ...opts, capture: true });
    const filename = path.join(screenshotDir, `signal-${name}.png`);
    fs.writeFileSync(filename, Buffer.from(shot.image.split(',')[1], 'base64'));
    console.log(`Signal preview: ${filename}`);
  }
}

await browser.close();
server.close();
fs.rmSync(outDir, { recursive: true, force: true });

console.log('\n--- traffic light markers and 3D signals ---');
report.forEach((l) => console.log(l));
if (pageErrors.length) {
  console.log('\npage errors:');
  pageErrors.forEach((e) => console.log(`  ${e}`));
}
console.log(`\nTRAFFIC LIGHT FAILURES: ${failures.length + pageErrors.length}`);
process.exit(failures.length + pageErrors.length ? 1 : 0);
