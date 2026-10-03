/**
 * What the map's overlays remember between updates.
 *
 * Every one of these is the same shape: something expensive to build, a cheap
 * signature of what it was last built for, and a flag for whether it is
 * currently drawn. They exist because the events that trigger a rebuild — a
 * tile landing, a view settling, a positions message — fire far more often than
 * anything that actually changes what should be drawn, so the signature turns
 * the common case into a comparison.
 *
 * Like the animation's state, this is a plain object the component owns rather
 * than React state: nothing here should cause a render.
 */
export interface OverlayState {
  /** 3D shelters and sign boards around the stops currently in view. */
  stopFurniture: {
    drawn: boolean;
    sig: string;
    /** Name, code and mode per stop, so a click on a shelter opens its popup. */
    meta: Record<string, { name: string; code: string; mode: string }>;
  };
  /** The stops currently carrying a next-arrival label. */
  arrivalLabels: {
    stops: Array<{ stopId: string; lng: number; lat: number }>;
    sig: string;
  };
  /** The live green-request exchanges last drawn at the junctions. */
  signalPriority: { sig: string };
  /** Decoded and slotted route geometry per line. */
  routePaths: Record<string, { src: string[]; paths: [number, number][][] }>;
}

export function createOverlayState(): OverlayState {
  return {
    stopFurniture: { drawn: false, sig: '', meta: {} },
    arrivalLabels: { stops: [], sig: '' },
    signalPriority: { sig: '' },
    routePaths: {},
  };
}

/** Force the next update to rebuild, whatever its signature says. */
export function invalidateOverlays(state: OverlayState): void {
  state.stopFurniture.sig = '';
  state.arrivalLabels.sig = '';
  state.signalPriority.sig = '';
}
