import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { Avatar } from '@/components/ui/Avatar';
import { BadgeChip } from '@/components/ui/BadgeChip';
import { Button } from '@/components/ui/Button';
import { CourseChip } from '@/components/ui/CourseChip';
import { EmptyState } from '@/components/ui/EmptyState';
import { SectionHeader } from '@/components/ui/SectionHeader';
import {
  Brand,
  Colors,
  Elevation,
  FontFamily,
  Radius,
  Space,
  TypeScale,
} from '@/constants/theme';
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

function timeOfDayGreeting(now: Date = new Date()) {
  const hour = now.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

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

  const subline = setup.hasClasses
    ? matchesToday > 0
      ? `${matchesToday} session${matchesToday === 1 ? '' : 's'} match${
          matchesToday === 1 ? 'es' : ''
        } your classes today`
      : matchedSessions.length > 0
        ? `${matchedSessions.length} upcoming session${
            matchedSessions.length === 1 ? '' : 's'
          } match your classes`
        : 'Nothing for your classes yet — set the first table'
    : 'Add your classes to see sessions that match';

  const dateEyebrow = new Date()
    .toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

  const placeholderColor = colorScheme === 'dark' ? '#8A8174' : Brand.textSubtle;
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
            <View style={styles.headerText}>
              <Text style={[TypeScale.eyebrow, { color: palette.icon }]}>{dateEyebrow}</Text>
              <Text
                style={[styles.greeting, { color: palette.text }]}
                numberOfLines={1}
                adjustsFontSizeToFit>
                {timeOfDayGreeting()}
                {savedName.firstName ? `, ${savedName.firstName}` : ''}
              </Text>
              <Text style={[TypeScale.meta, { color: palette.icon }]}>{subline}</Text>
            </View>
            <Pressable accessibilityRole="button" onPress={() => router.push('/profile')}>
              <Avatar
                name={profile?.displayName || currentUser?.email || 'S'}
                size="md"
              />
            </Pressable>
          </View>

          {sessionsError ? (
            <Text style={[TypeScale.caption, { color: palette.icon }]}>{sessionsError}</Text>
          ) : null}

          <View style={styles.section}>
            <SectionHeader eyebrow="Your next session" />
            {nextSession ? (
              <SessionCard
                variant="hero"
                session={nextSession}
                locationName={nextSession.locationName}
                // Only the signed-in user's profile is loaded here — their
                // avatar plus a "+N" chip covers the rest without new reads.
                attendeeNames={
                  profile?.displayName ? [profile.displayName] : undefined
                }
                joined
                onPress={() => router.push(`/session/${nextSession.sessionId}`)}
              />
            ) : (
              <EmptyState
                icon="calendar"
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
              <SectionHeader
                eyebrow="For your classes"
                action={
                  <Pressable accessibilityRole="button" onPress={() => router.push('/sessions')}>
                    <Text style={[TypeScale.label, { color: palette.tint }]}>See all</Text>
                  </Pressable>
                }
              />
              <View
                style={[
                  styles.listCard,
                  Elevation.e1,
                  { backgroundColor: palette.surface, borderColor: palette.border },
                ]}>
                {matchedSessions.slice(0, 4).map((session, index) => (
                  <View key={session.sessionId}>
                    {index > 0 ? (
                      <View style={[styles.divider, { backgroundColor: palette.border }]} />
                    ) : null}
                    <SessionCard
                      variant="list"
                      session={session}
                      locationName={session.locationName}
                      onPress={() => router.push(`/session/${session.sessionId}`)}
                    />
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {profileClasses.length > 0 ? (
            <View style={styles.section}>
              <SectionHeader eyebrow="Your classes" />
              <View style={styles.chipWrap}>
                {profileClasses.map((classCode) => (
                  <CourseChip
                    key={classCode}
                    code={classCode}
                    onPress={() =>
                      router.push({ pathname: '/sessions', params: { classId: classCode } })
                    }
                  />
                ))}
              </View>
            </View>
          ) : null}

          <View style={styles.section}>
            <Button
              label={
                profileClasses.length > 0
                  ? `Host a session for ${profileClasses[0]}`
                  : 'Host a session'
              }
              size="lg"
              fullWidth
              onPress={() =>
                router.push(
                  profileClasses.length > 0
                    ? { pathname: '/create-session', params: { classId: profileClasses[0] } }
                    : '/create-session'
                )
              }
            />
          </View>

          {setup.completed < 2 ? (
            <Pressable
              onPress={() => router.push('/profile')}
              style={[
                styles.setupCard,
                Elevation.e1,
                { backgroundColor: palette.surface, borderColor: palette.border },
              ]}>
              <View style={styles.setupCopy}>
                <Text style={[TypeScale.bodyStrong, { color: palette.text }]}>Finish setup</Text>
                <Text style={[TypeScale.caption, { color: palette.icon }]}>
                  {setup.hasClasses
                    ? 'Add your name so classmates know who’s at the table.'
                    : 'Add your classes to see sessions that match.'}
                </Text>
              </View>
              <BadgeChip label={`${setup.completed}/2`} tone="filling" />
            </Pressable>
          ) : null}
        </>
      ) : (
        <>
          <View style={styles.welcome}>
            <Text style={[styles.wordmark, { color: palette.tint }]}>Studi</Text>
            <Text style={[styles.welcomeHeadline, { color: palette.text }]}>
              Study together.
            </Text>
            <Text style={[TypeScale.body, styles.welcomeBody, { color: palette.icon }]}>
              Find, join, and host study sessions for every class on your schedule.
            </Text>
            <BadgeChip label="Verified @wisc.edu students only" tone="info" />
          </View>

          <View
            style={[
              styles.authCard,
              Elevation.e1,
              { backgroundColor: palette.surface, borderColor: palette.border },
            ]}>
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
              label={authMode === 'sign-in' ? 'Sign in' : 'Get started'}
              size="lg"
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.md,
  },
  headerText: {
    flexShrink: 1,
    gap: Space.xs + 1,
  },
  greeting: {
    fontFamily: FontFamily.serifItalic,
    fontSize: 29,
    lineHeight: 35,
  },
  section: {
    gap: Space.md,
  },
  listCard: {
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth * 2,
    paddingHorizontal: Space.md,
    paddingVertical: Space.xs,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
  },
  emptyState: {
    paddingVertical: Space.lg,
  },
  setupCard: {
    alignItems: 'center',
    borderRadius: Radius.xl,
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
  welcome: {
    alignItems: 'center',
    gap: Space.md,
    paddingTop: Space.xxl + 8,
    paddingBottom: Space.sm,
    paddingHorizontal: Space.lg,
  },
  wordmark: {
    fontFamily: FontFamily.serifItalic,
    fontSize: 30,
    lineHeight: 36,
  },
  welcomeHeadline: {
    fontFamily: FontFamily.serifItalic,
    fontSize: 38,
    lineHeight: 44,
    textAlign: 'center',
  },
  welcomeBody: {
    maxWidth: 280,
    textAlign: 'center',
  },
  authCard: {
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth * 2,
    gap: Space.md,
    padding: Space.lg + 4,
  },
  input: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth * 2,
    fontFamily: FontFamily.body,
    fontSize: 15,
    minHeight: 48,
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
