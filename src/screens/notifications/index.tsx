import { Button, Host, Picker, Switch } from '@expo/ui';
import DateTimePicker from '@expo/ui/community/datetime-picker';
import { Stack, useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Notice } from '@/components/notice';
import { Screen } from '@/components/screen';
import { SectionLabel } from '@/components/section-label';
import { LEAGUE_IDS, LEAGUES, type League } from '@/domain/league';
import { useNotificationCenter } from '@/notifications/center';
import type { NotificationAccount } from '@/notifications/center.types';
import {
  applyDraft,
  clockFromLocalDate,
  clockToLocalDate,
  deliveryStatusLabel,
  EMPTY_DRAFT,
  isDraftEmpty,
  preferenceFor,
  type ClockTime,
  type DeliveryRecord,
  type LeaguePatch,
  type PreferenceDraft,
  type PushPermission,
  type SchedulePatch,
} from '@/notifications/model';
import { useCalendar } from '@/state/calendar';
import { usePreferredLeague } from '@/state/preferences';
import { colors, layout, radius, space, typography } from '@/theme';

const deliveryTime = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

function Group({ children }: { children: ReactNode }) {
  return <View style={styles.group}>{children}</View>;
}

function Row({ label, children, last = false }: { label: string; children: ReactNode; last?: boolean }) {
  return (
    <View style={[styles.row, last ? null : styles.rowDivider]}>
      <Text style={[typography.body, styles.rowLabel]}>{label}</Text>
      {children}
    </View>
  );
}

function ToggleRow({
  label,
  value,
  disabled = false,
  onChange,
  last = false,
}: {
  label: string;
  value: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
  last?: boolean;
}) {
  return (
    <View style={[styles.toggleRow, last ? null : styles.rowDivider]}>
      <Host matchContents={{ vertical: true }} style={styles.fill}>
        <Switch label={label} value={value} disabled={disabled} onValueChange={onChange} />
      </Host>
    </View>
  );
}

function TimeRow({
  label,
  value,
  onChange,
  last = false,
}: {
  label: string;
  value: ClockTime;
  onChange: (value: ClockTime) => void;
  last?: boolean;
}) {
  return (
    <Row label={label} last={last}>
      <DateTimePicker
        value={clockToLocalDate(value)}
        mode="time"
        display="compact"
        accentColor={colors.accent}
        onValueChange={(_event, picked) => {
          const next = clockFromLocalDate(picked);
          if (next !== null) onChange(next);
        }}
      />
    </Row>
  );
}

function permissionText(permission: PushPermission): string {
  switch (permission) {
    case 'authorized':
      return 'Allowed on this iPhone.';
    case 'provisional':
      return 'Delivered quietly to Notification Center.';
    case 'denied':
      return 'Turned off in Settings. Allow notifications there to receive them.';
    case 'notDetermined':
      return 'Not requested yet.';
    case 'unsupported':
      return 'Not available on this device.';
    default: {
      const exhaustive: never = permission;
      return exhaustive;
    }
  }
}

function History({ league, records }: { league: League; records: readonly DeliveryRecord[] }) {
  const shown = records.flatMap((record) => {
    const status = deliveryStatusLabel(record.status);
    return record.league === league && status !== null && record.title !== '' ? [{ record, status }] : [];
  });
  if (shown.length === 0) return null;
  return (
    <>
      <SectionLabel>Recent</SectionLabel>
      <Group>
        {shown.map(({ record, status }, index) => (
          <View key={record.id} style={[styles.history, index === shown.length - 1 ? null : styles.rowDivider]}>
            <Text style={[typography.body, { fontWeight: '600' }]}>{record.title}</Text>
            {record.body ? <Text style={typography.subhead}>{record.body}</Text> : null}
            <Text style={typography.footnote}>
              {[record.createdAt > 0 ? deliveryTime.format(record.createdAt) : '', status].filter(Boolean).join(' · ')}
            </Text>
          </View>
        ))}
      </Group>
    </>
  );
}

type FormProps = {
  league: League;
  onLeagueChange: (league: League) => void;
  account: Extract<NotificationAccount, { kind: 'registered' }>;
  draft: PreferenceDraft;
  onDraftChange: (draft: PreferenceDraft) => void;
  onRetryTeams: () => void;
};

