import { Stack, useRouter } from 'expo-router';
import { ScrollView } from 'react-native';
import { colors } from '@/theme';
import { Notice } from './notice';

// Entity screens never guess a league. A link without a supported league and
// a valid id lands here instead of showing another league's data.
export function InvalidLink({ subject }: { subject: 'game' | 'team' | 'player' }) {
  const router = useRouter();
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <Stack.Screen options={{ title: '' }} />
      <Notice
        title="This link is incomplete"
        message={`A ${subject} link needs a supported league and a valid ${subject} id.`}
        action={{ label: 'Go to Scores', onPress: () => router.dismissTo('/') }}
      />
    </ScrollView>
  );
}
