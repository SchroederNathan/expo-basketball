import type { League } from '@/domain/league';
import type { NotificationCenter } from './center.types';

// The service accepts direct APNs tokens only, so Android and web stay
// disabled and send nothing.
export function useNotificationCenter(_league: League): NotificationCenter {
  return {
    view: { kind: 'unsupported', message: 'Push notifications are available in the iOS app.' },
    retry: () => undefined,
    enable: () => undefined,
    enabling: false,
    enableError: null,
    save: async () => false,
    saving: false,
    saveError: null,
  };
}
