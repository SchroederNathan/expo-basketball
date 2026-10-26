import { Link, type Href } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { colors, layout } from '@/theme';

type RowLinkProps = {
  href: Href;
  accessibilityLabel: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
};

// A full-width row highlights its background while pressed. Links push, so
// back returns through every screen the user opened in this tab.
export function RowLink({ href, accessibilityLabel, children, style }: RowLinkProps) {
  const [pressed, setPressed] = useState(false);
  return (
    <Link href={href} push asChild>
      <Pressable
        accessibilityLabel={accessibilityLabel}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        style={StyleSheet.flatten([
          { minHeight: layout.minTouch },
          style,
          pressed ? { backgroundColor: colors.fillPressed } : undefined,
        ])}
      >
        {children}
      </Pressable>
    </Link>
  );
}
