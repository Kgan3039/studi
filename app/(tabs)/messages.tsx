import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/ui/Avatar';
import { ActionRow } from '@/components/ui/ActionRow';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { LoadingState } from '@/components/ui/LoadingState';
import {
  PullToRefreshIndicator,
  usePullToRefreshDistance,
} from '@/components/ui/PullToRefreshIndicator';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ScreenTransition } from '@/components/ui/ScreenTransition';
import { SearchBar } from '@/components/ui/SearchBar';
import { Sheet } from '@/components/ui/Sheet';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Radius, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useFriendRequestCooldown } from '@/lib/friend-request-cooldown';
import {
  canAttemptFriendRequest,
  runFriendRequestSend,
} from '@/lib/friend-request-control';
import { presentFriendRequestFailure } from '@/lib/friend-request-feedback';
import { subscribeToAuthState } from '@/lib/auth';
import {
  confirmChatRemoval,
  showChatRemovalFailure,
} from '@/lib/confirm-chat-removal';
import {
  areMessageSourcesLoaded,
  dedupeMessageRows,
  isMessageRowVisible,
} from '@/lib/message-history';
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
  getGroupChatListItem,
  getLatestSessionMessagePreview,
  getSessionById,
  removeSessionChatFromUserHistory,
  SESSION_CHAT_GRACE_PERIOD_MS,
  subscribeToHiddenChats,
  subscribeToKeptSessionChats,
  subscribeToUserConversations,
  subscribeToUserGroupChats,
  type ConversationListItem,
  type GroupChatListItem,
  type HiddenChat,
  type KeptSessionChat,
  type UserProfile,
} from '@/lib/firestore';
import { getReportedUserIds } from '@/lib/reported-users';
import { getUserFacingErrorMessage } from '@/lib/user-facing-errors';
import { Timestamp } from 'firebase/firestore';
import type { User } from 'firebase/auth';

