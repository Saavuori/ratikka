import { describe, it, expect } from 'vitest';
import { relevantStopAlerts } from './stopAlerts';
import type { Alert } from '../types';

const makeAlert = (partial: Partial<Alert>): Alert => ({
  feed: 'HSL',
  severityLevel: 'INFO',
  effect: 'NO_SERVICE',
  cause: 'UNKNOWN_CAUSE',
  headerText: 'Header',
  descriptionText: 'Description',
  url: '',
  startDate: 0,
  endDate: 0,
  entities: [],
  ...partial,
});

describe('relevantStopAlerts', () => {
  it('matches alerts targeting the stop itself', () => {
    const alert = makeAlert({
      entities: [{ type: 'Stop', gtfsId: 'HSL:1020455' }],
    });
    expect(relevantStopAlerts([alert], 'HSL:1020455', [])).toEqual([alert]);
  });

  it('matches alerts targeting a route serving the stop', () => {
    const alert = makeAlert({
      entities: [{ type: 'Route', gtfsId: 'HSL:1009', shortName: '9' }],
    });
    expect(relevantStopAlerts([alert], 'HSL:1020455', ['9'])).toEqual([alert]);
    expect(relevantStopAlerts([alert], 'HSL:1020455', ['7'])).toEqual([]);
  });

  it('ignores alerts for other stops', () => {
    const alert = makeAlert({
      entities: [{ type: 'Stop', gtfsId: 'HSL:9999999' }],
    });
    expect(relevantStopAlerts([alert], 'HSL:1020455', ['9'])).toEqual([]);
  });

  it('collapses one disruption published once per route', () => {
    const alerts = ['9', '7', '3'].map((shortName) =>
      makeAlert({
        headerText: 'Tracks blocked',
        descriptionText: 'Trams are diverted.',
        entities: [{ type: 'Route', gtfsId: `HSL:${shortName}`, shortName }],
      }),
    );
    expect(relevantStopAlerts(alerts, 'HSL:1020455', ['9', '7', '3'])).toHaveLength(1);
  });

  it('keeps distinct alerts apart', () => {
    const alerts = [
      makeAlert({
        headerText: 'A',
        entities: [{ type: 'Route', gtfsId: 'HSL:1009', shortName: '9' }],
      }),
      makeAlert({
        headerText: 'B',
        entities: [{ type: 'Route', gtfsId: 'HSL:1009', shortName: '9' }],
      }),
    ];
    expect(relevantStopAlerts(alerts, 'HSL:1020455', ['9'])).toHaveLength(2);
  });

  it('lists the most severe alerts first', () => {
    const alerts: Alert[] = [
      makeAlert({ headerText: 'info', severityLevel: 'INFO', entities: [{ type: 'Stop', gtfsId: 'S' }] }),
      makeAlert({ headerText: 'severe', severityLevel: 'SEVERE', entities: [{ type: 'Stop', gtfsId: 'S' }] }),
      makeAlert({ headerText: 'warning', severityLevel: 'WARNING', entities: [{ type: 'Stop', gtfsId: 'S' }] }),
    ];
    expect(relevantStopAlerts(alerts, 'S', []).map((a) => a.headerText)).toEqual([
      'severe',
      'warning',
      'info',
    ]);
  });

  it('tolerates a missing routes list', () => {
    const alert = makeAlert({ entities: [{ type: 'Stop', gtfsId: 'S' }] });
    expect(relevantStopAlerts([alert], 'S', undefined)).toEqual([alert]);
  });
});
