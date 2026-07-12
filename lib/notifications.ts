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
const NOTIFICATION_URL_PATTERN = /^\/(?:conversation|session)\/[^/?#]+$/;

/**
 * Allowlist for navigation triggered by notification payloads — push taps and
 * Notifications Center rows both validate through here. Only in-app routes
 * that exist today pass: /conversation/{id}, /session/{id}, /notifications.
 */
export function isAllowedNotificationUrl(url: unknown): url is string {
  return typeof url === 'string' && (NOTIFICATION_URL_PATTERN.test(url) || url === '/notifications');
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

export async function addNotificationResponseListener(
  onTap: (target: NotificationTapTarget) => void
) {
  const Notifications = await getNotificationsModule();

  if (!Notifications) {
    return () => {};
  }

  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const target = getNotificationTapTarget(response);
    if (target) {
      onTap(target);
    }
  });

  const lastResponse = await Notifications.getLastNotificationResponseAsync();
  const lastTarget = getNotificationTapTarget(lastResponse);
  if (lastTarget) {
    onTap(lastTarget);
  }

  return () => subscription.remove();
}
