import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatSessionStart, formatSessionWindow } from '@/components/session-card';
import { Avatar, AvatarStack } from '@/components/ui/Avatar';
import { BadgeChip } from '@/components/ui/BadgeChip';
import { Button } from '@/components/ui/Button';
import { CourseChip } from '@/components/ui/CourseChip';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconButton } from '@/components/ui/IconButton';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ScreenTransition } from '@/components/ui/ScreenTransition';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { SuccessToast, useSuccessToast } from '@/components/ui/Toast';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, FontFamily, Radius, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { track } from '@/lib/analytics';
import { subscribeToAuthState } from '@/lib/auth';
import {
  getLocations,
  getProfilesByIds,
  getUpcomingSessionsForClasses,
  getUserProfile,
  isSessionAtCapacity,
  joinSession,
  SessionFullError,
  type StudySession,
  type UserProfile,
} from '@/lib/firestore';
import {
  UW_COURSE_CATALOG,
  formatCourseTitle,
  getStudyLocationDisplayName,
} from '@/lib/catalog';
import { getFriendsPage, type FriendListItem } from '@/lib/friends';
import {
  confirmBlockedJoinWithAlert,
  requestGuardedSessionJoin,
} from '@/lib/guarded-session-join';
import type { User } from 'firebase/auth';

type TodaySession = StudySession & { locationName: string };

/** Home shows a short list; the full roster lives behind the add action. */
const BUDDY_PREVIEW_COUNT = 4;

type HeroKind = 'live' | 'joined' | 'matched';

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

function timeOfDayGreeting(now: Date = new Date()) {
  const hour = now.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function isLive(session: StudySession, nowMs: number) {
  return (
    session.startTime.toMillis() <= nowMs &&
    !!session.endTime &&
    session.endTime.toMillis() > nowMs
  );
}

function HeroCard({
  session,
  kind,
  attendeeNames,
  joined,
  joining,
  onJoin,
  onPress,
}: {
  session: TodaySession;
  kind: HeroKind;
  attendeeNames: string[];
  joined: boolean;
  joining: boolean;
  onJoin: () => void;
  onPress: () => void;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const going = session.participantIds.length;
  const isFull = session.status === 'full' || isSessionAtCapacity(session);
  // "3 of 8 going" once capacity exists; pre-capacity sessions keep the count.
  const goingLabel =
    typeof session.capacity === 'number' ? `${going} of ${session.capacity} going` : `${going} going`;

  const eyebrow =
    kind === 'live' ? 'Happening now' : kind === 'joined' ? 'Your next session' : 'Up next';

  const action = joined ? (
    <Button label="✓ Going" variant="success" size="sm" onPress={onPress} />
  ) : isFull ? (
    <BadgeChip label="Full" tone="neutral" />
  ) : (
    <Button label="Join" size="sm" loading={joining} onPress={onJoin} />
  );

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.heroCard,
        {
          backgroundColor: palette.surface,
          borderColor: palette.border,
          opacity: pressed ? 0.92 : 1,
        },
        pressed ? styles.pressed : null,
      ]}>
      <View style={styles.heroTopRow}>
        <View style={styles.heroEyebrowRow}>
          {kind === 'live' ? (
            <View style={[styles.liveDot, { backgroundColor: palette.tint }]} />
          ) : null}
          <Text
            style={[
              TypeScale.meta,
              { color: kind === 'live' ? palette.tint : palette.icon },
            ]}>
            {eyebrow}
          </Text>
        </View>
        <Text style={[TypeScale.meta, { color: palette.icon }]}>
          {goingLabel}
        </Text>
      </View>
      <CourseChip code={session.classId} size="lg" />
      <Text style={[styles.heroTitle, { color: palette.text }]} numberOfLines={2}>
        {session.title}
      </Text>
      <Text style={[TypeScale.body, { color: palette.icon }]} numberOfLines={1}>
        {formatSessionWindow(session.startTime, session.endTime)}, {session.locationName}
      </Text>
      <View style={styles.heroFooter}>
        <AvatarStack names={attendeeNames} max={3} size="sm" totalCount={going} />
        {action}
      </View>
    </Pressable>
  );
}

/**
 * A class the user is enrolled in, with the number of upcoming sessions it
 * currently matches. Doubles as the empty-state next step: every row can start
 * a session for that class.
 */
