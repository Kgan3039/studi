import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/ui/Avatar';
import { Brand, Colors, FontFamily, Radius, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { track } from '@/lib/analytics';
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
      track('user_blocked', { context: 'conversation' });
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
  const canSend = !isSending && !isBlocked && draft.trim().length > 0;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
      style={[styles.screen, { backgroundColor: palette.background }]}>
      {/* Identity strip under the nav header — sans-only utility surface. */}
      <View style={[styles.identityBar, { borderBottomColor: palette.border }]}>
        <Avatar name={otherUserName || 'Student'} size="sm" verified />
        <View style={styles.identityText}>
          <Text style={[TypeScale.bodyStrong, { color: palette.text }]} numberOfLines={1}>
            {otherUserName || 'Student'}
          </Text>
          <Text style={[TypeScale.caption, { color: palette.icon }]} numberOfLines={1}>
            {status}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
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
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
          <Text style={[TypeScale.label, { color: palette.icon }]}>Report</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={handleBlockUser}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
          <Text style={[TypeScale.label, { color: palette.tint }]}>Block</Text>
        </Pressable>
      </View>

      <ScrollView
        style={styles.thread}
        contentContainerStyle={styles.threadContent}>
        {messages.length > 0 ? (
          messages.map((message, index) => {
            const isCurrentUser = currentUser?.uid === message.senderId;
            const nextMessage = messages[index + 1];
            const showTime =
              !nextMessage || (currentUser?.uid === nextMessage.senderId) !== isCurrentUser;

            return (
              <View
                key={message.messageId}
                style={[styles.messageGroup, isCurrentUser ? styles.mine : styles.theirs]}>
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
            <Text style={[styles.emptyHeadline, { color: palette.text }]}>Say hi 👋</Text>
            <Text style={[TypeScale.body, styles.emptyBody, { color: palette.icon }]}>
              &ldquo;What should I bring?&rdquo; is a great opener.
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
            { backgroundColor: palette.surfaceMuted, opacity: isBlocked ? 0.55 : 1 },
          ]}>
          <TextInput
            editable={!isSending && !isBlocked}
            multiline
            onChangeText={setDraft}
            placeholder={isBlocked ? 'This user is blocked.' : 'Message…'}
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
