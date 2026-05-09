import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { subscribeToAuthState } from '@/lib/auth';
import {
  getOrCreateDirectConversation,
  getPotentialMatch,
  getSessionsForClassIds,
  joinSession,
  type AvailabilitySlot,
  type PotentialMatch,
  type StudySessionListItem,
} from '@/lib/firestore';
import type { User } from 'firebase/auth';

function formatTime(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours % 12 === 0 ? 12 : hours % 12;
  return `${displayHour}:${mins.toString().padStart(2, '0')} ${period}`;
}

function formatAvailabilitySlot(slot: AvailabilitySlot) {
  if (slot.date) {
    const date = new Date(`${slot.date}T12:00:00`);
    return `${date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      weekday: 'short',
    })} · ${formatTime(slot.startMinutes)}-${formatTime(slot.endMinutes)}`;
  }

  const formattedDay = slot.day.charAt(0).toUpperCase() + slot.day.slice(1);
  return `${formattedDay} ${formatTime(slot.startMinutes)}-${formatTime(slot.endMinutes)}`;
}

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

export default function MatchDetailScreen() {
  const { userId } = useLocalSearchParams<{ userId?: string }>();
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [match, setMatch] = useState<PotentialMatch | null>(null);
  const [relatedSessions, setRelatedSessions] = useState<StudySessionListItem[]>([]);
  const [status, setStatus] = useState('Loading match details...');
  const [isLoading, setIsLoading] = useState(true);
  const [joiningSessionId, setJoiningSessionId] = useState('');
  const [isOpeningChat, setIsOpeningChat] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeToAuthState((user) => {
      setCurrentUser(user);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    async function loadMatchDetail() {
      if (!currentUser || !userId) {
        setMatch(null);
        setRelatedSessions([]);
        setStatus('Sign in to view this match.');
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        const loadedMatch = await getPotentialMatch(currentUser.uid, userId);

        if (!loadedMatch) {
          setMatch(null);
          setRelatedSessions([]);
          setStatus('This match is no longer available.');
          return;
        }

        const loadedSessions = await getSessionsForClassIds(loadedMatch.sharedClasses);
        const filteredSessions = loadedSessions.filter(
          (session) => session.hostId === loadedMatch.user.uid || session.participantIds.includes(loadedMatch.user.uid)
        );

        setMatch(loadedMatch);
        setRelatedSessions(filteredSessions);
        setStatus(
          filteredSessions.length > 0
            ? `Found ${filteredSessions.length} session${filteredSessions.length === 1 ? '' : 's'} that already involve this match.`
            : 'No shared sessions yet. You can still create one for a class you both share.'
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unable to load this match right now.';
        setStatus(message);
      } finally {
        setIsLoading(false);
      }
    }

    loadMatchDetail();
  }, [currentUser, userId]);

  async function handleJoinSession(sessionId: string) {
    if (!currentUser) {
      Alert.alert('Sign In Required', 'Sign in before joining a session.');
      return;
    }

    try {
      setJoiningSessionId(sessionId);
      await joinSession(sessionId, currentUser.uid);
      const loadedMatch = await getPotentialMatch(currentUser.uid, userId ?? '');
      const loadedSessions = loadedMatch
        ? await getSessionsForClassIds(loadedMatch.sharedClasses)
        : [];
      const filteredSessions = loadedMatch
        ? loadedSessions.filter(
            (session) =>
              session.hostId === loadedMatch.user.uid ||
              session.participantIds.includes(loadedMatch.user.uid)
          )
        : [];

      setMatch(loadedMatch);
      setRelatedSessions(filteredSessions);
      setStatus('Joined session successfully.');
      Alert.alert('Joined Session', 'You were added to the session participant list.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to join this session right now.';
      setStatus(message);
      Alert.alert('Join Session Error', message);
    } finally {
      setJoiningSessionId('');
    }
  }

  async function handleOpenConversation() {
    if (!currentUser || !match) {
      return;
    }

    try {
      setIsOpeningChat(true);
      const conversationId = await getOrCreateDirectConversation(currentUser.uid, match.user.uid);
      router.push({
        pathname: '/conversation/[conversationId]',
        params: {
          conversationId,
          otherUserId: match.user.uid,
          otherUserName: match.user.displayName || '',
          otherUserEmail: match.user.email,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to open chat right now.';
      Alert.alert('Chat Error', message);
    } finally {
      setIsOpeningChat(false);
    }
  }

  const primaryClass = match?.sharedClasses[0] ?? '';

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: palette.background }]}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}>
      <ThemedView style={[styles.hero, { backgroundColor: palette.hero }]}>
        <ThemedText style={[styles.eyebrow, { color: palette.tint }]}>Match To Session</ThemedText>
        <ThemedText type="title" style={styles.heroTitle}>
          {match?.user.displayName || 'Study Match'}
        </ThemedText>
        <ThemedText style={styles.heroText}>
          Turn a promising match into an actual study plan by joining a shared session or creating
          one around a class you both already have in common.
        </ThemedText>
      </ThemedView>

      <ThemedView style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <View style={styles.sectionHeader}>
          <ThemedText style={styles.sectionLabel}>Overview</ThemedText>
          <View style={[styles.statusPill, { backgroundColor: palette.surfaceMuted }]}>
            <ThemedText type="defaultSemiBold">
              {relatedSessions.length} session{relatedSessions.length === 1 ? '' : 's'}
            </ThemedText>
          </View>
        </View>
        <ThemedText type="subtitle">Shared study context</ThemedText>
        <ThemedText style={styles.statusText}>{status}</ThemedText>
      </ThemedView>

      {match ? (
        <>
          <ThemedView
            style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <ThemedText style={styles.sectionLabel}>Shared classes</ThemedText>
            <View style={styles.chipRow}>
              {match.sharedClasses.map((classCode) => (
                <ThemedView
                  key={classCode}
                  style={[styles.chip, { backgroundColor: palette.surfaceMuted, borderColor: palette.outline }]}>
                  <ThemedText type="defaultSemiBold">{classCode}</ThemedText>
                </ThemedView>
              ))}
            </View>

            <ThemedText style={styles.sectionLabel}>Availability overlap</ThemedText>
            <View style={styles.chipRow}>
              {match.availabilityOverlap.map((slot) => (
                <ThemedView
                  key={`${slot.day}-${slot.startMinutes}-${slot.endMinutes}`}
                  style={[
                    styles.chip,
                    styles.wideChip,
                    { backgroundColor: palette.surfaceMuted, borderColor: palette.outline },
                  ]}>
                  <ThemedText type="defaultSemiBold">{formatAvailabilitySlot(slot)}</ThemedText>
                </ThemedView>
              ))}
            </View>

            <View style={styles.actionColumn}>
              <Pressable
                onPress={handleOpenConversation}
                style={[styles.secondaryButton, { borderColor: palette.outline, opacity: isOpeningChat ? 0.6 : 1 }]}>
                {isOpeningChat ? (
                  <ActivityIndicator color={palette.text} />
                ) : (
                  <ThemedText type="defaultSemiBold">Message {match.user.displayName || 'This Match'}</ThemedText>
                )}
              </Pressable>
              <Pressable
                onPress={() =>
                  router.push({
                    pathname: '/create-session',
                    params: { classId: primaryClass },
                  })
                }
                style={[styles.primaryButton, { backgroundColor: palette.tint }]}>
                <ThemedText lightColor="#ffffff" darkColor="#ffffff" type="defaultSemiBold">
                  Create {primaryClass} Session
                </ThemedText>
              </Pressable>
            </View>
          </ThemedView>

          <ThemedView
            style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <View style={styles.sectionHeader}>
              <ThemedText style={styles.sectionLabel}>Relevant sessions</ThemedText>
              {primaryClass ? (
                <Pressable onPress={() => router.push({ pathname: '/sessions', params: { classId: primaryClass } })}>
                  <ThemedText type="defaultSemiBold" style={{ color: palette.tint }}>
                    See all {primaryClass}
                  </ThemedText>
                </Pressable>
              ) : null}
            </View>

            {isLoading ? (
              <ActivityIndicator color={palette.text} />
            ) : relatedSessions.length > 0 ? (
              relatedSessions.map((session) => {
                const isParticipant = currentUser
                  ? session.participantIds.includes(currentUser.uid)
                  : false;
                const isJoining = joiningSessionId === session.sessionId;

                return (
                  <ThemedView
                    key={session.sessionId}
                    style={[
                      styles.sessionCard,
                      { backgroundColor: palette.background, borderColor: palette.outline },
                    ]}>
                    <View style={styles.sectionHeader}>
                      <ThemedText style={styles.sectionLabel}>{session.classId}</ThemedText>
                      <View style={[styles.statusPill, { backgroundColor: palette.badge }]}>
                        <ThemedText type="defaultSemiBold">{session.status}</ThemedText>
                      </View>
                    </View>
                    <ThemedText type="defaultSemiBold">{session.title}</ThemedText>
                    <ThemedText style={styles.statusText}>
                      {session.location?.name ?? session.locationId}
                    </ThemedText>
                    <ThemedText style={styles.statusText}>
                      {formatSessionTime(session.startTime)} to {formatSessionTime(session.endTime)}
                    </ThemedText>
                    <ThemedText style={styles.statusText}>
                      Host: {session.hostProfile?.displayName || session.hostEmail || session.hostId}
                    </ThemedText>

                    <View style={styles.actionRow}>
                      <Pressable
                        disabled={isParticipant || isJoining}
                        onPress={() => handleJoinSession(session.sessionId)}
                        style={[
                          styles.compactPrimaryButton,
                          {
                            backgroundColor: isParticipant ? '#8F7D78' : palette.tint,
                            opacity: isJoining ? 0.6 : 1,
                          },
                        ]}>
                        {isJoining ? (
                          <ActivityIndicator color="#ffffff" />
                        ) : (
                          <ThemedText lightColor="#ffffff" darkColor="#ffffff" type="defaultSemiBold">
                            {isParticipant ? 'Joined' : 'Join'}
                          </ThemedText>
                        )}
                      </Pressable>

                      <Pressable
                        onPress={() => router.push(`/session/${session.sessionId}`)}
                        style={[styles.compactSecondaryButton, { borderColor: palette.outline }]}>
                        <ThemedText type="defaultSemiBold">Details</ThemedText>
                      </Pressable>
                    </View>
                  </ThemedView>
                );
              })
            ) : (
              <ThemedText style={styles.statusText}>
                No session with this match yet. Create one and send them the time you both already
                overlap on.
              </ThemedText>
            )}
          </ThemedView>
        </>
      ) : (
        <ThemedView style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <ThemedText type="subtitle">Match unavailable</ThemedText>
          <ThemedText>This match may have changed after profile updates.</ThemedText>
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
  sessionCard: {
    borderRadius: 18,
    borderWidth: 1,
    gap: 10,
    padding: 16,
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
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 36,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  wideChip: {
    minHeight: 44,
  },
  actionColumn: {
    gap: 10,
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
    minHeight: 52,
    paddingHorizontal: 16,
  },
  compactPrimaryButton: {
    alignItems: 'center',
    borderRadius: 14,
    flex: 1,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 16,
  },
  compactSecondaryButton: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 16,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
});
