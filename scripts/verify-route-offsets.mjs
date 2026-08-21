// Renders the highlighted-route paint expressions with MapLibre and measures
// where the pixels actually land relative to the route's true geometry.
//
// Why this exists: overlapping routes are fanned into parallel ribbons with
// `line-offset` (see frontend/src/lib/routeLineStyle.ts). That offset is in
// *pixels*, so the ground it covers grows as the map zooms out -- unbounded, it
// put whole tram lines a block off their street at city zoom, some of them out
// in the harbour, with blobs of solid colour where an offset wider than a
// terminal loop folded the offset geometry in on itself.
//
// Neither existing check catches that: verify-map-layers only asks whether the
// spec is valid (it always was), and verify-map-renders only asks whether the
// basemap draws. "The route is drawn" and "the route is drawn where the route
// is" are different claims. This one measures the second, so it needs no
// Digitransit key: the geometry is synthetic and the basemap is blank.
//
// Usage (from the repo root):
//   npx playwright@latest install chromium   # once
//   npm i --no-save playwright               # once per checkout
//   node scripts/verify-route-offsets.mjs
//
// Exits non-zero if any route pixel lands further from its true geometry than
// the fan is allowed to reach.
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

// The paint expressions are TypeScript, so bundle them the way the app does
// rather than re-typing the zoom stops here -- a copy would go stale in exactly
// the case this check exists to catch.
const { rolldown } = await import(
  pathToFileURL(path.join(FRONTEND, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href
);
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ratikka-offsets-'));
const bundle = await rolldown({
  input: path.join(FRONTEND, 'src', 'lib', 'routeLineStyle.ts'),
  external: ['maplibre-gl'],
  logLevel: 'silent',
});
await bundle.write({ dir: outDir, format: 'esm', entryFileNames: 'routeLineStyle.mjs' });
const { ROUTE_LINE_OFFSET, ROUTE_LINE_WIDTH, MAX_SLOT } = await import(
  pathToFileURL(path.join(outDir, 'routeLineStyle.mjs')).href
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
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(
    '<!doctype html><meta charset="utf-8">' +
    '<style>html,body,#map{margin:0;width:600px;height:600px}</style>' +
    '<div id="map"></div>' +
    '<script type="module">' +
    "import * as maplibregl from '/dist/maplibre-gl.mjs';" +
    'window.maplibregl = maplibregl;' +
    '</script>'
  );
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 600, height: 600 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
await page.goto(base, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.maplibregl, null, { timeout: 15000 });

/**
 * Draw one synthetic route at one zoom and report, in pixels, how far the
 * painted ribbon strays from the coordinates it was given.
 *
 * The measurement is done on the map's own canvas: every painted pixel is
 * matched to the nearest point of the projected true geometry, which is the
 * question a rider actually asks of the map ("is this line on that street?").
 */
const measure = (coords, offsetIndex, zoom, center) =>
  page.evaluate(
    async ({ coords, offsetIndex, zoom, center, offsetExpr, widthExpr }) => {
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
        fadeDuration: 0,
        // Required to read pixels back out of the WebGL canvas.
        preserveDrawingBuffer: true,
      });
      await new Promise((r) => map.on('load', r));
      map.addSource('route-lines', {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: coords },
          properties: { offsetIndex, selected: false },
        },
      });
      map.addLayer({
        id: 'route',
        type: 'line',
        source: 'route-lines',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#ff0000',
          'line-width': widthExpr,
          'line-offset': offsetExpr,
        },
      });
      await new Promise((r) => map.once('idle', r));

      const glCanvas = map.getCanvas();
      const scan = document.createElement('canvas');
      scan.width = glCanvas.width;
      scan.height = glCanvas.height;
      const ctx = scan.getContext('2d');
      ctx.drawImage(glCanvas, 0, 0);
      const { data } = ctx.getImageData(0, 0, scan.width, scan.height);
      const dpr = glCanvas.width / glCanvas.clientWidth;

      const truth = coords.map(([lng, lat]) => {
        const p = map.project([lng, lat]);
        return [p.x, p.y];
      });
      // Distance from a point to the projected polyline, segment by segment.
      const distance = (px, py) => {
        let best = Infinity;
        for (let i = 1; i < truth.length; i++) {
          const [x0, y0] = truth[i - 1];
          const [x1, y1] = truth[i];
          const dx = x1 - x0;
          const dy = y1 - y0;
          const len = dx * dx + dy * dy;
          const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / len));
          best = Math.min(best, Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy)));
        }
        return best;
      };

      let painted = 0;
      let max = 0;
      for (let y = 0; y < scan.height; y++) {
        for (let x = 0; x < scan.width; x++) {
          const i = (y * scan.width + x) * 4;
          if (data[i] > 180 && data[i + 1] < 90 && data[i + 2] < 90) {
            painted++;
            max = Math.max(max, distance(x / dpr, y / dpr));
          }
        }
      }
      map.remove();
      return { painted, max };
    },
    { coords, offsetIndex, zoom, center, offsetExpr: ROUTE_LINE_OFFSET, widthExpr: ROUTE_LINE_WIDTH }
  );

