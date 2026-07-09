import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
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

import { formatSessionWindow } from '@/components/session-card';
import { Avatar } from '@/components/ui/Avatar';
import { BadgeChip } from '@/components/ui/BadgeChip';
import { Button } from '@/components/ui/Button';
import { CourseChip } from '@/components/ui/CourseChip';
import { SuccessToast, useSuccessToast } from '@/components/ui/Toast';
import {
    Brand,
    Colors,
    deptColorFor,
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
    cancelSession,
    getBlockedUserIds,
    getOrCreateDirectConversation,
    getSessionById,
    joinSession,
    leaveSession,
    type StudySessionListItem,
} from '@/lib/firestore';
import { FirebaseError } from 'firebase/app';
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
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [isOpeningHostChat, setIsOpeningHostChat] = useState(false);
  const { toast, show: showToast } = useSuccessToast();

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
      setIsRefreshing(false);
    }
  }, [sessionId]);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  async function handleRefresh() {
    setIsRefreshing(true);
    await loadSession();
  }

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
          track('session_joined', {
            classId: session.classId,
            participantCountAfter: session.participantIds.length + 1,
            surface: 'session_detail',
          });
        }
        setStatus('Joined session successfully.');
        showToast('You’re in.', session?.title ?? 'See you at the table.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to join this session.';
      setStatus(message);
      Alert.alert('Join Session Error', message);
    } finally {
      setIsJoining(false);
    }
  }

  function describeSessionActionError(error: unknown, fallback: string) {
    if (error instanceof FirebaseError && error.code === 'permission-denied') {
      return 'You don’t have permission to do that. Refresh and try again.';
    }
    return error instanceof Error ? error.message : fallback;
  }

  async function handleLeaveSession() {
    if (!sessionId || !currentUser) {
      return;
    }

    try {
      setIsLeaving(true);
      await leaveSession(sessionId, currentUser.uid);
      await loadSession();
      if (session) {
        track('session_left', { classId: session.classId });
      }
      setStatus('You left the session.');
    } catch (error) {
      const message = describeSessionActionError(error, 'Unable to leave this session.');
      setStatus(message);
      Alert.alert('Leave Session Error', message);
    } finally {
      setIsLeaving(false);
    }
  }

  function confirmLeaveSession() {
    Alert.alert(
      'Leave session?',
      'You can rejoin later while a seat is open.',
      [
        { text: 'Stay', style: 'cancel' },
        { text: 'Leave', style: 'destructive', onPress: handleLeaveSession },
      ],
    );
  }

  async function handleCancelSession() {
    if (!sessionId) {
      return;
    }

    try {
      setIsLeaving(true);
      await cancelSession(sessionId);
      await loadSession();
      if (session) {
        track('session_cancelled', { classId: session.classId });
      }
      setStatus('Session cancelled.');
    } catch (error) {
      const message = describeSessionActionError(error, 'Unable to cancel this session.');
      setStatus(message);
      Alert.alert('Cancel Session Error', message);
    } finally {
      setIsLeaving(false);
    }
  }

  function confirmCancelSession() {
    Alert.alert(
      'Cancel session?',
      'Everyone going will see this session as cancelled. This can’t be undone.',
      [
        { text: 'Keep session', style: 'cancel' },
        { text: 'Cancel session', style: 'destructive', onPress: handleCancelSession },
      ],
    );
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
  const isHost = currentUser && session ? session.hostId === currentUser.uid : false;
  const visibleAttendees = session
    ? session.attendeeProfiles.filter((attendee) => !blockedUserIds.includes(attendee.uid))
    : [];
  const isFull = session?.status === 'full';
  const isCancelled = session?.status === 'cancelled';
  const hostName = formatDisplayName(session?.hostProfile?.displayName);
  // Capacity is not in the data model (no seat count). The board's
  // "Going (3 of 5)" / "2 left" collapses to the real going count plus the
  // open/full/cancelled status — same substitution used on Today.
  const goingCount = visibleAttendees.length || session?.participantIds.length || 0;
  const joinStatusLabel = isParticipant
    ? 'You’re going'
    : isCancelled
      ? 'Session cancelled'
      : isFull
        ? 'Session is full'
        : 'A seat is open';

  const startDate = session?.startTime.toDate();
  const endDate = session?.endTime.toDate();
  const dateTileLabel = startDate
    ? startDate.toDateString() === new Date().toDateString()
      ? 'Today'
      : startDate.toLocaleDateString('en-US', { weekday: 'short' })
    : '';
  const timeTileValue = startDate
    ? startDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : '';
  // Board DetailScreen shows a Duration tile — derived from existing times.
  const durationMinutes =
    startDate && endDate
      ? Math.max(Math.round((endDate.getTime() - startDate.getTime()) / 60000), 0)
      : 0;
  const durationLabel =
    durationMinutes <= 0
      ? '—'
      : durationMinutes < 120
        ? `${durationMinutes} min`
        : durationMinutes % 60 === 0
          ? `${durationMinutes / 60} hr`
          : `${Math.floor(durationMinutes / 60)}h ${durationMinutes % 60}m`;
  const deptTint = session ? deptColorFor(session.classId) ?? palette.text : palette.text;
  // The course chip already names the class, so a title like
  // "COMP SCI 400 Study Session" would repeat it — show just the rest
  // ("Study Session"). Custom titles without the class prefix pass through.
  const rawTitle = session?.title.trim() ?? '';
  const classPrefix = session ? `${session.classId.trim()} ` : '';
  const heroTitle =
    classPrefix.length > 1 && rawTitle.toUpperCase().startsWith(classPrefix.toUpperCase())
      ? rawTitle.slice(classPrefix.length).trim() || rawTitle
      : rawTitle;

  // Board lists three authored "house rules"; per-session rules are not in the
  // data model, so the spot's own notes + tags (the closest real guidance)
  // stand in for them.
  const houseRules = useMemo(() => {
    if (!session?.location) {
      return [];
    }

    return [session.location.notes ?? '', ...(session.location.tags ?? [])]
      .map((rule) => rule.trim())
      .filter((rule) => rule.length > 0);
  }, [session]);

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <ScrollView
        style={styles.screen}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={palette.tint} />
        }
        contentContainerStyle={[styles.content, { paddingTop: Space.sm }]}>
        {session ? (
          <>
            {/* 1. HERO — banner, course chip, title, time/location summary.
                Dept tint stands in for the location imagery the app lacks. */}
            <View
              style={[
                styles.banner,
                {
                  backgroundColor:
                    colorScheme === 'dark' ? `${deptTint}26` : `${deptTint}14`,
                },
              ]}>
              <Text style={[TypeScale.eyebrow, { color: palette.icon }]} numberOfLines={1}>
                {session.location?.name ?? session.locationId}
                {session.location?.campusArea ? ` · ${session.location.campusArea}` : ''}
              </Text>
            </View>
            <View style={styles.heroBlock}>
              <View style={styles.heroChipRow}>
                <CourseChip code={session.classId} size="lg" />
                {isCancelled ? (
                  <BadgeChip label="Cancelled" tone="neutral" />
                ) : isFull ? (
                  <BadgeChip label="Full" tone="neutral" />
                ) : null}
              </View>
              <Text style={[styles.heroTitle, { color: palette.text }]}>{heroTitle}</Text>
              {/* The banner directly above already names the spot, so the
                  meta line only carries the time window. */}
              <Text style={[TypeScale.body, { color: palette.icon }]} numberOfLines={1}>
                {formatSessionWindow(session.startTime, session.endTime)}
              </Text>
            </View>

            {/* 2. HOST — host card, reputation/stats area, message action. */}
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
                  {/* Reputation/stats area. Host rating, hosted count, and
                      show-up % are not in the data model; the verified-UW
                      trust signal is the available metric and stands in. */}
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

            {/* 3. ATTENDANCE — attendee list, capacity state, join status. */}
            <View
              style={[
                styles.card,
                Elevation.e1,
                { backgroundColor: palette.surface, borderColor: palette.border },
              ]}>
              <View style={styles.attendanceHeader}>
                <Text style={[TypeScale.eyebrow, { color: palette.icon }]}>
                  Going ({goingCount})
                </Text>
                <BadgeChip
                  label={joinStatusLabel}
                  tone={isParticipant ? 'success' : isFull || isCancelled ? 'neutral' : 'info'}
                />
              </View>
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

            {/* 4. SESSION INFORMATION — house rules + session details. */}
            <View
              style={[
                styles.card,
                Elevation.e1,
                { backgroundColor: palette.surface, borderColor: palette.border },
              ]}>
              <Text style={[TypeScale.eyebrow, { color: palette.icon }]}>House rules</Text>
              {houseRules.length > 0 ? (
                <View style={styles.ruleList}>
                  {houseRules.map((rule) => (
                    <View key={rule} style={styles.ruleRow}>
                      <View style={[styles.ruleDot, { backgroundColor: palette.tint }]} />
                      <Text style={[TypeScale.body, styles.ruleText, { color: palette.text }]}>
                        {rule}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={[TypeScale.body, { color: palette.icon }]}>
                  No house rules listed for this spot.
                </Text>
              )}
            </View>

            <View style={styles.tileRow}>
              {[
                { label: dateTileLabel, value: timeTileValue },
                { label: 'Duration', value: durationLabel },
                { label: 'Going', value: `${goingCount}` },
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

            <View style={styles.statusRow}>
              <Text style={[TypeScale.caption, styles.statusText, { color: palette.icon }]}>
                {status}
              </Text>
              <Pressable
                accessibilityRole="button"
                disabled={isLoading || isRefreshing}
                onPress={handleRefresh}
                style={({ pressed }) => ({ opacity: pressed || isLoading || isRefreshing ? 0.5 : 1 })}>
                <View style={styles.refreshButtonContent}>
                  {isLoading || isRefreshing ? (
                    <ActivityIndicator size="small" color={palette.tint} />
                  ) : null}
                  <Text style={[TypeScale.label, { color: palette.tint }]}>Refresh</Text>
                </View>
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

      {/* 5. PRIMARY CTA AREA. */}
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
          {isHost ? (
            !isCancelled ? (
              <Button
                label="Cancel session"
                variant="secondary"
                size="lg"
                fullWidth
                loading={isLeaving}
                onPress={confirmCancelSession}
              />
            ) : (
              <Button label="Session cancelled" variant="secondary" size="lg" fullWidth disabled />
            )
          ) : isParticipant ? (
            <View style={styles.ctaStack}>
              <Button label="✓ Going" variant="success" size="lg" fullWidth />
              <Button
                label="Leave session"
                variant="ghost"
                size="md"
                fullWidth
                loading={isLeaving}
                onPress={confirmLeaveSession}
              />
            </View>
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
      <SuccessToast toast={toast} bottomOffset={session ? 72 : 0} />
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
  banner: {
    borderRadius: Radius.xxl - 4,
    justifyContent: 'flex-end',
    minHeight: 96,
    padding: Space.lg,
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
  attendanceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.sm,
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
  ruleList: {
    gap: Space.sm,
  },
  ruleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Space.md,
  },
  ruleDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  ruleText: {
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
  refreshButtonContent: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Space.xs,
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
  ctaStack: {
    gap: Space.xs,
  },
});
