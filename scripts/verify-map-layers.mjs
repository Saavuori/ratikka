// Boots the built frontend in Chromium and reports any layer or source spec
// that MapLibre rejects.
//
// Why this exists: the map is assembled by ~30 addLayer/addSource calls in
// Map.tsx, and most of the other layers are anchored to `trams-circles` via
// beforeId. One invalid paint expression therefore does not just break one
// layer -- it removes the anchor and silently takes the stops, the route path
// and the journey overlay with it. That is exactly what happened in v0.44.7,
// and it reached production because nothing here is type-checked: expressions
// are validated at runtime, by MapLibre, in a browser.
//
// Usage (from the repo root):
//   cd frontend && npm run build && cd ..
//   npx playwright@latest install chromium   # once
//   node scripts/verify-map-layers.mjs
//
// Playwright is deliberately NOT a devDependency -- the frontend install stays
// lean, in line with the project's "avoid adding dependencies casually" rule.
// Exits non-zero if any layer/source was rejected.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'frontend', 'dist');

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error(`No build found at ${DIST}. Run "npm run build" in frontend/ first.`);
  process.exit(2);
}
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  let file = path.join(DIST, urlPath === '/' ? 'index.html' : urlPath);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

// MapLibre 6 requires WebGL2, which headless Chromium provides via SwiftShader.
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.addInitScript(() => { window.__mlProbe = true; });

let stream;
const vehicle = {
  veh: 'test-tram', desi: '4', lat: 60.17, lng: 24.94, hdg: 90,
  spd: 0, acc: 0, drst: 0, mode: 'tram', dl: 0, route: '', stop: null, tripId: '',
};
const sendVehicle = () => stream?.send(JSON.stringify({
  type: 'positions', timestamp: new Date().toISOString(), count: 1,
  vehicles: { [vehicle.veh]: { ...vehicle, ts: Math.floor(Date.now() / 1000) } },
}));
await page.routeWebSocket('**/api/v1/stream', (socket) => {
  stream = socket;
  socket.onMessage(sendVehicle);
});

const errors = [];
const warnings = [];
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error') errors.push(t);
  if (m.type() === 'warning') warnings.push(t);
});
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));

// A 1x1 transparent PNG, for sprite sheets and raster tiles.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64');

// Playwright matches the most recently registered route first, so the
// catch-all must be registered BEFORE the specific ones.
await page.route('**/api/v1/**', (r) => r.fulfill({ json: {} }));
await page.route('**/api/v1/alerts', (r) => r.fulfill({ json: { alerts: [] } }));
await page.route('**/api/v1/bike-station/**', (r) =>
  r.fulfill({ json: { type: 'FeatureCollection', features: [] } }));
await page.route('**/api/v1/traffic-lights', (r) =>
  r.fulfill({ json: { type: 'FeatureCollection', features: [] } }));
// VersionBadge does info.git_sha.substring(0, 7) unguarded, so an incomplete
// payload here crashes the whole app before the map ever initialises.
await page.route('**/api/v1/version', (r) =>
  r.fulfill({ json: { version: 'test', build_date: 'test', git_sha: 'abcdef1234' } }));
await page.route('**/api/v1/config', (r) =>
  r.fulfill({ json: { digitransit_map_key: 'test-key' } }));

// Sprites must return parseable JSON / a real PNG or style.load never fires.
const stubAsset = (r) => {
  const u = r.request().url();
  if (u.includes('/dark-matter-gl-style/style.json')) {
    return r.fulfill({ json: {
      version: 8,
      glyphs: `${base}/stub/{fontstack}/{range}.pbf`,
      sources: { carto: { type: 'vector', tiles: [`${base}/stub/{z}/{x}/{y}.pbf`] } },
      layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#15191e' } }],
    } });
  }
  if (u.includes('.png')) return r.fulfill({ contentType: 'image/png', body: PNG });
  // Sprite layout is a map of icon-name -> box; empty is valid.
  if (u.includes('sprite')) return r.fulfill({ json: {} });
  // Any other .json a style references is a TileJSON. It must carry a `tiles`
  // array or the source blows up on every render tick.
  if (u.includes('.json')) {
    return r.fulfill({
      json: {
        tilejson: '2.2.0', tiles: [`${base}/stub/{z}/{x}/{y}.pbf`],
        minzoom: 0, maxzoom: 14, bounds: [-180, -85, 180, 85],
      },
    });
  }
  return r.fulfill({ status: 200, contentType: 'application/x-protobuf', body: '' });
};
// Everything not served by the local static server is an external map asset
// (tiles, sprites, glyphs). Stub them all -- none of them affect whether a
// layer spec is valid, which is what this check is about.
await page.route('**/*', (r) => {
  const u = r.request().url();
  if (u.startsWith(base)) return r.fallback();
  return stubAsset(r);
});

await page.goto(base, { waitUntil: 'load' });
await page.waitForTimeout(6000);

