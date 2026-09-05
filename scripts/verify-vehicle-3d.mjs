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
process.once('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));
const bundle = await rolldown({
  input: path.join(FRONTEND, 'src', 'lib', 'vehicleModels.ts'),
  logLevel: 'silent',
});
await bundle.write({ dir: outDir, format: 'esm', entryFileNames: 'vehicleModels.mjs' });
await bundle.close();
const libSource = fs.readFileSync(path.join(outDir, 'vehicleModels.mjs'), 'utf8');
const { VEHICLE_MODELS, VEHICLE_3D_MIN_ZOOM, VEHICLE_3D_FULL_ZOOM, vehicleExtrusions } = await import(
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
const render = ({ mode, hdg = 90, zoom = 17, pitch = 0, doorsOpen = false, doorProgress, braking = false, flat = false, focus, capture = false }) =>
  page.evaluate(
    async ({ mode, hdg, zoom, pitch, doorsOpen, doorProgress, braking, flat, focus, capture, center, minZoom }) => {
      const { vehicleExtrusionCollection, VEHICLE_3D_FADE_IN, vehicleModel, offsetMeters } = window.vehicleModels;
      const model = vehicleModel(mode);
      const cameraCenter = focus
        ? offsetMeters(...center, hdg, focus === 'front' ? model.sections[0].front : model.sections.at(-1).back, 0)
        : center;
      document.getElementById('map').innerHTML = '';
      const map = new maplibregl.Map({
        container: 'map',
        // A blank style: no key, no tiles, nothing to confuse the pixel scan.
        style: {
          version: 8,
          sources: {},
          layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#ffffff' } }],
        },
        center: cameraCenter,
        zoom,
        pitch,
        fadeDuration: 0,
        preserveDrawingBuffer: true,
      });
      await new Promise((r) => map.on('load', r));

      const data = vehicleExtrusionCollection([
        { veh: 'v', lng: center[0], lat: center[1], hdg, mode, desi: '', doorsOpen, doorProgress, braking },
      ], zoom >= 16);
      map.addSource('vehicles-3d', { type: 'geojson', data });
      map.addLayer({
        id: 'vehicles-3d',
        type: 'fill-extrusion',
        source: 'vehicles-3d',
        minzoom: minZoom,
        layout: { visibility: flat ? 'none' : 'visible' },
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
      let red = 0;
      let head = 0;
      let redStrength = 0;
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
          if (px[i] > 90 && px[i] > px[i + 1] * 2 && px[i] > px[i + 2] * 1.7 && px[i + 2] > px[i + 1] * 1.05) {
            red++;
            redStrength += px[i];
          }
          if (px[i] > 170 && px[i + 1] > 160 && px[i + 2] > 95 && px[i + 2] < px[i + 1] * 0.8) head++;
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

      const image = capture ? glCanvas.toDataURL('image/png') : undefined;
      map.remove();
      return { painted, amber, cab, red, head, redStrength, minX, maxX, minY, maxY, groundTop, metersPerPixel, image };
    },
    { mode, hdg, zoom, pitch, doorsOpen, doorProgress, braking, flat, focus, capture, center: CENTER, minZoom: VEHICLE_3D_MIN_ZOOM }
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
  const far = await render({ mode: 'tram', zoom: VEHICLE_3D_FULL_ZOOM });
  check('real-scale bodies are visible at zoom 14', far.painted > 0, `${far.painted} px painted`);
  const flat = await render({ mode: 'tram', zoom: 18, flat: true });
  check('flat-map layer visibility hides all extrusions', flat.painted === 0, `${flat.painted} px painted`);
}

// 6. The doors have to stand proud of the flanks, or the doors-open cue is
//    swallowed by the body they are drawn inside. Only a tilted view can see
//    them — from straight above the roof hides the whole flank. The leaves also
//    have to *move*: a doorway that merely recolours in place is the thing this
//    check exists to catch, so the amber has to be narrower than the doors it
//    replaces rather than the same shape in a different colour.
{
  const shut = await render({ mode: 'bus', zoom: 18, pitch: 60 });
  const open = await render({ mode: 'bus', zoom: 18, pitch: 60, doorsOpen: true });
  const halfway = await render({ mode: 'bus', zoom: 18, pitch: 60, doorProgress: 0.5 });
  check(
    'open doors uncover an amber doorway on the flank',
    open.amber > 20 && shut.amber === 0 && open.amber < open.painted / 4,
    `${open.amber} amber px of ${open.painted} painted with the doors open, ${shut.amber} with them shut`
  );
  check('animated door progress progressively uncovers the opening',
    halfway.amber > shut.amber && halfway.amber < open.amber,
    `closed ${shut.amber}, half ${halfway.amber}, open ${open.amber} amber px`);
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

// Check visible mounted lamps against the complete body, not isolated polygons.
for (const mode of Object.keys(VEHICLE_MODELS)) {
  const front = await render({ mode, hdg: 150, zoom: 20, pitch: 60, focus: 'front' });
  const rear = await render({ mode, hdg: 330, zoom: 20, pitch: 60, focus: 'rear' });
  const braking = await render({ mode, hdg: 330, zoom: 20, pitch: 60, braking: true, focus: 'rear' });
  check(`${mode} headlights are visible on the front face`, front.head > 3, `${front.head} headlamp px`);
  check(`${mode} tail lamps are visible on the rear face`, rear.red > 3, `${rear.red} tail px`);
  if (mode === 'bus' || mode === 'tram') {
    check(`${mode} inferred road braking brightens rear lamps`,
      braking.redStrength > rear.redStrength * 1.1,
      `normal ${rear.redStrength}, braking ${braking.redStrength} red intensity sum`);
  }
  check(`${mode} inferred braking cue is visible on the roof`,
    braking.amber > rear.amber + 3, `normal ${rear.amber}, braking ${braking.amber} amber px`);
}

// Structural assertions use the same bundled geometry rendered above. Each
// open door must stay on a straight flank of its own section, never a gangway.
for (const [mode, model] of Object.entries(VEHICLE_MODELS)) {
  const state = { veh: 'v', lng: CENTER[0], lat: CENTER[1], hdg: 0, mode, desi: '', doorsOpen: true };
  const parts = vehicleExtrusions(state);
  const count = (part) => parts.filter((p) => p.properties.part === part).length;
  check(`${mode} has individually modelled sections and running gear`,
    count('body') === model.sections.length && count('gangway') === model.sections.length - 1 &&
    count('wheel') > 0 && count('pillar') > 0 && count('hvac') === model.hvac.length,
    `${count('body')} sections, ${count('wheel')} wheels, ${count('pillar')} pillars, ${count('hvac')} HVAC units`);
  check(`${mode} has the intended door sides and section-safe travel`,
    count('door') === model.doors.length * model.doorSides.length * 2 &&
    model.doors.every((d) => model.sections.some((s) =>
      d - model.doorWidth > s.back + (s.tail ?? 0) &&
      d + model.doorWidth < s.front - (s.nose ?? 0))));
  if (mode === 'metro' || mode === 'train') {
    const tails = (features) => features.filter((f) => f.properties.part === 'taillight');
    check(`${mode} tail lamps are not misrepresented as road brake lights`,
      JSON.stringify(tails(parts)) === JSON.stringify(tails(vehicleExtrusions({ ...state, braking: true }))));
  }
}

// Opt-in visual artifacts; normal verification leaves no images behind.
if (process.env.VEHICLE_SCREENSHOTS === '1') {
  const screenshotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ratikka-vehicle-previews-'));
  for (const mode of Object.keys(VEHICLE_MODELS)) {
    const shot = await render({
      mode, zoom: mode === 'bus' ? 20 : mode === 'tram' ? 19 : 17.5,
      pitch: 60, hdg: 110, doorsOpen: true, braking: true, capture: true,
    });
    const filename = path.join(screenshotDir, `vehicle-3d-preview-${mode}.png`);
    fs.writeFileSync(filename, Buffer.from(shot.image.split(',')[1], 'base64'));
    console.log(`Vehicle preview: ${filename}`);
  }
}

await browser.close();
server.close();
fs.rmSync(outDir, { recursive: true, force: true });

console.log('\n--- 3D vehicle bodies ---');
report.forEach((l) => console.log(l));
if (pageErrors.length) {
  console.log('\npage errors:');
  pageErrors.forEach((e) => console.log(`  ${e}`));
}
console.log(`\n3D VEHICLE FAILURES: ${failures.length + pageErrors.length}`);
process.exit(failures.length + pageErrors.length ? 1 : 0);
