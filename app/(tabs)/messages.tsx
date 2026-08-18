import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView, Swipeable } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/ui/Avatar';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { IconButton } from '@/components/ui/IconButton';
import { LoadingState } from '@/components/ui/LoadingState';
import {
  PullToRefreshIndicator,
  usePullToRefreshDistance,
} from '@/components/ui/PullToRefreshIndicator';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ScreenTransition } from '@/components/ui/ScreenTransition';
import { SearchBar } from '@/components/ui/SearchBar';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
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
  getBlockedUserIds,
  getGroupChatListItem,
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
} from '@/lib/firestore';
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
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [groupChats, setGroupChats] = useState<GroupChatListItem[]>([]);
  const [keptOnlyGroupChats, setKeptOnlyGroupChats] = useState<GroupChatListItem[]>([]);
  const [hiddenChats, setHiddenChats] = useState<Map<string, HiddenChat>>(new Map());
  const [keptSessionChats, setKeptSessionChats] = useState<Map<string, KeptSessionChat>>(new Map());
  const [pendingRemovalKeys, setPendingRemovalKeys] = useState<Set<string>>(new Set());
  const pendingRemovalKeysRef = useRef(new Set<string>());
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

  useEffect(() => {
    const unsubscribe = subscribeToAuthState((user) => {
      setCurrentUser(user);
    });

    return unsubscribe;
  }, []);

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
        preview: "Session chat",
        timestamp: groupChat.lastMessageAt,
        groupChat,
      })),
    ];

    return dedupeMessageRows(chats)
      .filter((chat) => {
        if (chat.type === "dm") {
          return true;
        }

        if (
          nowMs >= chat.groupChat.endTime.toMillis() + SESSION_CHAT_GRACE_PERIOD_MS &&
          !keptSessionChats.has(chat.id)
        ) {
          return false;
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

  async function handleRemoveSessionChat(sessionId: string) {
    if (!currentUser) {
      return;
    }

    const key = sessionChatHistoryKey(sessionId);
    if (pendingRemovalKeysRef.current.has(key)) {
      return;
    }
    pendingRemovalKeysRef.current.add(key);
    setPendingRemovalKeys((current) => new Set(current).add(key));

    try {
      await removeSessionChatFromUserHistory(currentUser.uid, sessionId);
      setHiddenChats((current) => {
        const next = new Map(current);
        next.set(key, { chatType: "group", threadId: sessionId, removedAt: Timestamp.now() });
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

  function confirmRemoveSessionChat(sessionId: string) {
    confirmChatRemoval({
      platform: Platform.OS,
      showNativeAlert: Alert.alert,
      showWebConfirm: (message) =>
        typeof window !== "undefined" && window.confirm(message),
      onConfirm: () => void handleRemoveSessionChat(sessionId),
    });
  }

  return (
    <GestureHandlerRootView style={[styles.screen, { backgroundColor: palette.background }]}>
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

                  const rowContents = (
                    <>
                      <Avatar name={otherName} size="md" />

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
                            {isBlocked ? "Blocked" : chat.preview}
                          </Text>
                        </View>
                      </View>
                    </>
                  );

                  if (chat.type === "dm") {
                    return (
                      <Pressable
                        key={`dm:${chat.id}`}
                        accessibilityLabel={
                          isBlocked
                            ? `Conversation with ${otherName}, blocked`
                            : `Conversation with ${otherName}`
                        }
                        accessibilityRole="button"
                        onPress={() =>
                          router.push({
                            pathname: "/conversation/[conversationId]",
                            params: {
                              conversationId: chat.id,
                              otherUserId,
                              otherUserName: otherName,
                            },
                          })
                        }
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

                  return (
                    <Swipeable
                      key={`group:${chat.id}`}
                      overshootRight={false}
                      renderRightActions={() => (
                        <Pressable
                          accessibilityLabel={`Remove ${otherName} from my Messages`}
                          accessibilityRole="button"
                          disabled={isRemoving}
                          onPress={() => confirmRemoveSessionChat(chat.id)}
                          style={({ pressed }) => [
                            styles.removeAction,
                            { backgroundColor: palette.destructive },
                            { opacity: pressed ? 0.75 : 1 },
                          ]}
                        >
                          <IconSymbol color="#FFFFFF" name="trash" size={21} />
                          <Text style={styles.removeActionText}>Remove</Text>
                        </Pressable>
                      )}
                      rightThreshold={44}
                    >
                      <View
                        style={[
                          styles.rowShell,
                          index > 0 && {
                            borderTopColor: palette.border,
                            borderTopWidth: StyleSheet.hairlineWidth,
                          },
                          { backgroundColor: palette.background },
                        ]}>
                        <Pressable
                          accessibilityLabel={`Session chat for ${otherName}`}
                          accessibilityRole="button"
                          onPress={() =>
                            router.push({
                              pathname: "/session-chat/[sessionId]",
                              params: { sessionId: chat.id },
                            })
                          }
                          style={({ pressed }) => [
                            styles.threadRow,
                            { opacity: pressed ? 0.7 : 1 },
                          ]}>
                          {rowContents}
                        </Pressable>
                        <IconButton
                          accessibilityLabel={`Remove ${otherName} from my Messages`}
                          disabled={isRemoving}
                          icon="trash"
                          onPress={() => confirmRemoveSessionChat(chat.id)}
                        />
                      </View>
                    </Swipeable>
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
    </GestureHandlerRootView>
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
  rowShell: {
    alignItems: 'center',
    flexDirection: 'row',
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
  threadName: {
    flexShrink: 1,
    minWidth: 0,
  },
  threadTimestamp: {
    flexShrink: 0,
  },
  removeAction: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 92,
    paddingHorizontal: Space.md,
  },
  removeActionText: {
    ...TypeScale.meta,
    color: '#FFFFFF',
    marginTop: Space.xs,
  },
});
