import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import {
  MessageActionOverlays,
  MessageEditedIndicator,
  MessageReactionBadge,
  MessageSelectionBar,
  MessageSelectionTarget,
} from '@/components/ui/MessageActions';
import { SuccessToast, useSuccessToast } from '@/components/ui/Toast';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Brand, Colors, FontFamily, Radius, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useMessageActions } from '@/hooks/use-message-actions';
import { track } from '@/lib/analytics';
import { subscribeToAuthState } from '@/lib/auth';
import { ObjectionableContentError } from '@/lib/content-moderation';
import {
  createSessionMessageId,
  getBlockedUserIds,
  getEarlierSessionMessages,
  getProfilesByIds,
  getSessionById,
  isGroupChatAvailable,
  keepSessionChat,
  markSessionChatRead,
  MAX_GROUP_CHAT_PARTICIPANTS,
  SESSION_CHAT_GRACE_PERIOD_MS,
  sendSessionMessage,
  subscribeToKeptSessionChats,
  subscribeToSessionMessages,
  type KeptSessionChat,
  type SessionMessage,
  type StudySessionListItem,
  type UserProfile,
} from '@/lib/firestore';
import { FirebaseError } from 'firebase/app';
import type { User } from 'firebase/auth';
import type { QueryDocumentSnapshot } from 'firebase/firestore';

// Analytics source for this screen open. Pushes from the notification
// pipeline navigate by bare URL (no params), so a missing param means the
// open came from a deep link rather than in-app navigation.
type ChatOpenSource = 'session_detail' | 'auto_join' | 'deeplink';

type FailedSend = {
  messageId: string;
  text: string;
  isRetrying: boolean;
};

function toDate(value: unknown): Date | null {
  if (!value || typeof value !== 'object' || !('toDate' in value)) {
    return null;
  }
  return (value as { toDate: () => Date }).toDate();
}

function toMillis(value: unknown): number {
  if (!value || typeof value !== 'object' || !('toMillis' in value)) {
    return 0;
  }
  return (value as { toMillis: () => number }).toMillis();
}

