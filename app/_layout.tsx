import {
  CormorantGaramond_500Medium,
  CormorantGaramond_500Medium_Italic,
} from '@expo-google-fonts/cormorant-garamond';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { SpaceGrotesk_500Medium } from '@expo-google-fonts/space-grotesk';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import * as Sentry from '@sentry/react-native';
import { useFonts } from 'expo-font';
import { Stack, useRouter, useSegments, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { initAnalytics, track } from '@/lib/analytics';
import { subscribeToAuthState, waitForAuthReady } from '@/lib/auth';

type AuthGateState = 'pending' | 'signed-out' | 'unverified' | 'signed-in';

// Routes reachable without a verified session. Everything else is gated below.
// (auth) onboarding leaves classes/profile-setup are NOT public — they sit
// behind the redirect effect (they already self-guard their own reads).
const PUBLIC_LEAVES = new Set(['welcome', 'sign-in', 'sign-up', 'verify-email', 'privacy', 'support']);
// Where an unverified, signed-in user is allowed to sit. verify-email is their
// hub (it owns the sign-out path); legal pages stay reachable.
const UNVERIFIED_LEAVES = new Set(['verify-email', 'privacy', 'support']);

// DSN is a public client key; set EXPO_PUBLIC_SENTRY_DSN from Sentry project settings.
const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn: SENTRY_DSN,
  enabled: !!SENTRY_DSN && !__DEV__,
  tracesSampleRate: 0.2,
});

initAnalytics();
let didTrackAppOpen = false;

SplashScreen.preventAutoHideAsync();

export const unstable_settings = {
  anchor: '(tabs)',
};

function RootLayout() {
  const colorScheme = useColorScheme();
  const pathname = usePathname();
  const router = useRouter();
  const segments = useSegments();
  const [authState, setAuthState] = useState<AuthGateState>('pending');
  const [fontsLoaded, fontError] = useFonts({
    CormorantGaramond_500Medium,
    CormorantGaramond_500Medium_Italic,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    SpaceGrotesk_500Medium,
  });

  useEffect(() => {
    track('screen_view', { pathname });
  }, [pathname]);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    // Don't subscribe until the persisted session is restored — the early null
    // emission would otherwise redirect signed-in users on cold start.
    waitForAuthReady().then(() => {
      if (cancelled) {
        return;
      }
      unsubscribe = subscribeToAuthState((user) => {
        setAuthState(!user ? 'signed-out' : user.emailVerified ? 'signed-in' : 'unverified');
      });
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const fontsReady = fontsLoaded || fontError;
  const ready = fontsReady && authState !== 'pending';

  useEffect(() => {
    if (ready) {
      SplashScreen.hideAsync();
    }
  }, [ready]);

  useEffect(() => {
    if (!ready || didTrackAppOpen) {
      return;
    }

    didTrackAppOpen = true;
    track('app_open');
  }, [ready]);

  // Root-level gate: send signed-out users to /welcome and unverified users to
  // /verify-email whenever they land on a route they shouldn't reach. Pairs
  // with Stack.Protected below — protected screens never mount for these users,
  // so no Firestore reads fire before the redirect resolves.
  useEffect(() => {
    if (!ready) {
      return;
    }

    const leaf = segments[segments.length - 1] ?? '';

    if (authState === 'signed-out' && !PUBLIC_LEAVES.has(leaf)) {
      router.replace('/welcome');
    } else if (authState === 'unverified' && !UNVERIFIED_LEAVES.has(leaf)) {
      router.replace('/verify-email');
    }
  }, [ready, authState, segments, router]);

  // Hold the splash (render nothing) until fonts AND the persisted auth session
  // resolve. Mounting no navigator during this window keeps the deep-linked URL
  // intact, so signed-in users reach their target instead of flashing welcome.
  if (!ready) {
    return null;
  }

  const isSignedIn = authState === 'signed-in';

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack
        screenOptions={{
          headerBackTitle: 'Back',
          headerBackTitleVisible: true,
        }}
      >
        {/* Public — always registered. */}
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="privacy" options={{ title: 'Privacy Policy' }} />
        <Stack.Screen name="support" options={{ title: 'Support' }} />
        <Stack.Screen name="verify-email" options={{ title: 'Verify Email', headerShown: false }} />

        {/* Protected — only registered for verified, signed-in users, so these
            screens (and their on-mount Firestore reads) never mount otherwise. */}
        <Stack.Protected guard={isSignedIn}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="create-session" options={{ title: 'Create Session' }} />
          <Stack.Screen name="conversation/[conversationId]" options={{ title: 'Conversation' }} />
          <Stack.Screen name="report-user" options={{ title: 'Report User' }} />
          <Stack.Screen name="session/[sessionId]" options={{ title: 'Session Details' }} />
          <Stack.Screen name="rate-location" options={{ title: 'Rate This Spot' }} />
        </Stack.Protected>
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}

export default Sentry.wrap(RootLayout);
