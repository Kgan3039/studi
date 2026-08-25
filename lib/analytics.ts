// lib/analytics.ts — vendor-agnostic analytics wrapper (PostHog underneath, D6).
// Every product event flows through track(); swapping vendors later touches
// only this file. Events are defined in docs/metrics.md — add new events there
// first, here second.

import PostHog from "posthog-react-native";
import type { PostHogCustomStorage } from "posthog-react-native";

// Project API key is a public client key (like the Firebase web key) — safe to ship.
// Set EXPO_PUBLIC_POSTHOG_API_KEY from PostHog project settings.
const POSTHOG_API_KEY = process.env.EXPO_PUBLIC_POSTHOG_API_KEY ?? "";
const POSTHOG_HOST = "https://us.i.posthog.com";

let client: PostHog | null = null;
let warnedMissingKey = false;

const memoryStorage: PostHogCustomStorage = (() => {
  const memory: Record<string, string> = {};

  return {
    getItem: (key) => memory[key] ?? null,
    setItem: (key, value) => {
      memory[key] = value;
    },
  };
})();

export async function initAnalytics() {
  if (client) return;

  if (!POSTHOG_API_KEY) {
    if (!warnedMissingKey && !__DEV__) {
      warnedMissingKey = true;
      console.warn("PostHog analytics disabled: EXPO_PUBLIC_POSTHOG_API_KEY is missing.");
    }
    return;
  }

  try {
    client = new PostHog(POSTHOG_API_KEY, {
      host: POSTHOG_HOST,
      persistence: "memory",
      customStorage: memoryStorage,
      enableSessionReplay: false,
      flushAt: 10,
      flushInterval: 30_000,
    });
  } catch {
    // Analytics must never break the app.
    client = null;
  }
}

export type AnalyticsEvent =
  | "app_open"
  | "sign_up_started"
  | "sign_up_completed"
  | "email_verified"
  | "sign_in_completed"
  | "classes_saved"
  | "onboarding_complete"
  | "profile_completed"
  | "profile_updated"
  | "settings_viewed"
  | "notification_pref_toggled"
  | "notifications_viewed"
  | "notification_opened"
  | "notifications_mark_all_read"
  | "session_create_started"
  | "session_created"
  | "session_joined"
  | "session_join_blocked_full"
  | "blocked_session_warning_shown"
  | "blocked_session_join_anyway"
  | "blocked_session_cancel"
  | "session_viewed"
  | "session_left"
  | "session_cancelled"
  | "map_directions_opened"
  | "uw_map_opened"
  | "message_sent"
  | "message_edited"
  | "message_unsent"
  | "messages_deleted_for_self"
  | "conversation_started"
  | "conversation_quota_blocked"
  | "session_chat_opened"
  | "group_message_sent"
  | "report_submitted"
  | "catalog_request_submitted"
  | "user_blocked"
  | "friends_viewed"
  | "friend_request_sent"
  | "friend_request_accepted"
  | "friend_request_declined"
  | "friend_request_cancelled"
  | "friend_removed"
  | "user_unblocked"
  | "account_deleted"
  | "screen_view";

export function track(event: AnalyticsEvent, properties?: Record<string, string | number | boolean>) {
  try {
    client?.capture(event, properties);
  } catch {
    // never throw from analytics
  }
}

export function identifyUser(uid: string, traits?: { classCount?: number }) {
  try {
    client?.identify(uid, traits);
  } catch {
    /* noop */
  }
}

export function resetAnalyticsIdentity() {
  try {
    client?.reset();
  } catch {
    /* noop */
  }
}
