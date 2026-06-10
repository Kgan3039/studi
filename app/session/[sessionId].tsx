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
  getBlockedUserIds,
  getOrCreateDirectConversation,
  getSessionById,
  joinSession,
  type StudySessionListItem,
} from '@/lib/firestore';
import type { User } from 'firebase/auth';
import type { Timestamp } from 'firebase/firestore';

function formatSessionTime(timestamp: Timestamp) {
  return timestamp.toDate().toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDisplayName(name: string | undefined) {
  if (name && name.trim().length > 0) {
    return name.trim();
  }

  return 'Student';
}

export default function SessionDetailScreen() {
  const router = useRouter();
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [blockedUserIds, setBlockedUserIds] = useState<string[]>([]);
  const [session, setSession] = useState<StudySessionListItem | null>(null);
  const [status, setStatus] = useState('Loading session details...');
  const [isLoading, setIsLoading] = useState(true);
  const [isJoining, setIsJoining] = useState(false);
  const [isOpeningHostChat, setIsOpeningHostChat] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeToAuthState((user) => {
      setCurrentUser(user);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!currentUser) {
      setBlockedUserIds([]);
      return;
    }

    getBlockedUserIds(currentUser.uid)
      .then(setBlockedUserIds)
      .catch(() => setBlockedUserIds([]));
  }, [currentUser]);

  const loadSession = useCallback(async () => {
    if (!sessionId) {
      setStatus('Session not found.');
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      const loadedSession = await getSessionById(sessionId);

      if (!loadedSession) {
        setSession(null);
        setStatus('This session no longer exists.');
        return;
      }

      setSession(loadedSession);
      setStatus('Session details loaded.');
      track('session_viewed', { classId: loadedSession.classId });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to load session details right now.';
      setStatus(message);
    } finally {
      setIsLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  async function handleJoinSession() {
    if (!sessionId) {
      return;
    }

    if (!currentUser) {
      Alert.alert('Sign In Required', 'Sign in before joining a session.');
      return;
    }

    try {
      setIsJoining(true);
      const result = await joinSession(sessionId, currentUser.uid);
      await loadSession();

      if (result === 'joined') {
        if (session) {
          track('session_joined', { classId: session.classId });
        }
        setStatus('Joined session successfully.');
        Alert.alert('Joined Session', 'You were added to the attendee list.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to join this session.';
      setStatus(message);
      Alert.alert('Join Session Error', message);
    } finally {
      setIsJoining(false);
    }
  }

  async function handleOpenHostChat() {
    if (!currentUser || !session) {
      return;
    }

    try {
      setIsOpeningHostChat(true);
      const conversationId = await getOrCreateDirectConversation(currentUser.uid, session.hostId);
      router.push({
        pathname: '/conversation/[conversationId]',
        params: {
          conversationId,
          otherUserId: session.hostId,
          otherUserName: session.hostProfile?.displayName || '',
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to open chat right now.';
      Alert.alert('Chat Error', message);
    } finally {
      setIsOpeningHostChat(false);
    }
  }

  const isParticipant = currentUser && session
    ? session.participantIds.includes(currentUser.uid)
    : false;
  const visibleAttendees = session
    ? session.attendeeProfiles.filter((attendee) => !blockedUserIds.includes(attendee.uid))
    : [];

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: palette.background }]}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}>
      <ThemedView style={[styles.hero, { backgroundColor: palette.hero }]}>
        <ThemedText style={[styles.eyebrow, { color: palette.tint }]}>Session detail</ThemedText>
        <ThemedText type="title" style={styles.heroTitle}>
          {session?.title ?? 'Study Session'}
        </ThemedText>
        <ThemedText style={styles.heroText}>
          Get the full session breakdown, see who is going, and decide whether this is the right
          study group for you.
        </ThemedText>
      </ThemedView>

      <ThemedView style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <View style={styles.sectionHeader}>
          <ThemedText style={styles.sectionLabel}>Overview</ThemedText>
          <View style={[styles.statusPill, { backgroundColor: palette.surfaceMuted }]}>
            <ThemedText type="defaultSemiBold">{session?.status ?? 'loading'}</ThemedText>
          </View>
        </View>
        <ThemedText type="subtitle">Session status</ThemedText>
        <ThemedText style={styles.metaText}>{status}</ThemedText>
        <Pressable
          onPress={loadSession}
          style={[styles.secondaryButton, { borderColor: palette.outline, opacity: isLoading ? 0.6 : 1 }]}>
          {isLoading ? (
            <ActivityIndicator color={palette.text} />
          ) : (
            <ThemedText type="defaultSemiBold">Refresh Details</ThemedText>
          )}
        </Pressable>
      </ThemedView>

      {session ? (
        <>
          <ThemedView style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <View style={styles.sectionHeader}>
              <ThemedText style={styles.sectionLabel}>At a glance</ThemedText>
              <View style={[styles.statusPill, { backgroundColor: palette.badge }]}>
                <ThemedText type="defaultSemiBold">{session.classId}</ThemedText>
              </View>
            </View>
            <ThemedText type="subtitle">{session.location?.name ?? session.locationId}</ThemedText>
            <ThemedText style={styles.metaText}>
              {formatSessionTime(session.startTime)} to {formatSessionTime(session.endTime)}
            </ThemedText>
            <ThemedText style={styles.metaText}>
              Host: {formatDisplayName(session.hostProfile?.displayName)}
            </ThemedText>
            <ThemedText style={styles.metaText}>
              Building: {session.location?.building ?? 'Campus location'}
            </ThemedText>
            <ThemedText style={styles.metaText}>
              Area: {session.location?.campusArea ?? 'UW-Madison'}
            </ThemedText>
            {session.location?.notes ? (
              <ThemedText style={styles.notesText}>{session.location.notes}</ThemedText>
            ) : null}
            <Pressable
              disabled={isOpeningHostChat}
              onPress={handleOpenHostChat}
              style={[
                styles.secondaryButton,
                { borderColor: palette.outline, opacity: isOpeningHostChat ? 0.65 : 1 },
              ]}>
              {isOpeningHostChat ? (
                <ActivityIndicator color={palette.text} />
              ) : (
                <ThemedText type="defaultSemiBold">Message Host</ThemedText>
              )}
            </Pressable>
            <Pressable
              disabled={!!isParticipant || isJoining}
              onPress={handleJoinSession}
              style={[
                styles.primaryButton,
                {
                  backgroundColor: isParticipant ? '#8F7D78' : palette.tint,
                  opacity: isJoining ? 0.65 : 1,
                },
              ]}>
              {isJoining ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <ThemedText lightColor="#ffffff" darkColor="#ffffff" type="defaultSemiBold">
                  {isParticipant ? 'You Joined This Session' : 'Join Session'}
                </ThemedText>
              )}
            </Pressable>
          </ThemedView>

          <ThemedView style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <View style={styles.sectionHeader}>
              <ThemedText style={styles.sectionLabel}>Attendees</ThemedText>
              <View style={[styles.statusPill, { backgroundColor: palette.surfaceMuted }]}>
                <ThemedText type="defaultSemiBold">
                  {visibleAttendees.length} going
                </ThemedText>
              </View>
            </View>
            <ThemedText type="subtitle">Who is already in</ThemedText>
            <View style={styles.attendeeList}>
              {visibleAttendees.map((attendee) => (
                <ThemedView
                  key={attendee.uid}
                  style={[
                    styles.attendeeCard,
                    { backgroundColor: palette.surfaceMuted, borderColor: palette.outline },
                  ]}>
                  <View style={[styles.avatar, { backgroundColor: palette.badge }]}>
                    <ThemedText type="defaultSemiBold">
                      {(attendee.displayName || 'S').slice(0, 1).toUpperCase()}
                    </ThemedText>
                  </View>
                  <View style={styles.attendeeMeta}>
                    <ThemedText type="defaultSemiBold">
                      {formatDisplayName(attendee.displayName)}
                    </ThemedText>
                  </View>
                </ThemedView>
              ))}
            </View>
          </ThemedView>
        </>
      ) : (
        <ThemedView style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <ThemedText type="subtitle">No Session Found</ThemedText>
          <ThemedText style={styles.metaText}>
            The session may have been removed, or the link is no longer valid.
          </ThemedText>
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
  heroTitle: {
    marginBottom: 4,
  },
  heroText: {
    lineHeight: 30,
    maxWidth: 420,
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
  metaText: {
    opacity: 0.8,
  },
  notesText: {
    lineHeight: 28,
    opacity: 0.9,
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 14,
    justifyContent: 'center',
    minHeight: 54,
    paddingHorizontal: 16,
  },
  secondaryButton: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: 16,
  },
  attendeeList: {
    gap: 12,
  },
  attendeeCard: {
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 14,
  },
  avatar: {
    alignItems: 'center',
    borderRadius: 999,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  attendeeMeta: {
    flex: 1,
    gap: 3,
  },
});
