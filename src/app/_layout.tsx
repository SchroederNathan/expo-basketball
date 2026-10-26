import { BarlowCondensed_700Bold_Italic } from '@expo-google-fonts/barlow-condensed/700Bold_Italic';
import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { DarkTheme, SplashScreen, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { DisplayFontProvider } from '@/components/display-text';
import { PushResponseBridge } from '@/notifications/bridge';
import { hydratePreferredLeague, usePreferencesHydrated } from '@/state/preferences';
import { connectQueryLifecycle, createQueryClient } from '@/state/query-client';
import { colors, fonts } from '@/theme';

void SplashScreen.preventAutoHideAsync();

const theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.accent,
    background: colors.background,
    card: colors.background,
    text: colors.text,
    border: colors.hairline,
  },
};

export default function RootLayout() {
  const [queryClient] = useState(createQueryClient);
  const [fontsLoaded, fontError] = useFonts({ [fonts.display]: BarlowCondensed_700Bold_Italic });
  const hydrated = usePreferencesHydrated();
  // The saved league decides every tab's first request, so nothing renders
  // before it is read. A font failure falls back to a system face.
  const ready = hydrated && (fontsLoaded || fontError !== null);

  useEffect(() => {
    connectQueryLifecycle();
    void hydratePreferredLeague();
  }, []);

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={theme}>
        <DisplayFontProvider loaded={fontsLoaded}>
          <StatusBar style="light" />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="notifications" options={{ presentation: 'modal', headerShown: true }} />
            <Stack.Screen name="+not-found" options={{ headerShown: true, title: 'Not Found' }} />
          </Stack>
          <PushResponseBridge />
        </DisplayFontProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
