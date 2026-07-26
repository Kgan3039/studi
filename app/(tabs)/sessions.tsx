import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Pressable,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SessionCard } from '@/components/session-card';
import { CourseChip } from '@/components/ui/CourseChip';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { NotificationCenterButton } from '@/components/ui/NotificationCenterButton';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { SearchBar } from '@/components/ui/SearchBar';
import { SuccessToast, useSuccessToast } from '@/components/ui/Toast';
import { Colors, Radius, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { track } from '@/lib/analytics';
import { subscribeToAuthState } from '@/lib/auth';
import {
    getLocations,
    getProfilesByIds,
    getUpcomingSessions,
    getUserProfile,
    isSessionAtCapacity,
    joinSession,
    SessionFullError,
    type StudySession,
} from '@/lib/firestore';
import { getStudyLocationDisplayName } from '@/lib/catalog';
import { matchesSessionSearch } from '@/lib/session-search';
import type { User } from 'firebase/auth';

type SessionListEntry = StudySession & {
  hostName: string;
  locationName: string;
};

export default function SessionsScreen() {
  const router = useRouter();
  const { classId: requestedClassId } = useLocalSearchParams<{ classId?: string }>();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [profileClasses, setProfileClasses] = useState<string[]>([]);
  const [showAllClasses, setShowAllClasses] = useState(false);
  const [sessions, setSessions] = useState<SessionListEntry[]>([]);
  const [status, setStatus] = useState('Loading sessions...');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [joiningSessionId, setJoiningSessionId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDept, setSelectedDept] = useState<string | null>(null);
  const [todayOnly, setTodayOnly] = useState(false);
  const createSessionNavigationRef = useRef(false);
  const [isNavigatingToCreateSession, setIsNavigatingToCreateSession] = useState(false);
  const { toast, show: showToast } = useSuccessToast();
  const normalizedRequestedClass = requestedClassId?.trim().toUpperCase() ?? '';

  // Dept filter chips (board BrowseScreen) — derived from loaded sessions only.
  const deptOptions = useMemo(
    () =>
      [
        ...new Set(
          sessions
            .map((session) => session.classId.trim().split(/\s+/)[0]?.toUpperCase() ?? '')
            .filter(Boolean)
        ),
      ].sort(),
    [sessions]
  );

  // All filtering is client-side over the already-fetched list.
  const visibleSessions = useMemo(() => {
    const todayString = new Date().toDateString();

    return sessions.filter((session) => {
      if (
        !matchesSessionSearch(
          [session.classId, session.title, session.locationName, session.hostName],
          searchQuery
        )
      ) {
        return false;
      }
      if (
        selectedDept &&
        (session.classId.trim().split(/\s+/)[0]?.toUpperCase() ?? '') !== selectedDept
      ) {
        return false;
      }
      if (todayOnly && session.startTime.toDate().toDateString() !== todayString) {
        return false;
      }
      return true;
    });
  }, [searchQuery, selectedDept, sessions, todayOnly]);

  const hasNarrowingFilters = !!searchQuery.trim() || selectedDept !== null || todayOnly;

  useEffect(() => {
    const unsubscribe = subscribeToAuthState((user) => {
      setCurrentUser(user);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!currentUser) {
      setProfileClasses([]);
      return;
    }

    getUserProfile(currentUser.uid)
      .then((profile) => setProfileClasses(profile?.classes ?? []))
      .catch(() => setProfileClasses([]));
  }, [currentUser]);

  const isFilteredToMyClasses =
    !normalizedRequestedClass && !showAllClasses && profileClasses.length > 0;

  const loadSessions = useCallback(async () => {
    try {
      setIsLoading(true);
      const classIds = normalizedRequestedClass
        ? [normalizedRequestedClass]
        : isFilteredToMyClasses
          ? profileClasses
          : undefined;
      const [loadedSessions, locations] = await Promise.all([
        getUpcomingSessions(classIds ? { classIds } : undefined),
        getLocations(),
      ]);

      const locationsById = new Map(
        locations.map((location) => [location.locationId, location] as const)
      );
      const hostsById = await getProfilesByIds(loadedSessions.map((session) => session.hostId));

      setSessions(
        loadedSessions.map((session) => ({
          ...session,
          hostName: hostsById.get(session.hostId)?.displayName || 'Student',
          locationName: getStudyLocationDisplayName(
            session.locationId,
            locationsById.get(session.locationId)?.name
          ),
        }))
      );
      setStatus(
        loadedSessions.length > 0
          ? `${loadedSessions.length} upcoming session${loadedSessions.length === 1 ? '' : 's'}${
              normalizedRequestedClass ? ` for ${normalizedRequestedClass}` : ''
            }`
          : 'No upcoming sessions yet'
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load sessions right now.';
      setStatus(message);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [isFilteredToMyClasses, normalizedRequestedClass, profileClasses]);

  async function handleRefresh() {
    setIsRefreshing(true);
    await loadSessions();
  }

  useFocusEffect(
    useCallback(() => {
      createSessionNavigationRef.current = false;
      setIsNavigatingToCreateSession(false);
    }, [])
  );

  const handleCreateSession = useCallback(
    (classId?: string) => {
      if (createSessionNavigationRef.current) {
        return;
      }

      createSessionNavigationRef.current = true;
      setIsNavigatingToCreateSession(true);

      try {
        router.push(
          classId
            ? {
                pathname: '/create-session',
                params: { classId },
              }
            : '/create-session'
        );
      } catch {
        createSessionNavigationRef.current = false;
        setIsNavigatingToCreateSession(false);
      }
    },
    [router]
  );

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  async function handleJoinSession(sessionId: string) {
    if (!currentUser) {
      Alert.alert('Sign In Required', 'Sign in before joining a session.');
      return;
    }

    try {
      setJoiningSessionId(sessionId);
      const result = await joinSession(sessionId, currentUser.uid);
      await loadSessions();

      if (result === 'joined') {
        const joinedSession = sessions.find((session) => session.sessionId === sessionId);
        if (joinedSession) {
          track('session_joined', {
            classId: joinedSession.classId,
            participantCountAfter: joinedSession.participantIds.length + 1,
            surface: 'sessions_tab',
          });
        }
        setStatus('Joined session successfully.');
        showToast('You’re in.', joinedSession?.title ?? 'See you at the table.');
      }
    } catch (error) {
      // Final seat went to someone else moments earlier — refresh so the
      // card flips to Full, and tell the user what happened.
      if (error instanceof SessionFullError) {
        const fullSession = sessions.find((session) => session.sessionId === sessionId);
        if (fullSession) {
          track('session_join_blocked_full', { classId: fullSession.classId });
        }
        await loadSessions();
        setStatus(error.message);
        Alert.alert('Session Full', error.message);
        return;
      }
      const message = error instanceof Error ? error.message : 'Unable to join this session right now.';
      setStatus(message);
      Alert.alert('Join Session Error', message);
    } finally {
      setJoiningSessionId('');
    }
  }

  const filterOptions: { label: string; selected: boolean; onPress: () => void }[] =
    normalizedRequestedClass
      ? [
          {
            label: normalizedRequestedClass,
            selected: true,
            onPress: () => {},
          },
          {
            label: 'All classes',
            selected: false,
            onPress: () => router.replace('/sessions'),
          },
        ]
      : profileClasses.length > 0
        ? [
            {
              label: 'My classes',
              selected: !showAllClasses,
              onPress: () => setShowAllClasses(false),
            },
            {
              label: 'All classes',
              selected: showAllClasses,
              onPress: () => setShowAllClasses(true),
            },
          ]
        : [];

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <ScrollView
        style={styles.screen}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={palette.tint} />
        }
        contentContainerStyle={[styles.content, { paddingTop: insets.top + Space.md }]}>
      <ScreenHeader
        title="Sessions"
        status={status}
        action={
          <View style={styles.headerActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Refresh sessions"
              disabled={isLoading || isRefreshing}
              onPress={handleRefresh}
              style={({ pressed }) => ({
                opacity: pressed || isLoading || isRefreshing ? 0.5 : 1,
              })}>
              <View style={styles.refreshButtonContent}>
                {isLoading || isRefreshing ? (
                  <ActivityIndicator size="small" color={palette.tint} />
                ) : null}
                <Text style={[TypeScale.label, { color: palette.tint }]}>Refresh</Text>
              </View>
            </Pressable>
            <NotificationCenterButton />
          </View>
        }
      />

      <SearchBar
        onChangeText={setSearchQuery}
        placeholder="Search course, title, place, or person"
        value={searchQuery}
      />

      <View style={styles.filterRow}>
        {[
          ...filterOptions,
          {
            label: 'Today',
            selected: todayOnly,
            onPress: () => setTodayOnly((current) => !current),
          },
        ].map((option) => (
          <Pressable
            key={option.label}
            accessibilityRole="button"
            accessibilityState={{ selected: option.selected }}
            onPress={option.onPress}
            style={[
              styles.filterPill,
              option.selected
                ? { backgroundColor: palette.tint }
                : {
                    backgroundColor: palette.surface,
                    borderColor: palette.border,
                    borderWidth: StyleSheet.hairlineWidth * 2,
                  },
            ]}>
            <Text
              style={[
                TypeScale.label,
                { color: option.selected ? '#FFFFFF' : palette.icon },
              ]}>
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {deptOptions.length > 1 ? (
        <View style={styles.deptRow}>
          {deptOptions.map((deptCode) => (
            <CourseChip
              key={deptCode}
              code={deptCode}
              size="sm"
              selected={selectedDept === deptCode}
              onPress={() =>
                setSelectedDept((current) => (current === deptCode ? null : deptCode))
              }
            />
          ))}
        </View>
      ) : null}

      {sessions.length > 0 ? (
        <Button
          fullWidth
          label="Host a session"
          loading={isNavigatingToCreateSession}
          onPress={handleCreateSession}
        />
      ) : null}

      {visibleSessions.length > 0 ? (
        <View style={styles.list}>
          {visibleSessions.map((session) => {
            const isParticipant = currentUser
              ? session.participantIds.includes(currentUser.uid)
              : false;
            const isFull = session.status === 'full' || isSessionAtCapacity(session);

            return (
              <SessionCard
                key={session.sessionId}
                session={session}
                locationName={session.locationName}
                hostName={session.hostName}
                joined={isParticipant}
                joining={joiningSessionId === session.sessionId}
                onPress={() => router.push(`/session/${session.sessionId}`)}
                // No waitlist backend exists: hide Join on full sessions instead
                // of showing a Waitlist action that would always fail.
                onJoin={
                  isFull && !isParticipant ? undefined : () => handleJoinSession(session.sessionId)
                }
              />
            );
          })}
        </View>
      ) : hasNarrowingFilters && sessions.length > 0 ? (
        <EmptyState
          icon="seat"
          headline="No sessions match those filters"
          body="Try widening the time, class, or search."
          actionLabel="Clear filters"
          onAction={() => {
            setSearchQuery('');
            setSelectedDept(null);
            setTodayOnly(false);
          }}
        />
      ) : (
        <EmptyState
          icon="seat"
          headline={
            normalizedRequestedClass
              ? `No ${normalizedRequestedClass} sessions yet`
              : 'No sessions yet'
          }
          body={
            normalizedRequestedClass
              ? `Create a ${normalizedRequestedClass} session for classmates to join.`
              : 'Create a session and invite classmates to join.'
          }
          actionLabel={normalizedRequestedClass ? 'Host one' : 'Host a session'}
          onAction={() => handleCreateSession(normalizedRequestedClass || undefined)}
        />
      )}
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
    gap: Space.lg,
    padding: Space.lg + 4,
    paddingBottom: Space.xxl + 4,
  },
  headerActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Space.sm,
  },
  refreshButtonContent: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Space.xs,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
  },
  deptRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
  },
  filterPill: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md,
    minHeight: 36,
    paddingHorizontal: Space.md + 2,
    paddingVertical: Space.xs + 2,
  },
  list: {
    gap: Space.md,
  },
});
