import type { PropsWithChildren } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

// Native headers and scroll views handle vertical insets. The Duo's side
// rail also needs to constrain the content's layout width.
export function Screen({ children }: PropsWithChildren) {
  return (
    <SafeAreaView edges={['left', 'right']} style={{ flex: 1, backgroundColor: colors.background }}>
      {children}
    </SafeAreaView>
  );
}
