import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Timestamp } from 'firebase/firestore';
import type { User } from 'firebase/auth';

import { EmptyState } from '@/components/ui/EmptyState';
import { Colors, Radius, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { track } from '@/lib/analytics';
import { subscribeToAuthState } from '@/lib/auth';
import {
  getNotificationsPage,
  getUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
  type AppNotification,
  type NotificationsPage,
} from '@/lib/firestore';
import { isAllowedNotificationUrl } from '@/lib/notifications';

// Board NotificationsScreen renders type icons as text glyphs in a tinted
// disc — mirrored here so no icon-font plumbing is needed. friend/group
// glyphs are mapped now so reserved types render correctly when they ship.
const GLYPH_BY_TYPE: Record<string, string> = {
  dm_message: '✉',
  group_message: '✉',
  session_joined: '+',
  session_updated: '✦',
  session_cancelled: '✕',
  session_reminder: '◴',
  friend_request: '♟',
  friend_accepted: '♟',
};

function formatTimestamp(value: Timestamp | null) {
  if (!value) {
    return 'Just now';
  }

  const date = value.toDate();
  const now = new Date();

  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function isToday(value: Timestamp | null) {
  // A null createdAt is a serverTimestamp still resolving — brand new.
  return !value || value.toDate().toDateString() === new Date().toDateString();
}

type LoadState = 'loading' | 'ready' | 'error';

export default function NotificationsScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [unreadCount, setUnreadCount] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const cursorRef = useRef<NotificationsPage['cursor']>(null);
  const shouldTrackView = useRef(false);

  useEffect(() => {
    const unsubscribe = subscribeToAuthState((user) => {
      setCurrentUser(user);
    });

    return unsubscribe;
  }, []);

  const loadFirstPage = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!currentUser) {
        return;
      }

      if (!options?.silent) {
        setLoadState('loading');
      }

      try {
        const [page, count] = await Promise.all([
          getNotificationsPage(currentUser.uid),
          getUnreadNotificationCount(currentUser.uid),
        ]);
        setItems(page.notifications);
        cursorRef.current = page.cursor;
        setHasMore(page.hasMore);
        setUnreadCount(count);
        setLoadState('ready');

        // Once per focus, not per retry/refresh.
        if (shouldTrackView.current) {
          shouldTrackView.current = false;
          track('notifications_viewed', { unreadCount: count });
        }
      } catch {
        setLoadState('error');
      } finally {
        setIsRefreshing(false);
      }
    },
    [currentUser]
  );

  useFocusEffect(
    useCallback(() => {
      shouldTrackView.current = true;
      loadFirstPage();
    }, [loadFirstPage])
  );

  async function handleLoadMore() {
    if (!currentUser || !hasMore || isLoadingMore || loadState !== 'ready') {
      return;
    }

    setIsLoadingMore(true);
    try {
      const page = await getNotificationsPage(currentUser.uid, cursorRef.current);
      cursorRef.current = page.cursor;
      setHasMore(page.hasMore);
      setItems((current) => {
        const seen = new Set(current.map((n) => n.notificationId));
        return [...current, ...page.notifications.filter((n) => !seen.has(n.notificationId))];
      });
    } catch {
      // Silent — the next end-reach retries; the loaded list stays usable.
    } finally {
      setIsLoadingMore(false);
    }
  }

  function handleRefresh() {
    setIsRefreshing(true);
    loadFirstPage({ silent: true });
  }

  function setItemReadAt(notificationId: string, readAt: Timestamp | null) {
    setItems((current) =>
      current.map((n) => (n.notificationId === notificationId ? { ...n, readAt } : n))
    );
  }

  function handleOpen(notification: AppNotification) {
    track('notification_opened', { type: notification.type, source: 'center' });

    if (currentUser && !notification.readAt) {
      // Optimistic: flip locally, write through, revert quietly on failure —
      // the row simply shows unread again next time.
      setItemReadAt(notification.notificationId, Timestamp.now());
      setUnreadCount((count) => Math.max(0, count - 1));
      markNotificationRead(currentUser.uid, notification.notificationId).catch(() => {
        setItemReadAt(notification.notificationId, null);
        setUnreadCount((count) => count + 1);
      });
    }

    // Payload URLs never navigate unvalidated, even from our own records.
    if (isAllowedNotificationUrl(notification.url) && notification.url !== '/notifications') {
      router.push(notification.url as never);
    }
  }

  async function handleMarkAllRead() {
    if (!currentUser || unreadCount === 0) {
      return;
    }

    const previousItems = items;
    const previousCount = unreadCount;
    const now = Timestamp.now();
    setItems((current) => current.map((n) => (n.readAt ? n : { ...n, readAt: now })));
    setUnreadCount(0);

    try {
      const count = await markAllNotificationsRead(currentUser.uid);
      track('notifications_mark_all_read', { count });
    } catch {
      setItems(previousItems);
      setUnreadCount(previousCount);
      Alert.alert('Notifications Error', "That didn't save. Check your connection and try again.");
    }
  }

  const sections = [
    { title: 'Today', data: items.filter((n) => isToday(n.createdAt)) },
    { title: 'Earlier', data: items.filter((n) => !isToday(n.createdAt)) },
  ].filter((section) => section.data.length > 0);

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <Stack.Screen
        options={{
          headerRight: () =>
            loadState === 'ready' && unreadCount > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Mark all notifications read"
                hitSlop={8}
                onPress={handleMarkAllRead}
                style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
                <Text style={[TypeScale.label, { color: palette.tint }]}>Mark all read</Text>
              </Pressable>
            ) : null,
        }}
      />

      {loadState === 'loading' ? (
        <View style={styles.centerArea}>
          <ActivityIndicator color={palette.tint} />
        </View>
      ) : loadState === 'error' ? (
        <EmptyState
          headline="Something went off-script."
          body="We couldn't load your notifications."
          actionLabel="Try again"
          onAction={() => loadFirstPage()}
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.notificationId}
          contentContainerStyle={styles.content}
          stickySectionHeadersEnabled={false}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={palette.tint}
            />
          }
          renderSectionHeader={({ section }) => (
            <Text style={[TypeScale.eyebrow, styles.sectionHeader, { color: palette.icon }]}>
              {section.title}
            </Text>
          )}
          renderItem={({ item }) => {
            const unread = !item.readAt;
            const isReminder = item.type === 'session_reminder';

            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${unread ? 'Unread notification' : 'Notification'}: ${item.title}`}
                onPress={() => handleOpen(item)}
                style={({ pressed }) => [
                  styles.row,
                  {
                    backgroundColor: palette.surface,
                    borderColor: unread ? `${palette.tint}4D` : palette.border,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}>
                {unread ? (
                  <View style={[styles.unreadDot, { backgroundColor: palette.tint }]} />
                ) : null}
                <View
                  style={[
                    styles.iconDisc,
                    { backgroundColor: isReminder ? `${palette.tint}1A` : palette.surfaceMuted },
                  ]}>
                  <Text style={[styles.iconGlyph, { color: isReminder ? palette.tint : palette.text }]}>
                    {GLYPH_BY_TYPE[item.type] ?? '✦'}
                  </Text>
                </View>
                <View style={styles.rowBody}>
                  <View style={styles.rowHeader}>
                    <Text
                      style={[TypeScale.label, styles.rowTitle, { color: palette.text }]}
                      numberOfLines={1}>
                      {item.title}
                    </Text>
                    <Text style={[TypeScale.caption, { color: palette.icon }]}>
                      {formatTimestamp(item.createdAt)}
                    </Text>
                  </View>
                  <Text
                    style={[TypeScale.caption, styles.rowText, { color: palette.icon }]}
                    numberOfLines={2}>
                    {item.body}
                  </Text>
                </View>
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <EmptyState
              icon="dot"
              headline="You're all caught up"
              body="Session updates, reminders, and new messages will land here."
              actionLabel="Browse sessions"
              onAction={() => router.push('/sessions')}
            />
          }
          ListFooterComponent={
            isLoadingMore ? (
              <View style={styles.footerLoading}>
                <ActivityIndicator color={palette.tint} />
              </View>
            ) : null
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    padding: Space.lg + 4,
    paddingBottom: Space.xxl + 4,
  },
  centerArea: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 240,
  },
  sectionHeader: {
    marginBottom: Space.sm,
    marginTop: Space.md,
  },
  row: {
    alignItems: 'flex-start',
    borderRadius: Radius.card,
    borderWidth: StyleSheet.hairlineWidth * 2,
    flexDirection: 'row',
    gap: Space.md,
    marginBottom: Space.sm,
    minHeight: 56,
    padding: Space.md + 2,
  },
  unreadDot: {
    borderRadius: Radius.pill,
    height: 8,
    left: -4,
    position: 'absolute',
    top: Space.lg + 4,
    width: 8,
  },
  iconDisc: {
    alignItems: 'center',
    borderRadius: Radius.lg,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  iconGlyph: {
    fontSize: 15,
    lineHeight: 20,
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  rowHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Space.sm,
    justifyContent: 'space-between',
  },
  rowTitle: {
    flexShrink: 1,
  },
  rowText: {
    fontSize: 13,
    lineHeight: 18,
  },
  footerLoading: {
    paddingVertical: Space.lg,
  },
});
