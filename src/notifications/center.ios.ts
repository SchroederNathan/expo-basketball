import { queryOptions, skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { League } from '@/domain/league';
import { useCalendar } from '@/state/calendar';
import type { NotificationCenter, NotificationView, TeamChoices } from './center.types';
import {
  applyDraft,
  type DeliveryRecord,
  type PreferenceDraft,
  type PushPermission,
  type VersionedPreferences,
} from './model';
import {
  allowsDelivery,
  detectPushSupport,
  ensureIdentity,
  fetchHistory,
  fetchPreferences,
  fetchTeamOptions,
  loadIdentity,
  NotificationServiceError,
  readDeviceToken,
  readPermission,
  registerInstallation,
  requestPermission,
  savePreferences,
  syncContext,
  type ServiceContext,
} from './service';

type AccountData =
  | { readonly kind: 'unregistered' }
  | {
      readonly kind: 'registered';
      readonly preferences: VersionedPreferences;
      readonly history: readonly DeliveryRecord[];
    };

type CenterData =
  | { readonly kind: 'unsupported'; readonly message: string }
  | {
      readonly kind: 'ready';
      readonly context: ServiceContext;
      readonly permission: PushPermission;
      readonly account: AccountData;
    };

// Opening this screen reads state. It writes only to finish a reinstall
// handoff or to sync a changed permission, zone, or token for an installation
// the user already turned on.
async function loadCenter(zone: string): Promise<CenterData> {
  const support = await detectPushSupport();
  if (support.kind === 'unsupported') return support;
  const { context } = support;
  const [permission, identity] = await Promise.all([readPermission(), loadIdentity(context)]);
  if (identity === null) return { kind: 'ready', context, permission, account: { kind: 'unregistered' } };
  const token = allowsDelivery(permission) ? await readDeviceToken().catch(() => null) : null;
  try {
    await syncContext(context, identity, { permission, timeZone: zone, token });
    const [preferences, history] = await Promise.all([
      fetchPreferences(context, identity),
      fetchHistory(context, identity),
    ]);
    return { kind: 'ready', context, permission, account: { kind: 'registered', preferences, history } };
  } catch (error) {
    if (error instanceof NotificationServiceError && (error.status === 401 || error.status === 404)) {
      return { kind: 'ready', context, permission, account: { kind: 'unregistered' } };
    }
    throw error;
  }
}

function centerOptions(zone: string) {
  return queryOptions({
    queryKey: ['notifications', zone] as const,
    queryFn: () => loadCenter(zone),
    // Returning from the system Settings app must show the new permission.
    staleTime: 0,
    retry: false,
  });
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof NotificationServiceError ? error.message : fallback;
}

export function useNotificationCenter(league: League): NotificationCenter {
  const { zone } = useCalendar();
  const client = useQueryClient();
  const options = centerOptions(zone);
  const query = useQuery(options);
  const data = query.data;
  const registered = data?.kind === 'ready' && data.account.kind === 'registered' ? data : null;

  const teamsQuery = useQuery({
    queryKey: ['notification-teams', league] as const,
    queryFn: registered ? () => fetchTeamOptions(registered.context, league) : skipToken,
    staleTime: 60 * 60_000,
  });

  const enableMutation = useMutation({
    mutationFn: async (context: ServiceContext) => {
      const permission = await requestPermission();
      if (!allowsDelivery(permission)) return;
      const identity = await ensureIdentity(context);
      await registerInstallation(context, identity, zone);
      const token = await readDeviceToken();
      await syncContext(context, identity, { permission, timeZone: zone, token });
    },
    onSettled: () => client.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const saveMutation = useMutation({
    mutationFn: async ({ context, draft }: { context: ServiceContext; draft: PreferenceDraft }) => {
      const identity = await loadIdentity(context);
      if (identity === null) {
        throw new NotificationServiceError('Turn on notifications before saving settings.', null);
      }
      // A conflict means another save landed between this read and write.
      // The draft holds only edits, so it applies once more to the newer revision.
      const saveCurrentRevision = async () => {
        const current = await fetchPreferences(context, identity);
        return savePreferences(context, identity, {
          revision: current.revision,
          preferences: applyDraft(current.preferences, draft, zone),
        });
      };
      try {
        return await saveCurrentRevision();
      } catch (error) {
        if (!(error instanceof NotificationServiceError && error.status === 409)) throw error;
        return saveCurrentRevision();
      }
    },
    onSuccess: (saved) => {
      client.setQueryData(options.queryKey, (current) =>
        current?.kind === 'ready' && current.account.kind === 'registered'
          ? { ...current, account: { ...current.account, preferences: saved } }
          : current,
      );
    },
  });

  let teams: TeamChoices = { kind: 'loading' };
  if (teamsQuery.data !== undefined) teams = { kind: 'ready', teams: teamsQuery.data };
  else if (teamsQuery.error) teams = { kind: 'failed' };

  let view: NotificationView;
  if (data?.kind === 'unsupported') view = data;
  else if (data?.kind === 'ready') {
    view = {
      kind: 'ready',
      permission: data.permission,
      account: data.account.kind === 'registered' ? { ...data.account, teams } : data.account,
    };
  } else if (query.error) {
    view = { kind: 'error', message: messageOf(query.error, 'Notification settings couldn’t be loaded.') };
  } else view = { kind: 'loading' };

  return {
    view,
    retry: () => {
      void query.refetch();
      if (teamsQuery.error) void teamsQuery.refetch();
    },
    enable: () => {
      if (data?.kind === 'ready') enableMutation.mutate(data.context);
    },
    enabling: enableMutation.isPending,
    enableError: enableMutation.error
      ? messageOf(enableMutation.error, 'Notifications couldn’t be turned on on this iPhone.')
      : null,
    save: async (draft) => {
      if (data?.kind !== 'ready') return false;
      try {
        await saveMutation.mutateAsync({ context: data.context, draft });
        return true;
      } catch {
        return false;
      }
    },
    saving: saveMutation.isPending,
    saveError: saveMutation.error ? messageOf(saveMutation.error, 'Settings couldn’t be saved.') : null,
  };
}
