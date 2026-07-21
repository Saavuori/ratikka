// localStorage access can throw: Safari Private Browsing gives storage a
// zero-byte quota (setItem throws QuotaExceededError) and "block all cookies"
// makes even reading `window.localStorage` throw a SecurityError. Persistence
// is a nice-to-have here, so degrade to in-memory defaults instead of letting
// an exception take down the app.

export function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage unavailable or full — skip persistence.
  }
}
