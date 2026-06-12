import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
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
  Colors,
  Elevation,
  FontFamily,
  Radius,
  Space,
  TypeScale,
} from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { subscribeToAuthState } from '@/lib/auth';
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
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isProfileLoading, setIsProfileLoading] = useState(false);
  const [sessions, setSessions] = useState<TodaySession[]>([]);
  const [sessionsError, setSessionsError] = useState('');
  // The (tabs) layout gate redirects signed-out/unverified users to the
  // (auth) flow; this flag only guards the brief frame before that happens.
  const isSignedIn = !!currentUser && currentUser.emailVerified;

  useEffect(() => {
    const unsubscribe = subscribeToAuthState((user) => {
      setCurrentUser(user);

      if (!user) {
        setProfile(null);
        setSessions([]);
      }
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

  if (!isSignedIn) {
    return null;
  }

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: palette.background }]}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + Space.md }]}>
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

      {isProfileLoading ? (
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
  loadingOverlay: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: Space.sm,
  },
});
