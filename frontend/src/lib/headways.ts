import type { Headway, VehiclePosition } from '../types';

// Reading the spacing of a line off its vehicles.
//
// The backend times every vehicle out of every stop and attaches, to each
// position, how far it is running behind the vehicle ahead of it on the same
// line and direction (`hw`; see backend/internal/mqtt/headway.go). That is one
// number per vehicle. What a rider cares about is the line: are the 4s coming
// in a steady stream, or two at once and then nothing? This module turns the
// per-vehicle numbers into that — the pairs worth drawing on the map, and the
// problems worth listing beside the line buttons.

/** A spacing worth pointing out. */
export type HeadwayIssue = 'bunched' | 'gap';

/**
 * The colours the two problems are drawn in, on the map and in the panels
 * alike. Coral is the map's colour for a vehicle standing still; amber is the
 * colour of a warning, which is what a hole in the service is to anyone
 * waiting inside it.
 */
export const BUNCHED_CORAL = '#e17055';
export const GAP_AMBER = '#f59e0b';

/**
 * The vehicle a vehicle is running behind, if it is still on the map and still
 * on the same run. A vehicle ahead that has reached the end of the line, or
 * turned onto its next journey, is no longer ahead of anything.
 */
export function vehicleAhead(
  vehicle: VehiclePosition,
  vehicles: Record<string, VehiclePosition>,
): VehiclePosition | null {
  const ahead = vehicle.hw?.ahead;
  if (!ahead) return null;
  const leader = vehicles[ahead];
  if (!leader || leader.eol || leader.route !== vehicle.route || leader.dir !== vehicle.dir) return null;
  return leader;
}

/** The vehicle running behind this one: the one whose vehicle ahead it is. */
export function vehicleBehind(
  vehicle: VehiclePosition,
  vehicles: Record<string, VehiclePosition>,
): VehiclePosition | null {
  let behind: VehiclePosition | null = null;
  for (const other of Object.values(vehicles)) {
    if (other.hw?.ahead !== vehicle.veh || other.route !== vehicle.route || other.dir !== vehicle.dir) continue;
    if (!behind || other.hw.secs < (behind.hw?.secs ?? Infinity)) behind = other;
  }
  return behind;
}

/** A vehicle and the one it runs behind, where the spacing is a problem. */
export interface HeadwayPair {
  /** The line both are running (`desi`). */
  line: string;
  follower: string;
  leader: string;
  state: HeadwayIssue;
}

/**
 * Every bunched or gapped pair whose two vehicles are both on the map — what
 * the map draws a link or a hole between. Recomputed per snapshot, not per
 * frame: the pairs only change when the feed does.
 */
export function headwayPairs(vehicles: Record<string, VehiclePosition>): HeadwayPair[] {
  const pairs: HeadwayPair[] = [];
  for (const vehicle of Object.values(vehicles)) {
    const state = vehicle.hw?.state;
    if (state !== 'bunched' && state !== 'gap') continue;
    const leader = vehicleAhead(vehicle, vehicles);
    if (!leader) continue;
    pairs.push({ line: vehicle.desi, follower: vehicle.veh, leader: leader.veh, state });
  }
  return pairs;
}

/**
 * One problem on one line, as the lines panel lists it.
 *
 * Bunched vehicles are grouped: three trams running together is one problem
 * with three trams in it, not two overlapping pairs. `vehicles` runs front to
 * back, and `focus` is the vehicle selecting the problem picks — the front of a
 * bunch, where the queue of riders is, or the vehicle at the back of a gap,
 * which the stops in the hole are waiting for.
 */
export interface RegularityIssue {
  line: string;
  mode: string;
  kind: HeadwayIssue;
  vehicles: string[];
  focus: string;
  /** The closest spacing in a bunch, or the length of a gap, in seconds. */
  secs: number;
  /** The gap is at least this long, and may yet be longer. */
  atLeast: boolean;
  /** The line's timetabled headway, in seconds. */
  sched: number;
  /**
   * How much waiting it adds, in seconds, for ordering the list: a gap adds
   * its excess over the headway, and a bunch wastes the vehicle at its back,
   * which adds as much as it arrived early.
   */
  cost: number;
}

/**
 * The line's problems, worst first. Only vehicles the backend has judged are
 * counted; a vehicle it has nothing to say about yet is neither bunched nor
 * regular, just unmeasured.
 */
