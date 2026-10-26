import { StyleSheet, Text, View } from 'react-native';
import { colors, layout, space, typography } from '@/theme';

type Line = { readonly label: string; readonly value: string };

export function InfoRows({ lines }: { lines: readonly Line[] }) {
  return (
    <View style={{ paddingHorizontal: layout.screenPadding }}>
      {lines.map((line) => (
        <View
          key={line.label}
          accessible
          accessibilityLabel={`${line.label}: ${line.value}`}
          style={{
            flexDirection: 'row',
            gap: space.lg,
            paddingVertical: space.md,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: colors.hairline,
          }}
        >
          <Text style={[typography.subhead, { width: 104, color: colors.textTertiary }]}>{line.label}</Text>
          <Text selectable style={[typography.subhead, { flex: 1, color: colors.text }]}>
            {line.value}
          </Text>
        </View>
      ))}
    </View>
  );
}
