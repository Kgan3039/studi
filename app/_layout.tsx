import { Arapey_400Regular, Arapey_400Regular_Italic } from '@expo-google-fonts/arapey';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Sentry from '@sentry/react-native';
import { useFonts } from 'expo-font';
import { Stack, useRouter, useSegments, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import 'react-native-reanimated';

import { StudiLaunchIntro } from '@/components/studi-launch-intro';
import { HeaderCloseButton } from '@/components/ui/HeaderCloseButton';
import { Colors, FontFamily } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { initAnalytics, track } from '@/lib/analytics';
import { subscribeToAuthState, waitForAuthReady } from '@/lib/auth';
import { addNotificationResponseListener } from '@/lib/notifications';

type AuthGateState = 'pending' | 'signed-out' | 'unverified' | 'signed-in';
type LaunchIntroState = 'checking' | 'showing' | 'finished';

// Routes reachable without a verified session. Everything else is gated below.
// (auth) onboarding leaves classes/profile-setup are NOT public — they sit
// behind the redirect effect (they already self-guard their own reads).
const PUBLIC_LEAVES = new Set(['welcome', 'sign-in', 'sign-up', 'verify-email', 'privacy', 'support']);
// Where an unverified, signed-in user is allowed to sit. verify-email is their
// hub (it owns the sign-out path); legal pages stay reachable.
const UNVERIFIED_LEAVES = new Set(['verify-email', 'privacy', 'support']);

// DSN is a public client key; set EXPO_PUBLIC_SENTRY_DSN from Sentry project settings.
const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
const LAUNCH_INTRO_STORAGE_KEY = '@studi/launch-intro-seen';

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
  const palette = Colors[colorScheme ?? 'light'];
  const pathname = usePathname();
  const router = useRouter();
  const segments = useSegments();
  const [authState, setAuthState] = useState<AuthGateState>('pending');
  const [launchIntroState, setLaunchIntroState] = useState<LaunchIntroState>('checking');
  const [fontsLoaded, fontError] = useFonts({
    Arapey_400Regular,
    Arapey_400Regular_Italic,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
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

  // The native splash still appears on every cold start. This lighter brand
  // moment is reserved for a fresh install, before a person has seen Studi.
  useEffect(() => {
    let active = true;

    AsyncStorage.getItem(LAUNCH_INTRO_STORAGE_KEY)
      .then((hasSeenIntro) => {
        if (active) {
          setLaunchIntroState(hasSeenIntro ? 'finished' : 'showing');
        }
      })
      .catch(() => {
        if (active) {
          setLaunchIntroState('showing');
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const fontsReady = fontsLoaded || fontError;
  const ready = fontsReady && authState !== 'pending' && launchIntroState !== 'checking';

  const finishLaunchIntro = useCallback(() => {
    setLaunchIntroState('finished');
    AsyncStorage.setItem(LAUNCH_INTRO_STORAGE_KEY, 'true').catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!ready || authState !== 'signed-in') {
      return;
    }

    let cleanup: (() => void) | undefined;
    let cancelled = false;

    addNotificationResponseListener(({ url, type }) => {
      if (!cancelled) {
        track('notification_opened', { type: type ?? 'unknown', source: 'push' });
        router.push(url as never);
      }
    }).then((unsubscribe) => {
      if (cancelled) {
        unsubscribe();
      } else {
        cleanup = unsubscribe;
      }
    });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [ready, authState, router]);

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
          headerShadowVisible: false,
          headerStyle: { backgroundColor: palette.background },
          headerTintColor: palette.text,
          headerTitleStyle: {
            fontFamily: FontFamily.bodySemiBold,
            fontSize: 16,
          },
          contentStyle: { backgroundColor: palette.background },
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
          {/* Finish-or-leave tasks present as sheets with an explicit close. */}
          <Stack.Screen
            name="create-session"
            options={{
              title: 'New session',
              presentation: 'modal',
              headerLeft: () => <HeaderCloseButton />,
            }}
          />
          <Stack.Screen name="conversation/[conversationId]" options={{ title: 'Conversation' }} />
          <Stack.Screen
            name="report-user"
            options={{
              title: 'Report user',
              presentation: 'modal',
              headerLeft: () => <HeaderCloseButton />,
            }}
          />
          <Stack.Screen name="session/[sessionId]" options={{ title: 'Session Details' }} />
          <Stack.Screen name="session-chat/[sessionId]" options={{ title: 'Session Chat' }} />
          <Stack.Screen
            name="rate-location"
            options={{
              title: 'Rate this spot',
              presentation: 'modal',
              headerLeft: () => <HeaderCloseButton />,
            }}
          />
          <Stack.Screen name="settings" options={{ title: 'Settings' }} />
          <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
          <Stack.Screen name="friends" options={{ title: 'Study Buddies' }} />
          <Stack.Screen name="user/[userId]" options={{ title: 'Profile' }} />
        </Stack.Protected>
      </Stack>
      <StatusBar style="auto" />
      {launchIntroState === 'showing' ? <StudiLaunchIntro onFinish={finishLaunchIntro} /> : null}
    </ThemeProvider>
  );
}

export default Sentry.wrap(RootLayout);
