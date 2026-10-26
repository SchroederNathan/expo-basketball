// iOS only. Imported from the .ios files of this folder, so Android and web
// bundles never load these native modules.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import type { NotificationPermissionsStatus } from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { z } from 'zod';
import type { League } from '@/domain/league';
import { NOTIFICATION_SERVICE_URL } from './config';
import {
  historySchema,
  isApnsToken,
  openedSchema,
  teamOptionsSchema,
  versionedPreferencesSchema,
  type ApnsToken,
  type DeliveryId,
  type DeliveryRecord,
  type PushEnvironment,
  type PushPermission,
  type TeamOption,
  type VersionedPreferences,
} from './model';

export type ServiceContext = {
  readonly environment: PushEnvironment;
  readonly baseUrl: string;
};

export type PushSupport =
  | { readonly kind: 'unsupported'; readonly message: string }
  | { readonly kind: 'supported'; readonly context: ServiceContext };

export async function detectPushSupport(): Promise<PushSupport> {
  if (NOTIFICATION_SERVICE_URL === null) {
    return {
      kind: 'unsupported',
      message: 'This build has no notification service configured. Scores, games, and teams work without one.',
    };
  }
  if (!Device.isDevice) {
    return {
      kind: 'unsupported',
      message: 'Push notifications need an iPhone. The simulator can’t register this app for remote notifications.',
    };
  }
  const environment = await Application.getIosPushNotificationServiceEnvironmentAsync().catch(() => null);
  if (environment === null) {
    return { kind: 'unsupported', message: 'This build isn’t signed for push notifications.' };
  }
  return {
    kind: 'supported',
    context: {
      environment: environment === 'development' ? 'sandbox' : 'production',
      baseUrl: NOTIFICATION_SERVICE_URL,
    },
  };
}

// Credentials are scoped to this app and to the APNs environment that signed
// the build, so development and store builds never share an installation.
const KEY_PREFIX = `${Application.applicationId ?? 'app'}.push`;
const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

function secretKey(environment: PushEnvironment): string {
  return `${KEY_PREFIX}.installation.${environment}`;
}

function markerKey(environment: PushEnvironment): string {
  return `${KEY_PREFIX}.installation-marker.${environment}`;
}

const identitySchema = z.object({
  installationId: z.uuid(),
  secret: z.string().regex(/^[a-f0-9]{64}$/),
});

export type InstallationIdentity = z.output<typeof identitySchema>;

export class NotificationServiceError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null) {
    super(message);
    this.name = 'NotificationServiceError';
    this.status = status;
  }
}

function statusMessage(status: number): string {
  switch (status) {
    case 400:
      return 'The notification service rejected these settings.';
    case 401:
      return 'The notification service didn’t accept this device’s credentials.';
    case 409:
      return 'These settings changed on the service. Review them and save again.';
    case 429:
      return 'Too many requests. Try again in a minute.';
    default:
      return 'The notification service is unavailable right now.';
  }
}

type ServiceRequest<S extends z.ZodType> = {
  readonly context: ServiceContext;
  readonly identity: InstallationIdentity | null;
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly path: `/v1/${string}`;
  readonly body?: unknown;
  readonly schema: S;
};

// The bearer credential is built here and never leaves this function: errors
// carry a fixed message and the HTTP status only.
async function serviceRequest<S extends z.ZodType>(request: ServiceRequest<S>): Promise<z.output<S>> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (request.identity !== null) {
    headers.Authorization = `Bearer ${request.identity.installationId}.${request.identity.secret}`;
  }
  if (request.body !== undefined) headers['Content-Type'] = 'application/json';
  let response: Response;
  try {
    response = await fetch(`${request.context.baseUrl}${request.path}`, {
      method: request.method,
      headers,
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
    });
  } catch {
    throw new NotificationServiceError('The notification service couldn’t be reached.', null);
  }
  if (!response.ok) throw new NotificationServiceError(statusMessage(response.status), response.status);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new NotificationServiceError('The notification service sent an unreadable answer.', response.status);
  }
  const parsed = request.schema.safeParse(body);
  if (!parsed.success) {
    throw new NotificationServiceError('The notification service sent an unexpected answer.', response.status);
  }
  return parsed.data;
}