// Exercise the actual App → Map path, not only static layer declarations.
await page.waitForFunction(() => window.__mlMap?.getLayer('vehicles-3d'));
await page.evaluate(() => window.__mlMap.jumpTo({ center: [24.94, 60.17], zoom: 14 }));
const vehicleToggle = page.getByRole('button', { name: 'Always show 3D vehicles, including on the flat map', exact: true });
assert.equal(await vehicleToggle.getAttribute('aria-pressed'), 'false');
assert.equal(await page.evaluate(() => window.__mlMap.getLayoutProperty('vehicles-3d', 'visibility')), 'none');
await vehicleToggle.click();
await page.waitForFunction(async () => {
  const map = window.__mlMap;
  const source = map?.getSource('vehicles-3d');
  return source && (await source.getData()).features.length > 0;
});
assert.equal(await page.evaluate(() => window.__mlMap.getPitch()), 0, 'vehicle toggle must not tilt the map');
assert.equal(await page.evaluate(() => localStorage.getItem('always3DVehicles')), 'true');
assert.equal(await page.evaluate(() => window.__mlMap.getLayoutProperty('vehicles-3d', 'visibility')), 'visible');

vehicle.drst = 1;
sendVehicle();
await page.waitForFunction(async () => {
  const data = await window.__mlMap.getSource('vehicles-3d').getData();
  return data.features.some((f) => f.properties.part === 'doorway');
});
vehicle.drst = 0;
sendVehicle();
await page.waitForFunction(async () => {
  const data = await window.__mlMap.getSource('vehicles-3d').getData();
  return data.features.length && !data.features.some((f) => f.properties.part === 'doorway');
});

await page.getByRole('button', { name: 'Enable 3D map', exact: true }).click();
await page.waitForFunction(() => window.__mlMap.getPitch() > 40);
await page.getByRole('button', { name: 'Disable 3D map', exact: true }).click();
await page.waitForFunction(() => window.__mlMap.getPitch() === 0);
assert.equal(await page.evaluate(() => window.__mlMap.getLayoutProperty('vehicles-3d', 'visibility')), 'visible');

await page.getByRole('button', { name: 'Switch to dark map', exact: true }).click();
await page.waitForFunction(() =>
  window.__mlMap.getLayer('vehicles-3d') &&
  window.__mlMap.getLayoutProperty('vehicles-3d', 'visibility') === 'visible' &&
  window.__mlMap.getSource('carto'));
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.__mlMap?.getLayer('vehicles-3d'));
assert.equal(await vehicleToggle.getAttribute('aria-pressed'), 'true', 'vehicle preference survives reload');
assert.equal(await page.evaluate(() => window.__mlMap.getLayoutProperty('vehicles-3d', 'visibility')), 'visible');
await page.evaluate(() => window.__mlMap.jumpTo({ center: [24.94, 60.17], zoom: 12 }));
await page.waitForFunction(async () => {
  const source = window.__mlMap.getSource('vehicles-3d');
  return source && (await source.getData()).features.length === 0;
});
await vehicleToggle.click();
assert.equal(await page.evaluate(() => window.__mlMap.getPaintProperty('trams-body', 'icon-opacity')), 1);
await page.getByRole('button', { name: 'Enable 3D map', exact: true }).click();
await page.waitForFunction(() =>
  window.__mlMap.getLayoutProperty('vehicles-3d', 'visibility') === 'visible');
console.log('3D vehicle toggle, live doors, pitch independence, zoom fallback and persistence: PASS');

const canvas = await page.locator('canvas.maplibregl-canvas').count();
const webgl2 = await page.evaluate(() => {
  const c = document.createElement('canvas');
  return !!c.getContext('webgl2');
});

console.log('--- MapLibre v6 smoke check ---');
console.log('WebGL2 available in test browser:', webgl2);
console.log('maplibregl canvas mounted        :', canvas > 0);
console.log('');

// Collapse repeats -- a per-render-tick failure otherwise floods the report.
const dedupe = (list) => {
  const seen = new Map();
  for (const e of list) {
    const key = e.split('\n')[0].slice(0, 200);
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return [...seen.entries()];
};

// The failure mode this check exists for: addLayer/addSource rejecting a spec
// that style-spec v25+ now considers invalid.
const layerErrors = errors.filter((e) =>
  /addLayer|addSource|expected.*expression|Expected.*but found|is not a valid|layers\[|sources\[|PAGEERROR|Vehicle animation frame failed/i.test(e));

console.log(`unique console errors: ${dedupe(errors).length} (raw ${errors.length})`);
dedupe(errors).forEach(([e, n]) => console.log(`  ERR  x${n} ${e}`));
console.log(`\nunique warnings: ${dedupe(warnings).length}`);
dedupe(warnings).forEach(([w, n]) => console.log(`  WARN x${n} ${w}`));
console.log(`\nLAYER/SOURCE SPEC REJECTIONS: ${layerErrors.length}`);
dedupe(layerErrors).forEach(([e, n]) => console.log(`  !! x${n} ${e}`));

await browser.close();
server.close();
process.exit(layerErrors.length > 0 ? 1 : 0);