function ClassRow({
  code,
  title,
  activeCount,
  onPress,
  onHost,
  isLast,
}: {
  code: string;
  title: string;
  activeCount: number;
  onPress: () => void;
  onHost: () => void;
  isLast: boolean;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${code}, ${activeCount} upcoming ${
        activeCount === 1 ? 'session' : 'sessions'
      }`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.classRow,
        {
          borderBottomColor: palette.border,
          borderBottomWidth: isLast ? 0 : 1,
          opacity: pressed ? 0.6 : 1,
        },
        pressed ? styles.pressed : null,
      ]}>
      <CourseChip code={code} size="sm" />
      <View style={styles.classRowBody}>
        <Text style={[TypeScale.meta, { color: palette.icon }]} numberOfLines={2}>
          {title}
        </Text>
        <Text style={[TypeScale.caption, { color: palette.icon }]}>
          {activeCount > 0
            ? `${activeCount} upcoming ${activeCount === 1 ? 'session' : 'sessions'}`
            : 'No sessions yet'}
        </Text>
      </View>
      {activeCount > 0 ? (
        <IconSymbol name="chevron.right" size={18} color={palette.icon} />
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Start a ${code} session`}
          hitSlop={8}
          onPress={onHost}
          style={({ pressed }) => [styles.classRowAction, { opacity: pressed ? 0.5 : 1 }]}>
          <Text style={[TypeScale.label, { color: palette.tint }]}>Start one</Text>
        </Pressable>
      )}
    </Pressable>
  );
}

/** A study buddy with the context that makes them worth tapping right now. */
function BuddyRow({
  name,
  detail,
  onPress,
  isLast,
}: {
  name: string;
  detail: string;
  onPress: () => void;
  isLast: boolean;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${detail}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.buddyRow,
        {
          borderBottomColor: palette.border,
          borderBottomWidth: isLast ? 0 : 1,
          opacity: pressed ? 0.6 : 1,
        },
        pressed ? styles.pressed : null,
      ]}>
      <Avatar name={name} size="sm" verified />
      <View style={styles.buddyCopy}>
        <Text style={[TypeScale.bodyStrong, { color: palette.text }]} numberOfLines={1}>
          {name}
        </Text>
        <Text style={[TypeScale.caption, { color: palette.icon }]} numberOfLines={1}>
          {detail}
        </Text>
      </View>
      <IconSymbol name="chevron.right" size={18} color={palette.icon} />
    </Pressable>
  );
}