type StoredIdentity =
  | { readonly kind: 'none' }
  | { readonly kind: 'current'; readonly identity: InstallationIdentity }
  | { readonly kind: 'stale'; readonly identity: InstallationIdentity };

async function readStoredIdentity(environment: PushEnvironment): Promise<StoredIdentity> {
  const raw = await SecureStore.getItemAsync(secretKey(environment), SECURE_OPTIONS);
  if (raw === null) return { kind: 'none' };
  let value: unknown = null;
  try {
    value = JSON.parse(raw);
  } catch {
    return { kind: 'none' };
  }
  const parsed = identitySchema.safeParse(value);
  if (!parsed.success) return { kind: 'none' };
  const marker = await AsyncStorage.getItem(markerKey(environment));
  return marker === parsed.data.installationId
    ? { kind: 'current', identity: parsed.data }
    : { kind: 'stale', identity: parsed.data };
}

// The keychain outlives a reinstall, but app storage does not. A credential
// without a matching marker belongs to an earlier install. It proves ownership
// and deletes that installation, so its push endpoint is released. Offline,
// the credential stays and a later attempt finishes the handoff.
async function releaseStaleIdentity(context: ServiceContext, identity: InstallationIdentity): Promise<void> {
  try {
    await serviceRequest({ context, identity, method: 'DELETE', path: '/v1/installations/me', schema: z.unknown() });
  } catch (error) {
    const gone = error instanceof NotificationServiceError && (error.status === 401 || error.status === 404);
    if (!gone) throw error;
  }
  await SecureStore.deleteItemAsync(secretKey(context.environment), SECURE_OPTIONS);
}

export async function loadIdentity(context: ServiceContext): Promise<InstallationIdentity | null> {
  const stored = await readStoredIdentity(context.environment);
  switch (stored.kind) {
    case 'none':
      return null;
    case 'current':
      return stored.identity;
    case 'stale':
      await releaseStaleIdentity(context, stored.identity);
      return null;
    default: {
      const exhaustive: never = stored;
      return exhaustive;
    }
  }
}

