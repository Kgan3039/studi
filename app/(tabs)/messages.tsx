import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/ui/Avatar';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { LoadingState } from '@/components/ui/LoadingState';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ScreenTransition } from '@/components/ui/ScreenTransition';
import { SearchBar } from '@/components/ui/SearchBar';
import { Colors, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { subscribeToAuthState } from '@/lib/auth';
import { subscribeToUserConversations, type ConversationListItem } from '@/lib/firestore';
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

export default function MessagesScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    const unsubscribe = subscribeToAuthState((user) => {
      setCurrentUser(user);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!currentUser) {
      setConversations([]);
      setErrorMessage('');
      setIsLoading(false);
      setIsRefreshing(false);
      return;
    }

    setIsLoading(true);
    setErrorMessage('');
    const unsubscribe = subscribeToUserConversations(
      currentUser.uid,
      (loadedConversations) => {
        setConversations(loadedConversations);
        setErrorMessage('');
        setIsLoading(false);
        setIsRefreshing(false);
      },
      // Listener failures (rules, offline, profile hydration) used to leave the
      // spinner up forever; surface them so pull-to-refresh can retry.
      (error) => {
        setErrorMessage(error.message);
        setIsLoading(false);
        setIsRefreshing(false);
      }
    );

    return unsubscribe;
  }, [currentUser, refreshNonce]);

  function handleRefresh() {
    if (!currentUser) {
      return;
    }

    setIsRefreshing(true);
    setRefreshNonce((value) => value + 1);
  }

  // Board MessagesListScreen has a "Search messages" field. Conversations are
  // already loaded by the subscription, so this filters them client-side —
  // no extra reads, no backend search.
  const visibleConversations = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    if (!query) {
      return conversations;
    }

    return conversations.filter((conversation) => {
      const name = conversation.otherParticipant?.displayName?.toLowerCase() ?? '';
      const preview = conversation.lastMessagePreview?.toLowerCase() ?? '';
      return name.includes(query) || preview.includes(query);
    });
  }, [conversations, searchQuery]);

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: palette.background }]}
      // Rows and the clear control stay tappable in one tap while the search
      // keyboard is open.
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={palette.tint} />
      }
      contentContainerStyle={[styles.content, { paddingTop: insets.top + Space.md }]}>
      <ScreenHeader
        showNotifications
        title="Messages"
      />

      <ScreenTransition style={styles.transition}>
      {conversations.length > 0 ? (
        <SearchBar
          accessibilityLabel="Search messages"
          clearAccessibilityLabel="Clear message search"
          onChangeText={setSearchQuery}
          placeholder="Search messages"
          value={searchQuery}
        />
      ) : null}

      {isLoading ? (
        <LoadingState title="Loading conversations" />
      ) : errorMessage ? (
        <ErrorState body={errorMessage} onRetry={handleRefresh} />
      ) : conversations.length > 0 ? (
        visibleConversations.length > 0 ? (
          <View>
            {visibleConversations.map((conversation, index) => {
              const otherName = conversation.otherParticipant?.displayName || 'Student';

              return (
                <Pressable
                  key={conversation.conversationId}
                  accessibilityRole="button"
                  onPress={() =>
                    router.push({
                      pathname: '/conversation/[conversationId]',
                      params: {
                        conversationId: conversation.conversationId,
                        otherUserId: conversation.otherParticipant?.uid ?? '',
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
                        // Metadata is capped so a scaled timestamp cannot eat
                        // the row and starve the name at accessibility sizes.
                        maxFontSizeMultiplier={1.6}
                        style={[
                          TypeScale.meta,
                          styles.threadTimestamp,
                          { color: palette.secondaryText },
                        ]}
                        numberOfLines={1}>
                        {formatTimestamp(conversation.lastMessageAt || conversation.updatedAt)}
                      </Text>
                    </View>
                    <Text
                      style={[TypeScale.body, { color: palette.secondaryText }]}
                      numberOfLines={1}>
                      {conversation.lastMessagePreview || 'Say hi before you arrive.'}
                    </Text>
                  </View>
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
  threadName: {
    flexShrink: 1,
    minWidth: 0,
  },
  threadTimestamp: {
    flexShrink: 0,
  },
});
