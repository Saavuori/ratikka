import type { DataDrivenPropertyValueSpecification, ExpressionSpecification } from 'maplibre-gl';

// Paint expressions shared by the highlighted route path and its casing. All
// three are zoom-and-property expressions: the zoom stops keep the ribbons
// readable from the whole-city view down to street level, while the inner
// `case`/`*` reads the per-feature slot written by `drawRouteGeometries`.
//
// The ribbons are kept slim so that the fan around a shared street stays a
// bundle of parallel lines rather than a band: at close zoom the spacing clears
// the casing and leaves a sliver of map between neighbours. Further out the
// offset is bounded by *ground* distance instead (see ROUTE_LINE_OFFSET), so
// the ribbons close up and eventually merge — being on the right street matters
// more there than being told apart.
const routeLineWidth = (selected: number, other: number, dim: number): ExpressionSpecification =>
  ['case', ['get', 'selected'], selected, ['get', 'dim'], dim, other];

export const ROUTE_LINE_WIDTH: DataDrivenPropertyValueSpecification<number> = [
  'interpolate', ['linear'], ['zoom'],
  10, routeLineWidth(2.4, 1.8, 0.8),
  13, routeLineWidth(3.6, 2, 1.2),
  16, routeLineWidth(5, 3, 1.8),
];

export const ROUTE_CASING_WIDTH: DataDrivenPropertyValueSpecification<number> = [
  'interpolate', ['linear'], ['zoom'],
  10, routeLineWidth(3.6, 2.4, 1.2),
  13, routeLineWidth(5, 3, 1.8),
  16, routeLineWidth(6.8, 4.2, 2.6),
];

//
// The offset is in *pixels*, so the same spacing covers more ground the further
// you zoom out — at the whole-city view a fanned ribbon ends up streets away
// from the line it represents, or out in the harbour. Below zoom 12 the spacing
// therefore tapers to nothing: the streets a fan separates are not
// distinguishable at that scale anyway, so the routes collapse back onto their
// true geometry, which is the only place they are honest. The slot itself is
// capped (see lib/routeSlots), which bounds how wide the fan can get at all.
// Mirrors the cap in lib/routeSlots: the deepest slot the fan can hand out, and
// therefore the widest offset this expression ever has to produce.
export const MAX_SLOT = 3;

// Tapering to zero below zoom 12 is not on its own enough. A *constant* pixel
// spacing above that point still covers more and more ground the further out
// you are: the 5 px/slot this used to ramp to by zoom 13 put the outermost
// ribbon 15 px — about 140 m at that latitude and scale — from the street it
// follows, which reads as the wrong street even though the fan technically
// "tapers". So the stops now roughly halve with each zoom level on the way out,
// which is exactly how a metre grows in pixels, holding the outermost ribbon to
// about 45 m of ground from zoom 12 up to 14 and tightening from there. The
// spacing itself is also a little narrower than it was at every zoom, matched
// to the slimmer ribbons above: neighbouring routes sit a sliver of map apart
// rather than a lane apart.
export const ROUTE_LINE_OFFSET: DataDrivenPropertyValueSpecification<number> = [
  'interpolate', ['linear'], ['zoom'],
  11, 0,
  13, ['*', ['get', 'offsetIndex'], 1.5],
  14, ['*', ['get', 'offsetIndex'], 3],
  16, ['*', ['get', 'offsetIndex'], 6.5],
];

// Non-selected routes fade back so the clicked vehicle's line reads first.
export const ROUTE_LINE_OPACITY: DataDrivenPropertyValueSpecification<number> =
  ['case', ['get', 'selected'], 1, ['get', 'dim'], 0.25, 0.95];

// Context outlines should not obscure streets after their route has faded.
export const ROUTE_CASING_OPACITY: DataDrivenPropertyValueSpecification<number> =
  ['case', ['get', 'selected'], 0.9, ['get', 'dim'], 0.12, 0.65];

// The selected line is drawn last within the layer, so it wins where the
// ribbons still cross.
export const ROUTE_LINE_SORT_KEY: DataDrivenPropertyValueSpecification<number> =
  ['case', ['get', 'selected'], 2, 1];
