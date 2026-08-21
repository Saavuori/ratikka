import type { DataDrivenPropertyValueSpecification, ExpressionSpecification } from 'maplibre-gl';

// Paint expressions shared by the highlighted route path and its casing. All
// three are zoom-and-property expressions: the zoom stops keep the ribbons
// readable from the whole-city view down to street level, while the inner
// `case`/`*` reads the per-feature slot written by `drawRouteGeometries`.
//
// The offset spacing is deliberately a touch wider than the line width at every
// zoom, so parallel routes stay separated by a sliver of map instead of merging
// back into one thick band.
const routeLineWidth = (selected: number, other: number): ExpressionSpecification =>
  ['case', ['get', 'selected'], selected, other];

export const ROUTE_LINE_WIDTH: DataDrivenPropertyValueSpecification<number> = [
  'interpolate', ['linear'], ['zoom'],
  10, routeLineWidth(3.5, 2),
  13, routeLineWidth(5.5, 3.2),
  16, routeLineWidth(8, 4.5),
];

export const ROUTE_CASING_WIDTH: DataDrivenPropertyValueSpecification<number> = [
  'interpolate', ['linear'], ['zoom'],
  10, routeLineWidth(5.5, 3.6),
  13, routeLineWidth(8, 5),
  16, routeLineWidth(11, 6.8),
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

export const ROUTE_LINE_OFFSET: DataDrivenPropertyValueSpecification<number> = [
  'interpolate', ['linear'], ['zoom'],
  11, 0,
  13, ['*', ['get', 'offsetIndex'], 5],
  16, ['*', ['get', 'offsetIndex'], 7.5],
];

// Non-selected routes fade back so the clicked vehicle's line reads first.
export const ROUTE_LINE_OPACITY: DataDrivenPropertyValueSpecification<number> =
  ['case', ['get', 'dim'], 0.4, 0.95];

// The selected line is drawn last within the layer, so it wins where the
// ribbons still cross.
export const ROUTE_LINE_SORT_KEY: DataDrivenPropertyValueSpecification<number> =
  ['case', ['get', 'selected'], 2, 1];
