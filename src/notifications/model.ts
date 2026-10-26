import { z } from 'zod';
import { parseYmd, type Ymd } from '@/domain/dates';
import { isGameId, type GameRef } from '@/domain/ids';
import { LEAGUE_IDS, parseLeague, type League } from '@/domain/league';

export type PushEnvironment = 'sandbox' | 'production';
export type PushPermission = 'notDetermined' | 'authorized' | 'provisional' | 'denied' | 'unsupported';

export type ClockTime = string & { readonly __brand: 'ClockTime' };
export type DeliveryId = string & { readonly __brand: 'DeliveryId' };
export type ApnsToken = string & { readonly __brand: 'ApnsToken' };

const CLOCK_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DELIVERY_ID_PATTERN = /^[A-Za-z0-9]{1,64}$/;
const APNS_TOKEN_PATTERN = /^[a-f0-9]{32,512}$/;

export function isClockTime(value: string): value is ClockTime {
  return CLOCK_PATTERN.test(value);
}

export function isDeliveryId(value: string): value is DeliveryId {
  return DELIVERY_ID_PATTERN.test(value);
}

// The service accepts only direct APNs device tokens: even-length hex.
export function isApnsToken(value: string): value is ApnsToken {
  return APNS_TOKEN_PATTERN.test(value) && value.length % 2 === 0;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

// Time pickers work with local Date values. Only the hour and minute matter.
export function clockToLocalDate(time: ClockTime): Date {
  return new Date(2000, 0, 1, Number(time.slice(0, 2)), Number(time.slice(3, 5)));
}

export function clockFromLocalDate(date: Date): ClockTime | null {
  const value = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return isClockTime(value) ? value : null;
}

const clock = z.string().refine(isClockTime, 'Expected HH:MM');
const league = z.enum(LEAGUE_IDS);

const leaguePreferenceSchema = z.object({
  league,
  enabled: z.boolean(),
  favoriteTeamId: z.string().max(40),
  scope: z.enum(['league', 'team']),
  recap: z.boolean(),
  tipoffs: z.boolean().catch(false),
  finals: z.boolean(),
  performances: z.boolean(),
});

const preferenceBundleSchema = z.object({
  timeZone: z.string(),
  locale: z.literal('en'),
  recapTime: clock,
  quietStart: clock,
  quietEnd: clock,
  leagues: z.array(leaguePreferenceSchema),
});

export const versionedPreferencesSchema = z.object({
  revision: z.number().int().min(0),
  preferences: preferenceBundleSchema,
});

export type LeaguePreference = z.output<typeof leaguePreferenceSchema>;
export type PreferenceBundle = z.output<typeof preferenceBundleSchema>;
export type VersionedPreferences = z.output<typeof versionedPreferencesSchema>;

const deliverySchema = z.object({
  id: z.string().refine(isDeliveryId, 'Expected a delivery id'),
  status: z.string().catch(''),
  league: league.nullable().catch(null),
  title: z.string().catch(''),
  body: z.string().catch(''),
  createdAt: z.number().catch(0),
  gameId: z.string().catch(''),
  date: z.string().catch(''),
});

export type DeliveryRecord = z.output<typeof deliverySchema>;

// History is a display list, so one malformed record is left out instead of
// hiding every other record.
export const historySchema = z.object({
  notifications: z.array(z.unknown()).transform((items) =>
    items.flatMap((item) => {
      const parsed = deliverySchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});

export const teamOptionsSchema = z.object({
  teams: z.array(z.object({ id: z.string().min(1).max(40), name: z.string().min(1) })),
});

export type TeamOption = z.output<typeof teamOptionsSchema>['teams'][number];

export const openedSchema = z.object({
  league: league.nullable().catch(null),
  gameId: z.string().catch(''),
  date: z.string().catch(''),
});

export function defaultLeaguePreference(target: League): LeaguePreference {
  return {
    league: target,
    enabled: false,
    favoriteTeamId: '',
    scope: 'league',
    recap: true,
    tipoffs: false,
    finals: false,
    performances: false,
  };
}

export function preferenceFor(bundle: PreferenceBundle, target: League): LeaguePreference {
  return bundle.leagues.find((entry) => entry.league === target) ?? defaultLeaguePreference(target);
}

export type LeaguePatch = Partial<Omit<LeaguePreference, 'league'>>;
export type SchedulePatch = Partial<Pick<PreferenceBundle, 'recapTime' | 'quietStart' | 'quietEnd'>>;

// Unsaved edits. Only changed fields are stored, so a save can apply them on
// top of whatever revision the service holds at that moment.
export type PreferenceDraft = {
  readonly leagues: Partial<Record<League, LeaguePatch>>;
  readonly schedule: SchedulePatch;
};

export const EMPTY_DRAFT: PreferenceDraft = { leagues: {}, schedule: {} };

export function isDraftEmpty(draft: PreferenceDraft): boolean {
  return (
    Object.keys(draft.schedule).length === 0 &&
    Object.values(draft.leagues).every((patch) => patch === undefined || Object.keys(patch).length === 0)
  );
}

// A team-only scope needs a favorite team. Clearing the favorite widens the
// scope to the whole league, which the service also requires.
function applyLeaguePatch(preference: LeaguePreference, patch: LeaguePatch | undefined): LeaguePreference {
  const next: LeaguePreference = patch
    ? {
        league: preference.league,
        enabled: patch.enabled ?? preference.enabled,
        favoriteTeamId: patch.favoriteTeamId ?? preference.favoriteTeamId,
        scope: patch.scope ?? preference.scope,
        recap: patch.recap ?? preference.recap,
        tipoffs: patch.tipoffs ?? preference.tipoffs,
        finals: patch.finals ?? preference.finals,
        performances: patch.performances ?? preference.performances,
      }
    : preference;
  return next.scope === 'team' && next.favoriteTeamId === '' ? { ...next, scope: 'league' } : next;
}

export function applyDraft(bundle: PreferenceBundle, draft: PreferenceDraft, timeZone: string): PreferenceBundle {
  const leagues = bundle.leagues.map((preference) =>
    applyLeaguePatch(preference, draft.leagues[preference.league]),
  );
  for (const target of LEAGUE_IDS) {
    const patch = draft.leagues[target];
    if (patch !== undefined && !leagues.some((entry) => entry.league === target)) {
      leagues.push(applyLeaguePatch(defaultLeaguePreference(target), patch));
    }
  }
  return {
    timeZone,
    locale: bundle.locale,
    recapTime: draft.schedule.recapTime ?? bundle.recapTime,
    quietStart: draft.schedule.quietStart ?? bundle.quietStart,
    quietEnd: draft.schedule.quietEnd ?? bundle.quietEnd,
    leagues,
  };
}

export function deliveryStatusLabel(status: string): string | null {
  if (status === 'accepted') return 'Sent';
  if (status === 'unknown') return 'Delivery unconfirmed';
  return null;
}

export type PushDestination =
  | { readonly kind: 'game'; readonly deliveryId: DeliveryId | null; readonly game: GameRef }
  | {
      readonly kind: 'scores';
      readonly deliveryId: DeliveryId | null;
      readonly league: League;
      readonly date: Ymd | null;
    };

const destinationFields = z.object({
  screen: z.string().optional(),
  gameId: z.string().optional(),
  date: z.string().optional(),
});

const pushPayloadSchema = destinationFields.extend({
  notificationId: z.string().optional(),
  id: z.string().optional(),
  league: z.string(),
  destination: destinationFields.optional(),
});

// Payloads carry the delivery id and league at the top level, with the target
// screen nested under "destination". Older payloads put the target fields flat.
export function parsePushDestination(payload: unknown): PushDestination | null {
  const parsed = pushPayloadSchema.safeParse(payload);
  if (!parsed.success) return null;
  const target = parseLeague(parsed.data.league);
  if (target === null) return null;
  const rawId = parsed.data.notificationId ?? parsed.data.id ?? '';
  const deliveryId = isDeliveryId(rawId) ? rawId : null;
  const fields = parsed.data.destination ?? parsed.data;
  const gameId = fields.gameId ?? '';
  if (fields.screen === 'game' && isGameId(gameId)) {
    return { kind: 'game', deliveryId, game: { league: target, id: gameId } };
  }
  return { kind: 'scores', deliveryId, league: target, date: parseYmd(fields.date) };
}
