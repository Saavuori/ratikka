import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { usePersistedFlag, usePersistedLines } from './usePersisted';

/**
 * Static rendering runs state initialisers but not effects, so these cover the
 * read side: what a stored string decodes to, and when the fallback stands.
 */
function readFlag(key: string, fallback: boolean): boolean {
  let seen: boolean | undefined;
  const Probe = () => {
    [seen] = usePersistedFlag(key, fallback);
    return null;
  };
  renderToStaticMarkup(<Probe />);
  return seen as boolean;
}

function readLines(key: string): string[] {
  let seen: string[] | undefined;
  const Probe = () => {
    [seen] = usePersistedLines(key);
    return null;
  };
  renderToStaticMarkup(<Probe />);
  return seen as string[];
}

function store(value: string | null) {
  vi.stubGlobal('window', {
    localStorage: { getItem: () => value, setItem: () => {} },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('usePersistedFlag', () => {
  it('takes the fallback when nothing was ever stored', () => {
    store(null);
    expect(readFlag('showTrams', true)).toBe(true);
    expect(readFlag('showBuses', false)).toBe(false);
  });

  it('honours an explicit stored choice either way', () => {
    store('false');
    expect(readFlag('showTrams', true)).toBe(false);
    store('true');
    expect(readFlag('showBuses', false)).toBe(true);
  });

  it('takes the fallback for a value it does not recognise', () => {
    store('yes');
    expect(readFlag('showTrams', true)).toBe(true);
    expect(readFlag('showBuses', false)).toBe(false);
  });

  it('takes the fallback when storage itself is unavailable', () => {
    // Safari Private Browsing and "block all cookies" throw on access.
    vi.stubGlobal('window', {
      get localStorage(): Storage {
        throw new Error('SecurityError');
      },
    });
    expect(readFlag('showTrams', true)).toBe(true);
  });
});

describe('usePersistedLines', () => {
  it('reads back a stored filter', () => {
    store(JSON.stringify(['4', '7B']));
    expect(readLines('selectedLines')).toEqual(['4', '7B']);
  });

  it('drops entries that are not line identifiers', () => {
    store(JSON.stringify(['4', 7, null, '10']));
    expect(readLines('selectedLines')).toEqual(['4', '10']);
  });

  it('falls back to no filter on malformed or unexpected JSON', () => {
    store('{oops');
    expect(readLines('selectedLines')).toEqual([]);
    store(JSON.stringify({ lines: ['4'] }));
    expect(readLines('selectedLines')).toEqual([]);
  });
});
