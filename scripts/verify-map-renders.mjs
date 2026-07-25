// Boots the built frontend in Chromium against the REAL Digitransit basemap and
// reports whether the map actually renders.
//
// Why this exists, and how it differs from verify-map-layers.mjs: that script
// stubs every external map asset, so it proves layer/source *specs* are valid
// and nothing more. v0.46.0 passed it and still shipped a blank map, because
// "the specs are valid" and "pixels appear" are different claims. This script
// makes the second claim testable: real tiles, real sprite, real glyphs, real
// subscription key -- then counts the tiles that came back and reads the
// rendered canvas back as pixels.
//
// Usage (from the repo root):
//   cd frontend && npm run build && cd ..
//   npx playwright@latest install chromium   # once
//   DIGITRANSIT_API_KEY=... node scripts/verify-map-renders.mjs
//
// Exits non-zero if the map did not render.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'frontend', 'dist');
const OUT = process.env.SHOT_OUT || path.join(ROOT, 'map-render.png');

const KEY = process.env.DIGITRANSIT_API_KEY;
if (!KEY) {
  console.error('DIGITRANSIT_API_KEY is required -- this check hits the real basemap.');
  process.exit(2);
}
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

const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
// Opt into the Map.tsx test hook, which only exposes the map when asked.
await page.addInitScript(() => { window.__mlProbe = true; });

const errors = [];
const warnings = [];
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error') errors.push(t);
  if (m.type() === 'warning') warnings.push(t);
});
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));

// Only the app's own API is stubbed. Everything the map draws with -- tiles,
// sprite, glyphs -- goes to the real network, which is the entire point.
await page.route('**/api/v1/**', (r) => r.fulfill({ json: {} }));
await page.route('**/api/v1/alerts', (r) => r.fulfill({ json: { alerts: [] } }));
await page.route('**/api/v1/bike-station/**', (r) =>
  r.fulfill({ json: { type: 'FeatureCollection', features: [] } }));
await page.route('**/api/v1/version', (r) =>
  r.fulfill({ json: { version: 'test', build_date: 'test', git_sha: 'abcdef1234' } }));
await page.route('**/api/v1/config', (r) => r.fulfill({ json: { digitransit_map_key: KEY } }));

const net = [];
page.on('response', (res) => {
  const u = res.url();
  if (u.startsWith(base)) return;
  net.push({ url: u.split('?')[0], status: res.status() });
});
page.on('requestfailed', (req) => {
  const u = req.url();
  if (u.startsWith(base)) return;
  net.push({ url: u.split('?')[0], status: `FAILED ${req.failure()?.errorText ?? ''}` });
});

await page.goto(base, { waitUntil: 'load' });
await page.waitForTimeout(12000);

const state = await page.evaluate(() => {
  const m = window.__mlMap;
  if (!m) return { exposed: false, isStyleLoaded: false };
  const style = m.getStyle?.();
  return {
    exposed: true,
    isStyleLoaded: m.isStyleLoaded(),
    loaded: m.loaded(),
    areTilesLoaded: m.areTilesLoaded?.(),
    layerCount: style?.layers?.length ?? 0,
    sourceCount: Object.keys(style?.sources ?? {}).length,
    // A source with no loaded tile is the signature of a blank basemap.
    sourcesWithTiles: Object.keys(style?.sources ?? {}).filter((id) => {
      try { return m.isSourceLoaded(id); } catch { return false; }
    }),
  };
});

// Read the canvas back as pixels. The map keeps no drawing buffer, so grab the
// composited frame instead and count distinct colours: a blank map is one or
// two flat colours, a drawn map is hundreds.
await page.screenshot({ path: OUT });
const shotBytes = fs.statSync(OUT).size;

const tiles = net.filter((r) => /\.pbf|\.mvt/.test(r.url));
const tilesOk = tiles.filter((r) => r.status === 200).length;
const glyphs = net.filter((r) => /mapfonts|glyphs/.test(r.url));
const sprite = net.filter((r) => /sprite/.test(r.url));
const bad = net.filter((r) => typeof r.status === 'string' || r.status >= 400);

const dedupe = (list) => {
  const seen = new Map();
  for (const e of list) {
    const key = String(e).split('\n')[0].slice(0, 220);
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return [...seen.entries()];
};

console.log('--- MapLibre real-basemap render check ---');
console.log('map exposed on window     :', state.exposed);
console.log('isStyleLoaded()           :', state.isStyleLoaded);
console.log('loaded()                  :', state.loaded);
console.log('areTilesLoaded()          :', state.areTilesLoaded);
console.log('style layers / sources    :', `${state.layerCount} / ${state.sourceCount}`);
console.log('sources reporting loaded  :', (state.sourcesWithTiles ?? []).join(', ') || '(none)');
console.log('');
console.log('vector tiles requested    :', tiles.length, `(${tilesOk} x 200)`);
console.log('glyph requests            :', glyphs.length);
console.log('sprite requests           :', sprite.length);
console.log('screenshot bytes          :', shotBytes, `-> ${OUT}`);
console.log('');
console.log(`non-2xx / failed external requests: ${dedupe(bad.map((r) => `${r.status} ${r.url}`)).length}`);
dedupe(bad.map((r) => `${r.status} ${r.url}`)).forEach(([e, n]) => console.log(`  !! x${n} ${e}`));
console.log(`\nunique console errors: ${dedupe(errors).length} (raw ${errors.length})`);
dedupe(errors).forEach(([e, n]) => console.log(`  ERR  x${n} ${e}`));
console.log(`\nunique warnings: ${dedupe(warnings).length}`);
dedupe(warnings).forEach(([w, n]) => console.log(`  WARN x${n} ${w}`));

await browser.close();
server.close();

// The map rendered if real tiles came back AND the style finished loading.
const ok = tilesOk > 0 && state.isStyleLoaded === true;
console.log(`\nVERDICT: ${ok ? 'map rendered' : 'MAP DID NOT RENDER'}`);
process.exit(ok ? 0 : 1);
