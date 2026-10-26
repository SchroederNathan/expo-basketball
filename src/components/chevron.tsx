import { SymbolView } from 'expo-symbols';
import { colors } from '@/theme';

export function Chevron() {
  return (
    <SymbolView
      name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
      size={14}
      weight="semibold"
      tintColor={colors.textMuted}
      importantForAccessibility="no"
      accessibilityElementsHidden
    />
  );
}
