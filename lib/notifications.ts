import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Platform } from 'react-native';

import app, { auth } from '../firebaseConfig';
import {
  PUSH_CLEANUP_TIMEOUT_MS,
  cleanupCurrentPushRegistration,
  createPushRegistrationState,
} from './push-registration-state';

type NotificationRegistrationResult =
  | { status: 'registered'; expoPushToken: string }
  | {
      status: 'denied' | 'signed-out' | 'skipped' | 'unsupported' | 'unavailable' | 'error';
      reason?: string;
    };

type NotificationModule = typeof import('expo-notifications');

let configuredPresentation = false;
const registrationState = createPushRegistrationState({ storage: AsyncStorage });

// Firestore auto-IDs, Firebase uids, and `${uidA}__${uidB}` conversation keys
// all fit this; dots, slashes, backslashes, percent-escapes, and empty
// segments do not. Mirrors functions/notification-validation.js — change
// both together.
const SAFE_ROUTE_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;

/**
 * Strict allowlist for navigation triggered by notification payloads — push
 * taps and Notifications Center rows both validate through here. Valid forms:
 * `/notifications`, `/friends`, `/conversation/{id}`, `/session/{id}`,
 * `/session-chat/{id}`, `/user/{id}` where {id} is a safe internal ID. The
 * segment must also decode to itself, so traversal (`.`/`..`), percent-encoded
 * separators (%2F, %5C), malformed escapes, and external schemes never pass.
 */
export function isAllowedNotificationUrl(url: unknown): url is string {
  if (typeof url !== 'string') {
    return false;
  }

  if (url === '/notifications' || url === '/friends') {
    return true;
  }

  const match = /^\/(conversation|session|session-chat|user)\/([^/]+)$/.exec(url);
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

  const resumedAfterCleanup = registrationState.resume(currentUser.uid);
  return registrationState.run(currentUser.uid, async () => {
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
      if (auth.currentUser?.uid !== currentUser.uid) {
        return { status: 'signed-out' };
      }

      const installationId = await registrationState.getInstallationId();
      const storedState = await registrationState.getSnapshot(currentUser.uid);

      const intent = await registrationState.createRegistrationIntent(
        currentUser.uid,
        token.data,
        resumedAfterCleanup
      );
      if (auth.currentUser?.uid !== currentUser.uid) {
        return { status: 'signed-out' };
      }

      const registerPushToken = httpsCallable<
        Record<string, unknown>,
        { status: string; generation: number }
      >(getFunctions(app, 'us-central1'), 'registerPushToken');
      const registrationResult = await registerPushToken({
        token: token.data,
        ...(storedState.active?.token && storedState.active.token !== token.data
          ? { previousToken: storedState.active.token }
          : {}),
        installationId,
        registrationId: intent.registrationId,
        generation: intent.generation,
        platform: Platform.OS,
        projectId,
      });

      if (auth.currentUser?.uid !== currentUser.uid) {
        return { status: 'signed-out' };
      }
      if (!Number.isSafeInteger(registrationResult.data.generation) || registrationResult.data.generation < 1) {
        return { status: 'error' };
      }
      await registrationState.markRegistered(currentUser.uid, {
        ...intent,
        generation: registrationResult.data.generation,
      });

      return { status: 'registered', expoPushToken: token.data };
    } catch (error) {
      if (__DEV__) {
        console.warn('Push notification registration skipped:', error);
      }
      return { status: 'error' };
    }
  });
}

type PushCleanupEntry = {
  token: string;
  installationId: string;
  registrationId: string;
  generation: number;
};

async function unregisterPushTokenForUid(uid: string, entry: PushCleanupEntry) {
  if (auth.currentUser?.uid !== uid || !entry.token) return false;
  try {
    const unregister = httpsCallable<
      PushCleanupEntry,
      { status: 'unregistered' | 'stale'; removed: boolean }
    >(getFunctions(app, 'us-central1'), 'unregisterPushToken');
    const result = await unregister(entry);
    return result.data?.removed === true;
  } catch (error) {
    if (__DEV__) {
      console.warn('Push notification unregister skipped:', error);
    }
    return false;
  }
}

export async function unregisterPushToken(expoPushToken: string) {
  const uid = auth.currentUser?.uid;
  if (!uid) return false;
  const state = await registrationState.getSnapshot(uid);
  const entry = [state.active, ...state.pending].find(
    (candidate) => candidate?.token === expoPushToken
  );
  if (!entry) return false;
  return unregisterPushTokenForUid(uid, {
    ...entry,
    installationId: await registrationState.getInstallationId(),
  });
}

/**
 * Bounded best-effort sign-out cleanup. Active and uncertain registrations are
 * persisted per UID in AsyncStorage before the callable runs. Failed or timed
 * out tokens stay there for the next authenticated registration to reconcile;
 * the server's owner check makes a former owner's stale retry harmless.
 */
export async function unregisterCurrentPushToken() {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  await cleanupCurrentPushRegistration({
    state: registrationState,
    uid,
    getInstallationId: () => registrationState.getInstallationId(),
    unregister: (entry) => unregisterPushTokenForUid(uid, entry),
    timeoutMs: PUSH_CLEANUP_TIMEOUT_MS,
  });
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
