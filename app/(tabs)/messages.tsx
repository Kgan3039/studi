import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/ui/EmptyState';
import { Brand, Colors, FontFamily, Radius, Space, TypeScale } from '@/constants/theme';
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
  const [status, setStatus] = useState('Sign in to open your messages.');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = subscribeToAuthState((user) => {
      setCurrentUser(user);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!currentUser) {
      setConversations([]);
      setStatus('Sign in to open your messages.');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const unsubscribe = subscribeToUserConversations(currentUser.uid, (loadedConversations) => {
      setConversations(loadedConversations);
      setStatus(
        loadedConversations.length > 0
          ? `${loadedConversations.length} conversation${
              loadedConversations.length === 1 ? '' : 's'
            }`
          : 'Chats start when you join a session.'
      );
      setIsLoading(false);
    });

    return unsubscribe;
  }, [currentUser]);

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: palette.background }]}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + Space.md }]}>
      <View style={styles.header}>
        <Text style={[TypeScale.title, { color: palette.text }]}>Messages</Text>
        <Text style={[TypeScale.caption, { color: palette.icon }]}>{status}</Text>
      </View>

      {isLoading ? (
        <View style={styles.loadingArea}>
          <ActivityIndicator color={palette.tint} />
        </View>
      ) : conversations.length > 0 ? (
        <View style={styles.threadList}>
          {conversations.map((conversation) => {
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
                  styles.threadCard,
                  {
                    backgroundColor: palette.surface,
                    borderColor: palette.border,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}>
                <View
                  style={[
                    styles.avatar,
                    {
                      backgroundColor:
                        colorScheme === 'dark' ? `${palette.tint}33` : Brand.red100,
                    },
                  ]}>
                  <Text
                    style={[
                      styles.avatarInitial,
                      { color: colorScheme === 'dark' ? palette.tint : Brand.red700 },
                    ]}>
                    {otherName.slice(0, 1).toUpperCase()}
                  </Text>
                </View>
                <View style={styles.threadBody}>
                  <View style={styles.threadHeader}>
                    <Text style={[TypeScale.label, styles.threadName, { color: palette.text }]} numberOfLines={1}>
                      {otherName}
                    </Text>
                    <Text style={[TypeScale.caption, { color: palette.icon }]}>
                      {formatTimestamp(conversation.lastMessageAt || conversation.updatedAt)}
                    </Text>
                  </View>
                  <Text style={[TypeScale.body, styles.preview, { color: palette.icon }]} numberOfLines={1}>
                    {conversation.lastMessagePreview || 'Say hi before you arrive.'}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <EmptyState
          headline="No conversations yet"
          body="Chats start when you join a session."
          actionLabel="Find a session"
          onAction={() => router.push('/sessions')}
        />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    gap: Space.lg,
    padding: Space.lg + 4,
    paddingBottom: Space.xxl + 4,
  },
  header: {
    gap: Space.xs,
  },
  threadList: {
    gap: Space.md,
  },
  threadCard: {
    alignItems: 'center',
    borderRadius: Radius.card,
    borderTopRightRadius: Radius.accentCorner,
    borderWidth: StyleSheet.hairlineWidth * 2,
    flexDirection: 'row',
    gap: Space.md,
    padding: Space.lg,
  },
  avatar: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  avatarInitial: {
    fontFamily: FontFamily.code,
    fontSize: 17,
    lineHeight: 22,
  },
  threadBody: {
    flex: 1,
    gap: 2,
  },
  threadHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Space.sm,
    justifyContent: 'space-between',
  },
  threadName: {
    flexShrink: 1,
  },
  preview: {
    fontSize: 14,
    lineHeight: 20,
  },
  loadingArea: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 160,
  },
});
