import { describe, expect, it } from 'vitest';
import { parseReplayLink, withoutReplayLink } from './replayLink';

describe('parseReplayLink', () => {
  it('reads a moment in seconds and a vehicle', () => {
    expect(parseReplayLink('?at=1791033448&veh=0040-412')).toEqual({ at: 1791033448, veh: '0040-412' });
  });

  it('takes milliseconds, which is what Grafana hands out', () => {
    expect(parseReplayLink('?at=1791033448123&veh=0040-412')).toEqual({ at: 1791033448, veh: '0040-412' });
  });

  it('ignores a link missing either half, or with a malformed one', () => {
    expect(parseReplayLink('')).toBeNull();
    expect(parseReplayLink('?at=1791033448')).toBeNull();
    expect(parseReplayLink('?veh=0040-412')).toBeNull();
    expect(parseReplayLink('?at=yesterday&veh=0040-412')).toBeNull();
    expect(parseReplayLink('?at=-5&veh=0040-412')).toBeNull();
    expect(parseReplayLink('?at=1791033448&veh=<script>')).toBeNull();
  });
});

describe('withoutReplayLink', () => {
  it('drops the link and keeps everything else', () => {
    expect(withoutReplayLink('https://hsl-live.duckdns.org/?at=1&veh=0040-1&x=2#map'))
      .toBe('/?x=2#map');
    expect(withoutReplayLink('https://hsl-live.duckdns.org/?at=1&veh=0040-1')).toBe('/');
  });
});
