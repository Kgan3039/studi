import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/ui/Avatar';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { IconButton } from '@/components/ui/IconButton';
import { Brand, Colors, FontFamily, Radius, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { track } from '@/lib/analytics';
import { subscribeToAuthState } from '@/lib/auth';
import {
  blockUser,
  getBlockedUserIds,
  getConversationPartner,
  isBlockedByUser,
  sendDirectMessage,
  subscribeToConversationMessages,
  unblockUser,
  type ConversationMessage,
} from '@/lib/firestore';
import type { User } from 'firebase/auth';

function toDate(value: unknown): Date | null {
  if (!value || typeof value !== 'object' || !('toDate' in value)) {
    return null;
  }
  return (value as { toDate: () => Date }).toDate();
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
  if (!value || typeof value !== 'object' || !('toDate' in value)) {
    return '';
  }

  const date = (value as { toDate: () => Date }).toDate();
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

export default function ConversationScreen() {
  const router = useRouter();
  const { conversationId, otherUserId, otherUserName } = useLocalSearchParams<{
    conversationId?: string;
    otherUserId?: string;
    otherUserName?: string;
  }>();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState('Loading conversation...');
  const [isSending, setIsSending] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const isRefreshingRef = useRef(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [blockedUserIds, setBlockedUserIds] = useState<string[]>([]);
  const [isBlockedByOther, setIsBlockedByOther] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [isBlocking, setIsBlocking] = useState(false);
  // Opening from a notification or push link carries no name/id params, so the
  // thread resolves its own partner rather than falling back to "Student".
  const [resolvedPartner, setResolvedPartner] = useState<{
    userId: string;
    name: string;
  } | null>(null);

  const partnerName = otherUserName?.trim() || resolvedPartner?.name || '';
  const partnerId = otherUserId || resolvedPartner?.userId || '';

  useEffect(() => {
    let cancelled = false;

    if (!currentUser || !conversationId || (otherUserName?.trim() && otherUserId)) {
      return;
    }

    getConversationPartner(conversationId, currentUser.uid)
      .then((partner) => {
        if (cancelled || !partner) {
          return;
        }
        setResolvedPartner({
          userId: partner.userId,
          name: partner.profile?.displayName?.trim() || '',
        });
      })
      .catch(() => {
        // Keep the generic label rather than blocking the thread on a failed
        // profile read — messages still load and send.
      });

    return () => {
      cancelled = true;
    };
  }, [conversationId, currentUser, otherUserId, otherUserName]);

  useEffect(() => {
    const unsubscribe = subscribeToAuthState((user) => {
      setCurrentUser(user);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!currentUser || !conversationId) {
      return;
    }

    const unsubscribe = subscribeToConversationMessages(conversationId, (loadedMessages) => {
      setMessages(loadedMessages);
      if (isRefreshingRef.current) {
        isRefreshingRef.current = false;
        setIsRefreshing(false);
      }
      setStatus(
        loadedMessages.length > 0
          ? `Chatting with ${partnerName || 'Student'}.`
          : `Start the conversation with ${partnerName || 'Student'}.`
      );
    });

    return unsubscribe;
  }, [conversationId, currentUser, partnerName, refreshNonce]);

  useEffect(() => {
    async function loadBlocks() {
      if (!currentUser) {
        setBlockedUserIds([]);
        setIsBlockedByOther(false);
        isRefreshingRef.current = false;
        setIsRefreshing(false);
        return;
      }

      const [loadedBlockedUserIds, blockedByOther] = await Promise.all([
        getBlockedUserIds(currentUser.uid),
        partnerId ? isBlockedByUser(currentUser.uid, partnerId) : false,
      ]);
      setBlockedUserIds(loadedBlockedUserIds);
      setIsBlockedByOther(blockedByOther);
    }

    loadBlocks();
  }, [currentUser, partnerId, refreshNonce]);

  async function handleSendMessage() {
    if (!currentUser || !conversationId) {
      return;
    }

    try {
      setIsSending(true);
      await sendDirectMessage(conversationId, currentUser.uid, draft);
      setDraft('');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to send message right now.';
      setStatus(message);
      Alert.alert('Message Error', message);
    } finally {
      setIsSending(false);
    }
  }

  async function handleBlockUser() {
    if (!currentUser || !partnerId) {
      return;
    }

    try {
      setIsBlocking(true);
      await blockUser(currentUser.uid, partnerId);
      track('user_blocked', { context: 'conversation' });
      setBlockedUserIds((currentIds) => [...new Set([...currentIds, partnerId])]);
      setConfirmBlock(false);
      router.replace('/messages');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to block this user.';
      Alert.alert('Block Error', message);
    } finally {
      setIsBlocking(false);
    }
  }

  async function handleUnblockUser() {
    if (!currentUser || !partnerId) {
      return;
    }

    try {
      await unblockUser(currentUser.uid, partnerId);
      track('user_unblocked', { context: 'conversation' });
      setBlockedUserIds((currentIds) => currentIds.filter((id) => id !== partnerId));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to unblock this user.';
      Alert.alert('Unblock Error', message);
    }
  }

  async function handleRefresh() {
    if (!currentUser || !conversationId) {
      return;
    }

    setStatus(`Refreshing ${partnerName || 'Student'}...`);
    isRefreshingRef.current = true;
    setIsRefreshing(true);
    setRefreshNonce((value) => value + 1);
  }

  const hasBlockedOther = !!partnerId && blockedUserIds.includes(partnerId);
  const isMessagingDisabled = hasBlockedOther || isBlockedByOther;
  const canSend = !isSending && !isMessagingDisabled && draft.trim().length > 0;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
      style={[styles.screen, { backgroundColor: palette.background }]}>
      {/* Identity strip under the nav header — sans-only utility surface. */}
      <View style={[styles.identityBar, { borderBottomColor: palette.border }]}>
        <Avatar name={partnerName || 'Student'} size="sm" verified />
        <View style={styles.identityText}>
          <Text style={[TypeScale.bodyStrong, { color: palette.text }]} numberOfLines={1}>
            {partnerName || 'Student'}
          </Text>
          <Text style={[TypeScale.caption, { color: palette.icon }]} numberOfLines={1}>
            {status}
          </Text>
        </View>
        {/* Grouped so the two safety actions sit together at the same rhythm as
            every other header action row in the app. */}
        <View style={styles.identityActions}>
          <IconButton
            accessibilityLabel={`Report ${partnerName || 'student'}`}
            icon="exclamationmark.triangle"
            onPress={() =>
              router.push({
                pathname: '/report-user',
                params: {
                  reportedUserId: partnerId,
                  reportedUserName: partnerName,
                  context: 'conversation',
                },
              })
            }
          />
          {!isBlockedByOther ? (
            <IconButton
              accessibilityLabel={
                hasBlockedOther
                  ? `Unblock ${partnerName || 'student'}`
                  : `Block ${partnerName || 'student'}`
              }
              icon="nosign"
              onPress={hasBlockedOther ? handleUnblockUser : () => setConfirmBlock(true)}
              tone={hasBlockedOther ? 'accent' : 'default'}
            />
          ) : null}
        </View>
      </View>

      <ScrollView
        style={styles.thread}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={palette.tint} />
        }
        contentContainerStyle={styles.threadContent}>
        {messages.length > 0 ? (
          messages.map((message, index) => {
            const isCurrentUser = currentUser?.uid === message.senderId;
            const nextMessage = messages[index + 1];
            const showTime =
              !nextMessage || (currentUser?.uid === nextMessage.senderId) !== isCurrentUser;
            const messageDate = toDate(message.createdAt);
            const previousDate = index > 0 ? toDate(messages[index - 1].createdAt) : null;
            const showDaySeparator =
              !!messageDate &&
              (!previousDate || previousDate.toDateString() !== messageDate.toDateString());

            return (
              <View
                key={message.messageId}
                style={[styles.messageGroup, isCurrentUser ? styles.mine : styles.theirs]}>
                {showDaySeparator ? (
                  <Text style={[styles.daySeparator, { color: palette.icon }]}>
                    {formatDaySeparator(messageDate)}
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
                  <Text
                    style={[
                      styles.bubbleText,
                      { color: isCurrentUser ? '#FFFFFF' : palette.text },
                    ]}>
                    {message.text}
                  </Text>
                </View>
                {showTime ? (
                  <Text style={[styles.bubbleTime, { color: palette.icon }]}>
                    {formatTimestamp(message.createdAt)}
                  </Text>
                ) : null}
              </View>
            );
          })
        ) : (
          <View style={styles.emptyThread}>
            <Text style={[styles.emptyHeadline, { color: palette.text }]}>Start the conversation</Text>
            <Text style={[TypeScale.body, styles.emptyBody, { color: palette.icon }]}>
              Ask what to bring or where everyone is meeting.
            </Text>
          </View>
        )}
      </ScrollView>

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
            { backgroundColor: palette.surfaceMuted, opacity: isMessagingDisabled ? 0.55 : 1 },
          ]}>
          <TextInput
            editable={!isSending && !isMessagingDisabled}
            multiline
            onChangeText={setDraft}
            placeholder={
              hasBlockedOther
                ? 'This user is blocked.'
                : isBlockedByOther
                  ? 'Messaging unavailable.'
                  : 'Message…'
            }
            placeholderTextColor={colorScheme === 'dark' ? '#8A8174' : Brand.textSubtle}
            style={[styles.composerInput, { color: palette.text }]}
            value={draft}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send message"
            disabled={!canSend}
            onPress={handleSendMessage}
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
      <ConfirmDialog
        visible={confirmBlock}
        title={`Block ${partnerName || 'this student'}?`}
        body="They won't be able to message you, and you won't see them in attendee lists."
        confirmLabel="Block"
        loading={isBlocking}
        onConfirm={handleBlockUser}
        onCancel={() => setConfirmBlock(false)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
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
    minWidth: 0,
  },
  identityActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 0,
    gap: Space.xs,
  },
  thread: {
    flex: 1,
  },
  threadContent: {
    gap: Space.xs + 2,
    padding: Space.lg,
    paddingBottom: Space.xl,
  },
  messageGroup: {
    gap: Space.xs,
  },
  daySeparator: {
    alignSelf: 'center',
    fontFamily: FontFamily.bodySemiBold,
    fontSize: 11,
    lineHeight: 14,
    marginVertical: Space.sm,
    textAlign: 'center',
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
