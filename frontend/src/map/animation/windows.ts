/**
 * How long one glide window is allowed to be.
 *
 * The window is measured, not assumed: it is the gap between the last two
 * snapshots, so a late feed stretches the glide instead of leaving the vehicles
 * standing still waiting for it.
 */
export const MIN_WINDOW_SEC = 0.7;
export const MAX_WINDOW_SEC = 2.5;

/**
 * The floor above exists because the live feed speaks once a second and a
 * window measured shorter than that is a hiccup, not a cadence. A fast replay
 * genuinely does deliver a snapshot every eighth of a second, and holding it to
 * seven tenths would mean every glide is cut off at a fifth of its length by
 * the next one — vehicles crawling a step behind the map and then jumping to
 * catch up, which is exactly what a fast timelapse looked like. So at speed the
 * floor is only there to keep the division finite.
 */
export const MIN_REPLAY_WINDOW_SEC = 0.03;
