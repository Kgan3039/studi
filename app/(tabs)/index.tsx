import { useEffect, useMemo, useState } from 'react';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  signInOrPrepareAccountCreation,
  subscribeToAuthState,
} from '@/lib/auth';
import { getUserProfile, type UserProfile } from '@/lib/firestore';
import type { User } from 'firebase/auth';

function splitDisplayName(displayName: string | undefined) {
  const normalized = displayName?.trim() ?? '';

  if (!normalized) {
    return { firstName: '', lastName: '' };
  }

  const [firstName, ...rest] = normalized.split(/\s+/);

  return {
    firstName,
    lastName: rest.join(' '),
  };
}

function getSetupSummary(profile: UserProfile | null) {
  const hasName = !!profile?.displayName?.trim();
  const hasClasses = (profile?.classes?.length ?? 0) > 0;

  return {
    completed: [hasName, hasClasses].filter(Boolean).length,
    hasClasses,
    hasName,
  };
}

export default function HomeScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isProfileLoading, setIsProfileLoading] = useState(false);
  const [dashboardStatus, setDashboardStatus] = useState(
    'Sign in to find and join study sessions for your classes.'
  );
  const isSignedIn = !!currentUser;

  useEffect(() => {
    const unsubscribe = subscribeToAuthState((user) => {
      setCurrentUser(user);

      if (user?.email) {
        setEmail(user.email);
        return;
      }

      setProfile(null);
      setDashboardStatus('Sign in to find and join study sessions for your classes.');
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    async function loadUserProfile() {
      if (!currentUser) {
        return;
      }

      try {
        setIsProfileLoading(true);
        const loadedProfile = await getUserProfile(currentUser.uid);
        setProfile(loadedProfile);

        if (!loadedProfile) {
          setDashboardStatus('Finish your profile so Studi can recommend the right people and sessions.');
          return;
        }

        const setup = getSetupSummary(loadedProfile);
        setDashboardStatus(
          setup.completed === 2
            ? 'Your profile is ready. Browse sessions or create one for your class.'
            : `You are ${setup.completed}/2 of the way through setup. Add your classes on Profile to see sessions for them.`
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to load your dashboard right now.';
        setDashboardStatus(message);
      } finally {
        setIsProfileLoading(false);
      }
    }

    loadUserProfile();
  }, [currentUser]);

  async function handleSignIn() {
    try {
      setIsBusy(true);
      const result = await signInOrPrepareAccountCreation(email, password);

      if (result.mode === 'needs-profile') {
        router.push('/complete-profile');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to sign in right now.';
      Alert.alert('Auth Error', message);
    } finally {
      setIsBusy(false);
    }
  }

  const savedName = splitDisplayName(profile?.displayName);
  const firstName = savedName.firstName || 'Study';
  const setup = useMemo(() => getSetupSummary(profile), [profile]);
  const classCount = profile?.classes.length ?? 0;

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: palette.background }]}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}>
      <ThemedView style={[styles.hero, { backgroundColor: palette.surface }]}>
        <Image
          contentFit="contain"
          source={require('../../assets/images/studi-wordmark.png')}
          style={styles.heroLogo}
        />
        <ThemedText style={[styles.eyebrow, styles.heroEyebrow, { color: palette.tint }]}>
          UW-Madison Study Hub
        </ThemedText>
        <ThemedText style={styles.heroText}>
          Find and join study sessions for your classes — or start one and let classmates come to
          you.
        </ThemedText>
      </ThemedView>

      {isSignedIn ? (
        <>
          <ThemedView style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <View style={styles.sectionHeader}>
              <ThemedText style={styles.sectionLabel}>Dashboard</ThemedText>
              <View style={[styles.statusPill, { backgroundColor: palette.badge }]}>
                <ThemedText type="defaultSemiBold">
                  {setup.completed}/2 ready
                </ThemedText>
              </View>
            </View>
            <ThemedText type="subtitle">Welcome back, {firstName}</ThemedText>
            <ThemedText style={styles.helperText}>{dashboardStatus}</ThemedText>
            <View style={styles.metricsRow}>
              <View style={[styles.metricCard, { backgroundColor: palette.surfaceMuted, borderColor: palette.outline }]}>
                <ThemedText style={styles.metricValue}>{classCount}</ThemedText>
                <ThemedText style={styles.metricLabel}>
                  class{classCount === 1 ? '' : 'es'}
                </ThemedText>
              </View>
              <View style={[styles.metricCard, { backgroundColor: palette.surfaceMuted, borderColor: palette.outline }]}>
                <ThemedText style={styles.metricValue}>{profile ? 'On' : 'Off'}</ThemedText>
                <ThemedText style={styles.metricLabel}>profile</ThemedText>
              </View>
            </View>
          </ThemedView>

          <ThemedView style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <View style={styles.sectionHeader}>
              <ThemedText style={styles.sectionLabel}>Quick actions</ThemedText>
            </View>
            <ThemedText type="subtitle">Start from what you need right now</ThemedText>
            <View style={styles.actionGrid}>
              <Pressable
                onPress={() => router.push('/sessions')}
                style={[styles.actionTile, { backgroundColor: palette.surfaceMuted, borderColor: palette.outline }]}>
                <ThemedText type="defaultSemiBold">Browse Sessions</ThemedText>
                <ThemedText style={styles.actionCopy}>Find sessions already happening for your classes.</ThemedText>
              </Pressable>
              <Pressable
                onPress={() => router.push('/messages')}
                style={[styles.actionTile, { backgroundColor: palette.surfaceMuted, borderColor: palette.outline }]}>
                <ThemedText type="defaultSemiBold">Open Messages</ThemedText>
                <ThemedText style={styles.actionCopy}>Keep session plans and coordination in one place.</ThemedText>
              </Pressable>
              <Pressable
                onPress={() => router.push('/explore')}
                style={[styles.actionTile, { backgroundColor: palette.surfaceMuted, borderColor: palette.outline }]}>
                <ThemedText type="defaultSemiBold">Browse Spots</ThemedText>
                <ThemedText style={styles.actionCopy}>Search campus libraries, commons, and other study areas.</ThemedText>
              </Pressable>
            </View>
            <Pressable
              onPress={() => router.push('/create-session')}
              style={[styles.primaryButton, { backgroundColor: palette.tint }]}>
              <ThemedText lightColor="#ffffff" darkColor="#ffffff" type="defaultSemiBold">
                Create a Study Session
              </ThemedText>
            </Pressable>
          </ThemedView>

          <ThemedView style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <View style={styles.sectionHeader}>
              <ThemedText style={styles.sectionLabel}>Profile completion</ThemedText>
              <View style={[styles.statusPill, { backgroundColor: palette.surfaceMuted }]}>
                <ThemedText type="defaultSemiBold">Edit on Profile</ThemedText>
              </View>
            </View>
            <ThemedText type="subtitle">Keep your profile accurate</ThemedText>
            <View style={styles.checklist}>
              <View style={styles.checklistItem}>
                <ThemedText type="defaultSemiBold">{setup.hasName ? 'Done' : 'Next'}</ThemedText>
                <ThemedText style={styles.checklistCopy}>
                  {setup.hasName
                    ? `Name saved as ${profile?.displayName || currentUser.email}.`
                    : 'Add your first and last name so people see you clearly in sessions and chat.'}
                </ThemedText>
              </View>
              <View style={styles.checklistItem}>
                <ThemedText type="defaultSemiBold">{setup.hasClasses ? 'Done' : 'Next'}</ThemedText>
                <ThemedText style={styles.checklistCopy}>
                  {setup.hasClasses
                    ? `${classCount} class${classCount === 1 ? '' : 'es'} selected.`
                    : 'Choose classes on your Profile so Studi can show the right sessions.'}
                </ThemedText>
              </View>
            </View>
            <Pressable
              onPress={() => router.push('/profile')}
              style={[styles.secondaryButton, { borderColor: palette.outline }]}>
              <ThemedText type="defaultSemiBold">Open Profile</ThemedText>
            </Pressable>
          </ThemedView>
        </>
      ) : (
        <>
          <ThemedView style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <View style={styles.sectionHeader}>
              <ThemedText style={styles.sectionLabel}>Welcome</ThemedText>
              <View style={[styles.statusPill, { backgroundColor: palette.badge }]}>
                <ThemedText type="defaultSemiBold">Start here</ThemedText>
              </View>
            </View>
            <ThemedText type="subtitle">Sign in with your UW email</ThemedText>
            <ThemedText style={styles.helperText}>
              Use a `@wisc.edu` email. If the account does not exist yet, we&apos;ll send you to a
              quick profile screen to finish setting up your name before you enter the app.
            </ThemedText>

            <TextInput
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              onChangeText={setEmail}
              placeholder="netid@wisc.edu"
              placeholderTextColor={colorScheme === 'dark' ? '#8aa1a8' : '#7a8f97'}
              style={[styles.input, { borderColor: palette.outline, color: palette.text }]}
              value={email}
            />

            <TextInput
              autoCapitalize="none"
              onChangeText={setPassword}
              placeholder="Password"
              placeholderTextColor={colorScheme === 'dark' ? '#8aa1a8' : '#7a8f97'}
              secureTextEntry
              style={[styles.input, { borderColor: palette.outline, color: palette.text }]}
              value={password}
            />

            <Pressable
              disabled={isBusy}
              onPress={handleSignIn}
              style={[styles.primaryButton, { backgroundColor: palette.tint, opacity: isBusy ? 0.7 : 1 }]}>
              {isBusy ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <ThemedText lightColor="#ffffff" darkColor="#ffffff" type="defaultSemiBold">
                  Sign In / Create Account
                </ThemedText>
              )}
            </Pressable>
          </ThemedView>

          <ThemedView style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <View style={styles.sectionHeader}>
              <ThemedText style={styles.sectionLabel}>What happens next</ThemedText>
            </View>
            <ThemedText type="subtitle">One login, then a personalized dashboard</ThemedText>
            <ThemedText style={styles.mutedText}>
              New users finish their name on a separate setup screen, then land inside Studi with
              access to profile editing, study spots, messages, and sessions.
            </ThemedText>
          </ThemedView>
        </>
      )}

      {isProfileLoading && isSignedIn ? (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator color={palette.tint} />
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    gap: 18,
    padding: 20,
    paddingBottom: 36,
  },
  hero: {
    alignItems: 'center',
    borderRadius: 24,
    gap: 10,
    padding: 24,
  },
  heroLogo: {
    height: 110,
    width: 320,
  },
  eyebrow: {
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  heroEyebrow: {
    textAlign: 'center',
  },
  heroText: {
    lineHeight: 32,
    maxWidth: 420,
    textAlign: 'center',
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
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sectionLabel: {
    fontSize: 12,
    letterSpacing: 1,
    opacity: 0.72,
    textTransform: 'uppercase',
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  helperText: {
    lineHeight: 28,
    opacity: 0.86,
  },
  mutedText: {
    lineHeight: 28,
    opacity: 0.82,
  },
  input: {
    borderRadius: 14,
    borderWidth: 1,
    fontSize: 16,
    minHeight: 56,
    paddingHorizontal: 16,
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 16,
    justifyContent: 'center',
    minHeight: 56,
    paddingHorizontal: 18,
  },
  secondaryButton: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: 18,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  metricCard: {
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    gap: 4,
    minHeight: 96,
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  metricValue: {
    fontSize: 24,
    fontWeight: '700',
  },
  metricLabel: {
    opacity: 0.75,
  },
  actionGrid: {
    gap: 12,
  },
  actionTile: {
    borderRadius: 18,
    borderWidth: 1,
    gap: 6,
    padding: 16,
  },
  actionCopy: {
    lineHeight: 24,
    opacity: 0.8,
  },
  checklist: {
    gap: 14,
  },
  checklistItem: {
    gap: 4,
  },
  checklistCopy: {
    lineHeight: 24,
    opacity: 0.82,
  },
  loadingOverlay: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 8,
  },
});
