import type { Alert, JourneyItinerary, JourneyLeg } from '../types';

export const JOURNEY_TIME_ZONE = 'Europe/Helsinki';
export const JOURNEY_REFRESH_MS = 20_000;
export const JOURNEY_STALE_MS = 45_000;

/** Never infer a trip identity from its route number or a moving prediction. */
export function itineraryIdentity(itinerary: JourneyItinerary): string | undefined {
  const legs = itinerary.legs.filter(leg => leg.transit);
  if (!legs.length || legs.some(leg =>
    !leg.tripId || !leg.serviceDate || !leg.from.stopId || !leg.to.stopId
  )) return undefined;
  return JSON.stringify(legs.map(leg => [
    leg.tripId, leg.serviceDate, leg.from.stopId, leg.to.stopId,
  ]));
}

export function findRefreshedItinerary(
  selected: JourneyItinerary,
  alternatives: JourneyItinerary[],
): JourneyItinerary | undefined {
  const identity = itineraryIdentity(selected);
  return identity ? alternatives.find(it => itineraryIdentity(it) === identity) : undefined;
}

export function monitoredLegIds(itinerary: JourneyItinerary): string[] | undefined {
  const legs = itinerary.legs.filter(leg => leg.transit);
  if (!legs.length || legs.length > 8 || legs.some(leg => !leg.legId)) return undefined;
  return legs.map(leg => leg.legId!);
}

/** A missing or mismatched leg is unavailable, not a cancellation or replacement. */
export function mergeMonitoredLegs(
  selected: JourneyItinerary,
  predictions: (JourneyLeg | null)[],
): { itinerary: JourneyItinerary; missingLegIndexes: number[] } {
  const missingLegIndexes: number[] = [];
  let transitIndex = 0;
  const legs = selected.legs.map((leg, index) => {
    if (!leg.transit) return leg;
    const prediction = predictions[transitIndex++];
    const identity = itineraryIdentity({ ...selected, legs: [leg] });
    if (!prediction || !leg.legId || prediction.legId !== leg.legId || !identity ||
      itineraryIdentity({ ...selected, legs: [prediction] }) !== identity) {
      missingLegIndexes.push(index);
      return leg;
    }
    return prediction;
  });
  // Walking is still a duration estimate, positioned after the updated arrival.
  for (let index = 1; index < legs.length; index++) {
    if (legs[index].transit) continue;
    const startTime = legs[index - 1].endTime;
    legs[index] = { ...legs[index], startTime, endTime: startTime + legs[index].duration * 1000 };
  }
  const startTime = legs[0]?.startTime ?? selected.startTime;
  const endTime = legs.at(-1)?.endTime ?? selected.endTime;
  return {
    itinerary: { ...selected, legs, startTime, endTime, duration: Math.max(0, (endTime - startTime) / 1000) },
    missingLegIndexes,
  };
}

export function helsinkiDateTime(epochMs: number): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: JOURNEY_TIME_ZONE, year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(epochMs);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)!.value;
  return {
    date: `${value('year')}-${value('month')}-${value('day')}`,
    time: `${value('hour')}:${value('minute')}`,
  };
}

export function journeyLegStatus(leg: JourneyLeg, stale: boolean): string {
  if (/^(CANCELED|CANCELLED)$/i.test(leg.realtimeState ?? '')) return 'Cancelled';
  if (stale) return 'Stale';
  return leg.realtime ? 'Live prediction' : 'Scheduled';
}

export interface TransferEstimate {
  legIndex: number;
  marginSeconds: number;
  risk: 'missed' | 'tight' | 'normal';
  message: string;
}

export function transferEstimates(itinerary: JourneyItinerary): TransferEstimate[] {
  const result: TransferEstimate[] = [];
  let previousTransit = -1;
  itinerary.legs.forEach((leg, index) => {
    if (!leg.transit) return;
    if (previousTransit >= 0) {
      const previous = itinerary.legs[previousTransit];
      const walkingSeconds = itinerary.legs.slice(previousTransit + 1, index)
        .reduce((sum, connection) => sum + connection.duration, 0);
      const marginSeconds = (leg.startTime - previous.endTime) / 1000 - walkingSeconds;
      const risk = marginSeconds < 0 ? 'missed' : marginSeconds < 180 ? 'tight' : 'normal';
      const margin = Math.round(Math.abs(marginSeconds) / 60);
      result.push({
        legIndex: index, marginSeconds, risk,
        message: risk === 'missed'
          ? `Transfer may be missed: estimated ${margin} min short after walking.`
          : `Estimated ${margin} min available after walking${risk === 'tight' ? ' — tight transfer' : ''}.`,
      });
    }
    previousTransit = index;
  });
  return result;
}

/** Alert epochs are seconds; itinerary times are milliseconds. */
export function relevantJourneyAlerts(itinerary: JourneyItinerary, alerts: Alert[]): Alert[] {
  return alerts.filter(alert => itinerary.legs.some(leg => {
    if (alert.startDate && alert.startDate * 1000 > leg.endTime) return false;
    if (alert.endDate && alert.endDate * 1000 < leg.startTime) return false;
    const stops = [leg.from, leg.to, ...leg.intermediateStops];
    return alert.entities.some(entity =>
      (entity.type === 'Route' && !!leg.route?.gtfsId && entity.gtfsId === leg.route.gtfsId) ||
      (entity.type === 'Stop' && stops.some(stop => !!stop.stopId && entity.gtfsId === stop.stopId))
    );
  }));
}
