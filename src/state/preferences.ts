import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { DEFAULT_LEAGUE, parseLeague, type League } from '@/domain/league';

const STORAGE_KEY = 'lob.preferred-league';

type PreferenceState =
  | { readonly kind: 'hydrating' }
  | { readonly kind: 'ready'; readonly league: League };

let state: PreferenceState = { kind: 'hydrating' };
let hydration: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(next: PreferenceState): void {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): PreferenceState {
  return state;
}

export function hydratePreferredLeague(): Promise<void> {
  hydration ??= AsyncStorage.getItem(STORAGE_KEY)
    .then(parseLeague, () => null)
    .then((stored) => {
      if (state.kind === 'hydrating') publish({ kind: 'ready', league: stored ?? DEFAULT_LEAGUE });
    });
  return hydration;
}

export function usePreferencesHydrated(): boolean {
  return useSyncExternalStore(subscribe, snapshot, snapshot).kind === 'ready';
}

export function usePreferredLeague(): League {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  return current.kind === 'ready' ? current.league : DEFAULT_LEAGUE;
}

export function setPreferredLeague(league: League): void {
  if (state.kind === 'ready' && state.league === league) return;
  publish({ kind: 'ready', league });
  // A failed write only costs persistence. The choice still applies now.
  void AsyncStorage.setItem(STORAGE_KEY, league).catch(() => undefined);
}
