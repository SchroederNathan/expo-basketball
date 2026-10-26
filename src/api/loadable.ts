// What a screen can show for one query. Cached data always wins: a failed
// refresh keeps the last answer on screen and reports the error beside it.
import { ApiError } from './errors';

export type Loadable<T> =
  | { readonly kind: 'loading' }
  | { readonly kind: 'offline' }
  | { readonly kind: 'failed'; readonly error: Error }
  | { readonly kind: 'ready'; readonly data: T; readonly refreshError: Error | null };

type QuerySnapshot<T> = {
  readonly data: T | undefined;
  readonly error: Error | null;
  readonly fetchStatus: 'fetching' | 'paused' | 'idle';
};

export function loadable<T>(query: QuerySnapshot<T>, online = true): Loadable<T> {
  if (query.data !== undefined) return {
    kind: 'ready',
    data: query.data,
    refreshError: query.error ?? (!online ? new ApiError('network', 'The device is offline.') : null),
  };
  if (!online) return { kind: 'offline' };
  if (query.error) return { kind: 'failed', error: query.error };
  if (query.fetchStatus === 'paused') return { kind: 'offline' };
  return { kind: 'loading' };
}
