import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useFocusEffect, useRouter } from 'expo-router';
import { type ComponentProps, useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Timestamp } from 'firebase/firestore';
import type { User } from 'firebase/auth';

import { Sheet } from '@/components/ui/Sheet';
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
} from '@/lib/firestore';
import { isAllowedNotificationUrl } from '@/lib/notifications';

const PREVIEW_SIZE = 3;

const ICON_BY_TYPE: Record<string, ComponentProps<typeof MaterialIcons>['name']> = {
  dm_message: 'chat-bubble-outline',
  group_message: 'forum',
  session_joined: 'group-add',
  session_updated: 'event-available',
  session_cancelled: 'event-busy',
  session_reminder: 'schedule',
  friend_request: 'person-add-alt-1',
  friend_accepted: 'people-outline',
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

/**
 * Lightweight in-app inbox entry. A bell belongs in the top bar, while the
 * full screen remains the home for history, filtering, and pagination.
 */
export function NotificationCenterButton() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [previewItems, setPreviewItems] = useState<AppNotification[]>([]);
  const pendingRouteRef = useRef<string | null>(null);
  const navigationFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeToAuthState(setCurrentUser);
    return () => {
      unsubscribe();
      if (navigationFallbackRef.current) {
        clearTimeout(navigationFallbackRef.current);
      }
    };
  }, []);

  const loadUnreadCount = useCallback(async () => {
    if (!currentUser) {
      setUnreadCount(0);
      return;
    }

    try {
      setUnreadCount(await getUnreadNotificationCount(currentUser.uid));
    } catch {
      // The bell is still useful without a count. A failed aggregation read
      // should never block a screen header.
    }
  }, [currentUser]);

  useFocusEffect(
    useCallback(() => {
      void loadUnreadCount();
    }, [loadUnreadCount])
  );

  const loadPreview = useCallback(async () => {
    if (!currentUser) {
      setPreviewItems([]);
      return;
    }

    setIsLoadingPreview(true);
    try {
      const page = await getNotificationsPage(currentUser.uid, null, PREVIEW_SIZE);
      setPreviewItems(page.notifications);
    } catch {
      setPreviewItems([]);
    } finally {
      setIsLoadingPreview(false);
    }
  }, [currentUser]);

  async function handleOpenCenter() {
    setIsOpen(true);
    await Promise.all([loadPreview(), loadUnreadCount()]);
  }

  function setPreviewItemRead(notificationId: string, readAt: Timestamp | null) {
    setPreviewItems((current) =>
      current.map((item) => (item.notificationId === notificationId ? { ...item, readAt } : item))
    );
  }

  function handleOpenNotification(notification: AppNotification) {
    track('notification_opened', { type: notification.type, source: 'bell' });

    if (currentUser && !notification.readAt) {
      setPreviewItemRead(notification.notificationId, Timestamp.now());
      setUnreadCount((count) => Math.max(0, count - 1));
      markNotificationRead(currentUser.uid, notification.notificationId).catch(() => {
        setPreviewItemRead(notification.notificationId, null);
        void loadUnreadCount();
      });
    }

    if (isAllowedNotificationUrl(notification.url) && notification.url !== '/notifications') {
      closeAndNavigate(notification.url);
    } else {
      setIsOpen(false);
    }
  }

  async function handleMarkAllRead() {
    if (!currentUser || unreadCount === 0) {
      return;
    }

    const previousItems = previewItems;
    const previousUnreadCount = unreadCount;
    const now = Timestamp.now();
    setPreviewItems((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? now })));
    setUnreadCount(0);

    try {
      const count = await markAllNotificationsRead(currentUser.uid);
      track('notifications_mark_all_read', { count, source: 'bell' });
    } catch {
      setPreviewItems(previousItems);
      setUnreadCount(previousUnreadCount);
    }
  }

  function finishPendingNavigation() {
    if (navigationFallbackRef.current) {
      clearTimeout(navigationFallbackRef.current);
      navigationFallbackRef.current = null;
    }

    const route = pendingRouteRef.current;
    pendingRouteRef.current = null;
    if (route) {
      router.push(route as never);
    }
  }

  function closeAndNavigate(route: string) {
    pendingRouteRef.current = route;
    setIsOpen(false);

    // Native Modal dismissal is asynchronous. onDismiss handles iOS; this
    // fallback keeps the same interaction reliable on Android.
    navigationFallbackRef.current = setTimeout(finishPendingNavigation, 350);
  }

  function handleViewAll() {
    closeAndNavigate('/notifications');
  }

  const badgeLabel = unreadCount > 99 ? '99+' : String(unreadCount);

  return (
    <>
      <Pressable
        accessibilityHint="Opens recent notifications"
        accessibilityLabel={
          unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'
        }
        accessibilityRole="button"
        hitSlop={8}
        onPress={handleOpenCenter}
        style={({ pressed }) => [
          styles.bellButton,
          {
            opacity: pressed ? 0.7 : 1,
          },
          pressed ? { backgroundColor: palette.surfaceMuted, transform: [{ scale: 0.94 }] } : null,
        ]}>
        <MaterialIcons color={palette.text} name="notifications-none" size={22} />
        {unreadCount > 0 ? (
          <View
            style={[
              styles.countBadge,
              { backgroundColor: palette.tint, borderColor: palette.background },
            ]}>
            <Text style={styles.countText}>{badgeLabel}</Text>
          </View>
        ) : null}
      </Pressable>

      <Sheet
        visible={isOpen}
        onClose={() => setIsOpen(false)}
        onDismissed={finishPendingNavigation}
        title="Notifications"
        subtitle="Recent activity"
        headerAction={
          unreadCount > 0 ? (
            <Pressable
              accessibilityLabel="Mark all notifications read"
              accessibilityRole="button"
              onPress={handleMarkAllRead}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
              <Text style={[TypeScale.label, { color: palette.tint }]}>Mark All Read</Text>
            </Pressable>
          ) : null
        }
        scroll={false}>
        <View style={styles.previewBodyWrap}>
            {isLoadingPreview ? (
              <View style={styles.previewLoading}>
                <ActivityIndicator color={palette.tint} />
              </View>
            ) : previewItems.length > 0 ? (
              <View style={[styles.previewList, { borderTopColor: palette.border }]}>
                {previewItems.map((item) => {
                  const unread = !item.readAt;
                  return (
                    <Pressable
                      accessibilityLabel={`${unread ? 'Unread notification' : 'Notification'}: ${item.title}`}
                      accessibilityRole="button"
                      key={item.notificationId}
                      onPress={() => handleOpenNotification(item)}
                      style={({ pressed }) => [
                        styles.previewRow,
                        {
                          borderBottomColor: palette.border,
                          opacity: pressed ? 0.7 : 1,
                        },
                      ]}>
                      <MaterialIcons
                        color={unread ? palette.tint : palette.icon}
                        name={ICON_BY_TYPE[item.type] ?? 'notifications-none'}
                        size={21}
                      />
                      <View style={styles.previewCopy}>
                        <View style={styles.previewTitleRow}>
                          <Text
                            numberOfLines={1}
                            style={[TypeScale.label, styles.previewTitle, { color: palette.text }]}>
                            {item.title}
                          </Text>
                          <Text style={[TypeScale.caption, { color: palette.icon }]}>
                            {formatTimestamp(item.createdAt)}
                          </Text>
                        </View>
                        <Text
                          numberOfLines={1}
                          style={[TypeScale.caption, styles.previewBody, { color: palette.icon }]}>
                          {item.body}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <View style={styles.emptyPreview}>
                <MaterialIcons color={palette.icon} name="notifications-off" size={22} />
                <Text style={[TypeScale.bodyStrong, { color: palette.text }]}>You’re all caught up</Text>
                <Text style={[TypeScale.caption, { color: palette.icon }]}>New activity will appear here.</Text>
              </View>
            )}

            <Pressable
              accessibilityLabel="View all notifications"
              accessibilityRole="button"
              onPress={handleViewAll}
              style={({ pressed }) => [
                styles.viewAllButton,
                { opacity: pressed ? 0.7 : 1 },
              ]}>
              <Text style={[TypeScale.label, { color: palette.text }]}>View All Notifications</Text>
              <MaterialIcons color={palette.tint} name="arrow-forward" size={18} />
            </Pressable>
        </View>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  bellButton: {
    alignItems: 'center',
    borderRadius: Radius.md,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  countBadge: {
    alignItems: 'center',
    borderColor: '#FFFFFF',
    borderRadius: Radius.pill,
    borderWidth: 1.5,
    justifyContent: 'center',
    minHeight: 16,
    minWidth: 16,
    paddingHorizontal: 3,
    position: 'absolute',
    // The button is a 44pt target around a 22pt bell, so anchoring to the
    // button's corner leaves the count floating in empty space. These offsets
    // sit it on the bell itself.
    right: 5,
    top: 4,
  },
  countText: {
    color: '#FFFFFF',
    fontFamily: TypeScale.eyebrow.fontFamily,
    fontSize: 9,
    lineHeight: 11,
  },
  previewBodyWrap: {
    paddingHorizontal: Space.lg,
  },
  previewLoading: {
    alignItems: 'center',
    minHeight: 132,
    justifyContent: 'center',
  },
  previewList: {
    // The sheet header already draws a rule here; a second one reads as a seam.
    borderTopWidth: 0,
  },
  previewRow: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: Space.md,
    minHeight: 64,
    paddingHorizontal: Space.xs,
    paddingVertical: Space.md,
  },
  previewCopy: {
    flex: 1,
    gap: 1,
  },
  previewTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Space.sm,
    justifyContent: 'space-between',
  },
  previewTitle: {
    flexShrink: 1,
  },
  previewBody: {
    fontSize: 13,
    lineHeight: 18,
  },
  emptyPreview: {
    alignItems: 'center',
    gap: Space.xs,
    paddingVertical: Space.xl,
  },
  viewAllButton: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 52,
    paddingHorizontal: Space.xs,
  },
});
