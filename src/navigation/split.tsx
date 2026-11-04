import { Stack, useLocalSearchParams, type NativeStackNavigationOptions } from 'expo-router';
import { createContext, use, useLayoutEffect, useSyncExternalStore } from 'react';
import type { DetailEntry, RouteParams } from './hrefs';

// Wide windows (an unfolded iPhone Duo, an iPad, a phone in landscape) show
// the tab's list beside the selected game, team, or player. The width is read
// live, so folding or unfolding switches the layout without a reload.
export const SPLIT_MIN_WIDTH = 700;

export function listPaneWidth(windowWidth: number): number {
  return Math.round(Math.min(420, Math.max(320, windowWidth * 0.38)));
}

// Row links inside a split layout open their entry in the detail pane instead
// of pushing. The list pane replaces the selection; the detail pane pushes
// onto its own history. Without a provider, rows push as on a phone.
export type SplitLinks = {
  readonly open: (entry: DetailEntry) => void;
  readonly selectedKey: string | null;
};

export const SplitLinksContext = createContext<SplitLinks | null>(null);

export function useSplitLinks(): SplitLinks | null {
  return use(SplitLinksContext);
}

export type PaneHeaderOptions = Pick<NativeStackNavigationOptions, 'title' | 'headerTitle' | 'headerRight'>;

export type PaneHeaderStore = {
  readonly get: () => PaneHeaderOptions;
  readonly set: (options: PaneHeaderOptions) => void;
  readonly subscribe: (listener: () => void) => () => void;
};

export function createPaneHeaderStore(): PaneHeaderStore {
  let current: PaneHeaderOptions = {};
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set: (options) => {
      current = options;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function usePaneHeaderOptions(store: PaneHeaderStore): PaneHeaderOptions {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

type DetailPane = { readonly params: RouteParams; readonly header: PaneHeaderStore };

export const DetailPaneContext = createContext<DetailPane | null>(null);

// Detail screens read their entry from the pane when they render inside one,
// and from the route otherwise.
export function useDetailParams(): RouteParams {
  const pane = use(DetailPaneContext);
  const local = useLocalSearchParams();
  return pane?.params ?? local;
}

// A detail screen sets its header through this component. In the pane there
// is no native stack header, so the pane draws the title and actions itself.
export function DetailOptions({ options }: { options: NativeStackNavigationOptions }) {
  const pane = use(DetailPaneContext);
  if (pane === null) return <Stack.Screen options={options} />;
  return <PaneOptions store={pane.header} options={options} />;
}

function PaneOptions({ store, options }: { store: PaneHeaderStore; options: PaneHeaderOptions }) {
  const { title, headerTitle, headerRight } = options;
  useLayoutEffect(() => {
    store.set({ title, headerTitle, headerRight });
  }, [store, title, headerTitle, headerRight]);
  return null;
}
