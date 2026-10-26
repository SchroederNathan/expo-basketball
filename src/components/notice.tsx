import { Button, Host } from '@expo/ui';
import { Text, View } from 'react-native';
import { colors, space, typography } from '@/theme';

type NoticeProps = {
  title: string;
  message?: string;
  action?: { readonly label: string; readonly onPress: () => void };
};

export function Notice({ title, message, action }: NoticeProps) {
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{ paddingHorizontal: space.xl, paddingVertical: space.xxl, alignItems: 'center', gap: space.sm }}
    >
      <Text selectable style={[typography.headline, { textAlign: 'center' }]}>
        {title}
      </Text>
      {message ? (
        <Text selectable style={[typography.subhead, { textAlign: 'center' }]}>
          {message}
        </Text>
      ) : null}
      {action ? (
        <Host matchContents seedColor={colors.accent} style={{ marginTop: space.sm }}>
          <Button label={action.label} onPress={action.onPress} variant="outlined" />
        </Host>
      ) : null}
    </View>
  );
}
