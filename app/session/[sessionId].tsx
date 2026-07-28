import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
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

import { Avatar } from '@/components/ui/Avatar';
import { BadgeChip } from '@/components/ui/BadgeChip';
import { Button } from '@/components/ui/Button';
import { CourseChip } from '@/components/ui/CourseChip';
import { IconSymbol } from '@/components/ui/icon-symbol';
import {
  PullToRefreshIndicator,
  usePullToRefreshDistance,
} from '@/components/ui/PullToRefreshIndicator';
import { ScreenTransition } from '@/components/ui/ScreenTransition';
import { SuccessToast, useSuccessToast } from '@/components/ui/Toast';
import { Brand, Colors, FontFamily, Radius, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { track } from '@/lib/analytics';
import { subscribeToAuthState } from '@/lib/auth';
import {
  cancelSession,
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
  const [, setStatus] = useState('Loading session details...');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [isOpeningHostChat, setIsOpeningHostChat] = useState(false);
  const [chatLastReadAt, setChatLastReadAt] = useState<Timestamp | null>(null);
  const { toast, show: showToast } = useSuccessToast();
  const { onPullScroll, pullDistance } = usePullToRefreshDistance();

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
    }, [currentUser, sessionId]),
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
    Alert.alert('Leave session?', 'You can rejoin later while a seat is open.', [
      { text: 'Stay', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: handleLeaveSession },
    ]);
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
        {
          text: 'Cancel session',
          style: 'destructive',
          onPress: handleCancelSession,
        },
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

  const isParticipant =
    currentUser && session ? session.participantIds.includes(currentUser.uid) : false;
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
  const visibleGuests = visibleAttendees.filter((attendee) => attendee.uid !== session?.hostId);
  // Full is derived from capacity (host included); the legacy manual
  // status === 'full' still counts for pre-capacity sessions.
  const isFull = session?.status === 'full' || (!!session && isSessionAtCapacity(session));
  const isCancelled = session?.status === 'cancelled';
  const hostName = formatDisplayName(session?.hostProfile?.displayName);
  // Seat math uses the true participant count — blocked users still occupy
  // seats even though they're hidden from the attendee list below.
  const goingCount = session?.participantIds.length ?? 0;
  const capacity = session?.capacity;
  const spotsLeft = typeof capacity === 'number' ? Math.max(capacity - goingCount, 0) : undefined;
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
  const sessionDayLabel = startDate
    ? startDate.toDateString() === new Date().toDateString()
      ? 'Today'
      : startDate.toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        })
    : '';
  const startTimeLabel = startDate
    ? startDate.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      })
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
  const endTimeLabel = endDate
    ? endDate.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      })
    : '';
  const scheduleLabel =
    sessionDayLabel && startTimeLabel ? `${sessionDayLabel} at ${startTimeLabel}` : 'Time pending';
  const durationSummary = endTimeLabel ? `${durationLabel} · until ${endTimeLabel}` : durationLabel;
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

  const locationTags =
    session?.location?.tags?.map((tag) => tag.trim()).filter((tag) => tag.length > 0) ?? [];
  const locationAddress = [
    session?.location?.building,
    session?.location?.campusArea ?? 'UW Madison',
  ]
    .filter(Boolean)
    .join(' · ');
  const attendeeNames = visibleGuests.map(
    (attendee) => formatDisplayName(attendee.displayName).split(' ')[0],
  );
  const attendeeSummary =
    attendeeNames.length > 3
      ? `${attendeeNames.slice(0, 3).join(', ')} +${attendeeNames.length - 3}`
      : attendeeNames.join(', ');

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <ScrollView
        style={styles.screen}
        onScroll={onPullScroll}
        refreshControl={
          <RefreshControl
            colors={['transparent']}
            progressBackgroundColor="transparent"
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor="transparent"
          />
        }
        scrollEventThrottle={16}
        contentContainerStyle={styles.content}>
        {session ? (
          <ScreenTransition style={styles.transition}>
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
              <View style={styles.heroMeta}>
                <View style={styles.metaRow}>
                  <View style={[styles.metaIcon, { backgroundColor: palette.hero }]}>
                    <IconSymbol color={palette.tint} name="calendar" size={17} />
                  </View>
                  <Text style={[TypeScale.body, styles.metaText, { color: palette.text }]}>
                    {scheduleLabel}
                  </Text>
                </View>
                <View style={styles.metaRow}>
                  <View style={[styles.metaIcon, { backgroundColor: palette.surfaceMuted }]}>
                    <IconSymbol color={palette.icon} name="clock" size={17} />
                  </View>
                  <Text style={[TypeScale.body, styles.metaText, { color: palette.text }]}>
                    {durationSummary}
                  </Text>
                </View>
                <View style={styles.metaRow}>
                  <View style={[styles.metaIcon, { backgroundColor: palette.surfaceMuted }]}>
                    <IconSymbol color={palette.icon} name="mappin.and.ellipse" size={17} />
                  </View>
                  <Text
                    style={[TypeScale.body, styles.metaText, { color: palette.text }]}
                    numberOfLines={2}>
                    {locationDisplayName}
                    {session.location?.campusArea ? ` · ${session.location.campusArea}` : ''}
                  </Text>
                </View>
              </View>
            </View>

            <View style={[styles.surfaceCard, { backgroundColor: palette.surface }]}>
              <View style={styles.hostRow}>
                {/* The row itself opens the host's profile; Message stays a
                    separate sibling tap target rather than living inside it. */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`View ${hostName}'s profile`}
                  disabled={!session?.hostId}
                  onPress={() => router.push(`/user/${session?.hostId}`)}
                  style={({ pressed }) => [styles.hostIdentity, pressed && styles.pressed]}>
                  <Avatar name={hostName} size="lg" verified />
                  <View style={styles.hostText}>
                    <Text style={[TypeScale.bodyStrong, { color: palette.text }]} numberOfLines={1}>
                      Hosted by {hostName}
                    </Text>
                    <Text style={[TypeScale.caption, { color: palette.icon }]}>
                      Verified UW student
                    </Text>
                  </View>
                </Pressable>
                {!isHost ? (
                  <Button
                    icon="message"
                    label="Message"
                    variant="secondary"
                    size="sm"
                    loading={isOpeningHostChat}
                    onPress={handleOpenHostChat}
                  />
                ) : null}
              </View>

              {isParticipant ? (
                <>
                  <View style={[styles.cardDivider, { backgroundColor: palette.border }]} />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Open session chat"
                    onPress={() => openSessionChat('session_detail')}
                    style={({ pressed }) => [styles.chatRow, pressed && styles.pressed]}>
                    <View style={[styles.metaIcon, { backgroundColor: palette.hero }]}>
                      <IconSymbol color={palette.tint} name="message.fill" size={17} />
                    </View>
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
                    <IconSymbol color={palette.icon} name="chevron.right" size={18} />
                  </Pressable>
                </>
              ) : null}
            </View>

            <View style={styles.section}>
              <View style={styles.attendanceHeader}>
                <View style={styles.sectionTitleRow}>
                  <IconSymbol color={palette.tint} name="person.2.fill" size={19} />
                  <Text style={[TypeScale.sectionTitle, { color: palette.text }]}>
                    {goingHeading}
                  </Text>
                </View>
                <BadgeChip
                  label={joinStatusLabel}
                  tone={isParticipant ? 'success' : isFull || isCancelled ? 'neutral' : 'info'}
                />
              </View>
              {visibleGuests.length > 0 ? (
                <View style={styles.attendeeSummary}>
                  <View style={styles.attendeeAvatars}>
                    {visibleGuests.slice(0, 4).map((attendee) => (
                      <Avatar
                        key={attendee.uid}
                        name={formatDisplayName(attendee.displayName)}
                        size="sm"
                        verified
                      />
                    ))}
                  </View>
                  <Text
                    style={[TypeScale.body, styles.attendeeNames, { color: palette.text }]}
                    numberOfLines={2}>
                    {attendeeSummary}
                  </Text>
                </View>
              ) : (
                <Text style={[TypeScale.body, { color: palette.icon }]}>
                  The host is currently the only attendee.
                </Text>
              )}
              <View style={styles.verifiedRow}>
                <IconSymbol color={Brand.success} name="lock.shield.fill" size={16} />
                <Text style={[TypeScale.caption, { color: palette.icon }]}>
                  All attendees are verified UW students
                </Text>
              </View>
            </View>

            <View style={[styles.surfaceCard, { backgroundColor: palette.surface }]}>
              <View style={styles.sectionTitleRow}>
                <IconSymbol color={palette.tint} name="mappin.and.ellipse" size={19} />
                <Text style={[TypeScale.sectionTitle, { color: palette.text }]}>Location</Text>
              </View>
              <View style={styles.locationCopy}>
                <Text style={[TypeScale.heading, { color: palette.text }]}>
                  {locationDisplayName}
                </Text>
                <Text style={[TypeScale.body, { color: palette.icon }]}>
                  {locationAddress || 'UW Madison'}
                </Text>
              </View>
              {session.location?.notes ? (
                <Text style={[TypeScale.body, { color: palette.text }]}>
                  {session.location.notes}
                </Text>
              ) : null}
              {locationTags.length > 0 ? (
                <View style={styles.tagRow}>
                  {locationTags.map((tag) => (
                    <BadgeChip key={tag} label={tag} tone="neutral" />
                  ))}
                </View>
              ) : null}
              {session.location ? (
                <Button
                  icon="star.fill"
                  label="Rate spot"
                  variant="ghost"
                  size="sm"
                  style={styles.rateButton}
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
          </ScreenTransition>
        ) : (
          <View style={[styles.surfaceCard, { backgroundColor: palette.surface }]}>
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
      <PullToRefreshIndicator pullDistance={pullDistance} refreshing={isRefreshing} />

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
                icon="xmark"
                label="Cancel session"
                variant="secondary"
                size="lg"
                fullWidth
                loading={isLeaving}
                onPress={confirmCancelSession}
              />
            ) : (
              <Button
                disabled
                fullWidth
                icon="xmark.circle.fill"
                label="Session cancelled"
                size="lg"
                variant="secondary"
              />
            )
          ) : isParticipant ? (
            <Button
              fullWidth
              icon="xmark"
              label="Leave session"
              loading={isLeaving}
              onPress={confirmLeaveSession}
              size="lg"
              variant="secondary"
            />
          ) : (
            <Button
              icon="plus.circle.fill"
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
    paddingBottom: Space.xxl,
    paddingHorizontal: Space.lg + 4,
    paddingTop: Space.lg,
  },
  transition: {
    gap: Space.xl,
  },
  heroBlock: {
    gap: Space.md,
  },
  heroMeta: {
    gap: Space.sm + 2,
    marginTop: Space.xs,
  },
  metaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Space.md,
    minHeight: 32,
  },
  metaIcon: {
    alignItems: 'center',
    borderRadius: Radius.md,
    height: 32,
    justifyContent: 'center',
    width: 32,
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
    fontSize: 32,
    lineHeight: 38,
  },
  surfaceCard: {
    borderRadius: Radius.xl,
    gap: Space.md,
    padding: Space.lg,
  },
  cardDivider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: Space.xs,
  },
  hostRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Space.md,
  },
  hostIdentity: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: Space.md,
    minWidth: 0,
  },
  // Confirms the tap without any continuous motion.
  pressed: {
    opacity: 0.7,
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
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Space.sm,
  },
  section: {
    gap: Space.md,
    paddingHorizontal: Space.xs,
  },
  sectionTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Space.sm,
  },
  attendeeSummary: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Space.md,
  },
  attendeeAvatars: {
    flexDirection: 'row',
    gap: Space.xs,
  },
  attendeeNames: {
    flex: 1,
  },
  locationCopy: {
    gap: 2,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
  },
  rateButton: {
    paddingHorizontal: 0,
  },
  verifiedRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Space.sm - 2,
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
