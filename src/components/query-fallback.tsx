import { ActivityIndicator, View } from 'react-native';
import { isNotFound, loadErrorMessage } from '@/api/errors';
import type { Loadable } from '@/api/loadable';
import { colors, space } from '@/theme';
import { Notice } from './notice';

type QueryFallbackProps = {
  state: Exclude<Loadable<unknown>, { kind: 'ready' }>;
  // Sentence-case subject such as "Scores" or "This game".
  subject: string;
  onRetry: () => void;
};

// The first load shows progress, never an empty state.
export function QueryFallback({ state, subject, onRetry }: QueryFallbackProps) {
  switch (state.kind) {
    case 'loading':
      return (
        <View style={{ paddingVertical: space.xxxl, alignItems: 'center' }}>
          <ActivityIndicator color={colors.textTertiary} accessibilityLabel="Loading" />
        </View>
      );
    case 'offline':
      return (
        <Notice
          title="You’re offline"
          message={`${subject} will load when the connection returns.`}
          action={{ label: 'Try Again', onPress: onRetry }}
        />
      );
    case 'failed':
      return isNotFound(state.error) ? (
        <Notice title={`${subject} isn’t available`} message="It may have moved or never existed." />
      ) : (
        <Notice
          title={`${subject} couldn’t be loaded`}
          message={loadErrorMessage(state.error)}
          action={{ label: 'Try Again', onPress: onRetry }}
        />
      );
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}
