import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

import { SessionCard } from '@/components/session-card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Sheet } from '@/components/ui/Sheet';
import { FilterChip } from '@/components/ui/FilterChip';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ScreenTransition } from '@/components/ui/ScreenTransition';
import { SearchBar } from '@/components/ui/SearchBar';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
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
  const [, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [joiningSessionId, setJoiningSessionId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDept, setSelectedDept] = useState<string | null>(null);
  const [todayOnly, setTodayOnly] = useState(false);
  const [openSeatsOnly, setOpenSeatsOnly] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
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
      // Hiding full sessions is the difference between a list you can act on
      // and one where the Join button is missing half the time.
      if (
        openSeatsOnly &&
        (session.status === 'full' || isSessionAtCapacity(session))
      ) {
        return false;
      }
      return true;
    });
  }, [openSeatsOnly, searchQuery, selectedDept, sessions, todayOnly]);

  const hasNarrowingFilters =
    !!searchQuery.trim() || selectedDept !== null || todayOnly || openSeatsOnly;
  // Search is its own visible control, so it isn't counted on the button.
  const activeFilterCount =
    (todayOnly ? 1 : 0) + (openSeatsOnly ? 1 : 0) + (selectedDept ? 1 : 0);

  function clearFilters() {
    setSearchQuery('');
    setSelectedDept(null);
    setTodayOnly(false);
    setOpenSeatsOnly(false);
  }

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

  const scopeOptions: { label: string; value: 'mine' | 'all' | 'requested' }[] =
    normalizedRequestedClass
      ? [
          {
            label: normalizedRequestedClass,
            value: 'requested',
          },
          {
            label: 'All sessions',
            value: 'all',
          },
        ]
      : profileClasses.length > 0
        ? [
            {
              label: 'My classes',
              value: 'mine',
            },
            {
              label: 'All sessions',
              value: 'all',
            },
          ]
        : [];
  const selectedScope: 'mine' | 'all' | 'requested' = normalizedRequestedClass
    ? 'requested'
    : showAllClasses
      ? 'all'
      : 'mine';

  function handleScopeChange(scope: 'mine' | 'all' | 'requested') {
    if (scope === 'all' && normalizedRequestedClass) {
      router.replace('/sessions');
      return;
    }

    if (scope !== 'requested') {
      setShowAllClasses(scope === 'all');
    }
  }

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <ScrollView
        style={styles.screen}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={palette.tint} />
        }
        contentContainerStyle={[styles.content, { paddingTop: insets.top + Space.md }]}>
      <ScreenHeader
        action={
          <Button
            label="Host"
            size="sm"
            loading={isNavigatingToCreateSession}
            onPress={() => handleCreateSession()}
          />
        }
        showNotifications
        title="Sessions"
        status={status}
      />

      <ScreenTransition style={styles.transition}>
      {/* Search and its filter control share a row: one balanced band instead
          of a full-width field with a small button stranded beneath it. */}
      <View style={styles.searchRow}>
        <View style={styles.searchField}>
          <SearchBar
            onChangeText={setSearchQuery}
            placeholder="Search sessions"
            value={searchQuery}
          />
        </View>
        <Pressable
          accessibilityLabel={
            activeFilterCount > 0 ? `Filters, ${activeFilterCount} applied` : 'Filters'
          }
          accessibilityRole="button"
          onPress={() => setFiltersOpen(true)}
          style={({ pressed }) => [
            styles.filterButton,
            {
              backgroundColor: activeFilterCount > 0 ? palette.tint : 'transparent',
              borderColor: activeFilterCount > 0 ? palette.tint : palette.outline,
              opacity: pressed ? 0.7 : 1,
              transform: [{ scale: pressed ? 0.96 : 1 }],
            },
          ]}>
          <IconSymbol
            color={activeFilterCount > 0 ? '#FFFFFF' : palette.icon}
            name="slider.horizontal.3"
            size={20}
          />
          {activeFilterCount > 0 ? (
            <Text style={[TypeScale.label, styles.filterCount]}>{activeFilterCount}</Text>
          ) : null}
        </Pressable>
      </View>

      {scopeOptions.length > 0 ? (
        <SegmentedControl
          accessibilityLabel="Session scope"
          onChange={handleScopeChange}
          options={scopeOptions}
          value={selectedScope}
        />
      ) : null}

      {/* A department chip per class stops scaling the moment the campus is
          using this, so filters live behind one button and the row only shows
          what is currently applied. */}
      <View style={styles.filterRow}>
        {todayOnly ? (
          <FilterChip icon="xmark" label="Today" onPress={() => setTodayOnly(false)} />
        ) : null}
        {openSeatsOnly ? (
          <FilterChip icon="xmark" label="Open seats" onPress={() => setOpenSeatsOnly(false)} />
        ) : null}
        {selectedDept ? (
          <FilterChip icon="xmark" label={selectedDept} onPress={() => setSelectedDept(null)} />
        ) : null}
      </View>

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
          onAction={clearFilters}
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
      </ScreenTransition>
      </ScrollView>

      <Sheet
        visible={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Filters"
        subtitle={`${visibleSessions.length} of ${sessions.length} sessions shown`}
        footer={
          <View style={styles.filterFooter}>
            <Button
              label="Clear all"
              variant="secondary"
              onPress={clearFilters}
              disabled={!hasNarrowingFilters}
              style={styles.filterFooterButton}
            />
            <Button
              label="Show results"
              onPress={() => setFiltersOpen(false)}
              style={styles.filterFooterButton}
            />
          </View>
        }>
        <View style={styles.filterGroup}>
          <Text style={[TypeScale.label, { color: palette.icon }]}>When</Text>
          <View style={styles.filterGroupRow}>
            <FilterChip
              icon="calendar"
              label="Today only"
              onPress={() => setTodayOnly((current) => !current)}
              selected={todayOnly}
            />
          </View>
        </View>

        <View style={styles.filterGroup}>
          <Text style={[TypeScale.label, { color: palette.icon }]}>Availability</Text>
          <View style={styles.filterGroupRow}>
            <FilterChip
              icon="person.2.fill"
              label="Open seats"
              onPress={() => setOpenSeatsOnly((current) => !current)}
              selected={openSeatsOnly}
            />
          </View>
        </View>

        {deptOptions.length > 1 ? (
          <View style={styles.filterGroup}>
            <Text style={[TypeScale.label, { color: palette.icon }]}>Department</Text>
            <View style={styles.filterGroupRow}>
              {deptOptions.map((deptCode) => (
                <FilterChip
                  key={deptCode}
                  label={deptCode}
                  onPress={() =>
                    setSelectedDept((current) => (current === deptCode ? null : deptCode))
                  }
                  selected={selectedDept === deptCode}
                />
              ))}
            </View>
          </View>
        ) : null}
      </Sheet>

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
  transition: {
    gap: Space.lg,
  },
  searchRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Space.sm,
  },
  searchField: {
    flex: 1,
  },
  filterButton: {
    alignItems: 'center',
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth * 2,
    flexDirection: 'row',
    gap: Space.xs,
    height: 48,
    justifyContent: 'center',
    paddingHorizontal: Space.md,
  },
  filterCount: {
    color: '#FFFFFF',
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
  },
  filterGroup: {
    gap: Space.sm,
  },
  filterGroupRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
  },
  filterFooter: {
    flexDirection: 'row',
    gap: Space.sm,
  },
  filterFooterButton: {
    flex: 1,
  },
  list: {
    gap: Space.md,
  },
});
