import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SessionCard } from '@/components/session-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BadgeChip } from '@/components/ui/BadgeChip';
import { Button } from '@/components/ui/Button';
import { CourseChip } from '@/components/ui/CourseChip';
import { EmptyState } from '@/components/ui/EmptyState';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { track } from '@/lib/analytics';
import { subscribeToAuthState } from '@/lib/auth';
import {
  getLocations,
  getProfilesByIds,
  getUpcomingSessions,
  getUserProfile,
  joinSession,
  type StudySession,
} from '@/lib/firestore';
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
  const [joiningSessionId, setJoiningSessionId] = useState('');
  const normalizedRequestedClass = requestedClassId?.trim().toUpperCase() ?? '';

  const visibleSessions = sessions;

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
          locationName: locationsById.get(session.locationId)?.name ?? session.locationId,
        }))
      );
      setStatus(
        loadedSessions.length > 0
          ? normalizedRequestedClass
            ? `Loaded ${loadedSessions.length} upcoming session${
                loadedSessions.length === 1 ? '' : 's'
              } for ${normalizedRequestedClass}.`
            : `Loaded ${loadedSessions.length} upcoming session${
                loadedSessions.length === 1 ? '' : 's'
              }.`
          : 'No upcoming sessions yet.'
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load sessions right now.';
      setStatus(message);
    } finally {
      setIsLoading(false);
    }
  }, [isFilteredToMyClasses, normalizedRequestedClass, profileClasses]);

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
        track('session_joined', {
          ...(joinedSession ? { classId: joinedSession.classId } : {}),
        });
        setStatus('Joined session successfully.');
        Alert.alert('Joined Session', 'You were added to the session participant list.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to join this session right now.';
      setStatus(message);
      Alert.alert('Join Session Error', message);
    } finally {
      setJoiningSessionId('');
    }
  }

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: palette.background }]}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}>
      <ThemedView
        style={[
          styles.hero,
          { backgroundColor: palette.hero },
        ]}>
        <ThemedText style={[styles.eyebrow, { color: palette.tint }]}>Sessions</ThemedText>
        <ThemedText type="title" style={styles.heroTitle}>
          Available Sessions
        </ThemedText>
        <ThemedText style={styles.heroText}>
          Browse sessions students have already created and join one that fits your class and time.
        </ThemedText>
      </ThemedView>

      <ThemedView
        style={[
          styles.card,
          { backgroundColor: palette.surface, borderColor: palette.border },
        ]}>
        <View style={styles.sectionHeader}>
          <ThemedText style={styles.sectionLabel}>Overview</ThemedText>
          <BadgeChip label={`${visibleSessions.length} open`} tone="moss" />
        </View>
        <ThemedText type="subtitle">
          {normalizedRequestedClass
            ? `Browse ${normalizedRequestedClass} sessions`
            : 'Browse and join a session'}
        </ThemedText>
        <ThemedText style={styles.statusText}>{status}</ThemedText>
        {!normalizedRequestedClass && profileClasses.length > 0 ? (
          <View style={styles.chipRow}>
            <CourseChip
              code="My classes"
              selected={!showAllClasses}
              onPress={() => setShowAllClasses(false)}
            />
            <CourseChip
              code="All classes"
              selected={showAllClasses}
              onPress={() => setShowAllClasses(true)}
            />
          </View>
        ) : null}
        {normalizedRequestedClass ? (
          <Button
            label="Show All Sessions"
            variant="secondary"
            fullWidth
            onPress={() => router.replace('/sessions')}
          />
        ) : null}
        <Button
          label="Refresh Sessions"
          variant="secondary"
          fullWidth
          loading={isLoading}
          onPress={loadSessions}
        />
      </ThemedView>

      {visibleSessions.length > 0 ? (
        visibleSessions.map((session) => {
          const isParticipant = currentUser ? session.participantIds.includes(currentUser.uid) : false;
          const isFull = session.status === 'full';

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
        })
      ) : (
        <EmptyState
          headline={
            normalizedRequestedClass
              ? `No ${normalizedRequestedClass} sessions yet`
              : 'No sessions yet'
          }
          body={
            normalizedRequestedClass
              ? `Create a ${normalizedRequestedClass} study session first, or come back later to join one.`
              : 'Create a study session first, then come back here to join it.'
          }
          actionLabel={
            normalizedRequestedClass ? `Create ${normalizedRequestedClass} session` : undefined
          }
          onAction={
            normalizedRequestedClass
              ? () =>
                  router.push({
                    pathname: '/create-session',
                    params: { classId: normalizedRequestedClass },
                  })
              : undefined
          }
        />
      )}
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
    borderRadius: 24,
    gap: 10,
    padding: 24,
  },
  eyebrow: {
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  heroText: {
    lineHeight: 30,
    maxWidth: 420,
  },
  heroTitle: {
    marginBottom: 4,
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
  statusText: {
    opacity: 0.82,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
});
