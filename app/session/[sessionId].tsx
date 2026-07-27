import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
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
import { IconButton } from '@/components/ui/IconButton';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ScreenTransition } from '@/components/ui/ScreenTransition';
import { SuccessToast, useSuccessToast } from '@/components/ui/Toast';
import {
    Brand,
    Colors,
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
    ConversationQuotaError,
    getBlockedUserIds,
    getOrCreateDirectConversation,
    getSessionById,
    getSessionChatLastReadAt,
    hasUnreadSessionChat,
    isGroupChatAvailable,
    isSessionAtCapacity,
    joinSession,
    leaveSession,
    SessionFullError,
    type StudySessionListItem,
} from '@/lib/firestore';
import { getStudyLocationDisplayName } from '@/lib/catalog';
import { FirebaseError } from 'firebase/app';
import type { User } from 'firebase/auth';
import type { Timestamp } from 'firebase/firestore';

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
  const [chatLastReadAt, setChatLastReadAt] = useState<Timestamp | null>(null);
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

  // Refresh the chat read marker every time the screen regains focus, so the
  // unread dot clears right after coming back from the chat.
  useFocusEffect(
    useCallback(() => {
      if (!currentUser || !sessionId) {
        setChatLastReadAt(null);
        return;
      }

      let cancelled = false;
      getSessionChatLastReadAt(currentUser.uid, sessionId)
        .then((lastReadAt) => {
          if (!cancelled) {
            setChatLastReadAt(lastReadAt);
          }
        })
        .catch(() => {
          // Indicator-only data; a failed read just leaves the dot conservative.
        });

      return () => {
        cancelled = true;
      };
    }, [currentUser, sessionId])
  );

  function openSessionChat(source: 'session_detail' | 'auto_join') {
    if (!sessionId) {
      return;
    }

    router.push({
      pathname: '/session-chat/[sessionId]',
      params: { sessionId, source },
    } as unknown as Href);
  }

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
        // Land new members in the group chat so coordination starts right away.
        openSessionChat('auto_join');
      }
    } catch (error) {
      // Lost the race for the last seat: reload so the Full state renders,
      // and report it as a fact rather than a failure.
      if (error instanceof SessionFullError) {
        if (session) {
          track('session_join_blocked_full', { classId: session.classId });
        }
        await loadSession();
        setStatus(error.message);
        Alert.alert('Session Full', error.message);
        return;
      }
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
      // Only the quota error carries approved user-facing copy. Everything else
      // — permission-denied, network, internal Firebase errors — collapses to
      // one fixed string, matching app/user/[userId].tsx: a raw error.message
      // could leak internals, and a distinguishable failure would hint at
      // whether the host has blocked you.
      Alert.alert(
        'Chat Error',
        error instanceof ConversationQuotaError
          ? error.message
          : 'Unable to open chat right now.'
      );
    } finally {
      setIsOpeningHostChat(false);
    }
  }

  const isParticipant = currentUser && session
    ? session.participantIds.includes(currentUser.uid)
    : false;
  const isHost = currentUser && session ? session.hostId === currentUser.uid : false;
  // Oversized legacy sessions (past the group-chat fanout ceiling) get a
  // read-only chat — no unread dot, and the card says so.
  const isChatAvailable = !!session && isGroupChatAvailable(session);
  const hasUnreadChat =
    !!currentUser &&
    !!session &&
    isParticipant &&
    isChatAvailable &&
    hasUnreadSessionChat(session, currentUser.uid, chatLastReadAt);
  const visibleAttendees = session
    ? session.attendeeProfiles.filter((attendee) => !blockedUserIds.includes(attendee.uid))
    : [];
  // Full is derived from capacity (host included); the legacy manual
  // status === 'full' still counts for pre-capacity sessions.
  const isFull =
    session?.status === 'full' || (!!session && isSessionAtCapacity(session));
  const isCancelled = session?.status === 'cancelled';
  const hostName = formatDisplayName(session?.hostProfile?.displayName);
  // Seat math uses the true participant count — blocked users still occupy
  // seats even though they're hidden from the attendee list below.
  const goingCount = session?.participantIds.length ?? 0;
  const capacity = session?.capacity;
  const spotsLeft =
    typeof capacity === 'number' ? Math.max(capacity - goingCount, 0) : undefined;
  const goingHeading =
    typeof capacity === 'number' ? `Going (${goingCount} of ${capacity})` : `Going (${goingCount})`;
  const joinStatusLabel = isParticipant
    ? 'You’re going'
    : isCancelled
      ? 'Session cancelled'
      : isFull
        ? 'Full'
        : spotsLeft !== undefined
          ? `${spotsLeft} ${spotsLeft === 1 ? 'spot' : 'spots'} left`
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
  // The course chip already names the class, so a title like
  // "COMP SCI 400 Study Session" would repeat it — show just the rest
  // ("Study Session"). Custom titles without the class prefix pass through.
  const locationDisplayName = session
    ? getStudyLocationDisplayName(session.locationId, session.location?.name)
    : '';
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
          <ScreenTransition style={styles.transition}>
            <View style={styles.heroBlock}>
              <View style={styles.metaRow}>
                <IconSymbol color={palette.tint} name="mappin.and.ellipse" size={17} />
                <Text
                  style={[TypeScale.meta, styles.metaText, { color: palette.icon }]}
                  numberOfLines={1}>
                  {locationDisplayName}
                  {session.location?.campusArea ? `, ${session.location.campusArea}` : ''}
                </Text>
              </View>
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

            <View
              style={[
                styles.card,
                { borderColor: palette.border },
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
                    Host, verified UW student
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

            {isParticipant ? (
              <View
                style={[
                  styles.card,
                  { borderColor: palette.border },
                ]}>
                <View style={styles.chatRow}>
                  <View style={styles.chatText}>
                    <View style={styles.chatTitleRow}>
                      <Text style={[TypeScale.bodyStrong, { color: palette.text }]}>
                        Session chat
                      </Text>
                      {hasUnreadChat ? (
                        <View
                          accessibilityLabel="Unread messages"
                          style={[styles.unreadDot, { backgroundColor: palette.tint }]}
                        />
                      ) : null}
                    </View>
                    <Text style={[TypeScale.caption, { color: palette.icon }]} numberOfLines={1}>
                      {!isChatAvailable
                        ? 'Chat is unavailable for sessions this large.'
                        : hasUnreadChat
                          ? 'New messages from your group.'
                          : 'Coordinate with everyone going.'}
                    </Text>
                  </View>
                  <Button
                    label="Open chat"
                    variant="secondary"
                    size="sm"
                    onPress={() => openSessionChat('session_detail')}
                  />
                </View>
              </View>
            ) : null}

            <View
              style={[
                styles.card,
                { borderColor: palette.border },
              ]}>
              <View style={styles.attendanceHeader}>
                <Text style={[TypeScale.sectionTitle, { color: palette.text }]}>
                  {goingHeading}
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
                <IconSymbol color={Brand.success} name="lock.shield.fill" size={16} />
                <Text style={[TypeScale.caption, { color: palette.icon }]}>
                  All attendees are verified UW students
                </Text>
              </View>
            </View>

            <View
              style={[
                styles.card,
                { borderColor: palette.border },
              ]}>
              <Text style={[TypeScale.sectionTitle, { color: palette.text }]}>House rules</Text>
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

            <View
              style={[
                styles.tileRow,
                { borderBottomColor: palette.border, borderTopColor: palette.border },
              ]}>
              {[
                { label: dateTileLabel, value: timeTileValue },
                { label: 'Duration', value: durationLabel },
                {
                  label: 'Going',
                  value:
                    typeof capacity === 'number' ? `${goingCount} of ${capacity}` : `${goingCount}`,
                },
              ].map((tile, index) => (
                <View
                  key={tile.label}
                  style={[
                    styles.tile,
                    index > 0 ? { borderLeftColor: palette.border, borderLeftWidth: 1 } : null,
                  ]}>
                  <Text style={[TypeScale.meta, { color: palette.icon }]}>{tile.label}</Text>
                  <Text style={[TypeScale.bodyStrong, { color: palette.text }]}>{tile.value}</Text>
                </View>
              ))}
            </View>

            <View
              style={[
                styles.card,
                { borderColor: palette.border },
              ]}>
              <Text style={[TypeScale.sectionTitle, { color: palette.text }]}>Location</Text>
              <Text style={[TypeScale.heading, { color: palette.text }]}>
                {locationDisplayName}
              </Text>
              <Text style={[TypeScale.body, { color: palette.icon }]}>
                {session.location?.building ?? 'Campus location'}
                {', '}
                {session.location?.campusArea ?? 'UW Madison'}
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
                        locationName: locationDisplayName,
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
              <IconButton
                accessibilityLabel="Refresh session"
                disabled={isLoading || isRefreshing}
                icon="arrow.clockwise"
                loading={isLoading || isRefreshing}
                onPress={handleRefresh}
              />
            </View>
          </ScreenTransition>
        ) : (
          <View
            style={[
              styles.card,
              { borderColor: palette.border },
            ]}>
            {isLoading ? (
              <ActivityIndicator color={palette.tint} />
            ) : (
              <>
                <Text style={[styles.emptyHeadline, { color: palette.text }]}>
                  Session not found
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
              <Button
                disabled
                fullWidth
                icon="checkmark.circle.fill"
                label="Going"
                size="lg"
                variant="success"
              />
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
  transition: {
    gap: Space.lg,
  },
  heroBlock: {
    gap: Space.sm + 2,
  },
  metaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Space.sm,
  },
  metaText: {
    flex: 1,
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
    borderBottomWidth: 1,
    borderTopWidth: 1,
    flexDirection: 'row',
  },
  tile: {
    flex: 1,
    alignItems: 'center',
    gap: Space.xs,
    paddingVertical: Space.lg,
    paddingHorizontal: Space.sm,
  },
  card: {
    borderBottomWidth: 1,
    gap: Space.sm + 2,
    paddingHorizontal: 0,
    paddingVertical: Space.lg,
  },
  hostRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
  chatRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Space.md,
  },
  chatText: {
    flex: 1,
    gap: 2,
  },
  chatTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Space.sm,
  },
  unreadDot: {
    borderRadius: Radius.pill,
    height: 8,
    width: 8,
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
  ctaStack: {
    gap: Space.xs,
  },
});
