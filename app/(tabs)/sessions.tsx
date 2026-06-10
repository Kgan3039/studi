import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
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
import type { Timestamp } from 'firebase/firestore';

type SessionListEntry = StudySession & {
  hostName: string;
  locationName: string;
};

function formatSessionTime(timestamp: Timestamp) {
  return timestamp.toDate().toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

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
          <View
            style={[
              styles.statusPill,
              { backgroundColor: palette.surfaceMuted },
            ]}>
            <ThemedText type="defaultSemiBold">{visibleSessions.length} open</ThemedText>
          </View>
        </View>
        <ThemedText type="subtitle">
          {normalizedRequestedClass
            ? `Browse ${normalizedRequestedClass} sessions`
            : 'Browse and join a session'}
        </ThemedText>
        <ThemedText style={styles.statusText}>{status}</ThemedText>
        {!normalizedRequestedClass && profileClasses.length > 0 ? (
          <View style={styles.chipRow}>
            <Pressable
              onPress={() => setShowAllClasses(false)}
              style={[
                styles.chip,
                {
                  backgroundColor: !showAllClasses ? palette.tint : palette.surfaceMuted,
                  borderColor: !showAllClasses ? palette.tint : palette.outline,
                },
              ]}>
              <ThemedText
                type="defaultSemiBold"
                lightColor={!showAllClasses ? '#ffffff' : undefined}
                darkColor={!showAllClasses ? '#ffffff' : undefined}>
                My classes
              </ThemedText>
            </Pressable>
            <Pressable
              onPress={() => setShowAllClasses(true)}
              style={[
                styles.chip,
                {
                  backgroundColor: showAllClasses ? palette.tint : palette.surfaceMuted,
                  borderColor: showAllClasses ? palette.tint : palette.outline,
                },
              ]}>
              <ThemedText
                type="defaultSemiBold"
                lightColor={showAllClasses ? '#ffffff' : undefined}
                darkColor={showAllClasses ? '#ffffff' : undefined}>
                All classes
              </ThemedText>
            </Pressable>
          </View>
        ) : null}
        {normalizedRequestedClass ? (
          <Pressable
            onPress={() => router.replace('/sessions')}
            style={[styles.secondaryButton, { borderColor: palette.outline }]}>
            <ThemedText type="defaultSemiBold">Show All Sessions</ThemedText>
          </Pressable>
        ) : null}
        <Pressable
          onPress={loadSessions}
          style={[
            styles.refreshButton,
            {
              borderColor: palette.outline,
              opacity: isLoading ? 0.6 : 1,
            },
          ]}>
          {isLoading ? (
            <ActivityIndicator color={palette.text} />
          ) : (
            <ThemedText type="defaultSemiBold">Refresh Sessions</ThemedText>
          )}
        </Pressable>
      </ThemedView>

      {visibleSessions.length > 0 ? (
        visibleSessions.map((session) => {
          const isParticipant = currentUser ? session.participantIds.includes(currentUser.uid) : false;
          const isJoining = joiningSessionId === session.sessionId;

          return (
            <ThemedView
              key={session.sessionId}
              style={[
                styles.card,
                { backgroundColor: palette.surface, borderColor: palette.border },
              ]}>
              <View style={styles.sectionHeader}>
                <ThemedText style={styles.sectionLabel}>{session.classId}</ThemedText>
                <View
                  style={[
                    styles.statusPill,
                    { backgroundColor: palette.badge },
                  ]}>
                  <ThemedText type="defaultSemiBold">{session.status}</ThemedText>
                </View>
              </View>
              <ThemedText type="subtitle">{session.title}</ThemedText>
              <ThemedText style={styles.metaText}>{session.locationName}</ThemedText>
              <ThemedText style={styles.metaText}>
                {formatSessionTime(session.startTime)} to {formatSessionTime(session.endTime)}
              </ThemedText>
              <ThemedText style={styles.metaText}>Host: {session.hostName}</ThemedText>
              <ThemedText style={styles.metaText}>
                Participants: {session.participantIds.length}
              </ThemedText>

              <Pressable
                disabled={isParticipant || isJoining}
                onPress={() => handleJoinSession(session.sessionId)}
                style={[
                  styles.primaryButton,
                  {
                    backgroundColor: isParticipant ? '#8F7D78' : palette.tint,
                    opacity: isJoining ? 0.6 : 1,
                  },
                ]}>
                {isJoining ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <ThemedText lightColor="#ffffff" darkColor="#ffffff" type="defaultSemiBold">
                    {isParticipant ? 'Joined' : 'Join Session'}
                  </ThemedText>
                  )}
                </Pressable>

              <Pressable
                onPress={() => router.push(`/session/${session.sessionId}`)}
                style={[styles.secondaryButton, { borderColor: palette.outline }]}>
                <ThemedText type="defaultSemiBold">View Details</ThemedText>
              </Pressable>
            </ThemedView>
          );
        })
      ) : (
        <ThemedView
          style={[
            styles.card,
            { backgroundColor: palette.surface, borderColor: palette.border },
          ]}>
          <ThemedText type="subtitle">
            {normalizedRequestedClass ? `No ${normalizedRequestedClass} sessions yet` : 'No Sessions Yet'}
          </ThemedText>
          <ThemedText>
            {normalizedRequestedClass
              ? `Create a ${normalizedRequestedClass} study session first, or come back later to join one.`
              : 'Create a study session first, then come back here to join it.'}
          </ThemedText>
          {normalizedRequestedClass ? (
            <Pressable
              onPress={() =>
                router.push({
                  pathname: '/create-session',
                  params: { classId: normalizedRequestedClass },
                })
              }
              style={[styles.primaryButton, { backgroundColor: palette.tint }]}>
              <ThemedText lightColor="#ffffff" darkColor="#ffffff" type="defaultSemiBold">
                Create {normalizedRequestedClass} Session
              </ThemedText>
            </Pressable>
          ) : null}
        </ThemedView>
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
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  statusText: {
    opacity: 0.82,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  metaText: {
    opacity: 0.8,
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 14,
    justifyContent: 'center',
    minHeight: 52,
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
  refreshButton: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 16,
  },
});
