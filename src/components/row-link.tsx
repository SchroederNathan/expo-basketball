import { Link, type Href } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { detailEntryFromHref, detailKey } from '@/navigation/hrefs';
import { useSplitLinks } from '@/navigation/split';
import { colors, layout } from '@/theme';

type RowLinkProps = {
  href: Href;
  accessibilityLabel: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
};

// A full-width row highlights its background while pressed. Links push, so
// back returns through every screen the user opened in this tab. In a split
// layout, game, team, and player rows open in the detail pane instead, and
// the open row stays highlighted.
export function RowLink({ href, accessibilityLabel, children, style }: RowLinkProps) {
  const [pressed, setPressed] = useState(false);
  const split = useSplitLinks();
  const entry = split ? detailEntryFromHref(href) : null;
  const selected = split !== null && entry !== null && split.selectedKey === detailKey(entry);
  const row = (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      {...(split && entry
        ? { accessibilityRole: 'button', accessibilityState: { selected }, onPress: () => split.open(entry) }
        : null)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={StyleSheet.flatten([
        { minHeight: layout.minTouch },
        style,
        selected ? { backgroundColor: colors.fill } : undefined,
        pressed ? { backgroundColor: colors.fillPressed } : undefined,
      ])}
    >
      {children}
    </Pressable>
  );
  if (split && entry) return row;
  return (
    <Link href={href} push asChild>
      {row}
    </Link>
  );
}
