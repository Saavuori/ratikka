// Boots the built app against a stubbed line 4 and checks that bunched trams
// and a gap in the service are drawn, listed and explained.
//
// Why this exists: the spacing between vehicles is shown in three places that
// only work together in a browser. The map ties a bunched pair together and
// runs a gap along the rails between two trams — geometry read off the
// animation's own interpolated positions and the snapped track, so it is
// decided per frame by MapLibre, not by anything a unit test renders. The lines
// panel lists the problems and puts a dot on the line's button. The vehicle
// panel shows the neighbours either side. Each can be right on its own and the
// feature still wrong: a gap drawn on a line the reader never picked, a list
// entry that selects nothing, a gap drawn as a straight line across the blocks.
//
// Usage (from the repo root):
//   cd frontend && npm run build && cd ..
//   npx playwright@latest install chromium   # once
//   node scripts/verify-headways.mjs
// Set HEADWAY_SCREENSHOTS=1 to also write screenshots of each state.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(DIST, 'index.html');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

// Google's polyline encoding, for the stubbed route geometry.
function encodePolyline(coords) {
  let out = '';
  let prevLat = 0;
  let prevLng = 0;
  const enc = (v) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    let s = '';
    while (n >= 0x20) {
      s += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
      n >>= 5;
    }
    return s + String.fromCharCode(n + 63);
  };
  for (const [lng, lat] of coords) {
    const la = Math.round(lat * 1e5);
    const ln = Math.round(lng * 1e5);
    out += enc(la - prevLat) + enc(ln - prevLng);
    prevLat = la;
    prevLng = ln;
  }
  return out;
}

// Line 4, heading out: east along one street, then north up another. The
// corner is what the gap has to follow rather than cut.
const CORNER = [24.945, 60.170];
const TRACK = [[24.930, 60.170], CORNER, [24.945, 60.180]];
const points = encodePolyline(TRACK);

// Three trams, running east then north. The front two are 40 seconds apart on
// a six-minute line; the third is seventeen minutes behind them, round the
// corner and back down the street.
//
// They stand still. A vehicle is only pulled onto its rails when it reports a
// new position or has none to carry on from, and the rails arrive a moment
// after the first snapshot does — so a moving tram whose stubbed coordinate
// never changed would keep the unsnapped anchor it started with, which no
// real feed produces.
const tram = (veh, lng, lat, hdg, hw) => ({
  veh, desi: '4', route: '1004', dir: '1', mode: 'tram', lat, lng, hdg,
  spd: 0, acc: 0, drst: 0, dl: 0, stop: null, nextStop: 'HSL:1130106',
  tripId: `HSL:1004_${veh}`, oday: '2026-09-19', start: '19:00', hw,
});
const vehicles = {
  front: tram('front', 24.945, 60.1765, 0),
  bunched: tram('bunched', 24.945, 60.1752, 0,
    { ahead: 'front', secs: 40, sched: 360, state: 'bunched', stop: 'HSL:1130104' }),
  gap: tram('gap', 24.9345, 60.170, 90,
    { ahead: 'bunched', secs: 1020, atLeast: true, sched: 360, state: 'gap' }),
};

const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.addInitScript(() => { window.__mlProbe = true; });

const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && /Vehicle animation frame failed|addLayer|addSource/.test(m.text())) {
    pageErrors.push(m.text());
  }
});

let stream;
const send = () => stream?.send(JSON.stringify({
  type: 'positions', timestamp: new Date().toISOString(),
  count: Object.keys(vehicles).length,
  vehicles: Object.fromEntries(Object.entries(vehicles).map(([k, v]) =>
    [k, { ...v, ts: Math.floor(Date.now() / 1000) }])),
}));
await page.routeWebSocket('**/api/v1/stream', (socket) => {
  stream = socket;
  socket.onMessage(send);
});
// Once a second, as the backend broadcasts.
const ticker = setInterval(send, 1000);

// A 1x1 transparent PNG, for sprite sheets and raster tiles.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64');

// Playwright matches the most recently registered route first, so the
// catch-all must be registered BEFORE the specific ones.
await page.route('**/api/v1/**', (r) => r.fulfill({ json: {} }));
await page.route('**/api/v1/alerts', (r) => r.fulfill({ json: { alerts: [] } }));
await page.route('**/api/v1/bike-stations', (r) =>
  r.fulfill({ json: { type: 'FeatureCollection', features: [] } }));
await page.route('**/api/v1/traffic-lights', (r) =>
  r.fulfill({ json: { type: 'FeatureCollection', features: [] } }));
await page.route('**/api/v1/route/**', (r) => r.fulfill({ json: {
  shortName: '4', color: '#E4418A', stops: [],
  geometries: [points],
  patterns: [{ points, directionId: 0 }],
} }));
await page.route('**/api/v1/trip/**', (r) => r.fulfill({ json: {
  tripId: 'HSL:1004_gap', headsign: 'Munkkiniemi',
  route: { shortName: '4', longName: 'Katajanokka - Munkkiniemi', color: '#E4418A' },
  stops: [],
} }));
await page.route('**/api/v1/version', (r) =>
  r.fulfill({ json: { version: 'test', build_date: 'test', git_sha: 'abcdef1234' } }));
await page.route('**/api/v1/config', (r) =>
  r.fulfill({ json: { digitransit_map_key: 'test-key' } }));

