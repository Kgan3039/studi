import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { subscribeToAuthState } from '@/lib/auth';
import {
  blockUser,
  getBlockedUserIds,
  sendDirectMessage,
  subscribeToConversationMessages,
  type ConversationMessage,
} from '@/lib/firestore';
import type { User } from 'firebase/auth';

function formatTimestamp(value: unknown) {
  if (!value || typeof value !== 'object' || !('toDate' in value)) {
    return '';
  }

  const date = (value as { toDate: () => Date }).toDate();
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
  const [blockedUserIds, setBlockedUserIds] = useState<string[]>([]);

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
      setStatus(
        loadedMessages.length > 0
          ? `Chatting with ${otherUserName || 'Student'}.`
          : `Start the conversation with ${otherUserName || 'Student'}.`
      );
    });

    return unsubscribe;
  }, [conversationId, currentUser, otherUserName]);

  useEffect(() => {
    async function loadBlocks() {
      if (!currentUser) {
        setBlockedUserIds([]);
        return;
      }

      const loadedBlockedUserIds = await getBlockedUserIds(currentUser.uid);
      setBlockedUserIds(loadedBlockedUserIds);
    }

    loadBlocks();
  }, [currentUser]);

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
    if (!currentUser || !otherUserId) {
      return;
    }

    try {
      await blockUser(currentUser.uid, otherUserId);
      setBlockedUserIds((currentIds) => [...new Set([...currentIds, otherUserId])]);
      Alert.alert(
        'User Blocked',
        "They can no longer message you or join a conversation with you. You won't see them in attendee lists."
      );
      router.replace('/messages');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to block this user.';
      Alert.alert('Block Error', message);
    }
  }

  const isBlocked = !!otherUserId && blockedUserIds.includes(otherUserId);

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: palette.background }]}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}>
      <ThemedView style={[styles.hero, { backgroundColor: palette.hero }]}>
        <ThemedText style={[styles.eyebrow, { color: palette.tint }]}>Direct chat</ThemedText>
        <ThemedText type="title" style={styles.heroTitle}>
          {otherUserName || 'Student'}
        </ThemedText>
        <ThemedText style={styles.heroText}>
          Use this space to coordinate times, places, and session details with another student.
        </ThemedText>
      </ThemedView>

      <ThemedView style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <View style={styles.actionRow}>
          <Pressable
            onPress={() =>
              router.push({
                pathname: '/report-user',
                params: {
                  reportedUserId: otherUserId || '',
                  reportedUserName: otherUserName || '',
                  context: 'conversation',
                },
              })
            }
            style={[styles.secondaryButton, { borderColor: palette.outline }]}>
            <ThemedText type="defaultSemiBold">Report</ThemedText>
          </Pressable>

          <Pressable
            onPress={handleBlockUser}
            style={[styles.secondaryButton, { borderColor: palette.outline }]}>
            <ThemedText type="defaultSemiBold">Block</ThemedText>
          </Pressable>
        </View>
      </ThemedView>

      <ThemedView style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <ThemedText type="subtitle">Conversation</ThemedText>
        <ThemedText style={styles.statusText}>{status}</ThemedText>
        <View style={styles.messageColumn}>
          {messages.length > 0 ? (
            messages.map((message) => {
              const isCurrentUser = currentUser?.uid === message.senderId;

              return (
                <View
                  key={message.messageId}
                  style={[
                    styles.messageBubble,
                    {
                      alignSelf: isCurrentUser ? 'flex-end' : 'flex-start',
                      backgroundColor: isCurrentUser ? palette.tint : palette.surfaceMuted,
                    },
                  ]}>
                  <ThemedText
                    lightColor={isCurrentUser ? '#ffffff' : undefined}
                    darkColor={isCurrentUser ? '#ffffff' : undefined}>
                    {message.text}
                  </ThemedText>
                  <ThemedText
                    style={styles.timestamp}
                    lightColor={isCurrentUser ? '#ffffff' : undefined}
                    darkColor={isCurrentUser ? '#ffffff' : undefined}>
                    {formatTimestamp(message.createdAt)}
                  </ThemedText>
                </View>
              );
            })
          ) : (
            <ThemedText style={styles.statusText}>
              No messages yet. Start the thread when you are ready.
            </ThemedText>
          )}
        </View>
      </ThemedView>

      <ThemedView style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <ThemedText style={styles.sectionLabel}>Send a message</ThemedText>
        <TextInput
          editable={!isSending && !isBlocked}
          multiline
          onChangeText={setDraft}
          placeholder={isBlocked ? 'This user is blocked.' : 'Type a message'}
          placeholderTextColor={colorScheme === 'dark' ? '#8aa1a8' : '#7a8f97'}
          style={[styles.input, { borderColor: palette.outline, color: palette.text, opacity: isBlocked ? 0.55 : 1 }]}
          value={draft}
        />
        <Pressable
          disabled={isSending || isBlocked}
          onPress={handleSendMessage}
          style={[styles.primaryButton, { backgroundColor: palette.tint, opacity: isSending || isBlocked ? 0.6 : 1 }]}>
          {isSending ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <ThemedText lightColor="#ffffff" darkColor="#ffffff" type="defaultSemiBold">
              Send Message
            </ThemedText>
          )}
        </Pressable>
      </ThemedView>
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
  sectionLabel: {
    fontSize: 12,
    letterSpacing: 1,
    opacity: 0.72,
    textTransform: 'uppercase',
  },
  statusText: {
    opacity: 0.82,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  secondaryButton: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 16,
  },
  messageColumn: {
    gap: 10,
  },
  messageBubble: {
    borderRadius: 18,
    gap: 6,
    maxWidth: '84%',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  timestamp: {
    fontSize: 12,
    opacity: 0.72,
  },
  input: {
    borderRadius: 14,
    borderWidth: 1,
    fontSize: 16,
    minHeight: 120,
    paddingHorizontal: 14,
    paddingVertical: 12,
    textAlignVertical: 'top',
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 14,
    justifyContent: 'center',
    minHeight: 54,
    paddingHorizontal: 16,
  },
});
