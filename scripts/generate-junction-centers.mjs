// Recomputes where a signalized junction actually *is*, from Helsinki's own
// street geometry, and writes the result as a correction table the backend
// serves alongside the open-data points.
//
// Why this exists: `avoindata:Liikennevalot_piste` gives one point per
// signalized junction, but that point is a surveyed installation — the
// controller cabinet, a mast on a corner — not the middle of the crossing. It
// is typically 5-30 m off centre, which is nothing on a citywide view and very
// visible at the zooms the marker is drawn at: the signal sits in a building,
// on a pavement, or a full carriageway away from the tram waiting at it.
//
// The middle of a junction is recoverable from the same open data, because
// `avoindata:Liikennevaylat` carries the street centrelines and they are split
// at junctions:
//
//   * A junction is where three or more carriageway centrelines meet. A dual
//     carriageway or a staggered junction has several such nodes, and the
//     centroid of the ones belonging to one crossing is the middle of the
//     whole thing, which is what a marker wants.
//   * The marked pedestrian crossings (`Suojatie`) of a signalized junction
//     ring its box, so their centroid is a second, independent reading of the
//     same middle — and the only reading there is for a mid-block signal,
//     which has no meeting of streets at all.
//
// Where both readings exist the centre is their mean. Measured against a
// sample of 30 junctions, each reading looks best when scored against its own
// evidence and the open-data point looks worst against both; the mean is the
// one answer that is close under either scoring, which is what you want from
// two noisy witnesses to the same thing.
//
// A correction is only kept when the geometry agrees with the open-data point:
// it must move the marker less than MAX_SHIFT_METERS, and it must rest on more
// than one piece of evidence. Anything else keeps its original coordinates —
// being 20 m off is a blemish, being snapped to the wrong junction is a lie.
//
// The output is a static table (junctions move about as often as streets are
// rebuilt), embedded in the backend and applied when the endpoint is served,
// so neither the runtime nor the browser pays for any of this.
//
// Usage (from the repo root, needs network access to kartta.hel.fi):
//   node scripts/generate-junction-centers.mjs
//   node scripts/generate-junction-centers.mjs --limit 20   # a quick sample
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_FILE = path.join(ROOT, 'backend', 'internal', 'api', 'junction_centers.json');

const WFS = 'https://kartta.hel.fi/ws/geoserver/avoindata/wfs';
const SIGNAL_LAYERS = [
  ['avoindata:Liikennevalot_piste', 'traffic_light'],
  ['avoindata:Varoitusvalot_piste', 'warning_light'],
];

// How far around a signal to look for the geometry that explains it. Wide
// enough to contain a big junction seen from its corner, tight enough that the
// next junction down the street is not in the picture.
const SEARCH_RADIUS_METERS = 140;
// A crossing node this far from the signal is part of the junction it belongs
// to; anything further is a different junction.
const JUNCTION_RADIUS_METERS = 50;
// The marked crossings that belong to one junction — its own four arms, not
// the next junction's. A mid-block signal's pair of crossings is well inside
// this too.
const CROSSING_RADIUS_METERS = 45;
// The most a correction may move a marker. Beyond this the geometry is not
// refining the open-data point, it is disagreeing with it.
const MAX_SHIFT_METERS = 45;
// Below this the open-data point is already the middle, and rewriting it would
// only add noise to the table.
const MIN_SHIFT_METERS = 1.5;

// Centrelines a vehicle drives on. The pedestrian and cycle network is dense
// enough around a junction to drown the carriageways it crosses.
const CARRIAGEWAY_TYPES = new Set(['Katu', 'Ajoväylä']);
const CROSSING_SUBTYPE = 'Suojatie';

const METERS_PER_DEGREE_LAT = 111320;
const metersPerDegreeLon = (lat) => METERS_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180);

function distanceMeters(lat, lon, [olon, olat]) {
  return Math.hypot((olat - lat) * METERS_PER_DEGREE_LAT, (olon - lon) * metersPerDegreeLon(lat));
}

async function wfs(params) {
  const query = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    outputFormat: 'application/json',
    srsName: 'EPSG:4326',
    ...params,
  });
  const url = `${WFS}?${query}`;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt >= 3) throw err;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
    }
  }
}

// GeoServer reads an EPSG:4326 bbox in the authority's own axis order —
// latitude first — and silently returns nothing when handed lon/lat.
function bboxAround(lat, lon, radiusMeters) {
  const dLat = radiusMeters / METERS_PER_DEGREE_LAT;
  const dLon = radiusMeters / metersPerDegreeLon(lat);
  return `${lat - dLat},${lon - dLon},${lat + dLat},${lon + dLon},urn:ogc:def:crs:EPSG::4326`;
}

function lineParts(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'LineString') return [geometry.coordinates];
  if (geometry.type === 'MultiLineString') return geometry.coordinates;
  return [];
}

/** The centroid of a set of [lon, lat] points. */
function centroid(points) {
  const lon = points.reduce((sum, p) => sum + p[0], 0) / points.length;
  const lat = points.reduce((sum, p) => sum + p[1], 0) / points.length;
  return [lon, lat];
}

/**
 * Where the streets around a signal actually cross, and where the crossings
 * over them are marked. Returns both candidate centres; the caller picks.
 */
