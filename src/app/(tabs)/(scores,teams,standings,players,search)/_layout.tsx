import { Stack } from 'expo-router/stack';
import { useReducedMotion } from '@/state/reduced-motion';
import { colors } from '@/theme';

// One stack per tab. Game, team, and player screens are shared by every tab
// and push inside the tab that opened them. Each tab's stack starts at its own
// root, including after a deep link straight to a shared screen.
export const unstable_settings = {
  scores: { anchor: 'index' },
  teams: { anchor: 'teams' },
  standings: { anchor: 'standings' },
  players: { anchor: 'players' },
  search: { anchor: 'search' },
};

export default function TabStackLayout() {
  const reducedMotion = useReducedMotion();
  return (
    <Stack
      screenOptions={{
        animation: reducedMotion ? 'fade' : 'default',
        headerBackButtonDisplayMode: 'minimal',
        headerShadowVisible: false,
        headerTintColor: colors.text,
        headerTitleStyle: { color: colors.text },
        headerLargeTitleStyle: { color: colors.text },
        contentStyle: { backgroundColor: colors.background },
      }}
    />
  );
}
