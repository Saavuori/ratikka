import type { DataDrivenPropertyValueSpecification } from 'maplibre-gl';

// Zoom range and paint for the stop discs — the dots that stand in for stops
// across the wide, city-scale views, before the sign boards take over at
// STOP_CIRCLE_FADE_ZOOM.
//
// These used to inherit the HSL vector style's own ramp, which grows from a
// 1 px dot at zoom 12 to a 24 px disc at zoom 22. Almost all of that range sits
// *above* the zoom at which the sign boards replace the discs, so in the band
// the discs are actually drawn in — 13 to 15.5 — the ramp only ever produced
// dots of one to two pixels. The stops were technically on the map and
// practically invisible, which read as "the stops disappear when you zoom out"
// next to the city-bike gauges, which stay a legible marker across the same
// band. The ramp below is scoped to the band the discs live in instead, so a
// stop is a real dot the moment its layer switches on.

// Where the discs switch on. Kept level with the city-bike gauge layer so the
// two kinds of marker appear together on the way out of a zoomed-in view.
export const STOP_CIRCLE_MIN_ZOOM = 13;

// Stations (metro, commuter rail) carry a whole neighbourhood rather than one
// kerbside, so they earn their dot a zoom level earlier than street stops.
export const STATION_CIRCLE_MIN_ZOOM = 12;

// Where the discs hand over to the sign boards (stops_signs). The layers are
// capped here and the opacity ramp below fades them out across the last half
// level so the swap is not a pop.
export const STOP_CIRCLE_FADE_ZOOM = 15.5;

export const STOP_CIRCLE_RADIUS: DataDrivenPropertyValueSpecification<number> = [
  'interpolate', ['linear'], ['zoom'],
  12, 2.6,
  13, 3.2,
  15, 4.6,
  15.5, 5,
];

export const STATION_CIRCLE_RADIUS: DataDrivenPropertyValueSpecification<number> = [
  'interpolate', ['linear'], ['zoom'],
  12, 3.6,
  13, 4.4,
  15, 6,
  15.5, 6.5,
];

// A thin white ring. The style's own casing layers are switched off (they are
// drawn under every mode at once and cannot follow our filters), so the discs
// carry their own contrast against dark basemaps and dense street fill.
export const STOP_CIRCLE_STROKE_WIDTH: DataDrivenPropertyValueSpecification<number> = [
  'interpolate', ['linear'], ['zoom'],
  12, 0.8,
  15.5, 1.4,
];

export const STOP_CIRCLE_STROKE_COLOR = '#ffffff';

// Fades the discs out as the sign boards fade in.
export const STOP_CIRCLE_OPACITY: DataDrivenPropertyValueSpecification<number> = [
  'interpolate', ['linear'], ['zoom'],
  15.0, 1.0,
  STOP_CIRCLE_FADE_ZOOM, 0.0,
];

/** Layer ids drawing street stops as discs, across both basemap themes. */
export const STOP_CIRCLE_LAYERS = [
  'stops_tram',
  'stops_bus',
  'stops_trunk',
  'stops_lrail',
  'stops_ferry',
];

/** Layer ids drawing metro and commuter-rail stations as discs. */
export const STATION_CIRCLE_LAYERS = [
  'stops_subway',
  'stops_rail',
  'stops_metro',
  'stops_train',
];
