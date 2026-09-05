// Renders the stop platforms and the 3D stop furniture with MapLibre and
// measures what actually lands on the canvas.
//
// Why this exists: a stop is now three separate things on the map, and none of
// them is checked by tsc or the unit tests.
//
//   1. The platform polygon comes from the basemap's own `transportation`
//      layer, restyled (frontend/src/lib/stopPlatforms.ts). If the kerb line
//      drifts off the surface it outlines, both still render — you just get a
//      pale blob with an outline near it.
//   2. The furniture is `fill-extrusion` geometry in *metres on the ground*
//      (frontend/src/lib/stopModels.ts), so the same two failures the vehicle
//      bodies have apply: a shelter at the wrong size or heading is still a
//      box, and a shelter with no height is still a filled footprint seen from
//      above.
//   3. The zoom gates decide whether any of it is drawn at all.
//
// verify-map-layers only asks whether the specs are valid; verify-map-renders
// only whether the basemap draws. This one measures pixels. It needs no
// Digitransit key — the basemap is blank and the stop is synthetic.
//
// Usage (from the repo root):
//   npx playwright@latest install chromium   # once
//   npm i --no-save playwright               # once per checkout
//   node scripts/verify-stop-markers.mjs
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

// Bundle the app's own modules rather than re-typing the dimensions and paint
// here — a copy would go stale in exactly the case this check exists to catch.
const { rolldown } = await import(
  pathToFileURL(path.join(FRONTEND, 'node_modules', 'rolldown', 'dist', 'index.mjs')).href
);
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ratikka-stops-'));
process.once('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));

const bundleOf = async (name) => {
  const bundle = await rolldown({
    input: path.join(FRONTEND, 'src', 'lib', `${name}.ts`),
    logLevel: 'silent',
  });
  await bundle.write({ dir: outDir, format: 'esm', entryFileNames: `${name}.mjs` });
  await bundle.close();
  return fs.readFileSync(path.join(outDir, `${name}.mjs`), 'utf8');
};
const sources = {
  stopModels: await bundleOf('stopModels'),
  stopPlatforms: await bundleOf('stopPlatforms'),
};
const {
  STOP_MODELS, STOP_3D_MIN_ZOOM, STOP_3D_FULL_ZOOM, stopExtrusions, acrossFrom,
} = await import(pathToFileURL(path.join(outDir, 'stopModels.mjs')).href);
const {
  STOP_PLATFORM_MIN_ZOOM, STOP_TACTILE_MIN_ZOOM, PLATFORM_EXTRUSION_HEIGHT,
} = await import(pathToFileURL(path.join(outDir, 'stopPlatforms.mjs')).href);

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
  const module = urlPath.replace(/^\/|\.mjs$/g, '');
  if (sources[module]) {
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    res.end(sources[module]);
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(
    '<!doctype html><meta charset="utf-8">' +
    '<style>html,body,#map{margin:0;width:800px;height:600px}</style>' +
    '<div id="map"></div>' +
    '<script type="module">' +
    "import * as maplibregl from '/dist/maplibre-gl.mjs';" +
    "import * as stopModels from '/stopModels.mjs';" +
    "import * as stopPlatforms from '/stopPlatforms.mjs';" +
    'window.maplibregl = maplibregl; window.stopModels = stopModels; window.stopPlatforms = stopPlatforms;' +
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
await page.waitForFunction(
  () => !!window.maplibregl && !!window.stopModels && !!window.stopPlatforms,
  null,
  { timeout: 20000 },
);

const CENTER = [24.94, 60.17];

/**
 * Draw a stop and report what was painted, in CSS pixels: how much, where, and
 * how much of it is the two hues that carry meaning (the selection gold and the
 * doors-open amber). `groundTop` is the topmost row of the *projected
 * footprint*, so anything painted above it is a wall standing up.
 */
const render = (opts) =>
  page.evaluate(async ({
    stop, zoom, pitch, theme, platform, platformLength, tactile, furniture, capture, center, min3d,
  }) => {
    const { stopFurnitureCollection } = window.stopModels;
    const {
      platformFillPaint, platformKerbPaint, platformTactilePaint, platformExtrusionPaint,
      STOP_PLATFORM_MIN_ZOOM, STOP_TACTILE_MIN_ZOOM,
    } = window.stopPlatforms;

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

    // A synthetic platform: a rectangle running east-west through the centre,
    // standing in for the OSM polygon the real layers read from vector tiles.
    const half = platformLength / 2;
    const mPerDegLat = 111320;
    const mPerDegLng = mPerDegLat * Math.cos((center[1] * Math.PI) / 180);
    const dx = half / mPerDegLng;
    const dy = 1.4 / mPerDegLat;
    const ring = [
      [center[0] - dx, center[1] - dy],
      [center[0] + dx, center[1] - dy],
      [center[0] + dx, center[1] + dy],
      [center[0] - dx, center[1] + dy],
      [center[0] - dx, center[1] - dy],
    ];
    const platformData = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: {} }],
    };

    if (platform) {
      map.addSource('platform', { type: 'geojson', data: platformData });
      map.addLayer({
        id: 'stop-platform-fill', type: 'fill', source: 'platform',
        minzoom: STOP_PLATFORM_MIN_ZOOM, paint: platformFillPaint(theme),
      });
      // Same order as the app: the band goes under the kerb line.
      if (tactile) {
        map.addLayer({
          id: 'stop-platform-tactile', type: 'line', source: 'platform',
          minzoom: STOP_TACTILE_MIN_ZOOM, paint: platformTactilePaint(theme),
        });
      }
      map.addLayer({
        id: 'stop-platform-kerb', type: 'line', source: 'platform',
        minzoom: STOP_PLATFORM_MIN_ZOOM, paint: platformKerbPaint(theme),
      });
      if (pitch > 0) {
        map.addLayer({
          id: 'stop-platform-3d', type: 'fill-extrusion', source: 'platform',
          minzoom: min3d, paint: platformExtrusionPaint(theme),
        });
      }
    }

    let furnitureData = { type: 'FeatureCollection', features: [] };
    if (furniture) {
      furnitureData = stopFurnitureCollection([{ ...stop, lng: center[0], lat: center[1] }], theme);
      map.addSource('furniture', { type: 'geojson', data: furnitureData });
      map.addLayer({
        id: 'stop-furniture-3d', type: 'fill-extrusion', source: 'furniture',
        minzoom: min3d,
        paint: {
          'fill-extrusion-color': ['get', 'color'],
          'fill-extrusion-height': ['get', 'top'],
          'fill-extrusion-base': ['get', 'base'],
          'fill-extrusion-opacity': window.stopModels.STOP_3D_FADE_IN,
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
    let gold = 0;
    let amber = 0;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let y = 0; y < scan.height; y++) {
      for (let x = 0; x < scan.width; x++) {
        const i = (y * scan.width + x) * 4;
        const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
        if (r > 248 && g > 248 && b > 248) continue;
        painted++;
        // Hue tests rather than values: MapLibre shades every extruded face by
        // its orientation, so the same colour lands at several brightnesses.
        if (r > 120 && g / r > 0.72 && g / r < 0.88 && b / r > 0.33 && b / r < 0.55) gold++;
        if (r > 120 && g / r > 0.55 && g / r < 0.78 && b / r < 0.30) amber++;
        minX = Math.min(minX, x / dpr); maxX = Math.max(maxX, x / dpr);
        minY = Math.min(minY, y / dpr); maxY = Math.max(maxY, y / dpr);
      }
    }

    // Where the drawn geometry sits on the ground, for the "does it stand up"
    // and "is the kerb on the surface" tests.
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
    const groundPlatform = project(platformData.features);
    const groundFurniture = furnitureData.features.length ? project(furnitureData.features) : null;

    const metersPerPixel = (() => {
      const a = map.project(center);
      const b = map.unproject([a.x + 100, a.y]);
      return (Math.abs(b.lng - center[0]) * mPerDegLng) / 100;
    })();

    const image = capture ? glCanvas.toDataURL('image/png') : undefined;
    map.remove();
    return {
      painted, gold, amber, minX, maxX, minY, maxY,
      groundPlatform, groundFurniture, metersPerPixel, image,
      parts: furnitureData.features.map((f) => f.properties.part),
    };
  }, {
    stop: { stopId: 's', mode: 'TRAM', bearing: 90, hasPlatform: false, ...(opts.stop ?? {}) },
    zoom: opts.zoom ?? 18,
    pitch: opts.pitch ?? 0,
    theme: opts.theme ?? 'light',
    platform: opts.platform ?? false,
    platformLength: opts.platformLength ?? 30,
    tactile: opts.tactile ?? false,
    furniture: opts.furniture ?? false,
    capture: opts.capture ?? false,
    center: CENTER,
    min3d: STOP_3D_MIN_ZOOM,
  });

const failures = [];
const report = [];
const check = (label, ok, detail) => {
  report.push(`${ok ? 'ok   ' : 'FAIL '} ${label}${detail ? ` -- ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

// 1. The kerb outlines the surface it belongs to. A line drawn from geometry
//    that has drifted still renders — it just fences off a different shape.
for (const theme of ['light', 'dark']) {
  const r = await render({ platform: true, theme, zoom: 18 });
  const offLeft = Math.abs(r.minX - r.groundPlatform.left) * r.metersPerPixel;
  const offRight = Math.abs(r.maxX - r.groundPlatform.right) * r.metersPerPixel;
  check(
    `${theme} platform is painted on the polygon it was given`,
    r.painted > 0 && offLeft < 1.5 && offRight < 1.5,
    `edges ${offLeft.toFixed(2)} m / ${offRight.toFixed(2)} m off, ${r.painted} px painted`
  );
}

// 2. The zoom gates. Platform detail across the whole city is noise, so none of
//    it may draw at city zoom — and all of it must by the time the stop signs
//    have taken over.
{
  const away = await render({ platform: true, zoom: STOP_PLATFORM_MIN_ZOOM - 1.5 });
  const close = await render({ platform: true, zoom: 17 });
  check('the platform draws nothing at city zoom', away.painted === 0, `${away.painted} px`);
  check('the platform is paved once zoomed in', close.painted > 200, `${close.painted} px`);
}

// 3. The tactile strip is held back further still, and then appears.
{
  // Compared against the same view with the strip layer left out, so the
  // difference is the strip and not the zoom.
  const belowZoom = STOP_TACTILE_MIN_ZOOM - 0.3;
  const belowWith = await render({ platform: true, tactile: true, zoom: belowZoom });
  const belowWithout = await render({ platform: true, zoom: belowZoom });
  const aboveWith = await render({ platform: true, tactile: true, zoom: 18.5 });
  const aboveWithout = await render({ platform: true, zoom: 18.5 });
  // Counted by its own ochre rather than by total coverage: the strip is drawn
  // on top of the platform it edges, so it adds no painted pixels, only colour.
  // The band is wider than the kerb it sits under, so when it is on it reaches
  // past the kerb and paints pixels the kerb alone never touches. Measured that
  // way rather than by hue: the band is semi-transparent, so its colour on
  // screen is a blend, while its extra coverage is unambiguous.
  check(
    'the tactile strip waits for the platform to be a real shape',
    belowWith.painted === belowWithout.painted,
    `${belowWithout.painted} px without the strip, ${belowWith.painted} px with it, at z${belowZoom}`
  );
  check(
    'the tactile strip is drawn once zoomed in',
    aboveWith.painted > aboveWithout.painted,
    `${aboveWithout.painted} px without the strip, ${aboveWith.painted} px with it`
  );
}

// 4. Furniture is drawn at the size the model says. Seen from straight above
//    with the stop running east-west, the painted width IS the pad.
{
  const r = await render({ furniture: true, zoom: 18, stop: { bearing: 90 } });
  const paintedMeters = (r.maxX - r.minX) * r.metersPerPixel;
  const expected = STOP_MODELS.TRAM.pad.length;
  check(
    'the pad is drawn at its modelled length',
    r.painted > 0 && Math.abs(paintedMeters - expected) / expected < 0.12,
    `${paintedMeters.toFixed(1)} m painted vs ${expected.toFixed(1)} m modelled`
  );
}

// 5. The furniture turns with the stop's bearing. This is the check that a
//    shelter is beside the track rather than across it.
{
  const east = await render({ furniture: true, zoom: 18, stop: { bearing: 90 } });
  const north = await render({ furniture: true, zoom: 18, stop: { bearing: 0 } });
  check(
    'the furniture rotates with the stop bearing',
    east.maxX - east.minX > east.maxY - east.minY && north.maxY - north.minY > north.maxX - north.minX,
    `east ${(east.maxX - east.minX).toFixed(0)}x${(east.maxY - east.minY).toFixed(0)} px, ` +
    `north ${(north.maxX - north.minX).toFixed(0)}x${(north.maxY - north.minY).toFixed(0)} px`
  );
}

// 6. The shelter stands up. A box with no height is still a filled footprint
//    from above, so the test is whether anything is painted above the topmost
//    row of the projected ground geometry.
{
  const tilted = await render({ furniture: true, zoom: 19, pitch: 60, stop: { bearing: 90 } });
  const wallPixels = tilted.groundFurniture.top - tilted.minY;
  check(
    'the furniture has walls standing above its footprint',
    wallPixels > 8,
    `${wallPixels.toFixed(0)} px of wall above the footprint`
  );
}

// 7. The platform gets a kerb face in the tilted view for the furniture to
//    stand on, rather than staying a painted rectangle.
{
  const tilted = await render({ platform: true, zoom: 19, pitch: 60 });
  check(
    'the platform is extruded to a kerb when tilted',
    tilted.groundPlatform.top - tilted.minY > 1,
    `${(tilted.groundPlatform.top - tilted.minY).toFixed(1)} px of kerb face, ` +
    `${PLATFORM_EXTRUSION_HEIGHT} m modelled`
  );
}

// 8. Nothing is extruded below the fade-in zoom: at that scale a shelter is
//    sub-pixel and the flat sign icons are still in charge.
{
  const below = await render({ furniture: true, zoom: STOP_3D_MIN_ZOOM - 0.5 });
  const above = await render({ furniture: true, zoom: STOP_3D_FULL_ZOOM });
  check('no furniture is drawn below its fade-in zoom', below.painted === 0, `${below.painted} px`);
  check('furniture is solid above its fade-in zoom', above.painted > 100, `${above.painted} px`);
}

// 9. The two live cues actually reach the screen — they are the whole point of
//    highlighting a stop, and both are a colour swap that renders either way.
{
  const plain = await render({ furniture: true, zoom: 18, pitch: 45 });
  const highlighted = await render({ furniture: true, zoom: 18, pitch: 45, stop: { highlighted: true } });
  check(
    'the highlighted stop takes the selection gold',
    highlighted.gold > plain.gold + 50,
    `${plain.gold} gold px plain, ${highlighted.gold} highlighted`
  );

  const boarding = await render({ furniture: true, zoom: 19, stop: { boarding: true } });
  const idle = await render({ furniture: true, zoom: 19 });
  check(
    'the platform edge lights up while a vehicle is boarding',
    boarding.amber > idle.amber + 20,
    `${idle.amber} amber px idle, ${boarding.amber} boarding`
  );
}

// 10. Structural: a stop already covered by a real platform polygon must not
//     also get a synthetic slab, and a stop of unknown orientation must not get
//     a shelter placed at a guess.
{
  const onPlatform = stopExtrusions({
    stopId: 's', lng: CENTER[0], lat: CENTER[1], mode: 'TRAM', bearing: 90, hasPlatform: true,
  }).map((f) => f.properties.part);
  check(
    'a stop on a real platform draws no synthetic pad',
    !onPlatform.includes('pad') && onPlatform.includes('pole'),
    onPlatform.join(', ')
  );

  const unoriented = stopExtrusions({
    stopId: 's', lng: CENTER[0], lat: CENTER[1], mode: 'TRAM', bearing: null, hasPlatform: false,
  }).map((f) => f.properties.part);
  check(
    'a stop of unknown orientation gets no guessed shelter',
    !unoriented.some((p) => p.startsWith('shelter')) && unoriented.includes('pad'),
    unoriented.join(', ')
  );
}

// 11. Every mode's furniture actually paints something, in both themes: the
//     palette is theme-dependent, and a colour that matches the background is
//     indistinguishable from a layer that never drew.
for (const theme of ['light', 'dark']) {
  for (const mode of Object.keys(STOP_MODELS)) {
    const r = await render({ furniture: true, zoom: 18, pitch: 45, theme, stop: { mode, bearing: 90 } });
    check(`${theme} ${mode} furniture is visible`, r.painted > 100, `${r.painted} px`);
  }
}

// Sanity: the placement helper the furniture is oriented with agrees with the
// bearings the rendered geometry was built from.
check(
  'acrossFrom steps to the right of the heading',
  acrossFrom(CENTER[0], CENTER[1], 0, 50)[0] > CENTER[0],
  'heading north puts the offset point east'
);

// Opt-in visual artifacts; normal verification leaves no images behind.
if (process.env.STOP_SCREENSHOTS === '1') {
  const screenshotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ratikka-stop-previews-'));
  for (const theme of ['light', 'dark']) {
    const shot = await render({
      platform: true, tactile: true, furniture: true, theme,
      zoom: 19, pitch: 60, stop: { bearing: 90, highlighted: true }, capture: true,
    });
    const filename = path.join(screenshotDir, `stop-preview-${theme}.png`);
    fs.writeFileSync(filename, Buffer.from(shot.image.split(',')[1], 'base64'));
    console.log(`Stop preview: ${filename}`);
  }
}

await browser.close();
server.close();
fs.rmSync(outDir, { recursive: true, force: true });

console.log('\n--- stop platforms and furniture ---');
report.forEach((l) => console.log(l));
if (pageErrors.length) {
  console.log('\npage errors:');
  pageErrors.forEach((e) => console.log(`  ${e}`));
}
console.log(`\nSTOP MARKER FAILURES: ${failures.length + pageErrors.length}`);
process.exit(failures.length + pageErrors.length ? 1 : 0);
