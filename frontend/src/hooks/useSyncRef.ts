import { useEffect } from 'react';
import type { RefObject } from 'react';

/**
 * Keep `ref` holding the most recent value of `value`.
 *
 * `Map` drives MapLibre through imperative callbacks — map event handlers, the
 * `requestAnimationFrame` loop, layer-update helpers — that outlive the render
 * that installed them. Those callbacks must not close over props, or they read
 * whatever the values were when the handler was bound; they read a ref instead,
 * and the ref has to be kept current. This is that, said once rather than as
 * twenty hand-written four-line effects.
 *
 * The ref is passed in rather than created and returned, which is deliberate:
 * `react-hooks/exhaustive-deps` knows a `useRef` result is stable, and has no
 * way to know that about the return value of a custom hook. Hand it back and
 * every helper in `Map` that reads one of these refs becomes "unstable" to the
 * rule, which then demands those helpers in the dependency arrays of effects
 * that must not re-run every render. So the call site keeps its `useRef`:
 *
 *     const showTramsRef = useRef(showTrams);
 *     useSyncRef(showTramsRef, showTrams);
 *
 * The write happens in an effect rather than during render, so the ref only
 * ever reflects a value that actually committed. A render React throws away —
 * a Strict Mode double-render, an interrupted concurrent render — leaves it
 * alone, which is what makes it safe to read from a callback that fires at an
 * arbitrary moment. The corollary is that during the render which *introduces*
 * a new value the ref still holds the previous one; that is correct for the
 * callback case, and wrong if you were reaching for this to read a value during
 * render, where you should just read the value.
 */
export function useSyncRef<T>(ref: RefObject<T>, value: T): void {
  useEffect(() => {
    ref.current = value;
  }, [ref, value]);
}
