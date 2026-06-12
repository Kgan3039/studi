import { useCallback, useEffect, useMemo, useState } from 'react';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SessionCard } from '@/components/session-card';
import { BadgeChip } from '@/components/ui/BadgeChip';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Brand, Colors, FontFamily, Radius, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { track } from '@/lib/analytics';
import {
  requestPasswordReset,
  signIn,
  signUp,
  subscribeToAuthState,
} from '@/lib/auth';
import {
  getLocations,
  getUpcomingSessions,
  getUserProfile,
  type StudySession,
  type UserProfile,
} from '@/lib/firestore';
import type { User } from 'firebase/auth';

type TodaySession = StudySession & { locationName: string };

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

const ONBOARDING_STEPS = [
  { step: '1', title: 'Verify', copy: 'Sign up with your @wisc.edu email.' },
  { step: '2', title: 'Pick classes', copy: 'Tell us what you’re taking this term.' },
  { step: '3', title: 'Join a session', copy: 'Sit down with classmates who get it.' },
] as const;

export default function HomeScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authMode, setAuthMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isProfileLoading, setIsProfileLoading] = useState(false);
  const [sessions, setSessions] = useState<TodaySession[]>([]);
  const [sessionsError, setSessionsError] = useState('');
  const isSignedIn = !!currentUser && currentUser.emailVerified;

  useEffect(() => {
    if (currentUser && !currentUser.emailVerified) {
      router.replace('/verify-email');
    }
  }, [currentUser, router]);

  useEffect(() => {
    const unsubscribe = subscribeToAuthState((user) => {
      setCurrentUser(user);

      if (user?.email) {
        setEmail(user.email);
        return;
      }

      setProfile(null);
      setSessions([]);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    async function loadUserProfile() {
      if (!currentUser || !currentUser.emailVerified) {
        return;
      }

      try {
        setIsProfileLoading(true);
        const loadedProfile = await getUserProfile(currentUser.uid);
        setProfile(loadedProfile);
      } catch {
        setProfile(null);
      } finally {
        setIsProfileLoading(false);
      }
    }

    loadUserProfile();
  }, [currentUser]);

  const loadSessions = useCallback(async () => {
    if (!currentUser || !currentUser.emailVerified) {
      return;
    }

    try {
      setSessionsError('');
      const [loadedSessions, locations] = await Promise.all([
        getUpcomingSessions(),
        getLocations(),
      ]);
      const locationsById = new Map(
        locations.map((location) => [location.locationId, location] as const)
      );

      setSessions(
        loadedSessions.map((session) => ({
          ...session,
          locationName: locationsById.get(session.locationId)?.name ?? session.locationId,
        }))
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to load sessions right now.';
      setSessionsError(message);
    }
  }, [currentUser]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  async function handleSubmitAuth() {
    try {
      setIsBusy(true);
      if (authMode === 'sign-in') {
        await signIn(email, password);
        track('sign_in_completed');
      } else {
        track('sign_up_started');
        await signUp(email, password, firstName, lastName);
        router.replace('/verify-email');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to continue right now.';
      Alert.alert(authMode === 'sign-in' ? 'Sign In Error' : 'Sign Up Error', message);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleForgotPassword() {
    try {
      setIsBusy(true);
      await requestPasswordReset(email);
      Alert.alert(
        'Check Your Email',
        'If an account exists for that address, a password reset link is on its way.'
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to send a reset email.';
      Alert.alert('Reset Error', message);
    } finally {
      setIsBusy(false);
    }
  }

  const savedName = splitDisplayName(profile?.displayName);
  const setup = useMemo(() => getSetupSummary(profile), [profile]);
  const profileClasses = useMemo(
    () => (profile?.classes ?? []).map((classCode) => classCode.trim().toUpperCase()),
    [profile]
  );

  const nextSession = useMemo(() => {
    if (!currentUser) {
      return undefined;
    }
    return sessions.find((session) => session.participantIds.includes(currentUser.uid));
  }, [currentUser, sessions]);

  const matchedSessions = useMemo(
    () =>
      sessions.filter(
        (session) =>
          profileClasses.includes(session.classId.trim().toUpperCase()) &&
          session.sessionId !== nextSession?.sessionId
      ),
    [nextSession, profileClasses, sessions]
  );

  const matchesToday = matchedSessions.filter(
    (session) => session.startTime.toDate().toDateString() === new Date().toDateString()
  ).length;

  const greeting = setup.hasClasses
    ? matchesToday > 0
      ? `Hey ${savedName.firstName || 'there'} — ${matchesToday} session${
          matchesToday === 1 ? '' : 's'
        } match${matchesToday === 1 ? 'es' : ''} your classes today`
      : matchedSessions.length > 0
        ? `Hey ${savedName.firstName || 'there'} — ${matchedSessions.length} upcoming session${
            matchedSessions.length === 1 ? '' : 's'
          } match your classes`
        : `Hey ${savedName.firstName || 'there'} — nothing for your classes yet. Set the first table.`
    : `Hey ${savedName.firstName || 'there'} — add your classes to see sessions that match`;

  const placeholderColor = colorScheme === 'dark' ? '#9F918B' : Brand.charcoal400;
  const inputStyle = [
    styles.input,
    {
      backgroundColor: palette.surfaceMuted,
      borderColor: palette.border,
      color: palette.text,
    },
  ];

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: palette.background }]}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + Space.md }]}>
      {isSignedIn ? (
        <>
          <View style={styles.header}>
            <Text style={[TypeScale.title, { color: palette.text }]}>Today</Text>
            <Text style={[TypeScale.body, styles.greeting, { color: palette.icon }]}>
              {greeting}
            </Text>
          </View>

          {sessionsError ? (
            <Text style={[TypeScale.caption, { color: palette.icon }]}>{sessionsError}</Text>
          ) : null}

          <View style={styles.section}>
            <Text style={[TypeScale.heading, { color: palette.text }]}>Your next session</Text>
            {nextSession ? (
              <SessionCard
                accent
                session={nextSession}
                locationName={nextSession.locationName}
                joined
                onPress={() => router.push(`/session/${nextSession.sessionId}`)}
              />
            ) : (
              <EmptyState
                headline="Your week is wide open"
                body={
                  matchedSessions.length > 0
                    ? `${matchedSessions.length} session${
                        matchedSessions.length === 1 ? '' : 's'
                      } match your classes right now.`
                    : 'Join a session and it shows up here.'
                }
                actionLabel="Browse sessions"
                onAction={() => router.push('/sessions')}
                style={styles.emptyState}
              />
            )}
          </View>

          {matchedSessions.length > 0 ? (
            <View style={styles.section}>
              <Text style={[TypeScale.heading, { color: palette.text }]}>For your classes</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.rail}>
                {matchedSessions.slice(0, 8).map((session) => (
                  <SessionCard
                    key={session.sessionId}
                    variant="compact"
                    session={session}
                    locationName={session.locationName}
                    onPress={() => router.push(`/session/${session.sessionId}`)}
                  />
                ))}
              </ScrollView>
            </View>
          ) : null}

          <View style={styles.section}>
            <Text style={[TypeScale.heading, { color: palette.text }]}>Quick start</Text>
            <Button
              label={
                profileClasses.length > 0
                  ? `+ Start a session for ${profileClasses[0]}`
                  : '+ Start a session'
              }
              fullWidth
              onPress={() =>
                router.push(
                  profileClasses.length > 0
                    ? { pathname: '/create-session', params: { classId: profileClasses[0] } }
                    : '/create-session'
                )
              }
            />
            <Button
              label="Browse all sessions"
              variant="secondary"
              fullWidth
              onPress={() => router.push('/sessions')}
            />
          </View>

          {setup.completed < 2 ? (
            <Pressable
              onPress={() => router.push('/profile')}
              style={[
                styles.setupCard,
                { backgroundColor: palette.surface, borderColor: palette.border },
              ]}>
              <View style={styles.setupCopy}>
                <Text style={[TypeScale.label, { color: palette.text }]}>Finish setup</Text>
                <Text style={[TypeScale.caption, { color: palette.icon }]}>
                  {setup.hasClasses
                    ? 'Add your name so classmates know who’s at the table.'
                    : 'Add your classes to see sessions that match.'}
                </Text>
              </View>
              <BadgeChip label={`${setup.completed}/2`} tone="sunflower" />
            </Pressable>
          ) : null}
        </>
      ) : (
        <>
          <View style={[styles.welcomeHero, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <Image
              contentFit="contain"
              source={require('../../assets/images/studi-wordmark.png')}
              style={styles.heroLogo}
            />
            <BadgeChip label="✓ Verified @wisc.edu students only" tone="lake" />
            <Text style={[TypeScale.body, styles.heroText, { color: palette.icon }]}>
              Study sessions for your UW classes — find one happening soon, or set the table
              yourself.
            </Text>
          </View>

          <View style={styles.stepsRow}>
            {ONBOARDING_STEPS.map((item) => (
              <View
                key={item.step}
                style={[
                  styles.stepCard,
                  { backgroundColor: palette.surface, borderColor: palette.border },
                ]}>
                <View style={[styles.stepDot, { backgroundColor: palette.tint }]}>
                  <Text style={styles.stepNumber}>{item.step}</Text>
                </View>
                <Text style={[TypeScale.label, { color: palette.text }]}>{item.title}</Text>
                <Text style={[TypeScale.caption, { color: palette.icon }]}>{item.copy}</Text>
              </View>
            ))}
          </View>

          <View style={[styles.authCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <Text style={[TypeScale.heading, { color: palette.text }]}>
              {authMode === 'sign-in' ? 'Sign in' : 'Create your account'}
            </Text>
            <Text style={[TypeScale.caption, { color: palette.icon }]}>
              {authMode === 'sign-in'
                ? 'Use your @wisc.edu email and password.'
                : 'Use your @wisc.edu email. We’ll send a verification link first.'}
            </Text>

            {authMode === 'sign-up' ? (
              <View style={styles.inlineRow}>
                <TextInput
                  autoCapitalize="words"
                  onChangeText={setFirstName}
                  placeholder="First name"
                  placeholderTextColor={placeholderColor}
                  style={[...inputStyle, styles.flexInput]}
                  value={firstName}
                />
                <TextInput
                  autoCapitalize="words"
                  onChangeText={setLastName}
                  placeholder="Last name"
                  placeholderTextColor={placeholderColor}
                  style={[...inputStyle, styles.flexInput]}
                  value={lastName}
                />
              </View>
            ) : null}

            <TextInput
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              onChangeText={setEmail}
              placeholder="netid@wisc.edu"
              placeholderTextColor={placeholderColor}
              style={inputStyle}
              value={email}
            />

            <TextInput
              autoCapitalize="none"
              onChangeText={setPassword}
              placeholder="Password"
              placeholderTextColor={placeholderColor}
              secureTextEntry
              style={inputStyle}
              value={password}
            />

            <Button
              label={authMode === 'sign-in' ? 'Sign in' : 'Create account'}
              fullWidth
              loading={isBusy}
              onPress={handleSubmitAuth}
            />

            <Pressable
              disabled={isBusy}
              onPress={() => setAuthMode(authMode === 'sign-in' ? 'sign-up' : 'sign-in')}
              style={styles.textLink}>
              <Text style={[TypeScale.label, { color: palette.tint }]}>
                {authMode === 'sign-in'
                  ? 'New to Studi? Create an account'
                  : 'Have an account? Sign in'}
              </Text>
            </Pressable>

            {authMode === 'sign-in' ? (
              <Pressable disabled={isBusy} onPress={handleForgotPassword} style={styles.textLink}>
                <Text style={[TypeScale.label, { color: palette.tint }]}>Forgot password?</Text>
              </Pressable>
            ) : null}
          </View>
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
    gap: Space.xl,
    padding: Space.lg + 4,
    paddingBottom: Space.xxl + 4,
  },
  header: {
    gap: Space.xs,
  },
  greeting: {
    maxWidth: 420,
  },
  section: {
    gap: Space.md,
  },
  rail: {
    gap: Space.md,
    paddingRight: Space.lg,
  },
  emptyState: {
    paddingVertical: Space.lg,
  },
  setupCard: {
    alignItems: 'center',
    borderRadius: Radius.card,
    borderTopRightRadius: Radius.accentCorner,
    borderWidth: StyleSheet.hairlineWidth * 2,
    flexDirection: 'row',
    gap: Space.md,
    justifyContent: 'space-between',
    padding: Space.lg,
  },
  setupCopy: {
    flexShrink: 1,
    gap: Space.xs,
  },
  welcomeHero: {
    alignItems: 'center',
    borderRadius: Radius.card,
    borderTopRightRadius: Radius.accentCorner,
    borderWidth: StyleSheet.hairlineWidth * 2,
    gap: Space.md,
    padding: Space.xl,
  },
  heroLogo: {
    height: 96,
    width: 300,
  },
  heroText: {
    maxWidth: 420,
    textAlign: 'center',
  },
  stepsRow: {
    flexDirection: 'row',
    gap: Space.md,
  },
  stepCard: {
    borderRadius: Radius.card,
    borderWidth: StyleSheet.hairlineWidth * 2,
    flex: 1,
    gap: Space.xs + 2,
    padding: Space.md,
  },
  stepDot: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  stepNumber: {
    color: '#FFFFFF',
    fontFamily: FontFamily.bodySemiBold,
    fontSize: 12,
    lineHeight: 16,
  },
  authCard: {
    borderRadius: Radius.card,
    borderTopRightRadius: Radius.accentCorner,
    borderWidth: StyleSheet.hairlineWidth * 2,
    gap: Space.md,
    padding: Space.lg + 4,
  },
  input: {
    borderRadius: Radius.chip + 4,
    borderWidth: StyleSheet.hairlineWidth * 2,
    fontFamily: FontFamily.body,
    fontSize: 15,
    minHeight: 52,
    paddingHorizontal: Space.lg,
  },
  inlineRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Space.sm + 2,
  },
  flexInput: {
    flex: 1,
  },
  textLink: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 32,
  },
  loadingOverlay: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: Space.sm,
  },
});
