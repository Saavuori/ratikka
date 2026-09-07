// Renders the traffic-light markers with MapLibre and measures what actually
// lands on the canvas.
//
// Why this exists: a junction used to be a dot with a location. It is now a
// state display — the HFP `tlr`/`tla` feeds say which junction a tram is asking
// for a green and what the junction answered — and showing that fails quietly.
// The marker (`trafficLightIconSvg`) is an SVG rasterised through an Image and
// handed to `map.addImage`, once per state. A malformed path or a colour the
// encoder mangles leaves a symbol layer that "works" and draws nothing; a lit
// lens that is not actually lit leaves a marker that is *correct* about the
// junction and silent about the state, which is the whole point of the feature.
// The marker is the whole of the junction on the map — there is no 3D
// counterpart to hand over to — so this is the only place it is checked.
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
 * Draw a junction marker and report what was painted, in CSS pixels.
 */
const render = (opts) =>
  page.evaluate(async ({ variant, warning, zoom, pitch, capture, center }) => {
    const {
      trafficLightIconSvg, trafficLightIconName, warningLightIconSvg,
      TRAFFIC_LIGHT_ICON_WIDTH, TRAFFIC_LIGHT_ICON_HEIGHT,
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

    // Exactly how Map.tsx registers it: SVG through a data URI and an Image.
    const name = warning ? 'warning-light-icon' : trafficLightIconName(variant);
    const svg = warning ? warningLightIconSvg() : trafficLightIconSvg(variant);
    const img = new Image(TRAFFIC_LIGHT_ICON_WIDTH, TRAFFIC_LIGHT_ICON_HEIGHT);
    const loaded = new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error(`signal image ${name} failed to decode`));
    });
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
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

    const image = capture ? glCanvas.toDataURL('image/png') : undefined;
    map.remove();
    return { painted, red, amber, green, minX, maxX, minY, maxY, image };
  }, {
    variant: opts.variant ?? 'idle',
    warning: opts.warning ?? false,
    zoom: opts.zoom ?? 18,
    pitch: opts.pitch ?? 0,
    capture: opts.capture ?? false,
    center: CENTER,
  });

const failures = [];
const report = [];
const check = (label, ok, detail) => {
  report.push(`${ok ? 'ok   ' : 'FAIL '} ${label}${detail ? ` -- ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

// 1. Every state's marker decodes and paints. An SVG the encoder mangles leaves
//    a symbol layer that renders nothing at all, with no error anywhere.
for (const variant of TRAFFIC_LIGHT_ICON_VARIANTS) {
  const r = await render({ variant, zoom: 17 });
  check(`the ${variant} marker is drawn`, r.painted > 300, `${r.painted} px`);
}

// 2. The marker is a signal head on a mast: taller than it is wide, and about
//    icon-sized. A blob or a stretched sprite fails here.
{
  const r = await render({ variant: 'idle', zoom: 17 });
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
  const idle = await render({ variant: 'idle', zoom: 18 });
  const granted = await render({ variant: 'granted', zoom: 18 });
  const requesting = await render({ variant: 'requesting', zoom: 18 });
  const denied = await render({ variant: 'denied', zoom: 18 });
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

// 4. The marker is the junction at every zoom, in 3D as much as flat: nothing
//    hands over to it and it hands over to nothing, so it has to survive both
//    a straight-down street-level view and a steeply pitched one.
for (const [label, opts] of [
  ['flat at street level', { zoom: 15.5, pitch: 0 }],
  ['flat at close range', { zoom: 19, pitch: 0 }],
  ['pitched, as in 3D view', { zoom: 19, pitch: 60 }],
]) {
  const r = await render({ variant: 'granted', ...opts });
  check(
    `the marker is drawn and lit ${label}`,
    r.painted > 200 && r.green > 10,
    `${r.painted} px, ${r.green} green`
  );
}

// 5. A warning light is the other object in the dataset and must not be drawn
//    as a three-lens signal: one amber lamp under a triangle, nothing lit green
//    or red, because there is nothing a tram can ask of it.
{
  const r = await render({ warning: true, zoom: 18 });
  check('the warning light is drawn', r.painted > 300, `${r.painted} px`);
  check(
    'a warning light is amber only, with no signal lenses',
    r.amber > 50 && r.green === 0 && r.red === 0,
    `${r.amber} amber, ${r.green} green, ${r.red} red`
  );
}

// Opt-in visual artifacts; normal verification leaves no images behind.
if (process.env.SIGNAL_SCREENSHOTS === '1') {
  const screenshotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ratikka-signal-previews-'));
  for (const [name, opts] of [
    ['marker-granted', { zoom: 18, variant: 'granted' }],
    ['marker-idle', { zoom: 18, variant: 'idle' }],
    ['marker-requesting', { zoom: 18, variant: 'requesting' }],
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

console.log('\n--- traffic light markers ---');
report.forEach((l) => console.log(l));
if (pageErrors.length) {
  console.log('\npage errors:');
  pageErrors.forEach((e) => console.log(`  ${e}`));
}
console.log(`\nTRAFFIC LIGHT FAILURES: ${failures.length + pageErrors.length}`);
process.exit(failures.length + pageErrors.length ? 1 : 0);
