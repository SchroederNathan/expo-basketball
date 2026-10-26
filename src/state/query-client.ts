import NetInfo from '@react-native-community/netinfo';
import { focusManager, onlineManager, QueryClient } from '@tanstack/react-query';
import { AppState } from 'react-native';
import { shouldRetry } from '@/api/errors';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetry, gcTime: 10 * 60_000 },
    },
  });
}

// Queries count as focused only while the app is in the foreground, so interval
// polling stops in the background and stale data refreshes on return. Offline
// requests pause and resume when the network comes back.
export function connectQueryLifecycle(): void {
  focusManager.setEventListener((setFocused) => {
    const subscription = AppState.addEventListener('change', (status) => {
      setFocused(status === 'active');
    });
    return () => subscription.remove();
  });
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((network) => {
      setOnline(network.isConnected !== false && network.isInternetReachable !== false);
    }),
  );
}
