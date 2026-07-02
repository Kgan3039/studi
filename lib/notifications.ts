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

export function getNotificationUrl(response: unknown) {
  const data = (response as {
    notification?: { request?: { content?: { data?: Record<string, unknown> } } };
  })?.notification?.request?.content?.data;
  const url = data?.url;

  if (typeof url !== 'string') {
    return null;
  }

  if (NOTIFICATION_URL_PATTERN.test(url)) {
    return url;
  }

  return null;
}

export async function addNotificationResponseListener(onUrl: (url: string) => void) {
  const Notifications = await getNotificationsModule();

  if (!Notifications) {
    return () => {};
  }

  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const url = getNotificationUrl(response);
    if (url) {
      onUrl(url);
    }
  });

  const lastResponse = await Notifications.getLastNotificationResponseAsync();
  const lastUrl = getNotificationUrl(lastResponse);
  if (lastUrl) {
    onUrl(lastUrl);
  }

  return () => subscription.remove();
}