// Every external map asset (style, TileJSON, sprites, glyphs, tiles) is
// stubbed: the basemap is not what is being checked.
const stubAsset = (r) => {
  const u = r.request().url();
  if (u.includes('style.json')) {
    return r.fulfill({ json: {
      version: 8,
      glyphs: `${base}/stub/{fontstack}/{range}.pbf`,
      sources: {},
      layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#eef1f4' } }],
    } });
  }
  if (u.includes('.png')) return r.fulfill({ contentType: 'image/png', body: PNG });
  if (u.includes('sprite')) return r.fulfill({ json: {} });
  if (u.includes('.json')) {
    return r.fulfill({ json: {
      tilejson: '2.2.0', tiles: [`${base}/stub/{z}/{x}/{y}.pbf`],
      minzoom: 0, maxzoom: 14, bounds: [-180, -85, 180, 85],
    } });
  }
  return r.fulfill({ status: 200, contentType: 'application/x-protobuf', body: '' });
};
await page.route('**/*', (r) => {
  const u = r.request().url();
  if (u.startsWith(`${base}/stub/`)) return stubAsset(r);
  if (u.startsWith(base)) return r.fallback();
  return stubAsset(r);
});

const report = [];
const check = (name, ok, detail = '') => {
  report.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) process.exitCode = 1;
};

const shotDir = process.env.HEADWAY_SCREENSHOTS === '1'
  ? fs.mkdtempSync(path.join(os.tmpdir(), 'ratikka-headway-previews-'))
  : null;
const shot = async (name) => {
  if (!shotDir) return;
  const file = path.join(shotDir, `headway-${name}.png`);
  // Let the map repaint and the panels finish sliding in.
  await page.waitForTimeout(800);
  await page.screenshot({ path: file });
  console.log(`Headway preview: ${file}`);
};

const links = () => page.evaluate(async () => {
  const source = window.__mlMap?.getSource('headway-links');
  if (!source) return [];
  const data = await source.getData();
  return data.features.map((f) => ({ state: f.properties.state, coords: f.geometry.coordinates }));
});

// The first link of a kind to be drawn, polled from here rather than with
// `waitForFunction`: the source only answers asynchronously, and a predicate
// returning a promise is truthy before it has said anything.
const drawnLink = async (state, timeoutMs = 15000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const link = (await links()).find((l) => l.state === state);
    if (link) return link;
    await page.waitForTimeout(100);
  }
  return null;
};

await page.goto(base, { waitUntil: 'load' });
await page.waitForFunction(() => window.__mlMap?.getLayer('headway-bunched'));
await page.evaluate(() => window.__mlMap.jumpTo({ center: [24.941, 60.1735], zoom: 15 }));
send();

// 1. A bunch is drawn wherever it is; a gap only on a line picked out.
{
  const bunch = await drawnLink('bunched');
  check('a bunched pair is tied together on the map', !!bunch);
  const drawn = await links();
  check('a gap is not drawn on a line nobody picked', !drawn.some((l) => l.state === 'gap'),
    drawn.map((l) => l.state).join(', '));
}

// 2. The lines panel lists both, worst first, and flags the line.
const spacing = page.getByRole('region', { name: 'Line spacing' });
await spacing.waitFor();
const plain = (text) => text.replace(/\u00a0/g, ' ');
const entries = (await spacing.getByRole('button').allTextContents()).map(plain);
check('the lines panel lists the gap and the bunch',
  entries.some((t) => t.includes('Gap') && t.includes('≥ 17 min')) &&
  entries.some((t) => t.includes('Bunched') && t.includes('2 trams, 40 s apart')),
  entries.join(' | '));
check('the gap, costing more waiting, is listed first', entries[0]?.includes('Gap'), entries[0]);
const lineButton = page.getByRole('button', { name: 'Line 4, bunched' });
check('the line button carries the bunch', await lineButton.count() === 1);
await shot('overview');

// 3. Picking the line draws its gap, along the rails and round the corner.
await lineButton.click();
{
  const gap = await drawnLink('gap');
  const turnsTheCorner = !!gap?.coords.some(([lng, lat]) =>
    Math.abs(lng - CORNER[0]) < 1e-6 && Math.abs(lat - CORNER[1]) < 1e-6);
  check('the gap runs along the rails, round the corner between the two', turnsTheCorner,
    gap ? `${gap.coords.length} points` : 'no gap drawn');
}
await shot('line-picked');

// 4. The gap's entry opens the tram at the back of it, with its neighbours.
await spacing.getByRole('button', { name: /gap/ }).first().click();
const card = page.locator('.headway-card');
await card.waitFor();
const cardText = plain(await card.innerText());
check('the entry opens the tram at the back of the gap', cardText.includes('Running in a gap'), cardText.replace(/\s+/g, ' '));
// innerText carries the labels' CSS capitals, hence the case-blind match.
check('the card says how far behind, as a lower bound', /ahead\s*≥ 17 min/i.test(cardText));
check('the card gives the timetable it is judged against', cardText.includes('Timetabled every 6 min'));
await shot('vehicle-panel');
if (shotDir) {
  await page.getByRole('button', { name: 'Switch to dark map', exact: true }).click();
  await shot('vehicle-panel-dark');
  await page.getByRole('button', { name: 'Switch to light map', exact: true }).click();
}

// 5. The neighbour ahead opens with a tap, and it is bunched.
await card.getByRole('button', { name: /^Ahead/ }).click();
await page.waitForFunction(() =>
  document.querySelector('.headway-card')?.textContent?.includes('Bunched with the one ahead'));
check('the vehicle ahead opens from the card, bunched', true);

check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

clearInterval(ticker);
await browser.close();
server.close();

console.log('\n--- headways ---');
report.forEach((l) => console.log(l));