export function regularityIssues(vehicles: Record<string, VehiclePosition>): RegularityIssue[] {
  const issues: RegularityIssue[] = [];

  // Bunches: follow each bunched vehicle forward through the vehicles it is
  // bunched behind, so a chain of three is found once, from its back.
  const bunchedBehind = new Map<string, VehiclePosition>();
  for (const vehicle of Object.values(vehicles)) {
    if (vehicle.hw?.state !== 'bunched') continue;
    const leader = vehicleAhead(vehicle, vehicles);
    if (leader) bunchedBehind.set(vehicle.veh, leader);
  }
  const followed = new Set([...bunchedBehind.values()].map((v) => v.veh));
  for (const [veh, firstLeader] of bunchedBehind) {
    // The back of a chain is a bunched vehicle nothing is bunched behind;
    // everything else in the chain is walked into from there.
    if (followed.has(veh)) continue;
    const back = vehicles[veh];
    const chain = [back];
    let closest = back.hw!.secs;
    let sched = back.hw!.sched ?? 0;
    let leader: VehiclePosition | undefined = firstLeader;
    while (leader && !chain.includes(leader)) {
      chain.push(leader);
      const next = bunchedBehind.get(leader.veh);
      if (next) {
        closest = Math.min(closest, leader.hw!.secs);
        sched = Math.max(sched, leader.hw!.sched ?? 0);
      }
      leader = next;
    }
    chain.reverse();
    issues.push({
      line: back.desi,
      mode: back.mode,
      kind: 'bunched',
      vehicles: chain.map((v) => v.veh),
      focus: chain[0].veh,
      secs: closest,
      atLeast: false,
      sched,
      cost: Math.max(sched - closest, 0),
    });
  }

  for (const vehicle of Object.values(vehicles)) {
    const hw = vehicle.hw;
    if (hw?.state !== 'gap' || !hw.sched) continue;
    issues.push({
      line: vehicle.desi,
      mode: vehicle.mode,
      kind: 'gap',
      vehicles: [vehicle.veh],
      focus: vehicle.veh,
      secs: hw.secs,
      atLeast: !!hw.atLeast,
      sched: hw.sched,
      cost: hw.secs - hw.sched,
    });
  }

  return issues.sort((a, b) => b.cost - a.cost);
}

/**
 * The worst thing each line has going on, for the dot on its button. A bunch
 * is shown over a gap: the gap behind a bunch is usually the bunch's own doing.
 */
export function lineRegularity(issues: RegularityIssue[]): Record<string, HeadwayIssue> {
  const worst: Record<string, HeadwayIssue> = {};
  for (const issue of issues) {
    if (worst[issue.line] !== 'bunched') worst[issue.line] = issue.kind;
  }
  return worst;
}

/**
 * A headway in words, at the resolution it is worth reading at: to the ten
 * seconds under ten minutes, where the difference between a bunch and a
 * spacing lives, and to the minute above it, where it does not.
 *
 * Each number is tied to its unit with a no-break space, so a narrow panel
 * wraps between "6 min" and whatever follows rather than inside it.
 */
export function formatHeadway(secs: number): string {
  const s = Math.max(0, Math.round(secs));
  if (s < 60) return `${Math.round(s / 5) * 5}\u00a0s`;
  if (s < 600) {
    const rounded = Math.round(s / 10) * 10;
    const min = Math.floor(rounded / 60);
    const rest = rounded % 60;
    return rest === 0 ? `${min}\u00a0min` : `${min}\u00a0min ${rest}\u00a0s`;
  }
  return `${Math.round(s / 60)}\u00a0min`;
}

const PLURAL: Record<string, string> = {
  tram: 'trams',
  bus: 'buses',
  metro: 'metro trains',
  train: 'trains',
  ferry: 'ferries',
};

/** "trams", "buses" — what several vehicles of a mode are called. */
export function vehiclesOfMode(mode: string): string {
  return PLURAL[mode] ?? 'vehicles';
}

/**
 * A problem in a few words, as the lines panel lists it under "Bunched" or
 * "Gap": how many vehicles and how close, or how long and against what.
 */
export function describeIssue(issue: RegularityIssue): string {
  if (issue.kind === 'bunched') {
    return `${issue.vehicles.length} ${vehiclesOfMode(issue.mode)}, ${formatHeadway(issue.secs)} apart`;
  }
  return `${issue.atLeast ? '≥ ' : ''}${formatHeadway(issue.secs)}, due every ${formatHeadway(issue.sched)}`;
}

/**
 * What a vehicle's own spacing amounts to, for its telemetry panel — and, where
 * there is no verdict yet, what it is waiting for.
 */
export function describeHeadway(hw: Headway | undefined): string {
  switch (hw?.state) {
    case 'bunched':
      return 'Bunched with the one ahead';
    case 'gap':
      return 'Running in a gap';
    case 'regular':
      return 'Evenly spaced';
  }
  if (!hw) return 'Spacing not measured yet';
  // Only a lower bound so far: the gap is timed when this one leaves the stop
  // the one ahead has already left.
  if (hw.atLeast) return 'Timed at the next stop';
  return 'Timetable not known yet';
}
