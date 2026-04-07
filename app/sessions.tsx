import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet } from 'react-native';

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
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
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
      contentContainerStyle={styles.content}>
      <ThemedView
        style={[
          styles.hero,
          { backgroundColor: colorScheme === 'dark' ? '#1f3035' : '#eef7fa' },
        ]}>
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
          { borderColor: colorScheme === 'dark' ? '#2c3b42' : '#d7e8ef' },
        ]}>
        <ThemedText type="subtitle">Status</ThemedText>
        <ThemedText>{status}</ThemedText>
        <Pressable
          onPress={loadSessions}
          style={[
            styles.refreshButton,
            {
              borderColor: colorScheme === 'dark' ? '#35515b' : '#c8dbe2',
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
                { borderColor: colorScheme === 'dark' ? '#2c3b42' : '#d7e8ef' },
              ]}>
              <ThemedText type="subtitle">{session.title}</ThemedText>
              <ThemedText>{session.classId}</ThemedText>
              <ThemedText>{session.location?.name ?? session.locationId}</ThemedText>
              <ThemedText>
                {formatSessionTime(session.startTime)} to {formatSessionTime(session.endTime)}
              </ThemedText>
              <ThemedText>Host: {session.hostEmail || session.hostId}</ThemedText>
              <ThemedText>
                Participants: {session.participantIds.length}
              </ThemedText>

              <Pressable
                disabled={isParticipant || isJoining}
                onPress={() => handleJoinSession(session.sessionId)}
                style={[
                  styles.primaryButton,
                  {
                    backgroundColor: isParticipant ? '#9aa6ab' : palette.tint,
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
            </ThemedView>
          );
        })
      ) : (
        <ThemedView
          style={[
            styles.card,
            { borderColor: colorScheme === 'dark' ? '#2c3b42' : '#d7e8ef' },
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
    gap: 16,
    padding: 20,
  },
  hero: {
    borderRadius: 24,
    padding: 24,
  },
  heroText: {
    maxWidth: 420,
  },
  heroTitle: {
    marginBottom: 12,
  },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    gap: 12,
    padding: 20,
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
