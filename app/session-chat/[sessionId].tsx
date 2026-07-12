import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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

import { Button } from '@/components/ui/Button';
import { Brand, Colors, FontFamily, Radius, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { track } from '@/lib/analytics';
import { subscribeToAuthState } from '@/lib/auth';
import {
  createSessionMessageId,
  getBlockedUserIds,
  getEarlierSessionMessages,
  getProfilesByIds,
  getSessionById,
  markSessionChatRead,
  sendSessionMessage,
  subscribeToSessionMessages,
  type SessionMessage,
  type StudySessionListItem,
  type UserProfile,
} from '@/lib/firestore';
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

/** Board ChatScreen day separator: "Today · 2:14 PM", "Mon, Jun 9 · 4:00 PM". */
function formatDaySeparator(date: Date) {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const dayLabel =
    date.toDateString() === now.toDateString()
      ? 'Today'
      : date.toDateString() === yesterday.toDateString()
        ? 'Yesterday'
        : date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return `${dayLabel} · ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
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

export default function SessionChatScreen() {
  const router = useRouter();
  const { sessionId, source } = useLocalSearchParams<{ sessionId?: string; source?: string }>();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const insets = useSafeAreaInsets();

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [session, setSession] = useState<StudySessionListItem | null>(null);
  const [isLoadingSession, setIsLoadingSession] = useState(true);
  const [blockedUserIds, setBlockedUserIds] = useState<string[]>([]);
  // Accumulated by ID so messages that scroll out of the live listener window
  // never vanish and never gap against older pages (docs are immutable).
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
    if (!currentUser || !sessionId || !isParticipant) {
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
  }, [currentUser, sessionId, isParticipant, retryNonce, markRead]);

  // Resolve display names for senders no longer in the attendee list
  // (people who left the session but whose messages remain).
  useEffect(() => {
    const missing = [...messagesById.values()]
      .map((message) => message.senderId)
      .filter(
        (uid) => uid && !profilesById.has(uid) && !requestedProfileIdsRef.current.has(uid)
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
  }, [messagesById, profilesById]);

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

  const visibleMessages = useMemo(() => {
    return [...messagesById.values()]
      .filter((message) => !blockedUserIds.includes(message.senderId))
      .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
  }, [messagesById, blockedUserIds]);

  async function handleSend() {
    if (!currentUser || !sessionId) {
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
    } catch {
      // Keep the message; the bubble flips to a failed state with a retry.
      setFailedSends((current) => [{ messageId, text, isRetrying: false }, ...current]);
    } finally {
      setIsSending(false);
    }
  }

  async function handleRetry(failed: FailedSend) {
    if (!currentUser || !sessionId || failed.isRetrying) {
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
    } catch {
      setFailedSends((current) =>
        current.map((item) =>
          item.messageId === failed.messageId ? { ...item, isRetrying: false } : item
        )
      );
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

  const participantCount = session?.participantIds.length ?? 0;
  const senderName = useCallback(
    (uid: string) => profilesById.get(uid)?.displayName.trim() || 'Student',
    [profilesById]
  );

  const canSend = !isSending && draft.trim().length > 0;

  if (isLoadingSession && !session) {
    return (
      <View style={[styles.centered, { backgroundColor: palette.background }]}>
        <ActivityIndicator color={palette.tint} />
      </View>
    );
  }

  if (!session) {
    return (
      <View style={[styles.centered, { backgroundColor: palette.background }]}>
        <Text style={[styles.emptyHeadline, { color: palette.text }]}>
          Something went off-script.
        </Text>
        <Text style={[TypeScale.body, styles.emptyBody, { color: palette.icon }]}>
          This session may have been removed, or the link is no longer valid.
        </Text>
        <Button label="Try again" variant="secondary" size="sm" onPress={() => setRetryNonce((n) => n + 1)} />
      </View>
    );
  }

  if (!isParticipant) {
    return (
      <View style={[styles.centered, { backgroundColor: palette.background }]}>
        <Text style={[styles.emptyHeadline, { color: palette.text }]}>Join to chat</Text>
        <Text style={[TypeScale.body, styles.emptyBody, { color: palette.icon }]}>
          The session chat is just for people who are going.
        </Text>
        <Button
          label="View session"
          variant="secondary"
          size="sm"
          onPress={() =>
            router.push({ pathname: '/session/[sessionId]', params: { sessionId: session.sessionId } })
          }
        />
      </View>
    );
  }

  return (
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
            {threadError ?? `${session.classId} · ${participantCount} going`}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            router.push({ pathname: '/session/[sessionId]', params: { sessionId: session.sessionId } })
          }
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
          <Text style={[TypeScale.label, { color: palette.tint }]}>Details</Text>
        </Pressable>
      </View>

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
                    disabled={failed.isRetrying}
                    onPress={() => handleRetry(failed)}
                    style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
                    <Text style={[styles.bubbleTime, { color: Brand.accent }]}>
                      {failed.isRetrying ? 'Retrying…' : 'Not sent · Tap to retry'}
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
          threadLoaded ? (
            <View style={[styles.emptyThread, styles.invertedItem]}>
              <Text style={[styles.emptyHeadline, { color: palette.text }]}>Say hi 👋</Text>
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
              <View
                style={[
                  styles.bubble,
                  isCurrentUser
                    ? [styles.mineBubble, { backgroundColor: palette.tint }]
                    : [
                        styles.theirsBubble,
                        {
                          backgroundColor: palette.surface,
                          borderColor: palette.border,
                          borderWidth: StyleSheet.hairlineWidth * 2,
                        },
                      ],
                ]}>
                <Text style={[styles.bubbleText, { color: isCurrentUser ? '#FFFFFF' : palette.text }]}>
                  {message.text}
                </Text>
              </View>
              {showTime ? (
                <Text style={[styles.bubbleTime, { color: palette.icon }]}>
                  {message.pending ? 'Sending…' : formatTimestamp(message.createdAt)}
                </Text>
              ) : null}
            </View>
          );
        }}
      />

      <View
        style={[
          styles.composerBar,
          {
            borderTopColor: palette.border,
            paddingBottom: Math.max(insets.bottom, Space.md),
          },
        ]}>
        <View style={[styles.composer, { backgroundColor: palette.surfaceMuted }]}>
          <TextInput
            editable={!isSending}
            multiline
            onChangeText={setDraft}
            placeholder="Message the group…"
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
    </KeyboardAvoidingView>
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
  failedGroup: {
    gap: Space.xs + 2,
  },
  daySeparator: {
    alignSelf: 'center',
    fontFamily: FontFamily.bodySemiBold,
    fontSize: 10,
    letterSpacing: 0.8,
    lineHeight: 13,
    marginVertical: Space.sm,
    textAlign: 'center',
    textTransform: 'uppercase',
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
