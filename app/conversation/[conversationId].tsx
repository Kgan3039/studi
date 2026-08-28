import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/ui/Avatar';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ErrorState } from '@/components/ui/ErrorState';
import { IconButton } from '@/components/ui/IconButton';
import { LoadingState } from '@/components/ui/LoadingState';
import {
  MessageActionOverlays,
  MessageEditedIndicator,
  MessageReactionBadge,
  MessageSelectionBar,
  MessageSelectionTarget,
} from '@/components/ui/MessageActions';
import {
  PullToRefreshIndicator,
  usePullToRefreshDistance,
} from '@/components/ui/PullToRefreshIndicator';
import { SuccessToast, useSuccessToast } from '@/components/ui/Toast';
import { Brand, Colors, FontFamily, Radius, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useMessageActions } from '@/hooks/use-message-actions';
import { ObjectionableContentError } from '@/lib/content-moderation';
import { getUserFacingErrorMessage } from '@/lib/user-facing-errors';
import { track } from '@/lib/analytics';
import { useFriendRequestCooldown } from '@/lib/friend-request-cooldown';
import {
  canAttemptFriendRequest,
  runFriendRequestSend,
} from '@/lib/friend-request-control';
import { presentFriendRequestFailure } from '@/lib/friend-request-feedback';
import { subscribeToAuthState } from '@/lib/auth';
import {
  acceptFriendRequest,
  cancelFriendRequest,
  getFriendStatus,
  removeFriend,
  sendFriendRequest,
  type FriendStatus,
} from '@/lib/friends';
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
import { getReportedUserIds } from '@/lib/reported-users';
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
  const { toast, show: showToast } = useSuccessToast();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const friendRequestCooldown = useFriendRequestCooldown(currentUser?.uid);
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
  const [confirmUnblock, setConfirmUnblock] = useState(false);
  const [isUnblocking, setIsUnblocking] = useState(false);
  const [reportedUserIds, setReportedUserIds] = useState<string[]>([]);
  const [confirmAddFriend, setConfirmAddFriend] = useState(false);
  const [confirmRemoveFriend, setConfirmRemoveFriend] = useState(false);
  const [isBlocking, setIsBlocking] = useState(false);
  const [friendStatus, setFriendStatus] = useState<FriendStatus>('none');
  const [isFriendActionPending, setIsFriendActionPending] = useState(false);
  const { onPullScroll, pullDistance } = usePullToRefreshDistance();
  // Opening from a notification or push link carries no name/id params, so the
  // thread resolves its own partner rather than falling back to "Student".
  const [resolvedPartner, setResolvedPartner] = useState<{
    userId: string;
    name: string;
  } | null>(null);

  const partnerName = otherUserName?.trim() || resolvedPartner?.name || '';
  const partnerId = otherUserId || resolvedPartner?.userId || '';
  const hasBlockedOther = !!partnerId && blockedUserIds.includes(partnerId);
  const hasReportedOther = !!partnerId && reportedUserIds.includes(partnerId);
  const isMessagingDisabled = hasBlockedOther || isBlockedByOther;
  const messageActions = useMessageActions({
    allowEditing: !isMessagingDisabled,
    allowReactions: !isMessagingDisabled,
    currentUserId: currentUser?.uid,
    messages,
    onReportMessage: (message) => {
      if (!partnerId) return;
      router.push({
        pathname: '/report-user',
        params: {
          reportedUserId: message.senderId,
          reportedUserName: partnerName,
          context: 'conversation',
          contentType: 'direct_message',
          contentId: message.messageId,
          threadId: conversationId,
        },
      });
    },
    onSuccess: showToast,
    threadId: conversationId,
    threadType: 'direct',
  });
  const visibleMessages = useMemo(
    () =>
      messageActions.hiddenMessagesReady
        ? messages.filter((message) => !messageActions.hiddenMessageIds.has(message.messageId))
        : [],
    [messageActions.hiddenMessageIds, messageActions.hiddenMessagesReady, messages]
  );
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

  useFocusEffect(
    useCallback(() => {
      let active = true;

      if (!currentUser) {
        setBlockedUserIds([]);
        setIsBlockedByOther(false);
        setFriendStatus('none');
        isRefreshingRef.current = false;
        setIsRefreshing(false);
        return () => {
          active = false;
        };
      }

      // Profile and report actions can change a block while this conversation
      // is behind an overlay. Refresh on focus so its composer and safety
      // controls never describe the old relationship.
      void Promise.all([
        getBlockedUserIds(currentUser.uid),
        partnerId ? isBlockedByUser(currentUser.uid, partnerId) : false,
      ])
        .then(([loadedBlockedUserIds, blockedByOther]) => {
          if (active) {
            setBlockedUserIds(loadedBlockedUserIds);
            setIsBlockedByOther(blockedByOther);
          }
        })
        .catch(() => {
          // Preserve the last known state if the supporting block read fails.
        });

      return () => {
        active = false;
      };
    }, [currentUser, partnerId])
  );

  useFocusEffect(
    useCallback(() => {
      let active = true;

      if (!currentUser || !partnerId) {
        setFriendStatus('none');
        return;
      }

      void getFriendStatus(currentUser.uid, partnerId)
        .then((relationship) => {
          if (active) {
            setFriendStatus(relationship);
          }
        })
        .catch(() => {
          // Messaging remains available if the relationship badge cannot load.
        });

      // Re-read on focus so the indicator is already correct when the report
      // screen closes and hands this screen back.
      void getReportedUserIds().then((ids) => {
        if (active) {
          setReportedUserIds(ids);
        }
      });

      return () => {
        active = false;
      };
    }, [currentUser, partnerId])
  );

  async function handleSendMessage() {
    if (!currentUser || !conversationId) {
      return;
    }

    try {
      setIsSending(true);
      await sendDirectMessage(conversationId, currentUser.uid, draft);
      setDraft('');
    } catch (error) {
      const message =
        error instanceof ObjectionableContentError
          ? error.message
          : getUserFacingErrorMessage(error, 'message');
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
      // Focus the existing Messages tab. `dismissTo` emits Expo Router's
      // POP_TO action, which this native Stack does not handle consistently;
      // after a block it could leave a stale conversation in the Back stack.
      // `navigate` reuses the tab route instead of appending a duplicate.
      router.navigate('/messages');
    } catch (error) {
      Alert.alert('Block Error', getUserFacingErrorMessage(error, 'conversation'));
    } finally {
      setIsBlocking(false);
    }
  }

  async function handleUnblockUser() {
    if (!currentUser || !partnerId) {
      return;
    }

    try {
      setIsUnblocking(true);
      await unblockUser(currentUser.uid, partnerId);
      track('user_unblocked', { context: 'conversation' });
      setBlockedUserIds((currentIds) => currentIds.filter((id) => id !== partnerId));
      setConfirmUnblock(false);
    } catch (error) {
      Alert.alert('Unblock Error', getUserFacingErrorMessage(error, 'conversation'));
    } finally {
      setIsUnblocking(false);
    }
  }

  async function handleFriendAction() {
    if (!currentUser || !partnerId || isFriendActionPending) {
      return;
    }

    // Adding and removing both confirm first; accepting an incoming request
    // or cancelling one you just sent doesn't need to ask again.
    if (friendStatus === 'friends') {
      setConfirmRemoveFriend(true);
      return;
    }
    if (friendStatus === 'none') {
      setConfirmAddFriend(true);
      return;
    }

    try {
      setIsFriendActionPending(true);

      if (friendStatus === 'incoming') {
        await acceptFriendRequest(currentUser.uid, partnerId);
        setFriendStatus('friends');
        track('friend_request_accepted', { source: 'conversation' });
      } else {
        await cancelFriendRequest(currentUser.uid, partnerId);
        setFriendStatus('none');
        track('friend_request_cancelled', { source: 'conversation' });
      }
    } catch (error) {
      Alert.alert('Study Buddy Error', getUserFacingErrorMessage(error, 'friend'));
    } finally {
      setIsFriendActionPending(false);
    }
  }

  async function handleConfirmAddFriend() {
    if (!currentUser || !partnerId || !canAttemptFriendRequest(currentUser.uid)) {
      return;
    }

    try {
      setIsFriendActionPending(true);
      const result = await runFriendRequestSend({
        userId: currentUser.uid,
        send: () => sendFriendRequest(currentUser.uid, partnerId),
      });
      if (result.status !== 'sent') return;
      setFriendStatus('outgoing');
      setConfirmAddFriend(false);
      track('friend_request_sent', { source: 'conversation', limiter_bound: true });
    } catch (error) {
      presentFriendRequestFailure(error);
    } finally {
      setIsFriendActionPending(false);
    }
  }

  async function handleRemoveFriend() {
    if (!currentUser || !partnerId) {
      return;
    }

    try {
      setIsFriendActionPending(true);
      await removeFriend(currentUser.uid, partnerId);
      setFriendStatus('none');
      setConfirmRemoveFriend(false);
      track('friend_removed', { source: 'conversation' });
    } catch (error) {
      Alert.alert('Study Buddy Error', getUserFacingErrorMessage(error, 'friend'));
    } finally {
      setIsFriendActionPending(false);
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

  const canSend = !isSending && !isMessagingDisabled && draft.trim().length > 0;
  const friendActionLabel =
    friendStatus === 'friends'
      ? `Remove ${partnerName || 'student'} as a study buddy`
      : friendStatus === 'incoming'
        ? `Accept ${partnerName || 'student'}'s study buddy request`
        : friendStatus === 'outgoing'
          ? `Cancel study buddy request to ${partnerName || 'student'}`
          : `Add ${partnerName || 'student'} as a study buddy`;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
      style={[styles.screen, { backgroundColor: palette.background }]}>
      {/* Identity strip under the nav header — sans-only utility surface. */}
      <View style={[styles.identityBar, { borderBottomColor: palette.border }]}>
        <Pressable
          accessibilityLabel={`View ${partnerName || 'student'}'s profile`}
          accessibilityRole="button"
          disabled={!partnerId}
          onPress={() => router.push(`/user/${partnerId}`)}
          style={({ pressed }) => [
            styles.identityProfile,
            { opacity: pressed ? 0.58 : 1 },
          ]}>
          <Avatar name={partnerName || 'Student'} size="sm" verified />
          <View style={styles.identityText}>
            <Text style={[TypeScale.bodyStrong, { color: palette.text }]} numberOfLines={1}>
              {partnerName || 'Student'}
            </Text>
            <Text style={[TypeScale.caption, { color: palette.icon }]} numberOfLines={1}>
              {status}
            </Text>
          </View>
        </Pressable>
        {/* Social action first, followed by the same safety actions used on
            public profiles. */}
        <View style={styles.identityActions}>
          {!isBlockedByOther && !hasBlockedOther && friendStatus !== 'self' ? (
            <IconButton
              accessibilityLabel={friendActionLabel}
              disabled={!partnerId}
              // Same glyph family everywhere a buddy relationship is
              // acted on (see components/ui/icon-symbol.tsx): a plus badge
              // adds, a minus badge removes. Only the badge changes.
              icon={
                friendStatus === 'friends' || friendStatus === 'outgoing'
                  ? 'person.badge.minus'
                  : 'person.badge.plus'
              }
              loading={isFriendActionPending}
              onPress={handleFriendAction}
              selected={friendStatus === 'friends' || friendStatus === 'outgoing'}
              tone={friendStatus === 'incoming' ? 'accent' : 'default'}
            />
          ) : null}
          {/* `selected` tints the control so an already-reported or
              already-blocked person is obvious at a glance, instead of the
              icons looking identical whether or not you've acted. */}
          <IconButton
            accessibilityLabel={
              hasReportedOther
                ? `${partnerName || 'Student'} reported. Report again`
                : `Report ${partnerName || 'student'}`
            }
            disabled={!partnerId}
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
            selected={hasReportedOther}
          />
          {!isBlockedByOther ? (
            <IconButton
              accessibilityLabel={
                hasBlockedOther
                  ? `${partnerName || 'Student'} blocked. Unblock them`
                  : `Block ${partnerName || 'student'}`
              }
              icon="nosign"
              onPress={() =>
                hasBlockedOther ? setConfirmUnblock(true) : setConfirmBlock(true)
              }
              selected={hasBlockedOther}
              tone={hasBlockedOther ? 'accent' : 'default'}
            />
          ) : null}
        </View>
      </View>

      <ScrollView
        style={styles.thread}
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
        contentContainerStyle={styles.threadContent}>
        {messageActions.hiddenMessagesError ? (
          <ErrorState
            title="Unable to load this conversation"
            body="Please try again."
            onRetry={messageActions.retryHiddenMessages}
          />
        ) : !messageActions.hiddenMessagesReady ? (
          <LoadingState title="Loading messages" />
        ) : visibleMessages.length > 0 ? (
          visibleMessages.map((message, index) => {
            const isCurrentUser = currentUser?.uid === message.senderId;
            const nextMessage = visibleMessages[index + 1];
            const showTime =
              !nextMessage || (currentUser?.uid === nextMessage.senderId) !== isCurrentUser;
            const messageDate = toDate(message.createdAt);
            const previousDate = index > 0 ? toDate(visibleMessages[index - 1].createdAt) : null;
            const showDaySeparator =
              !!messageDate &&
              (!previousDate || previousDate.toDateString() !== messageDate.toDateString());
            const isSelected = messageActions.selectedMessageIds.has(message.messageId);
            const isActive = messageActions.activeMessage?.messageId === message.messageId;
            const isUnsent = !!message.unsentAt;
            const isLikedByCurrentUser = !!currentUser?.uid
              && message.likedByIds.includes(currentUser.uid);

            return (
              <View
                key={message.messageId}
                style={[styles.messageGroup, isCurrentUser ? styles.mine : styles.theirs]}>
                {showDaySeparator ? (
                  <Text style={[styles.daySeparator, { color: palette.icon }]}>
                    {formatDaySeparator(messageDate)}
                  </Text>
                ) : null}
                <MessageSelectionTarget
                  accessibilityLabel={isUnsent ? 'Message unsent' : message.text}
                  bubbleStyle={[
                    styles.bubble,
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
                  gestureResetKey={isLikedByCurrentUser}
                  reaction={
                    !messageActions.isSelecting && message.likedByIds.length > 0 ? (
                      <MessageReactionBadge
                        currentUserId={currentUser?.uid}
                        likedByIds={message.likedByIds}
                        onLongPress={() => messageActions.openMessageActions(message)}
                        onPress={() => messageActions.showMessageLikes(message)}
                        side={isCurrentUser ? 'right' : 'left'}
                        selecting={messageActions.isSelecting}
                      />
                    ) : null
                  }
                  onDoublePress={
                    messageActions.canDoubleTapLikeMessage(message)
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
                        {formatTimestamp(message.createdAt)}
                      </Text>
                    ) : null}
                  </View>
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
      <PullToRefreshIndicator pullDistance={pullDistance} refreshing={isRefreshing} />

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
              { backgroundColor: palette.surfaceMuted, opacity: isMessagingDisabled ? 0.55 : 1 },
            ]}>
            <TextInput
              autoCapitalize="sentences"
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
      )}
      <ConfirmDialog
        visible={confirmBlock}
        title={`Block ${partnerName || 'this student'}?`}
        body="They won't be able to message you, and you won't see them in attendee lists."
        confirmLabel="Block"
        loading={isBlocking}
        onConfirm={handleBlockUser}
        onCancel={() => setConfirmBlock(false)}
      />
      <ConfirmDialog
        visible={confirmUnblock}
        title={`Unblock ${partnerName || 'this student'}?`}
        body="They'll be able to message you and see you in sessions again."
        confirmLabel="Unblock"
        loading={isUnblocking}
        onConfirm={handleUnblockUser}
        onCancel={() => setConfirmUnblock(false)}
      />
      <ConfirmDialog
        visible={confirmAddFriend}
        title={`Send ${partnerName || 'this student'} a study buddy request?`}
        body="They'll see your request and can accept or ignore it."
        confirmLabel={
          friendRequestCooldown > 0
            ? `Send Request in ${friendRequestCooldown}s`
            : 'Send Request'
        }
        confirmDisabled={friendRequestCooldown > 0}
        loading={isFriendActionPending}
        onConfirm={handleConfirmAddFriend}
        onCancel={() => setConfirmAddFriend(false)}
      />
      <ConfirmDialog
        visible={confirmRemoveFriend}
        title={`Remove ${partnerName || 'this student'}?`}
        body="You'll both stop being study buddies. You can send a new request later."
        confirmLabel="Remove"
        loading={isFriendActionPending}
        onConfirm={handleRemoveFriend}
        onCancel={() => setConfirmRemoveFriend(false)}
      />
      <MessageActionOverlays
        controller={messageActions}
        userNameForId={(userId) =>
          userId === currentUser?.uid
            ? currentUser.displayName?.trim() || 'You'
            : partnerName || 'Student'
        }
      />
      <SuccessToast toast={toast} bottomOffset={72} />
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
  identityProfile: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: Space.md,
    minWidth: 0,
  },
  identityActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 0,
    // Three full-size utility targets need to stay compact enough that the
    // person and status copy never collapse into a hanging fragment.
    gap: 0,
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
    alignSelf: 'stretch',
    gap: Space.xs,
    width: '100%',
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
  activeBubble: {
    borderWidth: 2,
    zIndex: 3,
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
