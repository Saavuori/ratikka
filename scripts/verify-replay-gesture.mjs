// Opens the timelapse the way a phone does: one tap on the version badge,
// dispatched as real touch input in a touch-enabled Chromium.
//
// Why this exists: opening the panel is entirely browser behaviour, and nothing
// about it is type-checked or reachable from a DOM-less unit test. The bug it
// was written for looked correct in the source — the badge opened the timelapse
// on `dblclick`, which a mouse emits and a touchscreen does not — so a phone
// could not reach the archive at all and got the changelog instead. Only a
// browser driven by touch says which of those happened.
//
// Usage (from the repo root):
//   npm i --no-save playwright   # once per checkout
//   node scripts/verify-replay-gesture.mjs
import { chromium, devices } from 'playwright';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FRONTEND = path.join(ROOT, 'frontend');

if (!fs.existsSync(path.join(FRONTEND, 'node_modules', 'rolldown'))) {
  console.error('frontend dependencies missing. Run "npm install" in frontend/ first.');
  process.exit(2);
}

// Bundle the component itself, so this checks the badge the app ships rather
// than a re-typed copy of its gesture handling.
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ratikka-gesture-'));
process.once('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));
// The entry has to live inside frontend/ so bare imports resolve against its
// node_modules; rolldown would otherwise leave react external and unbundled.
const entryPath = path.join(FRONTEND, 'src', `__gesture-entry-${process.pid}.tsx`);
process.once('exit', () => fs.rmSync(entryPath, { force: true }));
fs.writeFileSync(
  entryPath,
  `import { createRoot } from 'react-dom/client';
   import { VersionBadge } from ${JSON.stringify(path.join(FRONTEND, 'src/components/VersionBadge.tsx'))};
   declare global { interface Window { reveals: number } }
   window.reveals = 0;
   const plain = new URLSearchParams(location.search).has('plain');
   createRoot(document.getElementById('root')!).render(
     <VersionBadge onReveal={plain ? undefined : () => { window.reveals += 1; }} />
   );`
);

const { rolldown } = await import(
  pathToFileURL(path.join(FRONTEND, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href
);
const bundle = await rolldown({
  input: entryPath,
  cwd: FRONTEND,
  platform: 'browser',
  logLevel: 'silent',
});
await bundle.write({ dir: outDir, format: 'iife', entryFileNames: 'badge.js' });
await bundle.close();
const script = fs.readFileSync(path.join(outDir, 'badge.js'), 'utf8');
const css = fs.readFileSync(path.join(FRONTEND, 'src', 'index.css'), 'utf8');

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  if (urlPath === '/badge.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript' }).end(script);
    return;
  }
  if (urlPath === '/api/v1/version') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ version: 'v0.66.0', build_date: '', git_sha: 'abc1234' }));
    return;
  }
  if (urlPath === '/changelog') {
    res.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><title>changelog</title>');
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html' }).end(
    // The viewport meta is the app's own (frontend/index.html): without it a
    // phone lays the page out at 980 px and the mobile rules never apply.
    `<!doctype html><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1.0">` +
    `<style>${css}</style>` +
    '<div class="dashboard-container"><div id="root"></div></div>' +
    // React reads process.env.NODE_ENV, which nothing defines in a bare page.
    '<script>window.process={env:{NODE_ENV:"production"}}</script>' +
    '<script src="/badge.js"></script>'
  );
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
});

const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`);
  if (!ok) failures.push(what);
};

/**
 * Runs one gesture and reports what the badge did with it: how many times it
 * asked for the timelapse, and whether anything navigated to the changelog —
 * in this tab or a new one, since the badge may reach it either way.
 */
async function gesture(deviceName, taps, gapMs = 0, { revealable = true } = {}) {
  const context = await browser.newContext({
    ...devices[deviceName],
    // The badge's link, and the changelog itself, are outside this server.
    baseURL: base,
  });
  await context.route('https://saavuori.github.io/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>changelog</title>' })
  );
  const page = await context.newPage();
  const opened = [];
  context.on('page', (p) => opened.push(p.url()));
  page.on('framenavigated', (f) => { if (f === page.mainFrame() && !f.url().startsWith(base)) opened.push(f.url()); });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (process.env.DEBUG_GESTURE) {
    page.on('console', (m) => console.log('  console:', m.text()));
    page.on('pageerror', (e) => console.log('  pageerror:', e.message));
    page.on('requestfailed', (r) => console.log('  requestfailed:', r.url(), r.failure()?.errorText));
  }

  await page.goto(revealable ? base : `${base}/?plain=1`, { waitUntil: 'load' });
  const badge = page.locator('.version-badge');
  await badge.waitFor({ state: 'visible', timeout: 10000 });
  const box = await badge.boundingBox();
  const at = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };

  const touch = devices[deviceName].hasTouch;
  for (let i = 0; i < taps; i++) {
    if (i) await page.waitForTimeout(gapMs);
    if (touch) await page.touchscreen.tap(at.x, at.y);
    else await page.mouse.click(at.x, at.y, { clickCount: 1 });
  }
  // Long enough for a navigation the badge starts to be seen.
  await page.waitForTimeout(500);

  const reveals = await page.evaluate(() => window.reveals);
  const result = { reveals, navigations: opened.length, errors, box };
  await context.close();
  return result;
}

console.log('touch: one tap opens the timelapse');
{
  const r = await gesture('Pixel 7', 1);
  check(r.reveals === 1, `a tap reveals the timelapse once (got ${r.reveals})`);
  check(r.navigations === 0, `a tap does not open the changelog (got ${r.navigations} navigations)`);
  check(r.errors.length === 0, `no page errors (${r.errors.join('; ') || 'none'})`);
  // The badge is small by design, but what opens the archive has to be hittable.
  check(r.box.height >= 32, `badge is tall enough for a thumb (${Math.round(r.box.height)} px)`);
  check(r.box.width >= 44, `badge is wide enough for a thumb (${Math.round(r.box.width)} px)`);
}

console.log('touch: a second tap is not swallowed by the first');
{
  const r = await gesture('Pixel 7', 2, 90);
  check(r.reveals === 2, `each tap asks for the timelapse (got ${r.reveals})`);
  check(r.navigations === 0, `no tap opens the changelog (got ${r.navigations} navigations)`);
}

console.log('mouse: one click does the same');
{
  const r = await gesture('Desktop Chrome', 1);
  check(r.reveals === 1, `a click reveals the timelapse once (got ${r.reveals})`);
  check(r.navigations === 0, `a click does not open the changelog (got ${r.navigations})`);
}

console.log('an instance with no history is only its link');
{
  const r = await gesture('Pixel 7', 1, 0, { revealable: false });
  check(r.reveals === 0, `no timelapse is offered (got ${r.reveals})`);
  check(r.navigations === 1, `the tap opens the changelog (got ${r.navigations} navigations)`);
}

await browser.close();
server.close();

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nall replay-gesture checks passed');
