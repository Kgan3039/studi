import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { subscribeToAuthState } from '@/lib/auth';
import { subscribeToUserConversations, type ConversationListItem } from '@/lib/firestore';
import type { User } from 'firebase/auth';

function formatTimestamp(value: unknown) {
  if (!value || typeof value !== 'object' || !('toDate' in value)) {
    return 'Just now';
  }

  const date = (value as { toDate: () => Date }).toDate();
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
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
          ? `You have ${loadedConversations.length} conversation${
              loadedConversations.length === 1 ? '' : 's'
            }.`
          : 'No conversations yet. Start from a match or session attendee to message someone.'
      );
      setIsLoading(false);
    });

    return unsubscribe;
  }, [currentUser]);

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: palette.background }]}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}>
      <ThemedView style={[styles.hero, { backgroundColor: palette.hero }]}>
        <ThemedText style={[styles.eyebrow, { color: palette.tint }]}>Coordination</ThemedText>
        <ThemedText type="title" style={styles.heroTitle}>
          Messages
        </ThemedText>
        <ThemedText style={styles.heroText}>
          Coordinate with matches and session partners without leaving Studi.
        </ThemedText>
      </ThemedView>

      <ThemedView style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <View style={styles.sectionHeader}>
          <ThemedText style={styles.sectionLabel}>Inbox</ThemedText>
          <View style={[styles.statusPill, { backgroundColor: palette.surfaceMuted }]}>
            <ThemedText type="defaultSemiBold">{conversations.length} threads</ThemedText>
          </View>
        </View>
        <ThemedText type="subtitle">Your recent conversations</ThemedText>
        <ThemedText style={styles.statusText}>{status}</ThemedText>
      </ThemedView>

      {isLoading ? (
        <View style={styles.loadingArea}>
          <ActivityIndicator color={palette.tint} />
        </View>
      ) : conversations.length > 0 ? (
        conversations.map((conversation) => {
          const otherName =
            conversation.otherParticipant?.displayName ||
            conversation.otherParticipant?.email ||
            'Student';

          return (
            <Pressable
              key={conversation.conversationId}
              onPress={() =>
                router.push({
                  pathname: '/conversation/[conversationId]',
                  params: {
                    conversationId: conversation.conversationId,
                    otherUserId: conversation.otherParticipant?.uid ?? '',
                    otherUserName: otherName,
                    otherUserEmail: conversation.otherParticipant?.email ?? '',
                  },
                })
              }>
              <ThemedView style={[styles.card, styles.threadCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                <View style={styles.sectionHeader}>
                  <ThemedText type="defaultSemiBold">{otherName}</ThemedText>
                  <ThemedText style={styles.timestamp}>
                    {formatTimestamp(conversation.lastMessageAt || conversation.updatedAt)}
                  </ThemedText>
                </View>
                <ThemedText style={styles.statusText}>
                  {conversation.lastMessagePreview || 'Say hello and coordinate your next session.'}
                </ThemedText>
              </ThemedView>
            </Pressable>
          );
        })
      ) : (
        <ThemedView style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <ThemedText type="subtitle">No messages yet</ThemedText>
          <ThemedText>
            Open a match or session detail and start a conversation from there.
          </ThemedText>
        </ThemedView>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    gap: 18,
    padding: 20,
    paddingBottom: 36,
  },
  hero: {
    borderRadius: 24,
    gap: 10,
    padding: 24,
  },
  eyebrow: {
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  heroTitle: { marginBottom: 4 },
  heroText: {
    lineHeight: 30,
    maxWidth: 420,
  },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    gap: 12,
    padding: 20,
    shadowColor: '#082431',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 18,
  },
  threadCard: {
    gap: 8,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sectionLabel: {
    fontSize: 12,
    letterSpacing: 1,
    opacity: 0.72,
    textTransform: 'uppercase',
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  statusText: {
    opacity: 0.82,
  },
  timestamp: {
    fontSize: 13,
    opacity: 0.7,
  },
  loadingArea: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 160,
  },
});
