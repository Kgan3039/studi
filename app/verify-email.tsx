import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ScreenTransition } from '@/components/ui/ScreenTransition';
import { Colors, FontFamily, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
    logOut,
    refreshVerificationState,
    resendVerificationEmail,
    subscribeToAuthState,
} from '@/lib/auth';
import { getUserFacingErrorMessage } from '@/lib/user-facing-errors';
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
      Alert.alert('Verification Error', getUserFacingErrorMessage(error, 'verification'));
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
      Alert.alert('Resend Error', getUserFacingErrorMessage(error, 'verificationEmail'));
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
      contentContainerStyle={[
        styles.content,
        { paddingBottom: insets.bottom + Space.xxl, paddingTop: insets.top + Space.xl },
      ]}>
      <ScreenTransition style={styles.transition}>
        <View style={styles.hero}>
          <IconSymbol color={palette.tint} name="envelope.fill" size={32} />
          <Text style={[styles.heroTitle, { color: palette.text }]}>Check your UW email</Text>
          <Text style={[TypeScale.body, styles.heroText, { color: palette.icon }]}>
            We sent a verification link to
            {currentUser?.email ? ` ${currentUser.email}` : ' your @wisc.edu email'}.
          </Text>
        </View>

        <View style={[styles.statusBlock, { borderColor: palette.border }]}>
          <Text style={[TypeScale.sectionTitle, { color: palette.text }]}>Open the link, then return</Text>
          <Text accessibilityLiveRegion="polite" style={[TypeScale.body, { color: palette.icon }]}>
            {status}
          </Text>
        </View>

        <View style={styles.actions}>
          <Button
            fullWidth
            icon="checkmark.circle.fill"
            label="I verified my email"
            loading={isChecking}
            onPress={handleCheckVerified}
            size="lg"
          />
          <Button
            disabled={isResending || cooldown > 0}
            fullWidth
            icon="arrow.clockwise"
            label={cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend email'}
            loading={isResending}
            onPress={handleResend}
            size="lg"
            variant="secondary"
          />
        </View>

        <View style={[styles.wrongEmail, { borderTopColor: palette.border }]}>
          <View style={styles.wrongEmailCopy}>
            <Text style={[TypeScale.bodyStrong, { color: palette.text }]}>Wrong email?</Text>
            <Text style={[TypeScale.caption, { color: palette.icon }]}>
              Sign out and create the account again with the correct address.
            </Text>
          </View>
          <Button label="Sign out" onPress={handleSignOut} size="sm" variant="ghost" />
        </View>
      </ScreenTransition>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    paddingHorizontal: Space.xl,
  },
  transition: {
    gap: Space.xl,
  },
  hero: {
    alignItems: 'center',
    gap: Space.md,
    paddingVertical: Space.xl,
  },
  heroTitle: {
    fontFamily: FontFamily.serifItalic,
    fontSize: 34,
    lineHeight: 39,
    textAlign: 'center',
  },
  heroText: {
    maxWidth: 320,
    textAlign: 'center',
  },
  statusBlock: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Space.sm,
    paddingVertical: Space.lg,
  },
  actions: {
    gap: Space.sm,
  },
  wrongEmail: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: Space.md,
    justifyContent: 'space-between',
    paddingTop: Space.lg,
  },
  wrongEmailCopy: {
    flex: 1,
    gap: 2,
  },
});