// A straight east/west corridor through Helsinki, ~1 km of it.
const CENTER = [24.94, 60.168];
const corridor = Array.from({ length: 20 }, (_, i) => [24.935 + i * 0.0005, 60.168]);
// A tram turning loop, ~80 m across -- the shape that folds into a blob when the
// offset is wider than the turn.
const loop = Array.from({ length: 33 }, (_, i) => {
  const a = (i / 32) * Math.PI * 2;
  return [24.94 + Math.cos(a) * 0.00072, 60.168 + Math.sin(a) * 0.00036];
});

const failures = [];
const report = [];
const check = (label, ok, detail) => {
  report.push(`${ok ? 'ok  ' : 'FAIL'}  ${label} -- ${detail}`);
  if (!ok) failures.push(label);
};

// 1. Zoomed out, the fan must be gone: pixel spacing that reads as "beside the
//    street" at zoom 16 is several streets wide at zoom 10.
for (const zoom of [9, 10, 11]) {
  const { max, painted } = await measure(corridor, MAX_SLOT, zoom, CENTER);
  // Half the line width -- i.e. the ribbon covers its own geometry and nothing
  // further. Any real offset would show up as several times this.
  check(
    `z${zoom} outermost slot sits on the true geometry`,
    painted > 0 && max <= 3,
    `max ${max.toFixed(1)}px from route, ${painted}px painted`
  );
}

// 2. Zoomed in, the fan is allowed -- but only about a street's width of it.
for (const zoom of [13, 16]) {
  const { max, painted } = await measure(corridor, MAX_SLOT, zoom, CENTER);
  check(
    `z${zoom} outermost slot stays within a street of its route`,
    painted > 0 && max <= 30,
    `max ${max.toFixed(1)}px from route, ${painted}px painted`
  );
}

// 3. The offset must not blow up where the geometry turns tighter than the
//    offset is wide. A fold shows as pixels far outside the loop.
for (const zoom of [13, 16]) {
  const { max, painted } = await measure(loop, MAX_SLOT, zoom, CENTER);
  check(
    `z${zoom} terminal loop does not fold into a blob`,
    painted > 0 && max <= 30,
    `max ${max.toFixed(1)}px from loop, ${painted}px painted`
  );
}

console.log('--- route offset placement ---');
report.forEach((l) => console.log(l));
if (pageErrors.length) {
  console.log('\npage errors:');
  pageErrors.forEach((e) => console.log(`  ${e}`));
}

await browser.close();
server.close();
fs.rmSync(outDir, { recursive: true, force: true });

if (failures.length || pageErrors.length) {
  console.log(`\nROUTE OFFSET FAILURES: ${failures.length}`);
  process.exit(1);
}
console.log('\nROUTE OFFSET FAILURES: 0');