function PreferencesForm({ league, onLeagueChange, account, draft, onDraftChange, onRetryTeams }: FormProps) {
  const { zone } = useCalendar();
  const bundle = applyDraft(account.preferences.preferences, draft, zone);
  const preference = preferenceFor(bundle, league);
  const updateLeague = (patch: LeaguePatch) =>
    onDraftChange({ ...draft, leagues: { ...draft.leagues, [league]: { ...draft.leagues[league], ...patch } } });
  const updateSchedule = (patch: SchedulePatch) => onDraftChange({ ...draft, schedule: { ...draft.schedule, ...patch } });
  const off = !preference.enabled;
  return (
    <>
      <SectionLabel>League</SectionLabel>
      <Group>
        <Row label="League">
          <Host matchContents seedColor={colors.accent}>
            <Picker selectedValue={league} onValueChange={onLeagueChange} appearance="menu">
              {LEAGUE_IDS.map((id) => (
                <Picker.Item key={id} label={LEAGUES[id].label} value={id} />
              ))}
            </Picker>
          </Host>
        </Row>
        <ToggleRow
          label={`${LEAGUES[league].label} notifications`}
          value={preference.enabled}
          onChange={(enabled) => updateLeague({ enabled })}
          last
        />
      </Group>
      <SectionLabel>Updates</SectionLabel>
      <Group>
        <Row label="Favorite team">
          {account.teams.kind === 'ready' ? (
            <Host matchContents seedColor={colors.accent}>
              <Picker
                selectedValue={preference.favoriteTeamId}
                onValueChange={(favoriteTeamId) => updateLeague({ favoriteTeamId })}
                appearance="menu"
                enabled={!off}
              >
                <Picker.Item label="None" value="" />
                {account.teams.teams.map((team) => (
                  <Picker.Item key={team.id} label={team.name} value={team.id} />
                ))}
              </Picker>
            </Host>
          ) : account.teams.kind === 'loading' ? (
            <ActivityIndicator color={colors.textTertiary} accessibilityLabel="Loading teams" />
          ) : (
            <Pressable
              onPress={onRetryTeams}
              accessibilityRole="button"
              accessibilityLabel="Teams couldn’t load. Try again."
              hitSlop={8}
              style={({ pressed }) => [styles.inlineAction, pressed ? { opacity: 0.5 } : null]}
            >
              <Text style={[typography.callout, { color: colors.accent }]}>Try Again</Text>
            </Pressable>
          )}
        </Row>
        <Row label="Games">
          <Host matchContents seedColor={colors.accent}>
            <Picker
              selectedValue={preference.scope}
              onValueChange={(scope) => updateLeague({ scope })}
              appearance="menu"
              enabled={!off && preference.favoriteTeamId !== ''}
            >
              <Picker.Item label="Whole league" value="league" />
              <Picker.Item label="Favorite team only" value="team" />
            </Picker>
          </Host>
        </Row>
        <ToggleRow label="Tip-offs" value={preference.tipoffs} disabled={off} onChange={(tipoffs) => updateLeague({ tipoffs })} />
        <ToggleRow label="Final scores" value={preference.finals} disabled={off} onChange={(finals) => updateLeague({ finals })} />
        <ToggleRow
          label="Big performances"
          value={preference.performances}
          disabled={off}
          onChange={(performances) => updateLeague({ performances })}
        />
        <ToggleRow label="Daily recap" value={preference.recap} disabled={off} onChange={(recap) => updateLeague({ recap })} last />
      </Group>
      <SectionLabel>Schedule</SectionLabel>
      <Group>
        <TimeRow label="Recap time" value={bundle.recapTime} onChange={(recapTime) => updateSchedule({ recapTime })} />
        <TimeRow label="Quiet from" value={bundle.quietStart} onChange={(quietStart) => updateSchedule({ quietStart })} />
        <TimeRow label="Quiet until" value={bundle.quietEnd} onChange={(quietEnd) => updateSchedule({ quietEnd })} last />
      </Group>
      <Text style={[typography.footnote, styles.hint]}>Times use this iPhone’s time zone.</Text>
    </>
  );
}

