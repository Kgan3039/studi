import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useFocusEffect, useRouter } from 'expo-router';
import { type ComponentProps, useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Timestamp } from 'firebase/firestore';
import type { User } from 'firebase/auth';

import { Colors, Elevation, Radius, Space, TypeScale } from '@/constants/theme';
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
  const insets = useSafeAreaInsets();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [previewItems, setPreviewItems] = useState<AppNotification[]>([]);

  useEffect(() => {
    const unsubscribe = subscribeToAuthState(setCurrentUser);
    return unsubscribe;
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

    setIsOpen(false);
    if (isAllowedNotificationUrl(notification.url) && notification.url !== '/notifications') {
      router.push(notification.url as never);
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

  function handleViewAll() {
    setIsOpen(false);
    router.push('/notifications');
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
            backgroundColor: palette.surface,
            borderColor: palette.border,
            opacity: pressed ? 0.7 : 1,
          },
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

      <Modal
        animationType="fade"
        onRequestClose={() => setIsOpen(false)}
        statusBarTranslucent
        transparent
        visible={isOpen}>
        <View style={styles.overlay}>
          <Pressable
            accessibilityLabel="Close notifications"
            accessibilityRole="button"
            onPress={() => setIsOpen(false)}
            style={StyleSheet.absoluteFill}
          />
          <View
            accessibilityViewIsModal
            style={[
              styles.previewCard,
              Elevation.e3,
              {
                backgroundColor: palette.background,
                borderColor: palette.border,
                top: insets.top + Space.md,
              },
            ]}>
            <View style={styles.previewHeader}>
              <View>
                <Text style={[TypeScale.h2, { color: palette.text }]}>Notifications</Text>
                <Text style={[TypeScale.caption, { color: palette.icon }]}>Recent activity</Text>
              </View>
              {unreadCount > 0 ? (
                <Pressable
                  accessibilityLabel="Mark all notifications read"
                  accessibilityRole="button"
                  onPress={handleMarkAllRead}
                  style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
                  <Text style={[TypeScale.label, { color: palette.tint }]}>Mark all read</Text>
                </Pressable>
              ) : null}
            </View>

            {isLoadingPreview ? (
              <View style={styles.previewLoading}>
                <ActivityIndicator color={palette.tint} />
              </View>
            ) : previewItems.length > 0 ? (
              <View style={styles.previewList}>
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
                          backgroundColor: unread ? palette.surface : palette.surfaceMuted,
                          borderColor: unread ? `${palette.tint}40` : palette.border,
                          opacity: pressed ? 0.7 : 1,
                        },
                      ]}>
                      <View
                        style={[
                          styles.previewIcon,
                          { backgroundColor: unread ? `${palette.tint}16` : palette.surface },
                        ]}>
                        <MaterialIcons
                          color={unread ? palette.tint : palette.icon}
                          name={ICON_BY_TYPE[item.type] ?? 'notifications-none'}
                          size={18}
                        />
                      </View>
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
                { backgroundColor: palette.surface, borderColor: palette.border, opacity: pressed ? 0.7 : 1 },
              ]}>
              <Text style={[TypeScale.label, { color: palette.text }]}>View all notifications</Text>
              <MaterialIcons color={palette.tint} name="arrow-forward" size={18} />
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  bellButton: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth * 2,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  countBadge: {
    alignItems: 'center',
    borderColor: '#FFFFFF',
    borderRadius: Radius.pill,
    borderWidth: 2,
    justifyContent: 'center',
    minHeight: 18,
    minWidth: 18,
    paddingHorizontal: 4,
    position: 'absolute',
    right: -5,
    top: -5,
  },
  countText: {
    color: '#FFFFFF',
    fontFamily: TypeScale.eyebrow.fontFamily,
    fontSize: 9,
    lineHeight: 11,
  },
  overlay: {
    flex: 1,
  },
  previewCard: {
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth * 2,
    left: Space.md,
    padding: Space.lg,
    position: 'absolute',
    right: Space.md,
  },
  previewHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: Space.md,
  },
  previewLoading: {
    alignItems: 'center',
    minHeight: 132,
    justifyContent: 'center',
  },
  previewList: {
    gap: Space.sm,
  },
  previewRow: {
    alignItems: 'center',
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth * 2,
    flexDirection: 'row',
    gap: Space.sm + 2,
    minHeight: 62,
    padding: Space.sm + 2,
  },
  previewIcon: {
    alignItems: 'center',
    borderRadius: Radius.md,
    height: 36,
    justifyContent: 'center',
    width: 36,
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
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth * 2,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: Space.md,
    minHeight: 46,
    paddingHorizontal: Space.md,
  },
});
