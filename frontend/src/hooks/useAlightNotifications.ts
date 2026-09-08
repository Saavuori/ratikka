import { useCallback, useEffect, useRef, useState } from 'react';
import { alightNotification, type AlightAlert, type AlightPhase } from '../lib/alightAlert';
import { readStorage, writeStorage } from '../lib/storage';

export type NotifyPermission = 'unsupported' | 'default' | 'granted' | 'denied';

export const ALIGHT_STORAGE_KEY = 'alightNotifications';

/**
 * The two moments worth a buzz in a pocket. "Get ready" is shown on screen but
 * not pushed: three interruptions per leg trains a rider to ignore all of them.
 */
const NOTIFY_PHASES: AlightPhase[] = ['next', 'now'];
/** Two short pulses, then a long one — felt through a coat, unlike one tick. */
const VIBRATION = [120, 80, 120, 80, 320];

export interface AlightNotifications {
  permission: NotifyPermission;
  /** Whether system notifications are wanted *and* allowed. */
  enabled: boolean;
  /** Ask for permission and remember that they are wanted. */
  enable: () => void;
  disable: () => void;
}

function currentPermission(): NotifyPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission as NotifyPermission;
}

/**
 * Announces the alighting alert: a buzz when the stop becomes the next one and
 * again at the door, and a system notification for the same two moments when
 * the reader has allowed them.
 *
 * The screen banner is the alert; this is what carries it to a phone in a
 * pocket. It can only fire while the page is alive — a tab the browser has
 * frozen posts nothing — which is why the banner never depends on it.
 */
export function useAlightNotifications(alert: AlightAlert | null): AlightNotifications {
  const [permission, setPermission] = useState<NotifyPermission>(currentPermission);
  const [wanted, setWanted] = useState(() => readStorage(ALIGHT_STORAGE_KEY) !== 'false');
  /** Phases already announced for this leg, so a redraw does not re-buzz. */
  const announcedRef = useRef<{ legIndex: number; phases: Set<AlightPhase> }>({ legIndex: -1, phases: new Set() });
  const enabled = wanted && permission === 'granted';
  const enabledRef = useRef(enabled);

  useEffect(() => { enabledRef.current = enabled; }, [enabled]);

  const enable = useCallback(() => {
    setWanted(true);
    writeStorage(ALIGHT_STORAGE_KEY, 'true');
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setPermission('unsupported');
      return;
    }
    Notification.requestPermission()
      .then((result) => setPermission(result as NotifyPermission))
      .catch(() => setPermission('denied'));
  }, []);

  const disable = useCallback(() => {
    setWanted(false);
    writeStorage(ALIGHT_STORAGE_KEY, 'false');
  }, []);

  const legIndex = alert?.legIndex ?? -1;
  const phase = alert?.phase ?? null;
  const alertRef = useRef(alert);
  useEffect(() => { alertRef.current = alert; }, [alert]);

  useEffect(() => {
    const current = alertRef.current;
    if (!current || phase === null) return;
    const announced = announcedRef.current;
    // A new leg is a clean slate; each leg gets its own two announcements.
    if (announced.legIndex !== legIndex) {
      announcedRef.current = { legIndex, phases: new Set() };
    }
    if (!NOTIFY_PHASES.includes(phase) || announcedRef.current.phases.has(phase)) return;
    announcedRef.current.phases.add(phase);

    navigator.vibrate?.(VIBRATION);
    if (!enabledRef.current) return;
    const { title, body } = alightNotification(current);
    try {
      // One notification per journey, replaced as the ride progresses, rather
      // than a stack of them to dismiss after getting off.
      new Notification(title, { body, tag: 'hsl-live-alight', requireInteraction: phase === 'now' });
    } catch {
      // Some browsers only allow notifications from a service worker; the
      // banner and the buzz still did their job.
    }
  }, [legIndex, phase]);

  return { permission, enabled, enable, disable };
}
