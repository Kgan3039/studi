import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Platform } from 'react-native';

import app, { auth } from '../firebaseConfig';

type NotificationRegistrationResult =
  | { status: 'registered'; expoPushToken: string }
  | {
      status: 'denied' | 'signed-out' | 'skipped' | 'unsupported' | 'unavailable' | 'error';
      reason?: string;
    };

type NotificationModule = typeof import('expo-notifications');

let configuredPresentation = false;
let didAttemptRegistration = false;

// Firestore auto-IDs, Firebase uids, and `${uidA}__${uidB}` conversation keys
// all fit this; dots, slashes, backslashes, percent-escapes, and empty
// segments do not. Mirrors functions/notification-validation.js — change
// both together.
const SAFE_ROUTE_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;

/**
 * Strict allowlist for navigation triggered by notification payloads — push
 * taps and Notifications Center rows both validate through here. Valid forms:
 * `/notifications`, `/conversation/{id}`, `/session/{id}` where {id} is a
 * safe internal ID. The segment must also decode to itself, so traversal
 * (`.`/`..`), percent-encoded separators (%2F, %5C), malformed escapes, and
 * external schemes never pass.
 */
export function isAllowedNotificationUrl(url: unknown): url is string {
  if (typeof url !== 'string') {
    return false;
  }

  if (url === '/notifications') {
    return true;
  }

  const match = /^\/(conversation|session)\/([^/]+)$/.exec(url);
  if (!match) {
    return false;
  }

  const segment = match[2];
  if (!SAFE_ROUTE_ID_PATTERN.test(segment)) {
    return false;
  }

  try {
    return decodeURIComponent(segment) === segment;
  } catch {
    return false; // malformed escape sequence
  }
}

function getExpoProjectId() {
  return (
    Constants.easConfig?.projectId ??
    Constants.expoConfig?.extra?.eas?.projectId ??
    undefined
  );
}

function isSupportedNativeRuntime() {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

async function getNotificationsModule(): Promise<NotificationModule | null> {
  if (!isSupportedNativeRuntime()) {
    return null;
  }

  try {
    return await import('expo-notifications');
  } catch {
    return null;
  }
}

async function configureNotificationPresentation() {
  if (configuredPresentation) {
    return;
  }

  const Notifications = await getNotificationsModule();
  if (!Notifications) {
    return;
  }

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
  configuredPresentation = true;
}

export async function registerForPushNotifications(): Promise<NotificationRegistrationResult> {
  const currentUser = auth.currentUser;

  if (!currentUser) {
    return { status: 'signed-out' };
  }

  if (didAttemptRegistration) {
    return { status: 'skipped' };
  }
  didAttemptRegistration = true;

  if (!isSupportedNativeRuntime() || !Device.isDevice) {
    return { status: 'unsupported' };
  }

  const projectId = getExpoProjectId();
  if (!projectId) {
    return { status: 'unavailable', reason: 'Missing Expo EAS projectId.' };
  }

  const Notifications = await getNotificationsModule();
  if (!Notifications) {
    return { status: 'unsupported' };
  }

  try {
    await configureNotificationPresentation();

    const existingPermission = await Notifications.getPermissionsAsync();
    let finalStatus = existingPermission.status;

    if (finalStatus !== 'granted') {
      const requestedPermission = await Notifications.requestPermissionsAsync();
      finalStatus = requestedPermission.status;
    }

    if (finalStatus !== 'granted') {
      return { status: 'denied' };
    }

    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    const registerPushToken = httpsCallable(getFunctions(app, 'us-central1'), 'registerPushToken');
    await registerPushToken({
      expoPushToken: token.data,
      platform: Platform.OS,
      projectId,
    });

    return { status: 'registered', expoPushToken: token.data };
  } catch (error) {
    if (__DEV__) {
      console.warn('Push notification registration skipped:', error);
    }
    return { status: 'error' };
  }
}

export async function unregisterPushToken(expoPushToken: string) {
  if (!auth.currentUser || !expoPushToken) {
    return;
  }

  try {
    const unregister = httpsCallable(getFunctions(app, 'us-central1'), 'unregisterPushToken');
    await unregister({ expoPushToken });
  } catch (error) {
    if (__DEV__) {
      console.warn('Push notification unregister skipped:', error);
    }
  }
}

export type NotificationTapTarget = {
  url: string;
  /** Notification type from the push payload (analytics); absent on old pushes. */
  type?: string;
};

export function getNotificationTapTarget(response: unknown): NotificationTapTarget | null {
  const data = (response as {
    notification?: { request?: { content?: { data?: Record<string, unknown> } } };
  })?.notification?.request?.content?.data;
  const url = data?.url;

  if (!isAllowedNotificationUrl(url)) {
    return null;
  }

  return {
    url,
    ...(typeof data?.type === 'string' ? { type: data.type } : {}),
  };
}

// One tap can surface twice: through the live response listener AND through
// getLastNotificationResponseAsync (cold start, or the listener re-mounting
// on auth changes). Dedupe on the delivered notification's identifier so each
// physical tap routes — and fires notification_opened — exactly once. Module
// level on purpose: it must outlive listener re-mounts.
const handledTapKeys = new Set<string>();
const HANDLED_TAP_KEYS_MAX = 100;

function getTapDedupeKey(response: unknown): string | null {
  const notification = (
    response as { notification?: { request?: { identifier?: unknown }; date?: unknown } }
  )?.notification;

  const identifier = notification?.request?.identifier;
  if (typeof identifier === 'string' && identifier) {
    return identifier;
  }

  // Fallback: delivery timestamp still distinguishes distinct taps.
  return typeof notification?.date === 'number' ? `delivered_${notification.date}` : null;
}

function handleTapResponse(response: unknown, onTap: (target: NotificationTapTarget) => void) {
  const target = getNotificationTapTarget(response);
  if (!target) {
    return;
  }

  const key = getTapDedupeKey(response);
  if (key) {
    if (handledTapKeys.has(key)) {
      return;
    }
    handledTapKeys.add(key);
    if (handledTapKeys.size > HANDLED_TAP_KEYS_MAX) {
      const oldest = handledTapKeys.values().next().value;
      if (oldest !== undefined) {
        handledTapKeys.delete(oldest);
      }
    }
  }

  onTap(target);
}

export async function addNotificationResponseListener(
  onTap: (target: NotificationTapTarget) => void
) {
  const Notifications = await getNotificationsModule();

  if (!Notifications) {
    return () => {};
  }

  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    handleTapResponse(response, onTap);
  });

  const lastResponse = await Notifications.getLastNotificationResponseAsync();
  if (lastResponse) {
    handleTapResponse(lastResponse, onTap);
  }

  return () => subscription.remove();
}
