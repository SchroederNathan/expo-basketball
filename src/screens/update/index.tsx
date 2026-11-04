import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Screen } from '@/components/screen';
import { colors, radius, space, typography } from '@/theme';
import { switchToUpdateChannelAsync, type UpdateChannelResult } from '@/updates/service';

export function UpdateChannelScreen({ channel }: { readonly channel: string | null }) {
  const router = useRouter();
  const [result, setResult] = useState<UpdateChannelResult | null>(null);

  useEffect(() => {
    if (channel === null) return;
    let active = true;
    void switchToUpdateChannelAsync(channel).then((next) => {
      if (active) setResult(next);
    });
    return () => {
      active = false;
    };
  }, [channel]);

  const title = channel === null ? 'Invalid preview link' : result === null ? 'Opening PR preview' : result.kind === 'reloaded' ? 'Preview ready' : result.kind === 'current' ? 'Preview is active' : result.kind === 'unavailable' ? 'Preview is not published' : 'Preview could not open';
  const message = channel === null
    ? 'This QR code does not identify a valid PR preview channel.'
    : result === null
      ? `Checking for a compatible update on ${channel}.`
      : result.kind === 'reloaded'
        ? `The app is restarting on ${channel}.`
        : result.kind === 'current'
          ? `This TestFlight build is already on ${channel}, and there is no newer update yet.`
          : result.kind === 'unavailable'
            ? `No compatible update is published on ${channel}. Ask the PR author to publish it, then scan the QR code again.`
            : result.message;

  return (
    <Screen>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
        <Text style={typography.label}>PR preview</Text>
        <Text style={[typography.title, styles.title]}>{title}</Text>
        <Text selectable style={[typography.subhead, styles.message]}>{message}</Text>
        {channel ? <Text selectable style={[typography.footnote, styles.channel]}>{channel}</Text> : null}
        {result === null && channel !== null ? <ActivityIndicator color={colors.accent} style={styles.spinner} /> : null}
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Return to scores"
            onPress={() => router.replace('/')}
            style={({ pressed }) => [styles.action, pressed ? styles.pressed : null]}
          >
            <Text style={styles.actionText}>Return to scores</Text>
          </Pressable>
        </View>
        <Text style={[typography.footnote, styles.hint]}>PR previews require a compatible TestFlight build. Native changes still need a new build.</Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center', padding: space.xl, alignItems: 'center' },
  title: { marginTop: space.sm, textAlign: 'center' },
  message: { marginTop: space.md, maxWidth: 360, textAlign: 'center' },
  channel: { marginTop: space.md, color: colors.accent },
  spinner: { marginTop: space.xl },
  actions: { marginTop: space.xxl },
  action: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space.lg, borderRadius: radius.full, backgroundColor: colors.accent },
  actionText: { ...typography.callout, color: colors.onAccent, fontWeight: '700' },
  pressed: { opacity: 0.65 },
  hint: { marginTop: space.xxl, maxWidth: 360, textAlign: 'center' },
});
