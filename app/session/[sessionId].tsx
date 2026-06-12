import { useCallback, useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatSessionWindow } from '@/components/session-card';
import { Avatar } from '@/components/ui/Avatar';
import { BadgeChip } from '@/components/ui/BadgeChip';
import { Button } from '@/components/ui/Button';
import { CourseChip } from '@/components/ui/CourseChip';
import {
  Brand,
  Colors,
  Elevation,
  FontFamily,
  Radius,
  Space,
  TypeScale,
} from '@/constants/theme';
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
  const isFull = session?.status === 'full';
  const isCancelled = session?.status === 'cancelled';
  const hostName = formatDisplayName(session?.hostProfile?.displayName);

  const startDate = session?.startTime.toDate();
  const dateTileLabel = startDate
    ? startDate.toDateString() === new Date().toDateString()
      ? 'Today'
      : startDate.toLocaleDateString('en-US', { weekday: 'short' })
    : '';
  const dateTileValue = startDate
    ? startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '';
  const timeTileValue = startDate
    ? startDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : '';

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={[styles.content, { paddingTop: Space.lg }]}>
        {session ? (
          <>
            <View style={styles.heroBlock}>
              <View style={styles.heroChipRow}>
                <CourseChip code={session.classId} size="lg" />
                {isCancelled ? (
                  <BadgeChip label="Cancelled" tone="neutral" />
                ) : isFull ? (
                  <BadgeChip label="Full" tone="neutral" />
                ) : null}
              </View>
              <Text style={[styles.heroTitle, { color: palette.text }]}>{session.title}</Text>
              <Text style={[TypeScale.body, { color: palette.icon }]} numberOfLines={1}>
                {formatSessionWindow(session.startTime, session.endTime)}
                {session.location?.name ? ` · ${session.location.name}` : ''}
              </Text>
            </View>

            <View style={styles.tileRow}>
              {[
                { label: dateTileLabel, value: dateTileValue },
                { label: 'Starts', value: timeTileValue },
                {
                  label: 'Going',
                  value: `${visibleAttendees.length || session.participantIds.length}`,
                },
              ].map((tile) => (
                <View
                  key={tile.label}
                  style={[
                    styles.tile,
                    Elevation.e1,
                    { backgroundColor: palette.surface, borderColor: palette.border },
                  ]}>
                  <Text style={[TypeScale.eyebrow, { color: palette.icon }]}>{tile.label}</Text>
                  <Text style={[TypeScale.bodyStrong, { color: palette.text }]}>{tile.value}</Text>
                </View>
              ))}
            </View>

            <View
              style={[
                styles.card,
                Elevation.e1,
                { backgroundColor: palette.surface, borderColor: palette.border },
              ]}>
              <View style={styles.hostRow}>
                <Avatar name={hostName} size="lg" verified />
                <View style={styles.hostText}>
                  <Text style={[TypeScale.bodyStrong, { color: palette.text }]} numberOfLines={1}>
                    {hostName}
                  </Text>
                  <Text style={[TypeScale.caption, { color: palette.icon }]}>
                    Host · Verified UW student
                  </Text>
                </View>
                <Button
                  label="Message"
                  variant="secondary"
                  size="sm"
                  loading={isOpeningHostChat}
                  onPress={handleOpenHostChat}
                />
              </View>
            </View>

            <View
              style={[
                styles.card,
                Elevation.e1,
                { backgroundColor: palette.surface, borderColor: palette.border },
              ]}>
              <Text style={[TypeScale.eyebrow, { color: palette.icon }]}>Where</Text>
              <Text style={[TypeScale.heading, { color: palette.text }]}>
                {session.location?.name ?? session.locationId}
              </Text>
              <Text style={[TypeScale.body, { color: palette.icon }]}>
                {session.location?.building ?? 'Campus location'}
                {' · '}
                {session.location?.campusArea ?? 'UW–Madison'}
              </Text>
              {session.location?.notes ? (
                <Text style={[TypeScale.caption, { color: palette.icon }]}>
                  {session.location.notes}
                </Text>
              ) : null}
              {session.location ? (
                <Button
                  label="Rate this spot"
                  variant="ghost"
                  size="sm"
                  onPress={() =>
                    router.push({
                      pathname: '/rate-location',
                      params: {
                        locationId: session.locationId,
                        locationName: session.location?.name ?? session.locationId,
                      },
                    })
                  }
                />
              ) : null}
            </View>

            <View
              style={[
                styles.card,
                Elevation.e1,
                { backgroundColor: palette.surface, borderColor: palette.border },
              ]}>
              <Text style={[TypeScale.eyebrow, { color: palette.icon }]}>
                Going ({visibleAttendees.length})
              </Text>
              {visibleAttendees.length > 0 ? (
                <View style={styles.attendeeList}>
                  {visibleAttendees.map((attendee) => {
                    const isHost = attendee.uid === session.hostId;

                    return (
                      <View key={attendee.uid} style={styles.attendeeRow}>
                        <Avatar
                          name={formatDisplayName(attendee.displayName)}
                          size="md"
                          verified
                        />
                        <Text
                          style={[TypeScale.body, styles.attendeeName, { color: palette.text }]}
                          numberOfLines={1}>
                          {formatDisplayName(attendee.displayName)}
                        </Text>
                        {isHost ? (
                          <Text style={[TypeScale.caption, { color: palette.icon }]}>host</Text>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              ) : (
                <Text style={[TypeScale.body, { color: palette.icon }]}>
                  Be the first at the table.
                </Text>
              )}
              <View style={styles.verifiedRow}>
                <View style={[styles.verifiedDot, { backgroundColor: Brand.success }]} />
                <Text style={[TypeScale.caption, { color: palette.icon }]}>
                  All attendees are verified UW students
                </Text>
              </View>
            </View>

            <View style={styles.statusRow}>
              <Text style={[TypeScale.caption, styles.statusText, { color: palette.icon }]}>
                {status}
              </Text>
              <Pressable
                accessibilityRole="button"
                disabled={isLoading}
                onPress={loadSession}
                style={({ pressed }) => ({ opacity: pressed || isLoading ? 0.5 : 1 })}>
                {isLoading ? (
                  <ActivityIndicator size="small" color={palette.tint} />
                ) : (
                  <Text style={[TypeScale.label, { color: palette.tint }]}>Refresh</Text>
                )}
              </Pressable>
            </View>
          </>
        ) : (
          <View
            style={[
              styles.card,
              Elevation.e1,
              { backgroundColor: palette.surface, borderColor: palette.border },
            ]}>
            {isLoading ? (
              <ActivityIndicator color={palette.tint} />
            ) : (
              <>
                <Text style={[styles.emptyHeadline, { color: palette.text }]}>
                  Something went off-script.
                </Text>
                <Text style={[TypeScale.body, { color: palette.icon }]}>
                  The session may have been removed, or the link is no longer valid.
                </Text>
              </>
            )}
          </View>
        )}
      </ScrollView>

      {session ? (
        <View
          style={[
            styles.bottomBar,
            {
              backgroundColor: palette.surface,
              borderTopColor: palette.border,
              paddingBottom: Math.max(insets.bottom, Space.md),
            },
          ]}>
          {isParticipant ? (
            <Button label="✓ Going" variant="success" size="lg" fullWidth />
          ) : (
            <Button
              label={isFull ? 'Session full' : 'Join session'}
              size="lg"
              fullWidth
              loading={isJoining}
              disabled={isFull || isCancelled}
              onPress={handleJoinSession}
            />
          )}
        </View>
      ) : null}
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
    paddingBottom: Space.xxl,
  },
  heroBlock: {
    gap: Space.sm + 2,
  },
  heroChipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.sm,
  },
  heroTitle: {
    fontFamily: FontFamily.serifItalic,
    fontSize: 30,
    lineHeight: 36,
  },
  tileRow: {
    flexDirection: 'row',
    gap: Space.sm,
  },
  tile: {
    flex: 1,
    alignItems: 'center',
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth * 2,
    gap: Space.xs,
    paddingVertical: Space.md,
    paddingHorizontal: Space.sm,
  },
  card: {
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth * 2,
    gap: Space.sm + 2,
    padding: Space.lg + 4,
  },
  hostRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
  hostText: {
    flex: 1,
    gap: 2,
  },
  attendeeList: {
    gap: Space.md,
  },
  attendeeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Space.md,
  },
  attendeeName: {
    flexShrink: 1,
  },
  verifiedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm - 2,
    marginTop: Space.xs,
  },
  verifiedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Space.md,
    justifyContent: 'space-between',
  },
  statusText: {
    flexShrink: 1,
  },
  emptyHeadline: {
    fontFamily: FontFamily.serifItalic,
    fontSize: 24,
    lineHeight: 30,
  },
  bottomBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Space.lg + 4,
    paddingTop: Space.md,
  },
});
