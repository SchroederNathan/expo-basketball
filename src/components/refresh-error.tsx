import { Button, Host } from '@expo/ui';
import { Text, View } from 'react-native';
import { loadErrorMessage } from '@/api/errors';
import { colors, layout, radius, space, typography } from '@/theme';

export function RefreshError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        marginHorizontal: layout.screenPadding,
        marginVertical: space.sm,
        paddingLeft: space.md,
        paddingRight: space.xs,
        paddingVertical: space.xs,
        borderRadius: radius.md,
        borderCurve: 'continuous',
        backgroundColor: colors.surfaceRaised,
      }}
    >
      <Text selectable style={[typography.footnote, { flex: 1, color: colors.textSecondary }]}>
        Couldn’t refresh. {loadErrorMessage(error)}
      </Text>
      <Host matchContents seedColor={colors.accent}>
        <Button label="Retry" onPress={onRetry} variant="text" />
      </Host>
    </View>
  );
}
