import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import * as Sentry from '@sentry/react-native';
import { Stack, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { initAnalytics, track } from '@/lib/analytics';

// DSN is a public client key; set EXPO_PUBLIC_SENTRY_DSN from Sentry project settings.
const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn: SENTRY_DSN,
  enabled: !!SENTRY_DSN && !__DEV__,
  tracesSampleRate: 0.2,
});

initAnalytics();

export const unstable_settings = {
  anchor: '(tabs)',
};

function RootLayout() {
  const colorScheme = useColorScheme();
  const pathname = usePathname();

  useEffect(() => {
    track('screen_view', { pathname });
  }, [pathname]);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="create-session" options={{ title: 'Create Session' }} />
        <Stack.Screen name="conversation/[conversationId]" options={{ title: 'Conversation' }} />
        <Stack.Screen name="privacy" options={{ title: 'Privacy Policy' }} />
        <Stack.Screen name="report-user" options={{ title: 'Report User' }} />
        <Stack.Screen name="session/[sessionId]" options={{ title: 'Session Details' }} />
        <Stack.Screen name="rate-location" options={{ title: 'Rate This Spot' }} />
        <Stack.Screen name="support" options={{ title: 'Support' }} />
        <Stack.Screen name="verify-email" options={{ title: 'Verify Email', headerShown: false }} />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}

export default Sentry.wrap(RootLayout);