async function createIdentity(environment: PushEnvironment): Promise<InstallationIdentity> {
  const secret = Array.from(Crypto.getRandomBytes(32), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const identity = identitySchema.parse({ installationId: Crypto.randomUUID().toLowerCase(), secret });
  await SecureStore.setItemAsync(secretKey(environment), JSON.stringify(identity), SECURE_OPTIONS);
  await AsyncStorage.setItem(markerKey(environment), identity.installationId);
  return identity;
}

const pendingIdentity = new Map<PushEnvironment, Promise<InstallationIdentity>>();

// One identity at a time per environment, even if two callers ask at once.
export function ensureIdentity(context: ServiceContext): Promise<InstallationIdentity> {
  const pending = pendingIdentity.get(context.environment);
  if (pending) return pending;
  const task = loadIdentity(context)
    .then((existing) => existing ?? createIdentity(context.environment))
    .finally(() => pendingIdentity.delete(context.environment));
  pendingIdentity.set(context.environment, task);
  return task;
}

export function registerInstallation(
  context: ServiceContext,
  identity: InstallationIdentity,
  timeZone: string,
): Promise<VersionedPreferences> {
  return serviceRequest({
    context,
    identity: null,
    method: 'POST',
    path: '/v1/installations',
    body: { installationId: identity.installationId, secret: identity.secret, timeZone },
    schema: versionedPreferencesSchema,
  });
}

export function fetchPreferences(context: ServiceContext, identity: InstallationIdentity): Promise<VersionedPreferences> {
  return serviceRequest({
    context,
    identity,
    method: 'GET',
    path: '/v1/installations/me/preferences',
    schema: versionedPreferencesSchema,
  });
}

export function savePreferences(
  context: ServiceContext,
  identity: InstallationIdentity,
  next: VersionedPreferences,
): Promise<VersionedPreferences> {
  return serviceRequest({
    context,
    identity,
    method: 'PUT',
    path: '/v1/installations/me/preferences',
    body: next,
    schema: versionedPreferencesSchema,
  });
}

export async function fetchHistory(context: ServiceContext, identity: InstallationIdentity): Promise<DeliveryRecord[]> {
  const history = await serviceRequest({
    context,
    identity,
    method: 'GET',
    path: '/v1/installations/me/notifications',
    schema: historySchema,
  });
  return history.notifications;
}

export async function fetchTeamOptions(context: ServiceContext, league: League): Promise<TeamOption[]> {
  const result = await serviceRequest({
    context,
    identity: null,
    method: 'GET',
    path: `/v1/teams?league=${encodeURIComponent(league)}`,
    schema: teamOptionsSchema,
  });
  return result.teams;
}

export function markOpened(context: ServiceContext, identity: InstallationIdentity, deliveryId: DeliveryId) {
  return serviceRequest({
    context,
    identity,
    method: 'POST',
    path: `/v1/notifications/${encodeURIComponent(deliveryId)}/open`,
    body: {},
    schema: openedSchema,
  });
}

const lastSynced = new Map<PushEnvironment, string>();

// Sends permission, zone, and device token only when one of them changed
// since the last sync in this process.
export async function syncContext(
  context: ServiceContext,
  identity: InstallationIdentity,
  state: { readonly permission: PushPermission; readonly timeZone: string; readonly token: ApnsToken | null },
): Promise<void> {
  const fingerprint = [identity.installationId, state.permission, state.timeZone, state.token ?? ''].join(':');
  if (lastSynced.get(context.environment) === fingerprint) return;
  await serviceRequest({
    context,
    identity,
    method: 'PATCH',
    path: '/v1/installations/me/context',
    body: { permission: state.permission, timeZone: state.timeZone },
    schema: z.unknown(),
  });
  if (state.token !== null) {
    await serviceRequest({
      context,
      identity,
      method: 'PUT',
      path: '/v1/installations/me/push-endpoint',
      body: { token: state.token, environment: context.environment },
      schema: z.unknown(),
    });
  }
  lastSynced.set(context.environment, fingerprint);
}

function permissionFrom(
  status: NotificationPermissionsStatus,
  authorization: typeof import('expo-notifications').IosAuthorizationStatus,
): PushPermission {
  switch (status.ios?.status) {
    case authorization.AUTHORIZED:
    case authorization.EPHEMERAL:
      return 'authorized';
    case authorization.PROVISIONAL:
      return 'provisional';
    case authorization.DENIED:
      return 'denied';
    case authorization.NOT_DETERMINED:
      return 'notDetermined';
    default:
      return status.granted ? 'authorized' : status.canAskAgain ? 'notDetermined' : 'denied';
  }
}

export async function readPermission(): Promise<PushPermission> {
  const notifications = await import('expo-notifications');
  return permissionFrom(await notifications.getPermissionsAsync(), notifications.IosAuthorizationStatus);
}

export async function requestPermission(): Promise<PushPermission> {
  const notifications = await import('expo-notifications');
  return permissionFrom(
    await notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } }),
    notifications.IosAuthorizationStatus,
  );
}

export function allowsDelivery(permission: PushPermission): boolean {
  return permission === 'authorized' || permission === 'provisional';
}

// The direct APNs device token, never an Expo push token.
export async function readDeviceToken(): Promise<ApnsToken | null> {
  const notifications = await import('expo-notifications');
  const token = await notifications.getDevicePushTokenAsync();
  if (token.type !== 'ios' || typeof token.data !== 'string') return null;
  const value = token.data.toLowerCase();
  return isApnsToken(value) ? value : null;
}

// Records that a delivery was opened. Returns the service's record of it, which
// carries the scores date for recaps, or null when that isn't possible.
export async function acknowledgeOpen(deliveryId: DeliveryId) {
  const support = await detectPushSupport();
  if (support.kind === 'unsupported') return null;
  try {
    const identity = await loadIdentity(support.context);
    return identity === null ? null : await markOpened(support.context, identity, deliveryId);
  } catch {
    return null;
  }
}
