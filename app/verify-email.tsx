import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Pressable,
    RefreshControl,
    ScrollView,
    StyleSheet,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
    logOut,
    refreshVerificationState,
    resendVerificationEmail,
    subscribeToAuthState,
} from '@/lib/auth';
import type { User } from 'firebase/auth';

const RESEND_COOLDOWN_SECONDS = 60;

export default function VerifyEmailScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const insets = useSafeAreaInsets();

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [status, setStatus] = useState(
    'We sent a verification link to your @wisc.edu inbox. Open it, then come back here.'
  );
  const cooldownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeToAuthState((user) => {
      setCurrentUser(user);

      if (!user) {
        router.replace('/welcome');
      }
    });

    return unsubscribe;
  }, [router]);

  useEffect(() => {
    return () => {
      if (cooldownTimer.current) {
        clearInterval(cooldownTimer.current);
      }
    };
  }, []);

  function startCooldown() {
    setCooldown(RESEND_COOLDOWN_SECONDS);
    cooldownTimer.current = setInterval(() => {
      setCooldown((seconds) => {
        if (seconds <= 1 && cooldownTimer.current) {
          clearInterval(cooldownTimer.current);
          cooldownTimer.current = null;
        }
        return Math.max(0, seconds - 1);
      });
    }, 1000);
  }

  async function handleCheckVerified() {
    try {
      setIsChecking(true);
      const result = await refreshVerificationState();

      if (result.verified) {
        // Continue onboarding: pick classes, then display name, then tabs.
        router.replace('/classes');
        return;
      }

      setStatus(
        'Not verified yet. Open the link in the email we sent, then tap “I verified my email” again. Check spam if you don\'t see it.'
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to check verification right now.';
      Alert.alert('Verification Error', message);
    } finally {
      setIsChecking(false);
      setIsRefreshing(false);
    }
  }

  async function handleRefresh() {
    setIsRefreshing(true);
    await handleCheckVerified();
  }

  async function handleResend() {
    try {
      setIsResending(true);
      await resendVerificationEmail();
      startCooldown();
      setStatus('Verification email sent again. Give it a minute, and check spam.');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to resend the email right now.';
      Alert.alert('Resend Error', message);
    } finally {
      setIsResending(false);
    }
  }

  async function handleSignOut() {
    await logOut();
    router.replace('/welcome');
  }

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: palette.background }]}
      refreshControl={
        <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={palette.tint} />
      }
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}>
      <ThemedView style={[styles.hero, { backgroundColor: palette.hero }]}>
        <ThemedText style={[styles.eyebrow, { color: palette.tint }]}>Account security</ThemedText>
        <ThemedText type="title" style={styles.heroTitle}>
          Verify your UW email
        </ThemedText>
        <ThemedText style={styles.heroText}>
          Studi is for verified UW–Madison students only. Verifying
          {currentUser?.email ? ` ${currentUser.email}` : ' your @wisc.edu email'} keeps sessions
          limited to real classmates.
        </ThemedText>
      </ThemedView>

      <ThemedView
        style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <ThemedText style={styles.sectionLabel}>One step left</ThemedText>
        <ThemedText type="subtitle">Open the link we emailed you</ThemedText>
        <ThemedText style={styles.statusText}>{status}</ThemedText>

        <Pressable
          disabled={isChecking}
          onPress={handleCheckVerified}
          style={[
            styles.primaryButton,
            { backgroundColor: palette.tint, opacity: isChecking ? 0.7 : 1 },
          ]}>
          {isChecking ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <ThemedText lightColor="#ffffff" darkColor="#ffffff" type="defaultSemiBold">
              I verified my email
            </ThemedText>
          )}
        </Pressable>

        <Pressable
          disabled={isResending || cooldown > 0}
          onPress={handleResend}
          style={[
            styles.secondaryButton,
            { borderColor: palette.outline, opacity: isResending || cooldown > 0 ? 0.6 : 1 },
          ]}>
          {isResending ? (
            <ActivityIndicator color={palette.tint} />
          ) : (
            <ThemedText type="defaultSemiBold">
              {cooldown > 0 ? `Resend email (${cooldown}s)` : 'Resend email'}
            </ThemedText>
          )}
        </Pressable>
      </ThemedView>

      <ThemedView
        style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <ThemedText style={styles.sectionLabel}>Wrong email?</ThemedText>
        <ThemedText style={styles.statusText}>
          Sign out and create the account again with the correct @wisc.edu address.
        </ThemedText>
        <Pressable
          onPress={handleSignOut}
          style={[styles.secondaryButton, { borderColor: palette.outline }]}>
          <ThemedText type="defaultSemiBold">Sign Out</ThemedText>
        </Pressable>
      </ThemedView>

      <View style={{ height: insets.bottom + 12 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    gap: 18,
    padding: 20,
    paddingBottom: 36,
  },
  hero: {
    borderRadius: 24,
    gap: 10,
    padding: 24,
  },
  eyebrow: {
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  heroTitle: { marginBottom: 4 },
  heroText: {
    lineHeight: 30,
    maxWidth: 420,
  },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    gap: 12,
    padding: 20,
    shadowColor: '#082431',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 18,
  },
  sectionLabel: {
    fontSize: 12,
    letterSpacing: 1,
    opacity: 0.72,
    textTransform: 'uppercase',
  },
  statusText: {
    opacity: 0.82,
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 14,
    justifyContent: 'center',
    minHeight: 54,
    paddingHorizontal: 16,
  },
  secondaryButton: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 16,
  },
});
