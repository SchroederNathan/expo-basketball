import { SymbolView, type AndroidSymbol, type SFSymbol } from 'expo-symbols';
import { Pressable } from 'react-native';
import { colors } from '@/theme';

type HeaderIconButtonProps = {
  icon: { readonly ios: SFSymbol; readonly android: AndroidSymbol };
  label: string;
  onPress: () => void;
};

export function HeaderIconButton({ icon, label, onPress }: HeaderIconButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => ({
        width: 40,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.5 : 1,
      })}
    >
      <SymbolView
        name={{ ios: icon.ios, android: icon.android, web: icon.android }}
        size={22}
        tintColor={colors.text}
      />
    </Pressable>
  );
}
