import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TimelapsePanel } from './TimelapsePanel';
import { REPLAY_SPEEDS } from '../lib/replay';
import type { ReplayDayCoverage } from '../types';

const hours = (recorded: Record<number, number>): number[] =>
  Array.from({ length: 24 }, (_, h) => recorded[h] ?? 0);

const day = (date: string, recorded: Record<number, number>): ReplayDayCoverage => ({
  date,
  hours: { tram: hours(recorded) },
});

// 2026-09-06 is a Sunday in Finnish summer time (UTC+3).
const noon = Date.parse('2026-09-06T12:00:00+03:00') / 1000;
const range = {
  from: Date.parse('2026-09-06T00:00:00+03:00') / 1000,
  to: Date.parse('2026-09-07T00:00:00+03:00') / 1000,
};

const render = (props: Partial<Parameters<typeof TimelapsePanel>[0]> = {}) =>
  renderToStaticMarkup(
    <TimelapsePanel
      cursor={noon}
      range={range}
      playing={false}
      speed={1}
      loading={false}
      inGap={false}
      error={null}
      days={[day('2026-09-06', { 12: 60 })]}
      retentionDays={7}
      onSeek={() => {}}
      onToggle={() => {}}
      onSpeed={() => {}}
      onExit={() => {}}
      {...props}
    />
  );

describe('TimelapsePanel', () => {
  it('shows the moment being replayed in Helsinki time', () => {
    expect(render()).toContain('12:00:00');
  });

  it('offers every playback speed and marks the active one', () => {
    const markup = render({ speed: 8 });
    for (const speed of REPLAY_SPEEDS) {
      expect(markup).toContain(`${speed}×`);
    }
    expect(markup).toMatch(/is-active[^>]*aria-pressed="true"[^>]*>8×/);
  });

  it('scrubs across the whole retained range', () => {
    const markup = render();
    expect(markup).toContain(`min="${range.from}"`);
    expect(markup).toContain(`max="${range.to}"`);
  });

  it('says so when the scrubber is in a stretch nothing was recorded for', () => {
    expect(render({ inGap: true })).toContain('Nothing was recorded here');
  });

  it('prefers an error over the loading note', () => {
    const markup = render({ error: 'Could not load this stretch of history.', loading: true });
    expect(markup).toContain('Could not load this stretch of history.');
    expect(markup).not.toContain('Loading history');
  });

  it('says nothing at all when there is nothing to report', () => {
    // The status line is a row of the map; it is spent only on a gap, a load or
    // an error, never on standing text.
    const markup = render();
    expect(markup).not.toContain('timelapse-panel__status');
    expect(markup).toContain('timelapse-panel__track'); // the panel did render
  });

  it('always offers a way back to the live map', () => {
    expect(render()).toContain('Live');
  });
});
