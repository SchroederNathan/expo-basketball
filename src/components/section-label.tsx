import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { layout, space, typography } from '@/theme';

export function SectionLabel({ children, trailing }: { children: string; trailing?: ReactNode }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: space.md,
        paddingHorizontal: layout.screenPadding,
        paddingTop: space.xl,
        paddingBottom: space.sm,
      }}
    >
      <Text accessibilityRole="header" style={[typography.label, { flexShrink: 1 }]}>
        {children}
      </Text>
      {trailing}
    </View>
  );
}
