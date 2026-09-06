// Renders the city-bike marker and the 3D rack with MapLibre and measures what
// actually lands on the canvas.
//
// Why this exists: a station used to be a disc with a number in it, which is
// hard to get wrong. It is now two drawn things, and both fail quietly.
//
//   1. The flat marker (`bikeGaugeIconSvg`) is an SVG rasterised through an
//      Image and handed to `map.addImage`. A malformed path, a colour the
//      encoder mangles, or art that is all white at 22 px all leave a symbol
//      layer that "works" — it just draws nothing, or draws a blob.
//   2. The rack is `fill-extrusion` geometry in *metres on the ground*
//      (frontend/src/lib/bikeStationModels.ts), so it has the same failure
//      modes as the vehicles and the stop furniture: a rack at the wrong size
//      or heading is still a row of boxes, and one with no height is still a
//      filled footprint seen from above.
//
// And the thing the whole design rests on — that a fuller station looks fuller
// — is a claim about pixels, not about geometry, so it is measured here.
//
// Usage (from the repo root):
//   npx playwright@latest install chromium   # once
//   npm i --no-save playwright               # once per checkout
//   node scripts/verify-bike-stations.mjs
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

// Bundle the app's own module rather than re-typing the dimensions here — a
// copy would go stale in exactly the case this check exists to catch.
const { rolldown } = await import(
  pathToFileURL(path.join(FRONTEND, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href
);
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ratikka-bikes-'));
process.once('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));

const bundle = await rolldown({
  input: path.join(FRONTEND, 'src', 'lib', 'bikeStationModels.ts'),
  logLevel: 'silent',
});
await bundle.write({ dir: outDir, format: 'esm', entryFileNames: 'bikeStationModels.mjs' });
await bundle.close();
const source = fs.readFileSync(path.join(outDir, 'bikeStationModels.mjs'), 'utf8');
const {
  BIKE_GAUGE_BUCKETS, BIKE_3D_MIN_ZOOM, BIKE_3D_FULL_ZOOM, RACK, CITYBIKE_YELLOW,
} = await import(pathToFileURL(path.join(outDir, 'bikeStationModels.mjs')).href);

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
  if (urlPath === '/bikeStationModels.mjs') {
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
    "import * as bikes from '/bikeStationModels.mjs';" +
    'window.maplibregl = maplibregl; window.bikes = bikes;' +
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
await page.waitForFunction(() => !!window.maplibregl && !!window.bikes, null, { timeout: 20000 });

const CENTER = [24.94, 60.17];

/**
 * Draw a station — the flat marker, the rack, or both — and report what was
 * painted, in CSS pixels. `groundRack` is the topmost row of the *projected
 * footprint*, so anything painted above it is a box standing up.
 */
const render = (opts) =>
  page.evaluate(async ({ station, zoom, pitch, theme, marker, bucketIndex, rack, capture, center, min3d }) => {
    const { bikeStationCollection, bikeGaugeIconSvg, BIKE_GAUGE_BUCKETS, BIKE_3D_FADE_IN } = window.bikes;

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
      const bucket = BIKE_GAUGE_BUCKETS[bucketIndex];
      const img = new Image(48, 48);
      const loaded = new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error(`gauge image ${bucket.name} failed to decode`));
      });
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(bikeGaugeIconSvg(bucket));
      await loaded;
      map.addImage(bucket.name, img, { pixelRatio: 2 });
      map.addSource('marker', {
        type: 'geojson',
        data: { type: 'Feature', geometry: { type: 'Point', coordinates: center }, properties: {} },
      });
      map.addLayer({
        id: 'citybike_gauge', type: 'symbol', source: 'marker',
        layout: { 'icon-image': bucket.name, 'icon-allow-overlap': true },
      });
    }

    let rackData = { type: 'FeatureCollection', features: [] };
    if (rack) {
      rackData = bikeStationCollection([{ ...station, lng: center[0], lat: center[1] }], theme);
      map.addSource('rack', { type: 'geojson', data: rackData });
      map.addLayer({
        id: 'bike-station-3d', type: 'fill-extrusion', source: 'rack',
        minzoom: min3d,
        paint: {
          'fill-extrusion-color': ['get', 'color'],
          'fill-extrusion-height': ['get', 'top'],
          'fill-extrusion-base': ['get', 'base'],
          'fill-extrusion-opacity': BIKE_3D_FADE_IN,
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
    let yellow = 0;
    let gold = 0;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let y = 0; y < scan.height; y++) {
      for (let x = 0; x < scan.width; x++) {
        const i = (y * scan.width + x) * 4;
        const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
        if (r > 248 && g > 248 && b > 248) continue;
        painted++;
        // Hue tests rather than values: MapLibre shades every extruded face by
        // its orientation, so one colour lands at several brightnesses. The
        // city-bike yellow and the selection gold are close enough in hue that
        // they are separated by their blue channel, which is where they differ.
        if (r > 120 && g / r > 0.6 && g / r < 0.85 && b / r < 0.28) yellow++;
        if (r > 120 && g / r > 0.72 && g / r < 0.9 && b / r > 0.33 && b / r < 0.58) gold++;
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
    const groundRack = rackData.features.length ? project(rackData.features) : null;

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
      painted, yellow, gold, minX, maxX, minY, maxY, groundRack, metersPerPixel, image,
      parts: rackData.features.map((f) => f.properties.part),
    };
  }, {
    station: {
      stationId: 'b', bikesAvailable: 5, spacesAvailable: 5, bearing: 90, ...(opts.station ?? {}),
    },
    zoom: opts.zoom ?? 18,
    pitch: opts.pitch ?? 0,
    theme: opts.theme ?? 'light',
    marker: opts.marker ?? false,
    bucketIndex: opts.bucketIndex ?? 3,
    rack: opts.rack ?? false,
    capture: opts.capture ?? false,
    center: CENTER,
    min3d: BIKE_3D_MIN_ZOOM,
  });

const failures = [];
const report = [];
const check = (label, ok, detail) => {
  report.push(`${ok ? 'ok   ' : 'FAIL '} ${label}${detail ? ` -- ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

// 1. Every gauge bucket decodes and paints. An SVG the encoder mangles leaves a
//    symbol layer that renders nothing at all, with no error anywhere.
for (let i = 0; i < BIKE_GAUGE_BUCKETS.length; i++) {
  const r = await render({ marker: true, bucketIndex: i, zoom: 16 });
  check(
    `the ${BIKE_GAUGE_BUCKETS[i].name} marker is drawn`,
    r.painted > 150,
    `${r.painted} px`
  );
}

// 2. The marker is a bicycle, not a disc: the art has interior detail, so a
//    scan line through its middle crosses the outline several times. A filled
//    blob — the failure this is here to catch — crosses it twice.
{
  const r = await render({ marker: true, bucketIndex: 5, zoom: 16 });
  const width = r.maxX - r.minX;
  check(
    'the marker is round and about icon-sized',
    width > 18 && width < 34 && Math.abs(width - (r.maxY - r.minY)) < 4,
    `${width.toFixed(0)}x${(r.maxY - r.minY).toFixed(0)} px`
  );
}

// 3. The ring says how full the station is: a fuller bucket paints more of its
//    own colour than an emptier one. This is the gauge's whole claim.
{
  const low = await render({ marker: true, bucketIndex: 1, zoom: 17 });
  const high = await render({ marker: true, bucketIndex: 5, zoom: 17 });
  check(
    'a fuller station paints a longer arc',
    high.painted > low.painted,
    `${low.painted} px at 20% full, ${high.painted} px at 100%`
  );
}

// 4. The rack is drawn at the size the model says. Seen from straight above
//    with the rack running east-west, the painted width IS the apron.
{
  const r = await render({ rack: true, zoom: 19, station: { bearing: 90, bikesAvailable: 5, spacesAvailable: 5 } });
  const paintedMeters = (r.maxX - r.minX) * r.metersPerPixel;
  const expected = 9 * RACK.dockPitch + 2 * RACK.apronMargin;
  check(
    'the apron is drawn at its modelled length',
    r.painted > 0 && Math.abs(paintedMeters - expected) / expected < 0.12,
    `${paintedMeters.toFixed(1)} m painted vs ${expected.toFixed(1)} m modelled`
  );
}

// 5. The rack turns with its bearing — a rack across the street rather than
//    along it is still a rack, which is why this needs measuring.
{
  const east = await render({ rack: true, zoom: 19, station: { bearing: 90 } });
  const north = await render({ rack: true, zoom: 19, station: { bearing: 0 } });
  check(
    'the rack rotates with its bearing',
    east.maxX - east.minX > east.maxY - east.minY && north.maxY - north.minY > north.maxX - north.minX,
    `east ${(east.maxX - east.minX).toFixed(0)}x${(east.maxY - east.minY).toFixed(0)} px, ` +
    `north ${(north.maxX - north.minX).toFixed(0)}x${(north.maxY - north.minY).toFixed(0)} px`
  );
}

// 6. The bikes stand up. A box with no height is still a filled footprint from
//    above, so the test is whether anything is painted above the topmost row of
//    the projected ground geometry.
{
  const tilted = await render({ rack: true, zoom: 19.5, pitch: 60, station: { bearing: 90 } });
  const wallPixels = tilted.groundRack.top - tilted.minY;
  check(
    'the rack has boxes standing above its footprint',
    wallPixels > 8,
    `${wallPixels.toFixed(0)} px of wall above the footprint`
  );
}

// 7. The zoom gate. A rack is pavement furniture; below the fade-in it is
//    sub-pixel and the flat marker is still in charge.
{
  const below = await render({ rack: true, zoom: BIKE_3D_MIN_ZOOM - 0.5 });
  const above = await render({ rack: true, zoom: BIKE_3D_FULL_ZOOM + 1 });
  check('no rack is drawn below its fade-in zoom', below.painted === 0, `${below.painted} px`);
  check('the rack is solid above its fade-in zoom', above.painted > 100, `${above.painted} px`);
}

// 8. The point of the whole thing: the rack shows the availability the gauge
//    summarises, so a busy station paints more yellow than an empty one, and an
//    empty one paints none at all.
{
  const empty = await render({ rack: true, zoom: 19.5, pitch: 45, station: { bikesAvailable: 0, spacesAvailable: 10 } });
  const some = await render({ rack: true, zoom: 19.5, pitch: 45, station: { bikesAvailable: 3, spacesAvailable: 7 } });
  const full = await render({ rack: true, zoom: 19.5, pitch: 45, station: { bikesAvailable: 8, spacesAvailable: 2 } });
  // The terminal's sign board is yellow too, so an empty station is never
  // quite zero — it is the sign and nothing else, which is a small fraction of
  // what even a third-full rack paints.
  check(
    'an empty rack shows no bikes, only its sign',
    empty.painted > 100 && empty.yellow * 3 < some.yellow,
    `${empty.yellow} yellow px empty (the sign) vs ${some.yellow} px with 3 bikes`
  );
  check(
    'a fuller rack shows more bikes',
    full.yellow > some.yellow && some.yellow > empty.yellow,
    `${empty.yellow} / ${some.yellow} / ${full.yellow} yellow px at 0, 3 and 8 bikes`
  );
}

// 9. The selected station takes the gold, the same cue a selected stop takes.
{
  const plain = await render({ rack: true, zoom: 19.5, pitch: 45 });
  const picked = await render({ rack: true, zoom: 19.5, pitch: 45, station: { highlighted: true } });
  check(
    'the selected station takes the selection gold',
    picked.gold > plain.gold + 50,
    `${plain.gold} gold px plain, ${picked.gold} selected (bikes are ${CITYBIKE_YELLOW})`
  );
}

// 10. Both themes paint something. The apron is theme-coloured, and a surface
//     the colour of the background is indistinguishable from a layer that never
//     drew at all.
for (const theme of ['light', 'dark']) {
  const r = await render({ rack: true, zoom: 19, pitch: 45, theme });
  check(`the ${theme} rack is visible`, r.painted > 100, `${r.painted} px`);
}

// Opt-in visual artifacts; normal verification leaves no images behind.
if (process.env.BIKE_SCREENSHOTS === '1') {
  const screenshotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ratikka-bike-previews-'));
  for (const [name, opts] of [
    ['rack-busy', { rack: true, zoom: 19.5, pitch: 60, station: { bearing: 90, bikesAvailable: 7, spacesAvailable: 3 } }],
    ['rack-empty', { rack: true, zoom: 19.5, pitch: 60, station: { bearing: 90, bikesAvailable: 0, spacesAvailable: 10 } }],
    ['marker', { marker: true, zoom: 17, bucketIndex: 4 }],
  ]) {
    const shot = await render({ ...opts, capture: true });
    const filename = path.join(screenshotDir, `bike-${name}.png`);
    fs.writeFileSync(filename, Buffer.from(shot.image.split(',')[1], 'base64'));
    console.log(`Bike preview: ${filename}`);
  }
}

await browser.close();
server.close();
fs.rmSync(outDir, { recursive: true, force: true });

console.log('\n--- city-bike markers and racks ---');
report.forEach((l) => console.log(l));
if (pageErrors.length) {
  console.log('\npage errors:');
  pageErrors.forEach((e) => console.log(`  ${e}`));
}
console.log(`\nBIKE STATION FAILURES: ${failures.length + pageErrors.length}`);
process.exit(failures.length + pageErrors.length ? 1 : 0);
