import { useRouter } from 'expo-router';
import { ScrollView } from 'react-native';
import { Notice } from '@/components/notice';
import { Screen } from '@/components/screen';
import { colors } from '@/theme';

export default function NotFoundRoute() {
  const router = useRouter();
  return (
    <Screen>
      <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ flex: 1, backgroundColor: colors.background }}>
        <Notice
          title="This page doesn’t exist"
          message="The link may be old or mistyped."
          action={{ label: 'Go to Scores', onPress: () => router.dismissTo('/') }}
        />
      </ScrollView>
    </Screen>
  );
}