function centresFrom(roads, lat, lon) {
  const nodeDegree = new Map(); // shared endpoint -> how many centrelines end there
  const crossings = [];

  for (const road of roads) {
    const props = road.properties ?? {};
    for (const line of lineParts(road.geometry)) {
      if (line.length < 2) continue;
      if (props.alatyyppi === CROSSING_SUBTYPE) {
        // A marked crossing is a short line across the road; its midpoint is
        // the point on the road it crosses at.
        const a = line[0];
        const b = line[line.length - 1];
        crossings.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
        continue;
      }
      if (!CARRIAGEWAY_TYPES.has(props.paatyyppi)) continue;
      for (const end of [line[0], line[line.length - 1]]) {
        // The centrelines are noded, so a junction is an endpoint several
        // segments share exactly. Rounding guards against float drift only.
        const key = `${end[0].toFixed(7)},${end[1].toFixed(7)}`;
        const entry = nodeDegree.get(key) ?? { point: [end[0], end[1]], degree: 0 };
        entry.degree += 1;
        nodeDegree.set(key, entry);
      }
    }
  }

  const junctionNodes = [...nodeDegree.values()]
    .filter((n) => n.degree >= 3 && distanceMeters(lat, lon, n.point) <= JUNCTION_RADIUS_METERS)
    .map((n) => n.point);
  const nearCrossings = crossings.filter((p) => distanceMeters(lat, lon, p) <= CROSSING_RADIUS_METERS);

  return {
    junction: junctionNodes.length >= 2 ? { point: centroid(junctionNodes), evidence: junctionNodes.length } : null,
    crossing: nearCrossings.length >= 3 ? { point: centroid(nearCrossings), evidence: nearCrossings.length } : null,
  };
}

/**
 * A signal whose name is a single street ("Albertinkatu") governs a crossing,
 * not a junction: there is nothing there for streets to meet at, and the
 * nearest node that does is the junction at the end of the block, which is
 * the one place this must not drag the marker to. Warning lights are
 * crossings by definition.
 */
function isMidBlockCrossing(kind, junctionName) {
  if (kind === 'warning_light') return true;
  return !(junctionName ?? '').includes('/');
}

async function centreFor(signal) {
  const { lat, lon, kind, junction } = signal;
  const roads = await wfs({
    typeNames: 'avoindata:Liikennevaylat',
    count: '2000',
    bbox: bboxAround(lat, lon, SEARCH_RADIUS_METERS),
  });
  const { junction: byNodes, crossing: byCrossings } = centresFrom(roads.features ?? [], lat, lon);

  const readings = isMidBlockCrossing(kind, junction)
    ? [['crossing', byCrossings]]
    : [['junction', byNodes], ['crossing', byCrossings]];
  const present = readings.filter(([, reading]) => reading);
  if (present.length === 0) return null;

  const point = centroid(present.map(([, reading]) => reading.point));
  const shift = distanceMeters(lat, lon, point);
  if (shift > MAX_SHIFT_METERS || shift < MIN_SHIFT_METERS) return null;
  return {
    point,
    shift,
    method: present.map(([name]) => name).join('+'),
    evidence: present.reduce((sum, [, reading]) => sum + reading.evidence, 0),
  };
}

async function main() {
  const limitArg = process.argv.indexOf('--limit');
  const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;

  const signals = [];
  for (const [typeName, kind] of SIGNAL_LAYERS) {
    const data = await wfs({ typeNames: typeName, count: '2000' });
    for (const f of data.features ?? []) {
      const coords = f.geometry?.coordinates;
      if (!coords || coords.length < 2) continue;
      signals.push({
        kind,
        id: f.properties.numero,
        junction: f.properties.risteys,
        lon: coords[0],
        lat: coords[1],
      });
    }
    console.log(`${typeName}: ${data.features?.length ?? 0} signals`);
  }

  const work = signals.slice(0, limit === Infinity ? signals.length : limit);
  const centers = {};
  const shifts = [];
  const byMethod = {};
  let done = 0;

  // A handful at a time: the WFS is somebody's public service, and 500-odd
  // small bbox queries is already asking a lot of it.
  const CONCURRENCY = 4;
  const queue = [...work];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let signal = queue.shift(); signal; signal = queue.shift()) {
        try {
          const result = await centreFor(signal);
          if (result) {
            // The signal layers number independently, so a warning light and a
            // traffic light can both be number 27. The kind is part of the key.
            centers[`${signal.kind}:${signal.id}`] = [
              Number(result.point[0].toFixed(7)),
              Number(result.point[1].toFixed(7)),
            ];
            shifts.push(result.shift);
            byMethod[result.method] = (byMethod[result.method] ?? 0) + 1;
          }
        } catch (err) {
          console.warn(`  ${signal.kind} ${signal.id} (${signal.junction}): ${err.message}`);
        }
        if (++done % 50 === 0) console.log(`  ${done}/${work.length}`);
      }
    })
  );

  shifts.sort((a, b) => a - b);
  const median = shifts.length ? shifts[Math.floor(shifts.length / 2)] : 0;
  const output = {
    _comment:
      'Generated by scripts/generate-junction-centers.mjs from Helsinki open data ' +
      '(CC BY 4.0, Helsingin kaupunkiymparistön toimiala / Kaupunkimittauspalvelut). ' +
      'Maps "<kind>:<junction number>" to the middle of the junction as [lon, lat]. Do not edit by hand.',
    generated: new Date().toISOString().slice(0, 10),
    signals: work.length,
    corrected: Object.keys(centers).length,
    medianShiftMeters: Number(median.toFixed(1)),
    centers,
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2) + '\n');

  console.log(
    `\n${output.corrected}/${work.length} signals recentred ` +
      `(${Object.entries(byMethod).map(([m, n]) => `${n} ${m}`).join(', ')}), ` +
      `median shift ${output.medianShiftMeters} m, max ${shifts.length ? shifts[shifts.length - 1].toFixed(1) : 0} m`
  );
  console.log(`written to ${path.relative(ROOT, OUT_FILE)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