function formatTimestamp(value: unknown) {
  if (!value || typeof value !== 'object' || !('toDate' in value)) {
    return 'Just now';
  }

  const date = (value as { toDate: () => Date }).toDate();
  const now = new Date();

  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function sessionChatHistoryKey(sessionId: string) {
  return `group:${sessionId}`;
}

type DirectChatOptions = {
  conversationId: string;
  friendStatus: FriendStatus;
  hasReported: boolean;
  isRelationshipReady: boolean;
  name: string;
  userId: string;
};

type GroupChatOptions = { id: string; name: string; type: 'group' };

type ChatOptionsTarget =
  | DirectChatOptions & { type: 'dm' }
  | GroupChatOptions;

function timestampMillis(value: unknown) {
  return value instanceof Timestamp ? value.toMillis() : 0;
}

export default function MessagesScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const { onPullScroll, pullDistance } = usePullToRefreshDistance();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const friendRequestCooldown = useFriendRequestCooldown(currentUser?.uid);
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [groupChats, setGroupChats] = useState<GroupChatListItem[]>([]);
  const [keptOnlyGroupChats, setKeptOnlyGroupChats] = useState<GroupChatListItem[]>([]);
  const [hiddenChats, setHiddenChats] = useState<Map<string, HiddenChat>>(new Map());
  const [keptSessionChats, setKeptSessionChats] = useState<Map<string, KeptSessionChat>>(new Map());
  const [groupChatPreviews, setGroupChatPreviews] = useState<Map<string, string>>(new Map());
  const [pendingRemovalKeys, setPendingRemovalKeys] = useState<Set<string>>(new Set());
  const pendingRemovalKeysRef = useRef(new Set<string>());
  const longPressChatRef = useRef<string | null>(null);
  const [blockedUserIds, setBlockedUserIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isDmLoading, setIsDmLoading] = useState(true);
  const [isGroupLoading, setIsGroupLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [isKeptChatsLoading, setIsKeptChatsLoading] = useState(true);
  const [hasLoadError, setHasLoadError] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [nowMs, setNowMs] = useState(Date.now());
  const [chatOptionsTarget, setChatOptionsTarget] = useState<ChatOptionsTarget | null>(null);
  const [groupMembersTarget, setGroupMembersTarget] = useState<GroupChatOptions | null>(null);
  const [groupMemberProfiles, setGroupMemberProfiles] = useState<UserProfile[]>([]);
  const [groupMembersHostId, setGroupMembersHostId] = useState<string | null>(null);
  const [groupMembersLoadState, setGroupMembersLoadState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [confirmBlockTarget, setConfirmBlockTarget] = useState<DirectChatOptions | null>(null);
  const [confirmAddBuddyTarget, setConfirmAddBuddyTarget] = useState<DirectChatOptions | null>(null);
  const [confirmRemoveBuddyTarget, setConfirmRemoveBuddyTarget] = useState<DirectChatOptions | null>(null);
  const [isActionPending, setIsActionPending] = useState(false);
  const groupProfileTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const groupMembersSessionId = groupMembersTarget?.id;
  const visibleGroupMembers = useMemo(
    () => groupMemberProfiles.filter((member) => !blockedUserIds.includes(member.uid)),
    [blockedUserIds, groupMemberProfiles]
  );

  useEffect(() => {
    const unsubscribe = subscribeToAuthState((user) => {
      setCurrentUser(user);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    return () => {
      if (groupProfileTimeoutRef.current) {
        clearTimeout(groupProfileTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!groupMembersSessionId) {
      setGroupMemberProfiles([]);
      setGroupMembersHostId(null);
      setGroupMembersLoadState('idle');
      return;
    }

    let active = true;
    setGroupMembersLoadState('loading');

    void getSessionById(groupMembersSessionId)
      .then((session) => {
        if (!active) {
          return;
        }

        if (!session) {
          setGroupMembersLoadState('error');
          return;
        }

        const membersById = new Map(session.attendeeProfiles.map((profile) => [profile.uid, profile]));
        if (session.hostProfile) {
          membersById.set(session.hostProfile.uid, session.hostProfile);
        }
        setGroupMemberProfiles([...membersById.values()]);
        setGroupMembersHostId(session.hostId);
        setGroupMembersLoadState('ready');
      })
      .catch(() => {
        if (active) {
          setGroupMembersLoadState('error');
        }
      });

    return () => {
      active = false;
    };
  }, [groupMembersSessionId]);

  // A block is written outside the conversations collection, so its snapshot
  // cannot update this list by itself. Re-read when the tab regains focus —
  // including after returning from a conversation, profile, or report sheet.
  useFocusEffect(
    useCallback(() => {
      let active = true;

      if (!currentUser) {
        setBlockedUserIds([]);
        return () => {
          active = false;
        };
      }

      void getBlockedUserIds(currentUser.uid)
        .then((ids) => {
          if (active) {
            setBlockedUserIds(ids);
          }
        })
        .catch(() => {
          // Leave the thread list usable if this supporting status read is
          // temporarily unavailable; the next focused visit retries it.
        });

      return () => {
        active = false;
      };
    }, [currentUser])
  );

  useEffect(() => {
    if (!currentUser) {
      setConversations([]);
      setHasLoadError(false);
      setIsDmLoading(false);
      setIsRefreshing(false);
      return;
    }

    setIsDmLoading(true);
    const unsubscribe = subscribeToUserConversations(
      currentUser.uid,
      (loadedConversations) => {
        setConversations(loadedConversations);
        setIsDmLoading(false);
      },
      // Listener failures (rules, offline, profile hydration) used to leave the
      // spinner up forever; surface them so pull-to-refresh can retry.
      () => {
        setHasLoadError(true);
        setIsDmLoading(false);
      }
    );

    return unsubscribe;
  }, [currentUser, refreshNonce]);

  useEffect(() => {
    if (!currentUser) {
      setGroupChats([]);
      setIsGroupLoading(false);
      return;
    }

    setIsGroupLoading(true);
    const unsubscribe = subscribeToUserGroupChats(
      currentUser.uid,
      (loadedGroupChats) => {
        setGroupChats(loadedGroupChats);
        setIsGroupLoading(false);
      },
      () => {
        setHasLoadError(true);
        setIsGroupLoading(false);
      }
    );

    return unsubscribe;
  }, [currentUser, refreshNonce]);

  useEffect(() => {
    if (!currentUser) {
      setKeptSessionChats(new Map());
      setIsKeptChatsLoading(false);
      return;
    }

    setIsKeptChatsLoading(true);
    const unsubscribe = subscribeToKeptSessionChats(
      currentUser.uid,
      (loadedChats) => {
        setKeptSessionChats(loadedChats);
        setIsKeptChatsLoading(false);
      },
      () => {
        // The private marker was introduced after the inbox. If an older rule
        // set is still live during rollout, preserve the ordinary inbox rather
        // than turning this optional enhancement into a full-screen failure.
        setKeptSessionChats(new Map());
        setIsKeptChatsLoading(false);
      }
    );

    return unsubscribe;
  }, [currentUser, refreshNonce]);

  // The main inbox listener deliberately stays capped to the 50 most recent
  // active chats. Saved history is a promise, though, so fetch any kept chat
  // that has aged out of that bounded query and merge it back into the list.
  useEffect(() => {
    if (!currentUser || keptSessionChats.size === 0) {
      setKeptOnlyGroupChats([]);
      return;
    }

    let active = true;
    const activeChatIds = new Set(groupChats.map((chat) => chat.sessionId));
    const missingIds = [...keptSessionChats.keys()].filter((id) => !activeChatIds.has(id));

    if (missingIds.length === 0) {
      setKeptOnlyGroupChats([]);
      return;
    }

    void Promise.all(
      missingIds.map((sessionId) => getGroupChatListItem(sessionId).catch(() => null))
    ).then((loadedChats) => {
      if (active) {
        setKeptOnlyGroupChats(
          loadedChats.filter((chat): chat is GroupChatListItem => chat !== null)
        );
      }
    });

    return () => {
      active = false;
    };
  }, [currentUser, groupChats, keptSessionChats]);

  const allGroupChats = useMemo(
    () => [...groupChats, ...keptOnlyGroupChats],
    [groupChats, keptOnlyGroupChats]
  );

  useEffect(() => {
    if (!currentUser || allGroupChats.length === 0) {
      setGroupChatPreviews(new Map());
      return;
    }

    let active = true;
    const sessionIds = [...new Set(allGroupChats.map((groupChat) => groupChat.sessionId))];

    void Promise.all(
      sessionIds.map(async (sessionId) => {
        const preview = await getLatestSessionMessagePreview(sessionId).catch(() => null);
        return [sessionId, preview] as const;
      })
    ).then((entries) => {
      if (!active) {
        return;
      }

      setGroupChatPreviews(
        new Map(
          entries.filter((entry): entry is readonly [string, string] => entry[1] !== null)
        )
      );
    });

    return () => {
      active = false;
    };
  }, [allGroupChats, currentUser]);

  useEffect(() => {
    if (!currentUser) {
      setHiddenChats(new Map());
      setPendingRemovalKeys(new Set());
      pendingRemovalKeysRef.current.clear();
      setIsHistoryLoading(false);
      return;
    }

    setIsHistoryLoading(true);
    const unsubscribe = subscribeToHiddenChats(
      currentUser.uid,
      (loadedHiddenChats) => {
        setHiddenChats(loadedHiddenChats);
        setIsHistoryLoading(false);
      },
      () => {
        setHasLoadError(true);
        setIsHistoryLoading(false);
      }
    );

    return unsubscribe;
  }, [currentUser, refreshNonce]);

  const isAnyLoading =
    !areMessageSourcesLoaded({
      dm: !isDmLoading,
      group: !isGroupLoading,
      hidden: !isHistoryLoading,
    }) || isKeptChatsLoading;

  useEffect(() => {
    if (isRefreshing && !isAnyLoading) {
      setIsRefreshing(false);
    }
  }, [isAnyLoading, isRefreshing]);

  function handleRefresh() {
    if (!currentUser) {
      return;
    }

    setIsRefreshing(true);
    setHasLoadError(false);
    setIsDmLoading(true);
    setIsGroupLoading(true);
    setIsHistoryLoading(true);
    setIsKeptChatsLoading(true);
    setRefreshNonce((value) => value + 1);
  }

  // A grace deadline does not change any Firestore document. Wake only for
  // the next one so an expired chat leaves the inbox promptly without a
  // permanent timer on this tab.
  useEffect(() => {
    const nextDeadline = allGroupChats
      .filter((chat) => !keptSessionChats.has(chat.sessionId))
      .map((chat) => chat.endTime.toMillis() + SESSION_CHAT_GRACE_PERIOD_MS)
      .filter((deadline) => deadline > nowMs)
      .sort((first, second) => first - second)[0];

    if (!nextDeadline) {
      return;
    }

    const timeout = setTimeout(
      () => setNowMs(Date.now()),
      Math.min(nextDeadline - Date.now() + 100, 2_147_483_647)
    );

    return () => clearTimeout(timeout);
  }, [allGroupChats, keptSessionChats, nowMs]);

  const allChats = useMemo(() => {
    const chats = [
      ...conversations.map((conversation) => ({
        type: "dm" as const,
        id: conversation.conversationId,
        name: conversation.otherParticipant?.displayName || "Student",
        preview: conversation.lastMessagePreview || "Say hi to your new study buddy.",
        timestamp: conversation.lastMessageAt || conversation.updatedAt,
        conversation,
      })),

      ...allGroupChats.map((groupChat) => ({
        type: "group" as const,
        id: groupChat.sessionId,
        name: groupChat.title,
        preview: groupChatPreviews.get(groupChat.sessionId) ?? "",
        timestamp: groupChat.lastMessageAt,
        groupChat,
      })),
    ];

    return dedupeMessageRows(chats)
      .filter((chat) => {
        if (
          chat.type === "group"
          && nowMs >= chat.groupChat.endTime.toMillis() + SESSION_CHAT_GRACE_PERIOD_MS
          && !keptSessionChats.has(chat.id)
        ) {
          return false;
        }

        if (chat.type === 'dm') {
          return true;
        }

        const key = sessionChatHistoryKey(chat.id);
        // Session-chat removal is persistent. New messages do not silently
        // override an explicit owner-scoped hidden marker.
        return isMessageRowVisible({
          type: chat.type,
          isHidden: hiddenChats.has(key),
          isPendingRemoval: pendingRemovalKeys.has(key),
        });
      })
      .sort((firstChat, secondChat) =>
        timestampMillis(secondChat.timestamp) - timestampMillis(firstChat.timestamp)
      );
  }, [
    conversations,
    allGroupChats,
    groupChatPreviews,
    hiddenChats,
    keptSessionChats,
    nowMs,
    pendingRemovalKeys,
  ]);

  // Board MessagesListScreen has a "Search messages" field. Conversations are
  // already loaded by the subscription, so this filters them client-side —
  // no extra reads, no backend search.
  const visibleChats = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    if (!query) {
      return allChats;
    }

    return allChats.filter((chat) => {
      return chat.name.toLowerCase().includes(query) || chat.preview.toLowerCase().includes(query);
    });
  }, [allChats, searchQuery]);

  async function handleRemoveChat(target: Extract<ChatOptionsTarget, { type: 'group' }>) {
    if (!currentUser) {
      return;
    }

    const key = sessionChatHistoryKey(target.id);
    if (pendingRemovalKeysRef.current.has(key)) {
      return;
    }
    pendingRemovalKeysRef.current.add(key);
    setPendingRemovalKeys((current) => new Set(current).add(key));

    try {
      await removeSessionChatFromUserHistory(currentUser.uid, target.id);
      setHiddenChats((current) => {
        const next = new Map(current);
        next.set(key, { chatType: 'group', threadId: target.id, removedAt: Timestamp.now() });
        return next;
      });
      setPendingRemovalKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    } catch {
      setPendingRemovalKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
      await showChatRemovalFailure({
        platform: Platform.OS,
        showNativeAlert: Alert.alert,
        showWebAlert: (message) => {
          if (typeof window !== "undefined") {
            window.alert(message);
          }
        },
      });
    } finally {
      pendingRemovalKeysRef.current.delete(key);
    }
  }

  function confirmRemoveChat(target: Extract<ChatOptionsTarget, { type: 'group' }>) {
    confirmChatRemoval({
      platform: Platform.OS,
      showNativeAlert: Alert.alert,
      showWebConfirm: (message) =>
        typeof window !== "undefined" && window.confirm(message),
      onConfirm: () => void handleRemoveChat(target),
    });
  }

  function openChatOptions(target: ChatOptionsTarget) {
    const key = target.type === 'group' ? `group:${target.id}` : `dm:${target.conversationId}`;
    // Some platforms also emit onPress when the long press ends. Suppress that
    // trailing tap so opening options never opens the chat underneath.
    longPressChatRef.current = key;
    setChatOptionsTarget(target);

    if (target.type === 'dm' && currentUser) {
      void Promise.all([
        getFriendStatus(currentUser.uid, target.userId),
        getReportedUserIds(),
      ])
        .then(([friendStatus, reportedUserIds]) => {
          setChatOptionsTarget((current) =>
            current?.type === 'dm' && current.conversationId === target.conversationId
              ? {
                  ...current,
                  friendStatus,
                  isRelationshipReady: true,
                  hasReported: reportedUserIds.includes(target.userId),
                }
              : current
          );
        })
        .catch(() => {
          setChatOptionsTarget((current) =>
            current?.type === 'dm' && current.conversationId === target.conversationId
              ? { ...current, isRelationshipReady: true }
              : current
          );
        });
    }
    setTimeout(() => {
      if (longPressChatRef.current === key) {
        longPressChatRef.current = null;
      }
    }, 0);
  }

  function openDirectChat(conversationId: string, otherUserId: string, otherUserName: string) {
    const key = `dm:${conversationId}`;
    if (longPressChatRef.current === key) {
      longPressChatRef.current = null;
      return;
    }

    router.push({
      pathname: "/conversation/[conversationId]",
      params: { conversationId, otherUserId, otherUserName },
    });
  }

  function openSessionChat(sessionId: string) {
    const key = `group:${sessionId}`;
    if (longPressChatRef.current === key) {
      longPressChatRef.current = null;
      return;
    }

    router.push({
      pathname: "/session-chat/[sessionId]",
      params: { sessionId },
    });
  }

  function closeChatOptions() {
    if (!isActionPending) {
      setChatOptionsTarget(null);
    }
  }

  function openGroupMembers(target: GroupChatOptions) {
    setChatOptionsTarget(null);
    setGroupMembersTarget(target);
  }

  function openGroupMemberProfile(userId: string) {
    setGroupMembersTarget(null);
    if (groupProfileTimeoutRef.current) {
      clearTimeout(groupProfileTimeoutRef.current);
    }
    groupProfileTimeoutRef.current = setTimeout(() => {
      groupProfileTimeoutRef.current = null;
      router.push(`/user/${userId}`);
    }, 250);
  }

  function handleReportUser(target: DirectChatOptions) {
    setChatOptionsTarget(null);
    router.push({
      pathname: '/report-user',
      params: {
        reportedUserId: target.userId,
        reportedUserName: target.name,
        context: 'messages',
      },
    });
  }

  function handleStudyBuddyAction(target: DirectChatOptions) {
    if (!currentUser || !target.isRelationshipReady || isActionPending) {
      return;
    }

    setChatOptionsTarget(null);
    if (target.friendStatus === 'friends') {
      setConfirmRemoveBuddyTarget(target);
      return;
    }
    if (target.friendStatus === 'none') {
      setConfirmAddBuddyTarget(target);
      return;
    }

    void (async () => {
      try {
        setIsActionPending(true);
        if (target.friendStatus === 'incoming') {
          await acceptFriendRequest(currentUser.uid, target.userId);
        } else {
          await cancelFriendRequest(currentUser.uid, target.userId);
        }
      } catch (error) {
        Alert.alert('Study Buddy Error', getUserFacingErrorMessage(error, 'friend'));
      } finally {
        setIsActionPending(false);
      }
    })();
  }

  async function handleConfirmAddBuddy() {
    if (
      !currentUser
      || !confirmAddBuddyTarget
      || !canAttemptFriendRequest(currentUser.uid)
    ) {
      return;
    }

    try {
      setIsActionPending(true);
      const result = await runFriendRequestSend({
        userId: currentUser.uid,
        send: () => sendFriendRequest(currentUser.uid, confirmAddBuddyTarget.userId),
      });
      if (result.status === 'sent') {
        setConfirmAddBuddyTarget(null);
      }
    } catch (error) {
      presentFriendRequestFailure(error);
    } finally {
      setIsActionPending(false);
    }
  }

  async function handleConfirmRemoveBuddy() {
    if (!currentUser || !confirmRemoveBuddyTarget) {
      return;
    }

    try {
      setIsActionPending(true);
      await removeFriend(currentUser.uid, confirmRemoveBuddyTarget.userId);
      setConfirmRemoveBuddyTarget(null);
    } catch (error) {
      Alert.alert('Study Buddy Error', getUserFacingErrorMessage(error, 'friend'));
    } finally {
      setIsActionPending(false);
    }
  }

  async function handleConfirmBlock() {
    if (!currentUser || !confirmBlockTarget) {
      return;
    }

    try {
      setIsActionPending(true);
      await blockUser(currentUser.uid, confirmBlockTarget.userId);
      setBlockedUserIds((current) => [...new Set([...current, confirmBlockTarget.userId])]);
      setConfirmBlockTarget(null);
    } catch (error) {
      Alert.alert('Block Error', getUserFacingErrorMessage(error, 'conversation'));
    } finally {
      setIsActionPending(false);
    }
  }

  function buddyMenuLabel(friendStatus: FriendStatus) {
    if (friendStatus === 'friends') return 'Remove buddy';
    if (friendStatus === 'incoming') return 'Accept request';
    if (friendStatus === 'outgoing') return 'Cancel request';
    return 'Add buddy';
  }

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <ScrollView
        onScroll={onPullScroll}
        scrollEventThrottle={16}
        style={styles.screen}
        // Rows and the clear control stay tappable in one tap while the search
        // keyboard is open.
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            colors={['transparent']}
            progressBackgroundColor="transparent"
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor="transparent"
          />
        }
        contentContainerStyle={[styles.content, { paddingTop: insets.top + Space.md }]}>
        <ScreenHeader showNotifications title="Messages" />

        <ScreenTransition style={styles.transition}>
          {allChats.length > 0 ? (
            <SearchBar
              accessibilityLabel="Search messages"
              clearAccessibilityLabel="Clear message search"
              onChangeText={setSearchQuery}
              placeholder="Search messages"
              value={searchQuery}
            />
          ) : null}

          {isAnyLoading ? (
            <LoadingState title="Loading conversations" />
          ) : hasLoadError ? (
            <ErrorState body="We couldn't load your conversations." onRetry={handleRefresh} />
          ) : allChats.length > 0 ? (
            visibleChats.length > 0 ? (
              <View>
                {visibleChats.map((chat, index) => {
                  const otherName = chat.name;

                  const otherUserId =
                    chat.type === "dm"
                      ? chat.conversation.otherParticipant?.uid ?? ""
                      : "";

                  const isBlocked =
                    !!otherUserId && blockedUserIds.includes(otherUserId);

                  const isSessionChat = chat.type === 'group';
                  const rowContents = (
                    <>
                      {isSessionChat ? (
                        <View
                          accessibilityElementsHidden
                          style={[
                            styles.sessionChatAvatar,
                            { backgroundColor: palette.hero, borderColor: palette.tint },
                          ]}>
                          <IconSymbol color={palette.tint} name="person.2.fill" size={22} />
                        </View>
                      ) : (
                        <Avatar name={otherName} size="md" />
                      )}

                      <View style={styles.threadBody}>
                        <View style={styles.threadHeader}>
                          <Text
                            style={[
                              TypeScale.bodyStrong,
                              styles.threadName,
                              { color: palette.primaryText },
                            ]}
                            numberOfLines={1}>
                            {otherName}
                          </Text>

                          <Text
                            maxFontSizeMultiplier={1.6}
                            style={[
                              TypeScale.meta,
                              styles.threadTimestamp,
                              { color: palette.secondaryText },
                            ]}
                            numberOfLines={1}>
                            {formatTimestamp(chat.timestamp)}
                          </Text>
                        </View>

                        <View style={styles.threadPreview}>
                          {isBlocked ? (
                            <IconSymbol color={palette.tint} name="nosign" size={15} />
                          ) : null}

                          <Text
                            style={[
                              TypeScale.body,
                              { color: isBlocked ? palette.tint : palette.secondaryText },
                            ]}
                            numberOfLines={1}>
                            {chat.preview}
                          </Text>
                        </View>
                      </View>
                    </>
                  );

                  if (chat.type === "dm") {
                    return (
                      <Pressable
                        key={`dm:${chat.id}`}
                        accessibilityActions={[
                          { name: 'showOptions', label: 'Show conversation options' },
                        ]}
                        accessibilityLabel={
                          isBlocked
                            ? `Conversation with ${otherName}, blocked`
                            : `Conversation with ${otherName}`
                        }
                        accessibilityRole="button"
                        accessibilityHint="Hold for conversation options"
                        delayLongPress={400}
                        onAccessibilityAction={() => {
                          if (otherUserId) {
                            openChatOptions({
                              type: 'dm',
                              conversationId: chat.id,
                              friendStatus: 'none',
                              hasReported: false,
                              isRelationshipReady: false,
                              name: otherName,
                              userId: otherUserId,
                            });
                          }
                        }}
                        onLongPress={
                          otherUserId
                            ? () =>
                                openChatOptions({
                                  type: 'dm',
                                  conversationId: chat.id,
                                  friendStatus: 'none',
                                  hasReported: false,
                                  isRelationshipReady: false,
                                  name: otherName,
                                  userId: otherUserId,
                                })
                            : undefined
                        }
                        onPress={() => openDirectChat(chat.id, otherUserId, otherName)}
                        style={({ pressed }) => [
                          styles.threadRow,
                          index > 0 && {
                            borderTopColor: palette.border,
                            borderTopWidth: StyleSheet.hairlineWidth,
                          },
                          { opacity: pressed ? 0.7 : 1 },
                        ]}>
                        {rowContents}
                      </Pressable>
                    );
                  }

                  const removalKey = sessionChatHistoryKey(chat.id);
                  const isRemoving = pendingRemovalKeys.has(removalKey);

                  const groupTarget = { type: 'group' as const, id: chat.id, name: otherName };

                  return (
                    <Pressable
                      key={`group:${chat.id}`}
                      accessibilityActions={[
                        { name: 'showOptions', label: 'Show group chat options' },
                        { name: 'remove', label: `Remove ${otherName} from my Messages` },
                      ]}
                      accessibilityHint="Hold or use Actions for group chat options"
                      accessibilityLabel={`Session chat for ${otherName}`}
                      accessibilityRole="button"
                      delayLongPress={400}
                      disabled={isRemoving}
                      onAccessibilityAction={(event) => {
                        if (event.nativeEvent.actionName === 'remove') {
                          confirmRemoveChat(groupTarget);
                        } else {
                          openChatOptions(groupTarget);
                        }
                      }}
                      onLongPress={() => openChatOptions(groupTarget)}
                      onPress={() => openSessionChat(chat.id)}
                      style={({ pressed }) => [
                        styles.threadRow,
                        index > 0 && {
                          borderTopColor: palette.border,
                          borderTopWidth: StyleSheet.hairlineWidth,
                        },
                        { opacity: isRemoving ? 0.45 : pressed ? 0.7 : 1 },
                      ]}>
                      {rowContents}
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <EmptyState
                icon="chat"
                headline="No matching conversations"
                body={`Nothing matches “${searchQuery.trim()}”.`}
                actionLabel="Clear search"
                onAction={() => setSearchQuery('')}
              />
            )
          ) : (
            <EmptyState
              icon="chat"
              headline="No messages yet"
              body="Open a session and tap Message to start a chat with the host."
              actionLabel="Find a session"
              onAction={() => router.push('/sessions')}
            />
          )}
        </ScreenTransition>
      </ScrollView>
      <PullToRefreshIndicator pullDistance={pullDistance} refreshing={isRefreshing} />
      <Sheet
        onClose={closeChatOptions}
        scroll={false}
        subtitle={chatOptionsTarget?.type === 'group' ? 'Session chat' : 'Conversation'}
        title={chatOptionsTarget?.name || 'Conversation'}
        visible={!!chatOptionsTarget}>
        {chatOptionsTarget ? (
          <View
            style={[
              styles.chatOptions,
              { backgroundColor: palette.surfaceMuted, borderColor: palette.border },
            ]}>
            {chatOptionsTarget.type === 'dm' ? (
              <>
                <ActionRow
                  accessory={
                    !chatOptionsTarget.isRelationshipReady ? (
                      <Text style={[TypeScale.meta, { color: palette.icon }]}>Loading…</Text>
                    ) : undefined
                  }
                  icon={
                    chatOptionsTarget.friendStatus === 'friends'
                    || chatOptionsTarget.friendStatus === 'outgoing'
                      ? 'person.badge.minus'
                      : 'person.badge.plus'
                  }
                  divided={false}
                  label={buddyMenuLabel(chatOptionsTarget.friendStatus)}
                  onPress={
                    chatOptionsTarget.isRelationshipReady
                      ? () => handleStudyBuddyAction(chatOptionsTarget)
                      : undefined
                  }
                  showChevron={false}
                  style={styles.chatOptionRow}
                />
                <ActionRow
                  divided={false}
                  icon="exclamationmark.triangle"
                  label={chatOptionsTarget.hasReported ? 'Report again' : 'Report'}
                  onPress={() => handleReportUser(chatOptionsTarget)}
                  showChevron={false}
                  style={styles.chatOptionRow}
                />
                {!blockedUserIds.includes(chatOptionsTarget.userId) ? (
                  <ActionRow
                    destructive
                    divided={false}
                    icon="nosign"
                    label="Block"
                    onPress={() => {
                      setChatOptionsTarget(null);
                      setConfirmBlockTarget(chatOptionsTarget);
                    }}
                    showChevron={false}
                    style={styles.chatOptionRow}
                  />
                ) : null}
              </>
            ) : null}
            {chatOptionsTarget.type === 'group' ? (
              <ActionRow
                divided={false}
                icon="person.2.fill"
                label="View group"
                onPress={() => openGroupMembers(chatOptionsTarget)}
                showChevron={false}
                style={styles.chatOptionRow}
              />
            ) : null}
            {chatOptionsTarget.type === 'group' ? (
              <ActionRow
                destructive
                divided={false}
                icon="trash.fill"
                label="Delete"
                onPress={() => {
                  const target = chatOptionsTarget;
                  setChatOptionsTarget(null);
                  setTimeout(() => confirmRemoveChat(target), 0);
                }}
                showChevron={false}
                style={styles.chatOptionRow}
              />
            ) : null}
          </View>
        ) : null}
      </Sheet>
      <Sheet
        onClose={() => setGroupMembersTarget(null)}
        subtitle={
          groupMembersLoadState === 'ready'
            ? `${visibleGroupMembers.length} ${visibleGroupMembers.length === 1 ? 'person' : 'people'} in this group`
            : groupMembersTarget
              ? `People in ${groupMembersTarget.name}`
              : undefined
        }
        title={groupMembersTarget?.name || 'Group members'}
        visible={!!groupMembersTarget}>
        {groupMembersLoadState === 'loading' ? (
          <View style={styles.groupMembersStatus}>
            <ActivityIndicator color={palette.tint} />
            <Text style={[TypeScale.caption, { color: palette.icon }]}>Loading people…</Text>
          </View>
        ) : groupMembersLoadState === 'error' ? (
          <View style={styles.groupMembersStatus}>
            <Text style={[TypeScale.bodyStrong, { color: palette.text }]}>Group unavailable</Text>
            <Text style={[TypeScale.caption, styles.groupMembersStatusCopy, { color: palette.icon }]}>
              Try opening the group again in a moment.
            </Text>
          </View>
        ) : visibleGroupMembers.length > 0 ? (
          <View style={styles.groupMemberList}>
            {visibleGroupMembers.map((member) => {
              const memberName = member.displayName.trim() || 'Student';
              const isHost = member.uid === groupMembersHostId;

              return (
                <Pressable
                  accessibilityHint="Opens profile"
                  accessibilityLabel={`View ${memberName}'s profile`}
                  accessibilityRole="button"
                  key={member.uid}
                  onPress={() => openGroupMemberProfile(member.uid)}
                  style={({ pressed }) => [
                    styles.groupMemberRow,
                    { borderBottomColor: palette.border, opacity: pressed ? 0.7 : 1 },
                  ]}>
                  <Avatar name={memberName} size="md" verified />
                  <View style={styles.groupMemberCopy}>
                    <Text style={[TypeScale.bodyStrong, { color: palette.text }]} numberOfLines={1}>
                      {memberName}
                    </Text>
                    <Text style={[TypeScale.caption, { color: palette.icon }]}>
                      {isHost ? 'Host · Verified UW student' : 'Verified UW student'}
                    </Text>
                  </View>
                  <IconSymbol color={palette.icon} name="chevron.right" size={18} />
                </Pressable>
              );
            })}
          </View>
        ) : (
          <View style={styles.groupMembersStatus}>
            <Text style={[TypeScale.caption, styles.groupMembersStatusCopy, { color: palette.icon }]}>
              No group members are available right now.
            </Text>
          </View>
        )}
      </Sheet>
      <ConfirmDialog
        body="They will no longer be able to message you."
        confirmLabel="Block"
        loading={isActionPending}
        onCancel={() => setConfirmBlockTarget(null)}
        onConfirm={handleConfirmBlock}
        title={`Block ${confirmBlockTarget?.name || 'this student'}?`}
        visible={!!confirmBlockTarget}
      />
      <ConfirmDialog
        body="They will get a study buddy request."
        confirmDisabled={friendRequestCooldown > 0}
        confirmLabel={friendRequestCooldown > 0 ? `Try again in ${friendRequestCooldown}s` : 'Add'}
        loading={isActionPending}
        onCancel={() => setConfirmAddBuddyTarget(null)}
        onConfirm={handleConfirmAddBuddy}
        title={`Add ${confirmAddBuddyTarget?.name || 'this student'}?`}
        visible={!!confirmAddBuddyTarget}
      />
      <ConfirmDialog
        body="You will no longer be study buddies."
        confirmLabel="Remove"
        loading={isActionPending}
        onCancel={() => setConfirmRemoveBuddyTarget(null)}
        onConfirm={handleConfirmRemoveBuddy}
        title={`Remove ${confirmRemoveBuddyTarget?.name || 'this student'}?`}
        visible={!!confirmRemoveBuddyTarget}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    gap: Space.lg,
    paddingBottom: Space.xxl + 4,
    paddingHorizontal: Space.lg + 4,
  },
  transition: {
    gap: Space.lg,
  },
  threadRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Space.md,
    minHeight: 64,
    paddingVertical: Space.md,
    flex: 1,
    minWidth: 0,
  },
  threadBody: {
    flex: 1,
    gap: Space.xs,
    minWidth: 0,
  },
  threadHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Space.sm,
    justifyContent: 'space-between',
  },
  threadPreview: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Space.xs + 2,
    minWidth: 0,
  },
  sessionChatAvatar: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  threadName: {
    flexShrink: 1,
    minWidth: 0,
  },
  threadTimestamp: {
    flexShrink: 0,
  },
  chatOptions: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    gap: StyleSheet.hairlineWidth,
    margin: Space.lg,
    overflow: 'hidden',
  },
  chatOptionRow: {
    paddingHorizontal: Space.md,
  },
  groupMemberList: {
    gap: 0,
  },
  groupMemberRow: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: Space.md,
    minHeight: 68,
    paddingVertical: Space.md,
  },
  groupMemberCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  groupMembersStatus: {
    alignItems: 'center',
    gap: Space.sm,
    justifyContent: 'center',
    minHeight: 120,
  },
  groupMembersStatusCopy: {
    textAlign: 'center',
  },
});
