import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { subscribeToAuthState } from '@/lib/auth';
import { getSessions, joinSession, type StudySessionListItem } from '@/lib/firestore';
import type { User } from 'firebase/auth';

function formatSessionTime(timestamp: string) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }

  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function SessionsScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [sessions, setSessions] = useState<StudySessionListItem[]>([]);
  const [status, setStatus] = useState('Loading sessions...');
  const [isLoading, setIsLoading] = useState(true);
  const [joiningSessionId, setJoiningSessionId] = useState('');

  useEffect(() => {
    const unsubscribe = subscribeToAuthState((user) => {
      setCurrentUser(user);
    });

    return unsubscribe;
  }, []);

  async function loadSessions() {
    try {
      setIsLoading(true);
      const loadedSessions = await getSessions();
      setSessions(loadedSessions);
      setStatus(
        loadedSessions.length > 0
          ? `Loaded ${loadedSessions.length} available session${loadedSessions.length === 1 ? '' : 's'}.`
          : 'No sessions available yet.'
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load sessions right now.';
      setStatus(message);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadSessions();
  }, []);

  async function handleJoinSession(sessionId: string) {
    if (!currentUser) {
      Alert.alert('Sign In Required', 'Sign in before joining a session.');
      return;
    }

    try {
      setJoiningSessionId(sessionId);
      await joinSession(sessionId, currentUser.uid);
      setStatus('Joined session successfully.');
      await loadSessions();
      Alert.alert('Joined Session', 'You were added to the session participant list.');
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
            <ThemedText type="defaultSemiBold">{sessions.length} open</ThemedText>
          </View>
        </View>
        <ThemedText type="subtitle">Browse and join a session</ThemedText>
        <ThemedText style={styles.statusText}>{status}</ThemedText>
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

      {sessions.length > 0 ? (
        sessions.map((session) => {
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
              <ThemedText style={styles.metaText}>{session.location?.name ?? session.locationId}</ThemedText>
              <ThemedText style={styles.metaText}>
                {formatSessionTime(session.startTime)} to {formatSessionTime(session.endTime)}
              </ThemedText>
              <ThemedText style={styles.metaText}>Host: {session.hostEmail || session.hostId}</ThemedText>
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
          <ThemedText type="subtitle">No Sessions Yet</ThemedText>
          <ThemedText>Create a study session first, then come back here to join it.</ThemedText>
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
  refreshButton: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 16,
  },
});
