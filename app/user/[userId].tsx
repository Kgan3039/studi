import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { User } from 'firebase/auth';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { CourseChip } from '@/components/ui/CourseChip';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { ScreenTransition } from '@/components/ui/ScreenTransition';
import { Colors, FontFamily, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { subscribeToAuthState } from '@/lib/auth';
import {
  blockUser,
  ConversationQuotaError,
  getOrCreateDirectConversation,
  getUserProfile,
  type UserProfile,
} from '@/lib/firestore';
import {
  acceptFriendRequest,
  cancelFriendRequest,
  declineFriendRequest,
  getFriendStatus,
  isBlockedEitherDirection,
  removeFriend,
  sendFriendRequest,
  sharedClasses,
  type FriendStatus,
} from '@/lib/friends';
import { track } from '@/lib/analytics';

type LoadState = 'loading' | 'ready' | 'error' | 'blocked';

export default function PublicProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const { userId } = useLocalSearchParams<{ userId: string }>();

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [myClasses, setMyClasses] = useState<string[]>([]);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [status, setStatus] = useState<FriendStatus>('none');
  const [confirmAdd, setConfirmAdd] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [actionPending, setActionPending] = useState(false);
  const [openingChat, setOpeningChat] = useState(false);

  useEffect(() => subscribeToAuthState(setCurrentUser), []);

  const load = useCallback(async () => {
    if (!currentUser || !userId) {
      return;
    }
    setLoadState('loading');
    try {
      if (userId === currentUser.uid) {
        // Own profile is edited on the You tab; nothing to friend here.
        const me = await getUserProfile(userId);
        setProfile(me);
        setStatus('self');
        setLoadState('ready');
        return;
      }

      const blocked = await isBlockedEitherDirection(currentUser.uid, userId);
      if (blocked) {
        setLoadState('blocked');
        return;
      }

      const [otherProfile, mine, relation] = await Promise.all([
        getUserProfile(userId),
        getUserProfile(currentUser.uid),
        getFriendStatus(currentUser.uid, userId),
      ]);

      if (!otherProfile) {
        setLoadState('error');
        return;
      }

      setProfile(otherProfile);
      setMyClasses(mine?.classes ?? []);
      setStatus(relation);
      setLoadState('ready');
    } catch {
      setLoadState('error');
    }
  }, [currentUser, userId]);

  useEffect(() => {
    load();
  }, [load]);

  async function runAction(action: () => Promise<void>, nextStatus: FriendStatus) {
    setActionPending(true);
    try {
      await action();
      setStatus(nextStatus);
    } catch {
      // Leave the current status so the button can be retried.
    } finally {
      setActionPending(false);
    }
  }

  function handleFriendAction() {
    if (!currentUser || !userId) return;

    // A pending request in either direction has its own resolution — you can
    // never "add" someone you already have a relationship with. Adding and
    // removing both confirm first; cancelling a request you just sent is the
    // one reversal that doesn't need to ask again.
    if (status === 'none') {
      setConfirmAdd(true);
    } else if (status === 'outgoing') {
      runAction(async () => {
        await cancelFriendRequest(currentUser.uid, userId);
        track('friend_request_cancelled');
      }, 'none');
    } else if (status === 'friends') {
      setConfirmRemove(true);
    }
  }

  function handleConfirmAdd() {
    if (!currentUser || !userId) return;
    runAction(async () => {
      await sendFriendRequest(currentUser.uid, userId);
      track('friend_request_sent', { source: 'profile' });
      setConfirmAdd(false);
    }, 'outgoing');
  }

  function handleAcceptRequest() {
    if (!currentUser || !userId) return;
    runAction(async () => {
      await acceptFriendRequest(currentUser.uid, userId);
      track('friend_request_accepted');
    }, 'friends');
  }

  function handleIgnoreRequest() {
    if (!currentUser || !userId) return;
    runAction(async () => {
      await declineFriendRequest(currentUser.uid, userId);
      track('friend_request_declined');
    }, 'none');
  }

  function handleConfirmRemove() {
    if (!currentUser || !userId) return;
    runAction(async () => {
      await removeFriend(currentUser.uid, userId);
      track('friend_removed');
      setConfirmRemove(false);
    }, 'none');
  }

  function handleConfirmBlock() {
    if (!currentUser || !userId) return;
    runAction(async () => {
      await blockUser(currentUser.uid, userId);
      track('user_blocked', { context: 'profile' });
      setConfirmBlock(false);
      router.back();
    }, 'none');
  }

  async function handleMessage() {
    if (!currentUser || !userId || !profile) return;
    try {
      setOpeningChat(true);
      const conversationId = await getOrCreateDirectConversation(currentUser.uid, userId);
      router.push({
        pathname: '/conversation/[conversationId]',
        params: {
          conversationId,
          otherUserId: userId,
          otherUserName: profile.displayName || '',
        },
      });
    } catch (error) {
      // Quota exhaustion carries approved user-facing copy; anything else stays
      // generic so a denial never hints at whether the other user blocked you.
      Alert.alert(
        'Chat Error',
        error instanceof ConversationQuotaError
          ? error.message
          : 'Unable to open chat right now.'
      );
    } finally {
      setOpeningChat(false);
    }
  }

  const friendActionLabel: Record<FriendStatus, string> = {
    self: '',
    none: 'Add study buddy',
    outgoing: 'Requested, tap to cancel',
    incoming: '',
    friends: 'Study buddies, tap to remove',
  };

  if (loadState === 'loading') {
    return (
      <View style={[styles.center, { backgroundColor: palette.background }]}>
        <Stack.Screen options={{ title: 'Profile' }} />
        <ActivityIndicator color={palette.tint} />
      </View>
    );
  }

  if (loadState === 'blocked') {
    return (
      <View style={[styles.screen, { backgroundColor: palette.background }]}>
        <Stack.Screen options={{ title: 'Profile' }} />
        <EmptyState
          headline="This profile isn't available"
          body="You can't view this student's profile."
        />
      </View>
    );
  }

  if (loadState === 'error' || !profile) {
    return (
      <View style={[styles.screen, { backgroundColor: palette.background }]}>
        <Stack.Screen options={{ title: 'Profile' }} />
        <EmptyState
          headline="Couldn't load this profile"
          body="They may have deleted their account, or the connection dropped."
          actionLabel="Try again"
          onAction={load}
        />
      </View>
    );
  }

  const name = profile.displayName || 'Student';
  const academicLine = [profile.year, profile.major, profile.pronouns]
    .filter(Boolean)
    .join(', ');
  const shared = sharedClasses(myClasses, profile.classes);
  const isSelf = status === 'self';

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: palette.background }]}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Space.xxl }]}>
      <Stack.Screen options={{ title: 'Profile' }} />

      <ScreenTransition style={styles.transition}>
      <View style={styles.identity}>
        <Avatar name={name} size="xl" verified tone="accent" />
        <Text style={[styles.name, { color: palette.text }]} numberOfLines={2}>
          {name}
        </Text>
        {academicLine ? (
          <Text style={[TypeScale.body, { color: palette.icon }]}>{academicLine}</Text>
        ) : null}
        <Text style={[TypeScale.label, { color: palette.tint }]}>Verified @wisc.edu</Text>
      </View>

      {profile.bio ? (
        <Text style={[TypeScale.body, styles.bio, { color: palette.text }]}>{profile.bio}</Text>
      ) : null}

      {!isSelf ? (
        <View style={styles.actions}>
          <Button
            icon="message.fill"
            label={openingChat ? 'Opening…' : 'Message'}
            fullWidth
            loading={openingChat}
            onPress={handleMessage}
          />
          {/* An incoming request is answered, not mirrored — offering "Add"
              here would create a second request pointing the other way. */}
          {status === 'incoming' ? (
            <View style={styles.requestRow}>
              <Button
                label="Accept"
                fullWidth
                loading={actionPending}
                onPress={handleAcceptRequest}
                style={styles.requestAction}
              />
              <Button
                label="Ignore"
                variant="secondary"
                fullWidth
                disabled={actionPending}
                onPress={handleIgnoreRequest}
                style={styles.requestAction}
              />
            </View>
          ) : (
            <Button
              icon={
                status === 'friends' || status === 'outgoing'
                  ? 'person.badge.minus'
                  : 'person.badge.plus'
              }
              label={friendActionLabel[status]}
              variant="secondary"
              fullWidth
              loading={actionPending}
              onPress={handleFriendAction}
            />
          )}

          {/* Match the conversation header's familiar safety icons, but keep
              text labels here because a profile has room for explicit actions. */}
          <View style={styles.safetyActions}>
            <Button
              icon="exclamationmark.triangle"
              label="Report"
              onPress={() =>
                router.push({
                  pathname: '/report-user',
                  params: {
                    reportedUserId: userId,
                    reportedUserName: name,
                    context: 'profile',
                  },
                })
              }
              style={styles.safetyAction}
              variant="secondary"
            />
            <Button
              icon="nosign"
              label="Block"
              onPress={() => setConfirmBlock(true)}
              style={styles.safetyAction}
              variant="secondary"
            />
          </View>
        </View>
      ) : (
        <Text style={[TypeScale.caption, styles.selfNote, { color: palette.icon }]}>
          This is you. Edit your details from the Profile tab.
        </Text>
      )}

      {profile.classes.length > 0 ? (
        <View style={styles.section}>
          <Text style={[TypeScale.sectionTitle, { color: palette.text }]}>
            {shared.length > 0 ? `Classes (${shared.length} shared)` : 'Classes'}
          </Text>
          <View style={styles.chipWrap}>
            {profile.classes.map((code) => (
              <CourseChip key={code} code={code} size="md" selected={shared.includes(code)} />
            ))}
          </View>
        </View>
      ) : null}
      </ScreenTransition>

      <ConfirmDialog
        visible={confirmAdd}
        title={`Send ${name} a study buddy request?`}
        body="They'll see your request and can accept or ignore it."
        confirmLabel="Send request"
        loading={actionPending}
        onConfirm={handleConfirmAdd}
        onCancel={() => setConfirmAdd(false)}
      />

      <ConfirmDialog
        visible={confirmRemove}
        title={`Remove ${name}?`}
        body="You'll both stop being study buddies. You can send a new request later."
        confirmLabel="Remove"
        loading={actionPending}
        onConfirm={handleConfirmRemove}
        onCancel={() => setConfirmRemove(false)}
      />

      <ConfirmDialog
        visible={confirmBlock}
        title={`Block ${name}?`}
        body="They won't be able to message you or see you in sessions, and any buddy request between you is removed."
        confirmLabel="Block"
        loading={actionPending}
        onConfirm={handleConfirmBlock}
        onCancel={() => setConfirmBlock(false)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  content: {
    padding: Space.lg + 4,
    paddingTop: Space.xl,
  },
  transition: {
    gap: Space.xl,
  },
  identity: {
    alignItems: 'center',
    gap: Space.sm,
  },
  name: {
    fontFamily: FontFamily.serifItalic,
    fontSize: 28,
    lineHeight: 34,
    textAlign: 'center',
  },
  bio: {
    textAlign: 'center',
  },
  actions: {
    gap: Space.sm,
  },
  requestRow: {
    flexDirection: 'row',
    gap: Space.sm,
  },
  requestAction: {
    flex: 1,
  },
  safetyActions: {
    flexDirection: 'row',
    gap: Space.sm,
    marginTop: Space.xs,
  },
  safetyAction: {
    flex: 1,
  },
  selfNote: {
    textAlign: 'center',
  },
  section: {
    gap: Space.md,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
  },
});
