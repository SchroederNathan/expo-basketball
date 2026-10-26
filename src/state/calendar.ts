import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { isIanaZone, todayIn, type IanaZone, type Ymd } from '@/domain/dates';

export type Calendar = { readonly zone: IanaZone; readonly today: Ymd };

const CHECK_INTERVAL_MS = 60_000;

function deviceZone(): IanaZone {
  for (const candidate of [Intl.DateTimeFormat().resolvedOptions().timeZone, 'UTC']) {
    if (typeof candidate === 'string' && isIanaZone(candidate)) return candidate;
  }
  throw new RangeError('This runtime has no usable time zone.');
}

function read(): Calendar {
  const zone = deviceZone();
  return { zone, today: todayIn(zone, new Date()) };
}

let current: Calendar = read();
let stop: (() => void) | null = null;
const listeners = new Set<() => void>();

function refresh(): void {
  const next = read();
  if (next.zone === current.zone && next.today === current.today) return;
  current = next;
  for (const listener of listeners) listener();
}

// The zone and the date are read again when the app returns to the foreground
// and once a minute while it is active, which covers midnight and travel.
function start(): () => void {
  const subscription = AppState.addEventListener('change', (status) => {
    if (status === 'active') refresh();
  });
  const timer = setInterval(() => {
    if (AppState.currentState === 'active') refresh();
  }, CHECK_INTERVAL_MS);
  return () => {
    subscription.remove();
    clearInterval(timer);
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    refresh();
    stop = start();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stop?.();
      stop = null;
    }
  };
}

function snapshot(): Calendar {
  return current;
}

export function useCalendar(): Calendar {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