export function NotificationsScreen() {
  const router = useRouter();
  const preferred = usePreferredLeague();
  const [league, setLeague] = useState(preferred);
  const [draft, setDraft] = useState<PreferenceDraft>(EMPTY_DRAFT);
  const [saved, setSaved] = useState(false);
  const center = useNotificationCenter(league);
  const { view } = center;
  const dirty = !isDraftEmpty(draft);

  const save = async () => {
    // The draft stays until the service confirms the save.
    if (await center.save(draft)) {
      setDraft(EMPTY_DRAFT);
      setSaved(true);
    }
  };

  let body: ReactNode;
  switch (view.kind) {
    case 'unsupported':
      body = <Notice title="Notifications aren’t available" message={view.message} />;
      break;
    case 'loading':
      body = <ActivityIndicator style={styles.loading} color={colors.textTertiary} accessibilityLabel="Loading" />;
      break;
    case 'error':
      body = (
        <Notice title="Notification settings couldn’t load" message={view.message} action={{ label: 'Try Again', onPress: center.retry }} />
      );
      break;
    case 'ready':
      body = (
        <>
          <SectionLabel>This iPhone</SectionLabel>
          <Group>
            <View style={styles.history}>
              <Text style={typography.body}>{permissionText(view.permission)}</Text>
              {view.account.kind === 'registered' ? (
                <Text style={typography.footnote}>
                  Delivery depends on the notification service and Apple’s push service.
                </Text>
              ) : null}
            </View>
          </Group>
          {view.permission === 'denied' ? (
            <View style={styles.actions}>
              <Host matchContents seedColor={colors.accent}>
                <Button label="Open Settings" variant="outlined" onPress={() => void Linking.openSettings()} />
              </Host>
            </View>
          ) : null}
          {view.account.kind === 'unregistered' ? (
            <View style={styles.actions}>
              <Text style={[typography.subhead, { textAlign: 'center' }]}>
                Get tip-offs, final scores, and a daily recap for the leagues you follow.
              </Text>
              {view.permission !== 'denied' ? (
                <Host matchContents seedColor={colors.accent}>
                  <Button
                    label={center.enabling ? 'Turning On…' : 'Turn On Notifications'}
                    variant="filled"
                    disabled={center.enabling}
                    onPress={center.enable}
                  />
                </Host>
              ) : null}
              {center.enableError ? (
                <Text accessibilityLiveRegion="polite" style={[typography.footnote, styles.error]}>
                  {center.enableError}
                </Text>
              ) : null}
            </View>
          ) : (
            <>
              <PreferencesForm
                league={league}
                onLeagueChange={setLeague}
                account={view.account}
                draft={draft}
                onDraftChange={(next) => {
                  setDraft(next);
                  setSaved(false);
                }}
                onRetryTeams={center.retry}
              />
              <View style={styles.actions}>
                <Host matchContents seedColor={colors.accent}>
                  <Button
                    label={center.saving ? 'Saving…' : 'Save'}
                    variant="filled"
                    disabled={!dirty || center.saving}
                    onPress={() => void save()}
                  />
                </Host>
                {center.saveError && dirty ? (
                  <Text accessibilityLiveRegion="polite" style={[typography.footnote, styles.error]}>
                    {center.saveError} Your changes are kept.
                  </Text>
                ) : saved ? (
                  <Text accessibilityLiveRegion="polite" style={typography.footnote}>
                    Saved.
                  </Text>
                ) : null}
              </View>
              <History league={league} records={view.account.history} />
            </>
          )}
        </>
      );
      break;
    default: {
      const exhaustive: never = view;
      body = exhaustive;
    }
  }

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: 'Notifications',
          headerRight: () => (
            <Pressable
              onPress={() => router.back()}
              accessibilityRole="button"
              hitSlop={8}
              style={({ pressed }) => [styles.done, pressed ? { opacity: 0.5 } : null]}
            >
              <Text style={[typography.callout, { color: colors.accent, fontWeight: '600' }]}>Done</Text>
            </Pressable>
          ),
        }}
      />
      <ScrollView
        style={styles.screen}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {body}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingBottom: space.xxxl,
  },
  loading: {
    paddingVertical: space.xxxl,
  },
  group: {
    marginHorizontal: layout.screenPadding,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    minHeight: layout.minTouch + space.xs,
    paddingHorizontal: space.lg,
    paddingVertical: space.xs,
  },
  rowLabel: {
    flexShrink: 1,
  },
  toggleRow: {
    minHeight: layout.minTouch + space.xs,
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.xs,
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  fill: {
    width: '100%',
  },
  history: {
    gap: space.xs,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  actions: {
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: layout.screenPadding,
    paddingTop: space.xl,
  },
  hint: {
    paddingHorizontal: layout.screenPadding + space.lg,
    paddingTop: space.sm,
  },
  error: {
    color: colors.live,
    textAlign: 'center',
  },
  inlineAction: {
    minHeight: 40,
    justifyContent: 'center',
  },
  done: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: space.sm,
  },
});
