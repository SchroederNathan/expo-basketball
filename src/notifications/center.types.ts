import type {
  DeliveryRecord,
  PreferenceDraft,
  PushPermission,
  TeamOption,
  VersionedPreferences,
} from './model';

// Teams for the favorite-team menu belong to one league, so they load apart
// from the rest of the account and never show another league's teams.
export type TeamChoices =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'ready'; readonly teams: readonly TeamOption[] };

export type NotificationAccount =
  | { readonly kind: 'unregistered' }
  | {
      readonly kind: 'registered';
      readonly preferences: VersionedPreferences;
      readonly history: readonly DeliveryRecord[];
      readonly teams: TeamChoices;
    };

// Unsupported covers other platforms, the simulator, unsigned builds, and
// builds without a configured service. That state makes no service request.
export type NotificationView =
  | { readonly kind: 'unsupported'; readonly message: string }
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready'; readonly permission: PushPermission; readonly account: NotificationAccount };

export type NotificationCenter = {
  readonly view: NotificationView;
  readonly retry: () => void;
  readonly enable: () => void;
  readonly enabling: boolean;
  readonly enableError: string | null;
  // Resolves true once the service stored the draft. On false the caller keeps it.
  readonly save: (draft: PreferenceDraft) => Promise<boolean>;
  readonly saving: boolean;
  readonly saveError: string | null;
};