function UpcomingRow({
  session,
  onPress,
  isLast,
}: {
  session: TodaySession;
  onPress: () => void;
  isLast: boolean;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const isFull = session.status === 'full' || isSessionAtCapacity(session);
  const spotsLeft =
    typeof session.capacity === 'number'
      ? Math.max(session.capacity - session.participantIds.length, 0)
      : undefined;
  const count =
    spotsLeft !== undefined
      ? { number: String(spotsLeft), label: 'left' }
      : { number: String(session.participantIds.length), label: 'going' };

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.upcomingCard,
        {
          borderColor: palette.border,
          borderBottomWidth: isLast ? 0 : 1,
          opacity: pressed ? 0.85 : isFull ? 0.6 : 1,
        },
      ]}>
      <View style={styles.upcomingBody}>
        <CourseChip code={session.classId} size="sm" />
        <Text
          style={[TypeScale.bodyStrong, styles.upcomingTitle, { color: palette.text }]}
          numberOfLines={1}>
          {session.title}
        </Text>
        <Text style={[TypeScale.caption, { color: palette.icon }]} numberOfLines={1}>
          {session.locationName}, {formatSessionStart(session.startTime)}
        </Text>
      </View>
      {isFull ? (
        <BadgeChip label="Full" tone="neutral" />
      ) : (
        <View style={styles.upcomingCount}>
          <Text style={[styles.upcomingNumber, { color: palette.tint }]}>{count.number}</Text>
          <Text style={[styles.upcomingNumberLabel, { color: palette.icon }]}>{count.label}</Text>
        </View>
      )}
    </Pressable>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [sessions, setSessions] = useState<TodaySession[]>([]);
  const [sessionsError, setSessionsError] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [heroAttendeeNames, setHeroAttendeeNames] = useState<string[]>([]);
  const [joiningHero, setJoiningHero] = useState(false);
  const [friends, setFriends] = useState<FriendListItem[]>([]);
  const { toast, show: showToast } = useSuccessToast();
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
        const loadedProfile = await getUserProfile(currentUser.uid);
        setProfile(loadedProfile);
      } catch {
        setProfile(null);
      }
    }

    loadUserProfile();
  }, [currentUser]);

  const profileClasses = useMemo(
    () => (profile?.classes ?? []).map((classCode) => classCode.trim().toUpperCase()),
    [profile]
  );

  const loadSessions = useCallback(async () => {
    if (!currentUser || !currentUser.emailVerified) {
      return;
    }

    try {
      setSessionsError('');
      // Query the user's classes directly (plus joined sessions) rather than
      // scanning the global upcoming list — at scale the first page of that
      // list may hold none of this user's classes.
      const [loadedSessions, locations] = await Promise.all([
        getUpcomingSessionsForClasses({
          classIds: profileClasses,
          participantId: currentUser.uid,
          includeInProgress: true,
        }),
        getLocations(),
      ]);
      const locationsById = new Map(
        locations.map((location) => [location.locationId, location] as const)
      );

      setSessions(
        loadedSessions.map((session) => ({
          ...session,
          locationName: getStudyLocationDisplayName(
            session.locationId,
            locationsById.get(session.locationId)?.name
          ),
        }))
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to load sessions right now.';
      setSessionsError(message);
    }
  }, [currentUser, profileClasses]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    let cancelled = false;

    if (!currentUser || !currentUser.emailVerified) {
      setFriends([]);
      return;
    }

    getFriendsPage(currentUser.uid)
      .then((page) => {
        if (!cancelled) {
          setFriends(page.items);
        }
      })
      .catch(() => {
        // The rest of Home is still useful without the buddy list.
        if (!cancelled) {
          setFriends([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  const savedName = splitDisplayName(profile?.displayName);

  // Hero + rows: the board feed is personal — sessions for my classes plus
  // anything I've already joined.
  const { hero, heroKind, upcoming } = useMemo(() => {
    const uid = currentUser?.uid ?? '';
    const nowMs = Date.now();

    const relevant = sessions.filter(
      (session) =>
        profileClasses.includes(session.classId.trim().toUpperCase()) ||
        (uid && session.participantIds.includes(uid))
    );

    const liveSession = relevant.find((session) => isLive(session, nowMs));
    const joinedSession = relevant.find(
      (session) => uid && session.participantIds.includes(uid) && !isLive(session, nowMs)
    );
    const heroSession = liveSession ?? joinedSession ?? relevant[0];
    const kind: HeroKind = liveSession
      ? 'live'
      : heroSession && uid && heroSession.participantIds.includes(uid)
        ? 'joined'
        : 'matched';

    return {
      hero: heroSession,
      heroKind: kind,
      upcoming: relevant
        .filter((session) => session.sessionId !== heroSession?.sessionId)
        .slice(0, 4),
    };
  }, [currentUser, profileClasses, sessions]);

  // Resolve a few attendee names for the hero's avatar stack; the "+N" chip
  // covers the rest without inventing initials.
  useEffect(() => {
    let cancelled = false;

    if (!hero || hero.participantIds.length === 0) {
      setHeroAttendeeNames([]);
      return;
    }

    getProfilesByIds(hero.participantIds.slice(0, 3))
      .then((profiles) => {
        if (cancelled) {
          return;
        }
        setHeroAttendeeNames(
          hero.participantIds
            .slice(0, 3)
            .map((uid) => profiles.get(uid)?.displayName)
            .filter((name): name is string => !!name)
        );
      })
      .catch(() => {
        if (!cancelled) {
          setHeroAttendeeNames([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [hero]);

  async function handleJoinHero() {
    if (!currentUser || !hero) {
      return;
    }

    // Same safety check as every other join surface; the guard re-reads the
    // roster and block list at tap time and only then calls performJoin.
    try {
      setJoiningHero(true);
      await requestGuardedSessionJoin({
        sessionId: hero.sessionId,
        userId: currentUser.uid,
        classId: hero.classId,
        confirm: confirmBlockedJoinWithAlert,
        onVerificationError: (message) => Alert.alert('Unable to Join', message),
        join: performJoin,
      });
    } finally {
      setJoiningHero(false);
    }
  }

  async function performJoin() {
    if (!currentUser || !hero) {
      return;
    }

    try {
      const result = await joinSession(hero.sessionId, currentUser.uid);
      await loadSessions();

      if (result === 'joined') {
        track('session_joined', {
          classId: hero.classId,
          participantCountAfter: hero.participantIds.length + 1,
          surface: 'today',
        });
        showToast('You’re in.', hero.title || 'See you at the table.');
      }
    } catch (error) {
      // Lost the last-seat race — refresh so the hero flips to Full.
      if (error instanceof SessionFullError) {
        track('session_join_blocked_full', { classId: hero.classId });
        await loadSessions();
        Alert.alert('Session Full', error.message);
        return;
      }
      const message =
        error instanceof Error ? error.message : 'Unable to join this session right now.';
      Alert.alert('Join Session Error', message);
    }
  }

  async function handleRefresh() {
    setIsRefreshing(true);
    await loadSessions();
    setIsRefreshing(false);
  }

  const dateEyebrow = new Date()
    .toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

  // How many upcoming sessions each saved class currently matches — the number
  // that makes "your classes" worth looking at rather than a row of labels.
  const activeByClass = useMemo(() => {
    const counts = new Map<string, number>();

    for (const session of sessions) {
      const code = session.classId.trim().toUpperCase();
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }

    return counts;
  }, [sessions]);

  const courseTitlesByCode = useMemo(
    () =>
      new Map(
        UW_COURSE_CATALOG.map((course) => [course.code, formatCourseTitle(course.title)] as const)
      ),
    []
  );

  /**
   * Buddies are ranked by how many of your upcoming sessions they're also in,
   * then by how recently you connected. Studi doesn't record per-person
   * interaction counts, and shared sessions are the closest real signal — they
   * are also the ones you're most likely to want to message today.
   */
  const topBuddies = useMemo(() => {
    return friends
      .map((friend) => {
        const shared = sessions.filter((session) =>
          session.participantIds.includes(friend.friendUid)
        );

        return {
          userId: friend.friendUid,
          name: friend.profile?.displayName?.trim() || 'Student',
          sharedCount: shared.length,
          detail:
            shared.length > 0
              ? `${shared.length} shared ${shared.length === 1 ? 'session' : 'sessions'}`
              : friend.profile?.major?.trim() || 'Classmate',
        };
      })
      .sort((first, second) => second.sharedCount - first.sharedCount)
      .slice(0, BUDDY_PREVIEW_COUNT);
  }, [friends, sessions]);

  if (!isSignedIn) {
    return null;
  }

  const heroJoined = !!hero && !!currentUser && hero.participantIds.includes(currentUser.uid);
  const showEmpty = !hero && upcoming.length === 0;

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <ScrollView
        style={styles.screen}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={palette.icon}
          />
        }
        contentContainerStyle={[styles.content, { paddingTop: insets.top + Space.md }]}>
        {/* Same header shape as every other tab — serif title, supporting line,
            actions anchored right. The warmth comes from the name, not from a
            different layout. */}
        <ScreenHeader
          showNotifications
          status={dateEyebrow}
          subtitle={timeOfDayGreeting()}
          title={savedName.firstName ? `Hi, ${savedName.firstName}` : 'Home'}
          titleStyle={styles.greetingName}
        />

        <ScreenTransition style={styles.transition}>
        {/* Every block on this screen carries a heading so the page reads as a
            sequence of answers, not a stack of loose parts. */}
        <View style={styles.section}>
          <SectionHeader
            eyebrow={hero ? 'Your next session' : 'Up next'}
            action={
              hero || upcoming.length > 0 ? (
                <Pressable accessibilityRole="button" onPress={() => router.push('/sessions')}>
                  <Text style={[TypeScale.label, { color: palette.tint }]}>See all</Text>
                </Pressable>
              ) : null
            }
          />

          {hero ? (
            <HeroCard
              session={hero}
              kind={heroKind}
              attendeeNames={heroAttendeeNames}
              joined={heroJoined}
              joining={joiningHero}
              onJoin={handleJoinHero}
              onPress={() => router.push(`/session/${hero.sessionId}`)}
            />
          ) : null}

          {upcoming.length > 0 ? (
            <View style={styles.upcomingList}>
              {upcoming.map((session, index) => (
                <UpcomingRow
                  key={session.sessionId}
                  session={session}
                  onPress={() => router.push(`/session/${session.sessionId}`)}
                  isLast={index === upcoming.length - 1}
                />
              ))}
            </View>
          ) : null}

        {showEmpty && sessionsError ? (
          <EmptyState
            icon="seat"
            headline="Sessions could not load"
            body={sessionsError}
            actionLabel="Try again"
            onAction={loadSessions}
            style={styles.emptyState}
          />
        ) : null}

        {showEmpty && !sessionsError && profileClasses.length === 0 ? (
          <EmptyState
            icon="calendar"
            headline="Add your classes"
            body="Studi uses your schedule to find sessions that match."
            actionLabel="Add classes"
            onAction={() => router.push('/profile')}
            style={styles.emptyState}
          />
        ) : null}

        {/* With classes saved, a centered empty blob would be a dead end — the
            class list below already offers the next step, so this stays a
            single quiet line above it. */}
        {showEmpty && !sessionsError && profileClasses.length > 0 ? (
          <View style={styles.quietEmpty}>
            <Text style={[TypeScale.body, { color: palette.icon }]}>
              Nothing scheduled yet.
            </Text>
            <Button
              label="Host a session"
              fullWidth
              onPress={() => router.push('/create-session')}
            />
          </View>
        ) : null}
        </View>

        {profileClasses.length > 0 ? (
          <View style={styles.section}>
            <SectionHeader
              eyebrow="Your classes"
              action={
                <IconButton
                  accessibilityLabel="Edit your classes"
                  icon="square.and.pencil"
                  onPress={() => router.push('/profile')}
                />
              }
            />
            <View style={[styles.classList, { borderTopColor: palette.border }]}>
              {profileClasses.map((classCode, index) => (
                <ClassRow
                  key={classCode}
                  code={classCode}
                  title={courseTitlesByCode.get(classCode) ?? 'UW–Madison course'}
                  activeCount={activeByClass.get(classCode) ?? 0}
                  isLast={index === profileClasses.length - 1}
                  onPress={() =>
                    router.push({ pathname: '/sessions', params: { classId: classCode } })
                  }
                  onHost={() =>
                    router.push({ pathname: '/create-session', params: { classId: classCode } })
                  }
                />
              ))}
            </View>
          </View>
        ) : null}

        <View style={styles.section}>
          <SectionHeader
            eyebrow="Study buddies"
            action={
              <IconButton
                accessibilityLabel="Find study buddies"
                icon="person.badge.plus"
                onPress={() => router.push('/friends')}
              />
            }
          />
          {topBuddies.length > 0 ? (
            <View style={[styles.classList, { borderTopColor: palette.border }]}>
              {topBuddies.map((buddy, index) => (
                <BuddyRow
                  key={buddy.userId}
                  name={buddy.name}
                  detail={buddy.detail}
                  isLast={index === topBuddies.length - 1}
                  onPress={() => router.push(`/user/${buddy.userId}`)}
                />
              ))}
            </View>
          ) : (
            <Text style={[TypeScale.body, { color: palette.icon }]}>
              No buddies yet. Add classmates to study together.
            </Text>
          )}
        </View>
        </ScreenTransition>
      </ScrollView>
      <SuccessToast toast={toast} />
    </View>
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
  greetingName: {
    fontFamily: FontFamily.serifItalic,
  },
  transition: {
    gap: Space.xl,
  },
  heroCard: {
    borderRadius: Radius.xl,
    borderWidth: 1,
    padding: Space.lg + 4,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.sm,
    marginBottom: Space.lg,
  },
  heroEyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm - 2,
  },
  liveDot: {
    borderRadius: Radius.pill,
    height: 6,
    width: 6,
  },
  heroTitle: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: 20,
    lineHeight: 26,
    marginTop: Space.md,
    marginBottom: Space.xs,
  },
  heroFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.md,
    marginTop: Space.lg,
  },
  section: {
    gap: Space.md,
  },
  upcomingList: {
    gap: 0,
  },
  upcomingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.md,
    paddingHorizontal: 0,
    paddingVertical: Space.lg,
  },
  upcomingBody: {
    flexShrink: 1,
    alignItems: 'flex-start',
  },
  upcomingTitle: {
    marginTop: Space.sm,
  },
  upcomingCount: {
    alignItems: 'center',
    minWidth: 40,
  },
  upcomingNumber: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: 18,
    lineHeight: 22,
  },
  upcomingNumberLabel: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: 11,
    marginTop: 1,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
  },
  emptyState: {
    paddingVertical: Space.lg,
  },
  // Presses compress slightly to confirm the tap. Nothing moves while idle.
  pressed: {
    transform: [{ scale: 0.98 }],
  },
  quietEmpty: {
    gap: Space.md,
  },
  classList: {
    borderTopWidth: 1,
  },
  classRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Space.md,
    minHeight: 60,
    paddingVertical: Space.md,
  },
  classRowBody: {
    flex: 1,
    gap: 1,
    minWidth: 0,
  },
  classRowAction: {
    paddingVertical: Space.xs,
  },
  buddyRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Space.md,
    minHeight: 60,
    paddingVertical: Space.md,
  },
  buddyCopy: {
    flex: 1,
    gap: 1,
    minWidth: 0,
  },
});
