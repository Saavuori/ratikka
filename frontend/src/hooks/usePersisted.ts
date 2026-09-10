import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { readStorage, writeStorage } from '../lib/storage';

/**
 * `useState`, with the value read back from localStorage on mount and written
 * to it whenever it changes.
 *
 * `decode` turns the stored string into a value, and returns null for anything
 * it does not recognise — a key that was never written, or one holding what an
 * older version of the app put there — in which case the fallback stands.
 * Storage itself may be unavailable (see `lib/storage`), which is the same
 * case: the preference simply does not persist.
 */
export function usePersistedState<T>(
  key: string,
  fallback: T,
  decode: (raw: string) => T | null,
  encode: (value: T) => string
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    const raw = readStorage(key);
    if (raw === null) return fallback;
    return decode(raw) ?? fallback;
  });

  useEffect(() => {
    writeStorage(key, encode(value));
    // `encode` is a literal at every call site; re-running on its identity
    // would write on every render for no gain.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, value]);

  return [value, setValue];
}

/** A remembered on/off preference — a Settings toggle. */
export function usePersistedFlag(
  key: string,
  fallback: boolean
): [boolean, Dispatch<SetStateAction<boolean>>] {
  return usePersistedState(
    key,
    fallback,
    (raw) => (raw === 'true' ? true : raw === 'false' ? false : null),
    String
  );
}

/** A remembered list of line identifiers — the reader's line filter. */
export function usePersistedLines(
  key: string
): [string[], Dispatch<SetStateAction<string[]>>] {
  return usePersistedState<string[]>(
    key,
    [],
    (raw) => {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return null;
        return parsed.filter((line): line is string => typeof line === 'string');
      } catch {
        return null;
      }
    },
    (lines) => JSON.stringify(lines)
  );
}
