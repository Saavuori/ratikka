// Renders the 3D vehicle bodies with MapLibre and measures what actually lands
// on the canvas.
//
// Why this exists: in the tilted view the flat carriage icons are replaced by
// `fill-extrusion` boxes at real vehicle scale (frontend/src/lib/vehicleModels.ts).
// Extrusion geometry is in *metres on the ground*, not icon pixels, so nothing
// about it is checked by tsc or the unit tests, and the two ways it goes wrong
// both render "fine": a body drawn at the wrong size or heading is still a box,
// and a body with no height at all is still a filled footprint. Neither of the
// other map checks would notice — verify-map-layers only asks whether the spec
// is valid, verify-map-renders only whether the basemap draws.
//
// This one measures the pixels: how long each body is on the ground, that the
// modes keep their size order, that the box has walls standing above its
// footprint, and that nothing is drawn below the zoom where the bodies fade in.
// It needs no Digitransit key — the basemap is blank and the vehicles are
// synthetic.
//
// Usage (from the repo root):
//   npx playwright@latest install chromium   # once
//   npm i --no-save playwright               # once per checkout
//   node scripts/verify-vehicle-3d.mjs
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

// The models are TypeScript, so bundle the app's own module rather than
// re-typing the dimensions here — a copy would go stale in exactly the case
// this check exists to catch.
const { rolldown } = await import(
  pathToFileURL(path.join(FRONTEND, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href
);
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ratikka-vehicles-'));
const bundle = await rolldown({
  input: path.join(FRONTEND, 'src', 'lib', 'vehicleModels.ts'),
  logLevel: 'silent',
});
await bundle.write({ dir: outDir, format: 'esm', entryFileNames: 'vehicleModels.mjs' });
const libSource = fs.readFileSync(path.join(outDir, 'vehicleModels.mjs'), 'utf8');
const { VEHICLE_MODELS, VEHICLE_3D_MIN_ZOOM } = await import(
  pathToFileURL(path.join(outDir, 'vehicleModels.mjs')).href
);

// MapLibre 6 ships ESM only and spawns its worker from a URL relative to its own
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
  if (urlPath === '/vehicleModels.mjs') {
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    res.end(libSource);
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(
    '<!doctype html><meta charset="utf-8">' +
    '<style>html,body,#map{margin:0;width:800px;height:600px}</style>' +
    '<div id="map"></div>' +
    '<script type="module">' +
    "import * as maplibregl from '/dist/maplibre-gl.mjs';" +
    "import * as vehicleModels from '/vehicleModels.mjs';" +
    'window.maplibregl = maplibregl; window.vehicleModels = vehicleModels;' +
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
await page.waitForFunction(() => !!window.maplibregl && !!window.vehicleModels, null, { timeout: 20000 });

const CENTER = [24.94, 60.17];

/**
 * Draw one vehicle and report what was painted: the number of body pixels, the
 * bounding box of them, and — for the height check — the topmost row of the
 * projected ground footprint. All in CSS pixels.
 */
const render = ({ mode, hdg = 90, zoom = 17, pitch = 0, doorsOpen = false }) =>
  page.evaluate(
    async ({ mode, hdg, zoom, pitch, doorsOpen, center, minZoom }) => {
      const { vehicleExtrusionCollection, VEHICLE_3D_FADE_IN } = window.vehicleModels;
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

      const data = vehicleExtrusionCollection([
        { veh: 'v', lng: center[0], lat: center[1], hdg, mode, desi: '', doorsOpen },
      ]);
      map.addSource('vehicles-3d', { type: 'geojson', data });
      map.addLayer({
        id: 'vehicles-3d',
        type: 'fill-extrusion',
        source: 'vehicles-3d',
        minzoom: minZoom,
        paint: {
          'fill-extrusion-color': ['get', 'color'],
          'fill-extrusion-height': ['get', 'top'],
          'fill-extrusion-base': ['get', 'base'],
          'fill-extrusion-opacity': VEHICLE_3D_FADE_IN,
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
      // The amber the window band turns while the doors are open (#ffb020),
      // shaded by MapLibre's lighting, so the match is a band not a value.
      let amber = 0;
      let cab = 0;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let y = 0; y < scan.height; y++) {
        for (let x = 0; x < scan.width; x++) {
          const i = (y * scan.width + x) * 4;
          // Anything that is not the white background is vehicle.
          if (px[i] > 245 && px[i + 1] > 245 && px[i + 2] > 245) continue;
          painted++;
          if (px[i] > 150 && px[i + 1] > 90 && px[i + 1] < 200 && px[i + 2] < 80) amber++;
          // The pale blue cab patch (#9fd8f2), likewise shaded.
          if (px[i] > 110 && px[i] < 200 && px[i + 1] > 150 && px[i + 2] > 190) cab++;
          minX = Math.min(minX, x / dpr); maxX = Math.max(maxX, x / dpr);
          minY = Math.min(minY, y / dpr); maxY = Math.max(maxY, y / dpr);
        }
      }

      // Where the footprint sits on the ground, for the "does it stand up" test.
      let groundTop = Infinity;
      for (const f of data.features) {
        for (const [lng, lat] of f.geometry.coordinates[0]) {
          groundTop = Math.min(groundTop, map.project([lng, lat]).y);
        }
      }

      const metersPerPixel = (() => {
        const a = map.project(center);
        const b = map.unproject([a.x + 100, a.y]);
        const mPerDegLng = 111320 * Math.cos((center[1] * Math.PI) / 180);
        return (Math.abs(b.lng - center[0]) * mPerDegLng) / 100;
      })();

      map.remove();
      return { painted, amber, cab, minX, maxX, minY, maxY, groundTop, metersPerPixel };
    },
    { mode, hdg, zoom, pitch, doorsOpen, center: CENTER, minZoom: VEHICLE_3D_MIN_ZOOM }
  );

const failures = [];
const report = [];
const check = (label, ok, detail) => {
  report.push(`${ok ? 'ok   ' : 'FAIL '} ${label}${detail ? ` -- ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

// The length of each model, straight from the app's own dimensions.
const modelLength = (mode) => {
  const m = VEHICLE_MODELS[mode];
  return Math.max(...m.sections.map((s) => s.front)) - Math.min(...m.sections.map((s) => s.back));
};

// 1. Each body is drawn on the ground at its real length. Seen from straight
//    above with the vehicle pointing east, the painted width IS the body.
const lengths = {};
for (const mode of ['bus', 'tram', 'train', 'metro']) {
  const r = await render({ mode, zoom: mode === 'metro' || mode === 'train' ? 16 : 17 });
  const paintedMeters = (r.maxX - r.minX) * r.metersPerPixel;
  lengths[mode] = paintedMeters;
  const expected = modelLength(mode);
  const off = Math.abs(paintedMeters - expected) / expected;
  check(
    `${mode} body is drawn at its real length`,
    r.painted > 0 && off < 0.1,
    `${paintedMeters.toFixed(1)} m painted vs ${expected.toFixed(1)} m modelled`
  );
}

// 2. The modes stay tellable apart by size, which is half of what makes a body
//    readable at a glance.
check(
  'the modes keep their size order (bus < tram < train < metro)',
  lengths.bus < lengths.tram && lengths.tram < lengths.train && lengths.train < lengths.metro,
  Object.entries(lengths).map(([m, l]) => `${m} ${l.toFixed(0)} m`).join(', ')
);

// 3. A heading turns the body: pointing north, the same vehicle must paint tall
//    and narrow instead of wide and flat.
{
  const east = await render({ mode: 'tram', hdg: 90, zoom: 17 });
  const north = await render({ mode: 'tram', hdg: 0, zoom: 17 });
  check(
    'the body rotates with the vehicle heading',
    east.maxX - east.minX > east.maxY - east.minY && north.maxY - north.minY > north.maxX - north.minX,
    `east ${(east.maxX - east.minX).toFixed(0)}x${(east.maxY - east.minY).toFixed(0)} px, ` +
    `north ${(north.maxX - north.minX).toFixed(0)}x${(north.maxY - north.minY).toFixed(0)} px`
  );
}

// 4. The point of the whole exercise: in the tilted view the body has walls, so
//    it paints above the ground it stands on. A zero-height extrusion would
//    still fill its footprint and look like a perfectly good vehicle from above.
{
  const tilted = await render({ mode: 'tram', zoom: 17, pitch: 60 });
  check(
    'a tilted body stands up off the ground',
    tilted.painted > 0 && tilted.minY < tilted.groundTop - 3,
    `top of body at y=${tilted.minY.toFixed(0)}, footprint starts at y=${tilted.groundTop.toFixed(0)}`
  );
}

// 5. Below the fade-in the flat icons are in charge and nothing is extruded —
//    at real scale a tram down there is a couple of pixels of mud.
{
  const belowFade = await render({ mode: 'tram', zoom: VEHICLE_3D_MIN_ZOOM - 0.1 });
  check(
    `nothing is extruded below zoom ${VEHICLE_3D_MIN_ZOOM}`,
    belowFade.painted === 0,
    `${belowFade.painted} px painted`
  );
}

// 6. The doors have to stand proud of the flanks, or the doors-open cue is
//    swallowed by the body they are drawn inside. Only a tilted view can see
//    them — from straight above the roof hides the whole flank.
{
  const shut = await render({ mode: 'bus', zoom: 18, pitch: 60 });
  const open = await render({ mode: 'bus', zoom: 18, pitch: 60, doorsOpen: true });
  check(
    'open doors are visible on the flank of a tilted body',
    open.amber > 20 && shut.amber === 0,
    `${open.amber} amber px with the doors open, ${shut.amber} with them shut`
  );
}

// 7. The cab patch marks the driving end on the roof, which is where a map
//    camera can see it — it is what says which way the vehicle faces once the
//    flat icon's nose nub has faded out.
{
  const seen = await render({ mode: 'tram', zoom: 18, pitch: 45 });
  check(
    'the cab patch is visible on the roof',
    seen.cab > 20,
    `${seen.cab} px of cab patch`
  );
}

await browser.close();
server.close();

console.log('\n--- 3D vehicle bodies ---');
report.forEach((l) => console.log(l));
if (pageErrors.length) {
  console.log('\npage errors:');
  pageErrors.forEach((e) => console.log(`  ${e}`));
}
console.log(`\n3D VEHICLE FAILURES: ${failures.length + pageErrors.length}`);
process.exit(failures.length + pageErrors.length ? 1 : 0);