/** Compact day and time label for the first message in a day. */
function formatDaySeparator(date: Date) {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const dayLabel =
    date.toDateString() === now.toDateString()
      ? 'Today'
      : date.toDateString() === yesterday.toDateString()
        ? 'Yesterday'
        : date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return `${dayLabel}, ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

function formatTimestamp(value: unknown) {
  const date = toDate(value);
  if (!date) {
    return '';
  }

  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatCountdown(remainingMs: number) {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export default function SessionChatScreen() {
  const router = useRouter();
  const { sessionId, source } = useLocalSearchParams<{ sessionId?: string; source?: string }>();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const { toast, show: showToast } = useSuccessToast();

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [session, setSession] = useState<StudySessionListItem | null>(null);
  const [isLoadingSession, setIsLoadingSession] = useState(true);
  const [blockedUserIds, setBlockedUserIds] = useState<string[]>([]);
  // Accumulated by ID so messages that scroll out of the live listener window
  // never vanish and never gap against older pages. Live snapshots replace
  // matching entries when message text or reactions change.
  const [messagesById, setMessagesById] = useState<Map<string, SessionMessage>>(new Map());
  const [threadLoaded, setThreadLoaded] = useState(false);
  const [profilesById, setProfilesById] = useState<Map<string, UserProfile>>(new Map());
  const [failedSends, setFailedSends] = useState<FailedSend[]>([]);
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isLoadingEarlier, setIsLoadingEarlier] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [focusNonce, setFocusNonce] = useState(0);
  const [keptSessionChats, setKeptSessionChats] = useState<Map<string, KeptSessionChat>>(new Map());
  const [isKeepStateLoading, setIsKeepStateLoading] = useState(true);
  const [isKeeping, setIsKeeping] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());
  // Cursor/hasMore for paging backwards; starts from the live window's edge.
  const cursorRef = useRef<QueryDocumentSnapshot | null>(null);
  const [hasEarlier, setHasEarlier] = useState(false);
  const startedPagingRef = useRef(false);

  const isFocusedRef = useRef(false);
  const shouldTrackOpenRef = useRef(false);
  const lastMarkedMessageIdRef = useRef<string | null>(null);
  const requestedProfileIdsRef = useRef<Set<string>>(new Set());

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

  useEffect(() => {
    if (!currentUser) {
      setKeptSessionChats(new Map());
      setIsKeepStateLoading(false);
      return;
    }

    setIsKeepStateLoading(true);
    const unsubscribe = subscribeToKeptSessionChats(
      currentUser.uid,
      (loadedChats) => {
        setKeptSessionChats(loadedChats);
        setIsKeepStateLoading(false);
      },
      () => setIsKeepStateLoading(false)
    );

    return unsubscribe;
  }, [currentUser]);

  useEffect(() => {
    const sessionEndMs = session?.endTime.toMillis();
    if (!sessionEndMs) {
      return;
    }

    const graceDeadlineMs = sessionEndMs + SESSION_CHAT_GRACE_PERIOD_MS;
    const currentMs = Date.now();
    if (currentMs >= graceDeadlineMs) {
      return;
    }

    // Before a session ends, a single wake-up is enough. Once its compact
    // countdown is visible, tick only the label — never an idle chat screen.
    const delay =
      currentMs < sessionEndMs
        ? sessionEndMs - currentMs + 100
        : Math.min(1_000 - (currentMs % 1_000) + 20, graceDeadlineMs - currentMs + 20);
    const timeout = setTimeout(() => setNowMs(Date.now()), Math.max(delay, 100));

    return () => clearTimeout(timeout);
  }, [nowMs, session?.endTime]);

  useEffect(() => {
    let cancelled = false;

    async function loadSession() {
      if (!sessionId) {
        setIsLoadingSession(false);
        return;
      }

      try {
        setIsLoadingSession(true);
        const loadedSession = await getSessionById(sessionId);
        if (!cancelled) {
          setSession(loadedSession);
          if (loadedSession) {
            setProfilesById((current) => {
              const next = new Map(current);
              for (const profile of loadedSession.attendeeProfiles) {
                next.set(profile.uid, profile);
              }
              if (loadedSession.hostProfile) {
                next.set(loadedSession.hostProfile.uid, loadedSession.hostProfile);
              }
              return next;
            });
          }
        }
      } catch {
        if (!cancelled) {
          setSession(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingSession(false);
        }
      }
    }

    loadSession();
    return () => {
      cancelled = true;
    };
  }, [sessionId, retryNonce]);

  const isParticipant =
    !!currentUser && !!session && session.participantIds.includes(currentUser.uid);
  // Rules enforce every one of these states too. The expiry window is read-only
  // unless this participant chose to keep the history before it closed.
  const isCancelled = session?.status === 'cancelled';
  const isOversized = !!session && !isGroupChatAvailable(session);
  const sessionEndMs = session?.endTime.toMillis() ?? Number.POSITIVE_INFINITY;
  const graceDeadlineMs = sessionEndMs + SESSION_CHAT_GRACE_PERIOD_MS;
  const hasSessionEnded = nowMs >= sessionEndMs;
  const hasGraceExpired = nowMs >= graceDeadlineMs;
  const isKept = !!sessionId && keptSessionChats.has(sessionId);
  const isReadOnly = isCancelled || isOversized || hasGraceExpired;
  const canReadHistory = !hasGraceExpired || isKept;

  const markRead = useCallback(
    (newestMessageId: string | null) => {
      if (!currentUser || !sessionId) {
        return;
      }
      if (newestMessageId && newestMessageId === lastMarkedMessageIdRef.current) {
        return;
      }
      lastMarkedMessageIdRef.current = newestMessageId;
      markSessionChatRead(currentUser.uid, sessionId).catch(() => {
        // Best-effort: a failed marker only means the unread dot lingers.
        lastMarkedMessageIdRef.current = null;
      });
    },
    [currentUser, sessionId]
  );

  // Live window over the newest page. Local optimistic sends surface here
  // immediately (pending: true) and settle in place on ack.
  useEffect(() => {
    if (!currentUser || !sessionId || !isParticipant || !canReadHistory || isKeepStateLoading) {
      return;
    }

    const unsubscribe = subscribeToSessionMessages(
      sessionId,
      (page) => {
        setThreadLoaded(true);
        setThreadError(null);
        if (!startedPagingRef.current) {
          cursorRef.current = page.cursor;
          setHasEarlier(page.hasMore);
        }
        setMessagesById((current) => {
          const next = new Map(current);
          for (const message of page.messages) {
            next.set(message.messageId, message);
          }
          return next;
        });
        // A send that comes back acknowledged is no longer failed (retry won).
        setFailedSends((current) =>
          current.filter((failed) => !page.messages.some((m) => m.messageId === failed.messageId))
        );

        const newestFromOthers = page.messages.find((m) => m.senderId !== currentUser.uid);
        if (isFocusedRef.current && newestFromOthers) {
          markRead(newestFromOthers.messageId);
        }
      },
      () => {
        setThreadError('Messages are unavailable right now.');
      }
    );

    return unsubscribe;
  }, [
    currentUser,
    sessionId,
    isParticipant,
    canReadHistory,
    isKeepStateLoading,
    retryNonce,
    markRead,
  ]);

  // Resolve display names for senders and reactors no longer in the attendee
  // list (including people who left after sending or liking a message).
  useEffect(() => {
    const missing = [...messagesById.values()]
      .flatMap((message) => [message.senderId, ...message.likedByIds])
      .filter(
        (uid) =>
          uid
          && !blockedUserIds.includes(uid)
          && !profilesById.has(uid)
          && !requestedProfileIdsRef.current.has(uid)
      );

    if (missing.length === 0) {
      return;
    }

    for (const uid of missing) {
      requestedProfileIdsRef.current.add(uid);
    }

    getProfilesByIds([...new Set(missing)])
      .then((loaded) => {
        setProfilesById((current) => {
          const next = new Map(current);
          loaded.forEach((profile, uid) => {
            if (profile) {
              next.set(uid, profile);
            }
          });
          return next;
        });
      })
      .catch(() => {
        // Names fall back to "Student"; retry happens naturally on next mount.
      });
  }, [blockedUserIds, messagesById, profilesById]);

  useFocusEffect(
    useCallback(() => {
      isFocusedRef.current = true;
      shouldTrackOpenRef.current = true;
      // Effects don't re-run on focus alone; the nonce re-arms the one below.
      setFocusNonce((nonce) => nonce + 1);
      return () => {
        isFocusedRef.current = false;
      };
    }, [])
  );

  // session_chat_opened fires once per focus, and only once the session is
  // known (classId is a required property). Never on rerenders or sends.
  useEffect(() => {
    if (!shouldTrackOpenRef.current || !session || !isParticipant) {
      return;
    }
    shouldTrackOpenRef.current = false;

    const openSource: ChatOpenSource =
      source === 'session_detail' || source === 'auto_join' ? source : 'deeplink';
    track('session_chat_opened', { classId: session.classId, source: openSource });
    markRead(null);
  }, [session, isParticipant, source, markRead, focusNonce]);

  const actionMessages = useMemo(() => {
    const blockedIds = new Set(blockedUserIds);
    return [...messagesById.values()]
      .filter((message) => !blockedIds.has(message.senderId))
      .map((message) => ({
        ...message,
        likedByIds: message.likedByIds.filter((userId) => !blockedIds.has(userId)),
      }))
      .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
  }, [messagesById, blockedUserIds]);
  const messageActions = useMessageActions({
    allowEditing: !isReadOnly,
    allowReactions: !isReadOnly,
    allowUnsend: !isReadOnly,
    currentUserId: currentUser?.uid,
    messages: actionMessages,
    onReportMessage: (message) => {
      router.push({
        pathname: '/report-user',
        params: {
          reportedUserId: message.senderId,
          reportedUserName:
            profilesById.get(message.senderId)?.displayName.trim() || 'Student',
          context: 'session_chat',
          contentType: 'session_message',
          contentId: message.messageId,
          threadId: sessionId,
        },
      });
    },
    onSuccess: showToast,
    threadId: sessionId,
    threadType: 'session',
  });
  const visibleMessages = messageActions.hiddenMessagesReady
    ? actionMessages.filter((message) => !messageActions.hiddenMessageIds.has(message.messageId))
    : [];

  // A denied write usually means the session state changed under us (e.g.
  // the host cancelled while this screen was open) — reload the session so
  // the read-only state renders instead of an endless retry loop.
  function refreshSessionOnDenied(error: unknown) {
    if (error instanceof FirebaseError && error.code === 'permission-denied') {
      setRetryNonce((nonce) => nonce + 1);
    }
  }

  async function handleSend() {
    if (!currentUser || !sessionId || isReadOnly) {
      return;
    }

    const text = draft.trim();
    if (!text) {
      return;
    }

    const messageId = createSessionMessageId(sessionId);
    setDraft('');

    try {
      setIsSending(true);
      await sendSessionMessage(sessionId, currentUser.uid, text, messageId);
    } catch (error) {
      if (error instanceof ObjectionableContentError) {
        setDraft(text);
        Alert.alert('Message Not Sent', error.message);
        return;
      }
      // Keep the message; the bubble flips to a failed state with a retry.
      setFailedSends((current) => [{ messageId, text, isRetrying: false }, ...current]);
      refreshSessionOnDenied(error);
    } finally {
      setIsSending(false);
    }
  }

  async function handleRetry(failed: FailedSend) {
    if (!currentUser || !sessionId || failed.isRetrying || isReadOnly) {
      return;
    }

    setFailedSends((current) =>
      current.map((item) =>
        item.messageId === failed.messageId ? { ...item, isRetrying: true } : item
      )
    );

    try {
      // Same pre-generated ID: a retry can never double-send.
      await sendSessionMessage(sessionId, currentUser.uid, failed.text, failed.messageId);
      setFailedSends((current) => current.filter((item) => item.messageId !== failed.messageId));
    } catch (error) {
      setFailedSends((current) =>
        current.map((item) =>
          item.messageId === failed.messageId ? { ...item, isRetrying: false } : item
        )
      );
      refreshSessionOnDenied(error);
    }
  }

  async function handleLoadEarlier() {
    if (!sessionId || !cursorRef.current || isLoadingEarlier) {
      return;
    }

    try {
      setIsLoadingEarlier(true);
      startedPagingRef.current = true;
      const page = await getEarlierSessionMessages(sessionId, cursorRef.current);
      cursorRef.current = page.cursor;
      setHasEarlier(page.hasMore);
      setMessagesById((current) => {
        const next = new Map(current);
        for (const message of page.messages) {
          next.set(message.messageId, message);
        }
        return next;
      });
    } catch {
      // Leave hasEarlier as-is so the user can try again by scrolling.
    } finally {
      setIsLoadingEarlier(false);
    }
  }

  async function handleKeep() {
    if (
      !currentUser ||
      !sessionId ||
      isKept ||
      isKeeping ||
      !hasSessionEnded ||
      hasGraceExpired
    ) {
      return;
    }

    try {
      setIsKeeping(true);
      await keepSessionChat(currentUser.uid, sessionId);
      setKeptSessionChats((current) => {
        const next = new Map(current);
        next.set(sessionId, { keptAt: Date.now(), sessionId });
        return next;
      });
      showToast('Chat history saved', 'You can come back to it anytime.');
    } catch {
      Alert.alert("Couldn't save chat history", 'Try again before the timer ends.');
    } finally {
      setIsKeeping(false);
    }
  }

  const participantCount = session?.participantIds.length ?? 0;
  const senderName = useCallback(
    (uid: string) => profilesById.get(uid)?.displayName.trim() || 'Student',
    [profilesById]
  );

  const canSend = !isSending && !isReadOnly && draft.trim().length > 0;

  if (isLoadingSession && !session) {
    return (
      <View style={[styles.centered, { backgroundColor: palette.background }]}>
        <ActivityIndicator color={palette.tint} />
      </View>
    );
  }

  // Both of these use the shared empty state so a chat that can't open looks
  // like every other dead end in the app rather than a bare block of text.
  if (!session) {
    return (
      <View style={[styles.screen, { backgroundColor: palette.background }]}>
        <EmptyState
          icon="chat"
          headline="Chat unavailable"
          body="This session was removed or the link expired."
          actionLabel="Try again"
          onAction={() => setRetryNonce((n) => n + 1)}
        />
      </View>
    );
  }

  if (!isParticipant) {
    return (
      <View style={[styles.screen, { backgroundColor: palette.background }]}>
        <EmptyState
          icon="chat"
          headline="Join to chat"
          body="Session chat is for people who are going."
          actionLabel="View session"
          onAction={() =>
            router.push({ pathname: '/session/[sessionId]', params: { sessionId: session.sessionId } })
          }
        />
      </View>
    );
  }

  if (hasGraceExpired && isKeepStateLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: palette.background }]}>
        <ActivityIndicator color={palette.tint} />
      </View>
    );
  }

  if (hasGraceExpired && !isKept) {
    return (
      <View style={[styles.screen, { backgroundColor: palette.background }]}>
        <EmptyState
          icon="chat"
          headline="Chat expired"
          body="The two-hour window ended before this chat was saved."
          actionLabel="Back to messages"
          onAction={() => router.replace('/messages')}
        />
      </View>
    );
  }

  return (
    <>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
        style={[styles.screen, { backgroundColor: palette.background }]}>
      {/* Identity strip under the nav header — mirrors the DM conversation. */}
      <View style={[styles.identityBar, { borderBottomColor: palette.border }]}>
        <View style={styles.identityText}>
          <Text style={[TypeScale.bodyStrong, { color: palette.text }]} numberOfLines={1}>
            {session.title}
          </Text>
          <Text style={[TypeScale.caption, { color: palette.icon }]} numberOfLines={1}>
            {threadError ?? `${session.classId}, ${participantCount} going`}
          </Text>
        </View>
        <IconButton
          accessibilityLabel="View session details"
          icon="info.circle"
          onPress={() =>
            router.push({ pathname: '/session/[sessionId]', params: { sessionId: session.sessionId } })
          }
          tone="accent"
        />
      </View>

      {hasSessionEnded && !hasGraceExpired ? (
        <View
          style={[
            styles.graceNotice,
            { backgroundColor: palette.surfaceMuted, borderBottomColor: palette.border },
          ]}>
          <IconSymbol color={palette.tint} name="clock" size={18} />
          <View style={styles.graceText}>
            <Text style={[TypeScale.label, { color: palette.text }]}>Session ended</Text>
            <Text
              accessibilityLabel={`${formatCountdown(graceDeadlineMs - nowMs)} remaining to save chat history`}
              style={[TypeScale.caption, { color: palette.icon }]}
              numberOfLines={1}>
              {isKept ? 'Chat history is saved.' : `Save history in ${formatCountdown(graceDeadlineMs - nowMs)}`}
            </Text>
          </View>
          {isKept ? (
            <View
              accessibilityLabel="Chat history saved"
              style={[styles.savedBadge, { backgroundColor: `${palette.success}14` }]}>
              <IconSymbol color={palette.success} name="checkmark" size={15} />
              <Text style={[TypeScale.label, { color: palette.success }]}>Saved</Text>
            </View>
          ) : (
            <Button
              disabled={isKeepStateLoading}
              label="Keep"
              loading={isKeeping}
              onPress={handleKeep}
              size="sm"
              style={styles.keepAction}
              variant="secondary"
            />
          )}
        </View>
      ) : null}

      {isReadOnly ? (
        <View style={[styles.readOnlyNotice, { backgroundColor: palette.surfaceMuted }]}>
          <Text style={[TypeScale.caption, styles.readOnlyText, { color: palette.icon }]}>
            {hasGraceExpired
              ? 'This saved chat is now read-only.'
              : isCancelled
              ? 'This session was cancelled. Chat history is still available.'
              : `Group chat is unavailable for sessions with more than ${MAX_GROUP_CHAT_PARTICIPANTS} people.`}
          </Text>
        </View>
      ) : null}

      <FlatList
        style={styles.thread}
        inverted
        data={visibleMessages}
        keyExtractor={(message) => message.messageId}
        contentContainerStyle={styles.threadContent}
        onEndReachedThreshold={0.4}
        onEndReached={hasEarlier ? handleLoadEarlier : undefined}
        ListHeaderComponent={
          failedSends.length > 0 ? (
            // Inverted list: the header renders at the bottom, right above the
            // composer — exactly where the failed sends belong.
            <View style={styles.failedGroup}>
              {failedSends.map((failed) => (
                <View key={failed.messageId} style={[styles.messageGroup, styles.mine]}>
                  <View style={[styles.bubble, styles.mineBubble, styles.failedBubble, { backgroundColor: palette.tint }]}>
                    <Text style={[styles.bubbleText, { color: '#FFFFFF' }]}>{failed.text}</Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Retry sending message"
                    disabled={failed.isRetrying || isReadOnly}
                    onPress={() => handleRetry(failed)}
                    style={({ pressed }) => ({ opacity: pressed && !isReadOnly ? 0.6 : 1 })}>
                    <Text style={[styles.bubbleTime, { color: Brand.accent }]}>
                      {isReadOnly
                        ? 'Not sent'
                        : failed.isRetrying
                          ? 'Retrying…'
                          : 'Not sent. Tap to retry'}
                    </Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null
        }
        ListFooterComponent={
          isLoadingEarlier ? (
            <ActivityIndicator style={styles.earlierSpinner} color={palette.tint} />
          ) : null
        }
        ListEmptyComponent={
          messageActions.hiddenMessagesError ? (
            <ErrorState
              title="Unable to load this chat"
              body="Please try again."
              onRetry={messageActions.retryHiddenMessages}
              style={styles.invertedItem}
            />
          ) : threadLoaded && messageActions.hiddenMessagesReady ? (
            <View style={[styles.emptyThread, styles.invertedItem]}>
              <Text style={[styles.emptyHeadline, { color: palette.text }]}>Start the conversation</Text>
              <Text style={[TypeScale.body, styles.emptyBody, { color: palette.icon }]}>
                Coordinate seats, timing, and what to bring.
              </Text>
            </View>
          ) : (
            <ActivityIndicator style={styles.earlierSpinner} color={palette.tint} />
          )
        }
        renderItem={({ item: message, index }) => {
          const isCurrentUser = currentUser?.uid === message.senderId;
          // Newest-first data: chronological neighbors are inverted.
          const chronPrev = visibleMessages[index + 1];
          const chronNext = visibleMessages[index - 1];
          const showTime = !chronNext || chronNext.senderId !== message.senderId;
          const showSenderName =
            !isCurrentUser && (!chronPrev || chronPrev.senderId !== message.senderId);
          const messageDate = toDate(message.createdAt);
          const previousDate = chronPrev ? toDate(chronPrev.createdAt) : null;
          const showDaySeparator =
            !!messageDate &&
            (!previousDate || previousDate.toDateString() !== messageDate.toDateString());
          const isSelected = messageActions.selectedMessageIds.has(message.messageId);
          const isActive = messageActions.activeMessage?.messageId === message.messageId;
          const isUnsent = !!message.unsentAt;

          return (
            <View style={[styles.messageGroup, isCurrentUser ? styles.mine : styles.theirs]}>
              {showDaySeparator ? (
                <Text style={[styles.daySeparator, { color: palette.icon }]}>
                  {formatDaySeparator(messageDate)}
                </Text>
              ) : null}
              {showSenderName ? (
                <Text style={[styles.senderName, { color: palette.icon }]} numberOfLines={1}>
                  {senderName(message.senderId)}
                </Text>
              ) : null}
              <MessageSelectionTarget
                accessibilityLabel={isUnsent ? 'Message unsent' : message.text}
                bubbleStyle={[
                  styles.bubble,
                  message.likedByIds.length > 0 && styles.bubbleWithReaction,
                  isUnsent
                    ? [
                        styles.unsentBubble,
                        {
                          backgroundColor: palette.surfaceMuted,
                          borderColor: palette.outline,
                        },
                      ]
                    : isCurrentUser
                      ? [styles.mineBubble, { backgroundColor: palette.tint }]
                      : [
                          styles.theirsBubble,
                          {
                            backgroundColor: palette.surface,
                            borderColor: palette.border,
                            borderWidth: StyleSheet.hairlineWidth * 2,
                          },
                        ],
                  isSelected && { borderColor: palette.tint, borderWidth: 2 },
                  isActive && [
                    styles.activeBubble,
                    { backgroundColor: palette.tint, borderColor: '#FFFFFF' },
                  ],
                ]}
                onDoublePress={
                  messageActions.canReactToMessage(message)
                    ? () => void messageActions.toggleMessageLike(message)
                    : undefined
                }
                onOpenActions={() => messageActions.openMessageActions(message)}
                onToggleSelection={() =>
                  messageActions.toggleMessageSelection(message.messageId)
                }
                rowStyle={[
                  styles.messageRow,
                  isCurrentUser ? styles.messageRowMine : styles.messageRowTheirs,
                ]}
                selected={isSelected}
                selecting={messageActions.isSelecting}>
                  <Text
                    style={[
                      styles.bubbleText,
                      isUnsent && styles.unsentText,
                      {
                        color: isActive
                          ? '#FFFFFF'
                          : isUnsent
                            ? palette.icon
                            : isCurrentUser
                            ? '#FFFFFF'
                            : palette.text,
                      },
                    ]}>
                    {isUnsent ? 'Message unsent' : message.text}
                  </Text>
                  <MessageReactionBadge
                    currentUserId={currentUser?.uid}
                    likedByIds={message.likedByIds}
                    onPress={() => messageActions.showMessageLikes(message)}
                    selecting={messageActions.isSelecting}
                  />
                </MessageSelectionTarget>
              {showTime || (!!message.editedAt && !isUnsent) ? (
                <View style={styles.messageMeta}>
                  {!messageActions.isSelecting ? (
                    <MessageEditedIndicator
                      message={message}
                      onPress={() => messageActions.showOriginalMessage(message)}
                    />
                  ) : null}
                  {showTime ? (
                    <Text style={[styles.bubbleTime, { color: palette.icon }]}>
                      {message.pending ? 'Sending…' : formatTimestamp(message.createdAt)}
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </View>
          );
        }}
      />

      {messageActions.isSelecting ? (
        <MessageSelectionBar controller={messageActions} />
      ) : (
        <View
          style={[
            styles.composerBar,
            {
              borderTopColor: palette.border,
              paddingBottom: Math.max(insets.bottom, Space.md),
            },
          ]}>
          <View
            style={[
              styles.composer,
              { backgroundColor: palette.surfaceMuted, opacity: isReadOnly ? 0.55 : 1 },
            ]}>
            <TextInput
              autoCapitalize="sentences"
              editable={!isSending && !isReadOnly}
              multiline
              onChangeText={setDraft}
              placeholder={
                hasGraceExpired
                  ? 'This chat is now read-only.'
                  : isCancelled
                    ? 'This session was cancelled.'
                    : isOversized
                      ? 'Chat is unavailable for this session.'
                      : 'Message the group…'
              }
              placeholderTextColor={colorScheme === 'dark' ? '#8A8174' : Brand.textSubtle}
              style={[styles.composerInput, { color: palette.text }]}
              value={draft}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send message"
              disabled={!canSend}
              onPress={handleSend}
              style={({ pressed }) => [
                styles.sendButton,
                {
                  backgroundColor: palette.tint,
                  opacity: !canSend ? 0.4 : pressed ? 0.8 : 1,
                },
              ]}>
              {isSending ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.sendGlyph}>↑</Text>
              )}
            </Pressable>
          </View>
        </View>
      )}
      </KeyboardAvoidingView>
      <MessageActionOverlays
        controller={messageActions}
        userNameForId={(userId) =>
          userId === currentUser?.uid
            ? profilesById.get(userId)?.displayName.trim() || 'You'
            : senderName(userId)
        }
      />
      <SuccessToast toast={toast} />
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: {
    alignItems: 'center',
    flex: 1,
    gap: Space.sm,
    justifyContent: 'center',
    padding: Space.xl,
  },
  identityBar: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: Space.md,
    paddingHorizontal: Space.lg + 4,
    paddingVertical: Space.md,
  },
  identityText: {
    flex: 1,
    gap: 1,
  },
  readOnlyNotice: {
    paddingHorizontal: Space.lg,
    paddingVertical: Space.sm + 2,
  },
  readOnlyText: {
    textAlign: 'center',
  },
  graceNotice: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: Space.sm,
    paddingHorizontal: Space.lg + 4,
    paddingVertical: Space.sm + 2,
  },
  graceText: {
    flex: 1,
    gap: 1,
    minWidth: 0,
  },
  keepAction: {
    flexShrink: 0,
  },
  savedBadge: {
    alignItems: 'center',
    borderRadius: Radius.lg,
    flexDirection: 'row',
    gap: Space.xs,
    minHeight: 36,
    paddingHorizontal: Space.md,
  },
  thread: {
    flex: 1,
  },
  threadContent: {
    gap: Space.xs + 2,
    padding: Space.lg,
    paddingBottom: Space.xl,
  },
  invertedItem: {
    // ListEmptyComponent renders inside the inverted container; flip it back.
    transform: [{ scaleY: -1 }],
  },
  messageGroup: {
    gap: Space.xs,
  },
  messageRow: {
    alignItems: 'center',
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: Space.sm,
  },
  messageRowMine: {
    justifyContent: 'flex-end',
  },
  messageRowTheirs: {
    justifyContent: 'flex-start',
  },
  failedGroup: {
    gap: Space.xs + 2,
  },
  daySeparator: {
    alignSelf: 'center',
    fontFamily: FontFamily.bodySemiBold,
    fontSize: 11,
    lineHeight: 14,
    marginVertical: Space.sm,
    textAlign: 'center',
  },
  senderName: {
    fontFamily: FontFamily.bodyMedium,
    fontSize: 11,
    lineHeight: 14,
    paddingHorizontal: Space.xs,
  },
  mine: {
    alignItems: 'flex-end',
  },
  theirs: {
    alignItems: 'flex-start',
  },
  bubble: {
    borderRadius: Radius.xl - 2,
    maxWidth: '80%',
    paddingHorizontal: Space.md + 2,
    paddingVertical: Space.sm + 2,
  },
  bubbleWithReaction: {
    marginTop: Space.sm,
  },
  activeBubble: {
    borderWidth: 2,
    transform: [{ scale: 1.025 }],
    zIndex: 3,
  },
  mineBubble: {
    borderBottomRightRadius: Radius.sm - 2,
  },
  theirsBubble: {
    borderBottomLeftRadius: Radius.sm - 2,
  },
  failedBubble: {
    opacity: 0.55,
  },
  bubbleText: {
    fontFamily: FontFamily.body,
    fontSize: 14,
    lineHeight: 19,
  },
  unsentBubble: {
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  unsentText: {
    fontStyle: 'italic',
  },
  messageMeta: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Space.xs,
  },
  bubbleTime: {
    fontFamily: FontFamily.bodyMedium,
    fontSize: 10,
    lineHeight: 13,
    paddingHorizontal: Space.xs,
  },
  emptyThread: {
    alignItems: 'center',
    gap: Space.sm,
    paddingVertical: Space.xxl + 8,
  },
  emptyHeadline: {
    fontFamily: FontFamily.serifItalic,
    fontSize: 24,
    lineHeight: 30,
  },
  emptyBody: {
    maxWidth: 280,
    textAlign: 'center',
  },
  earlierSpinner: {
    paddingVertical: Space.md,
  },
  composerBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Space.lg,
    paddingTop: Space.sm + 2,
  },
  composer: {
    alignItems: 'flex-end',
    borderRadius: Radius.xxl - 4,
    flexDirection: 'row',
    gap: Space.sm,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.sm - 2,
  },
  composerInput: {
    flex: 1,
    fontFamily: FontFamily.body,
    fontSize: 15,
    lineHeight: 20,
    maxHeight: 120,
    paddingVertical: Space.sm,
  },
  sendButton: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    height: 32,
    justifyContent: 'center',
    marginBottom: Space.xs + 2,
    width: 32,
  },
  sendGlyph: {
    color: '#FFFFFF',
    fontFamily: FontFamily.bodySemiBold,
    fontSize: 16,
    lineHeight: 20,
  },
});
