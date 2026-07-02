# Push Notifications V1

## Branch status

`feature/push-notifications-v1` prepares Expo push notifications for direct messages and session-join alerts. It is not deployed, merged, or ready for production release yet.

Implemented:
- Expo Notifications client registration behind signed-in tab-shell gating.
- Private push-token registration through Cloud Functions callables.
- Direct-message push trigger.
- Hosted-session join push trigger.
- Notification tap routing for `/conversation/{conversationId}` and `/session/{sessionId}`.

Not implemented:
- Session reminders.
- App Check.
- RNFirebase messaging.

## Required EAS setup

Launch scope: **iOS / TestFlight only** for V1. Android is deferred, so `android.package` and Android (FCM) push credentials are intentionally not configured yet.

Before this branch can ship, configure EAS and push credentials:
- Run `eas init` to create the EAS project and populate `expo.extra.eas.projectId` (currently an empty placeholder in `app.json`).
- Configure APNs credentials for iOS through EAS (`eas credentials`).
- Verify token registration in a development build or TestFlight build.

Expo Go may warn that notifications are not fully supported. The app should degrade gracefully, but remote push should be verified in an EAS development or TestFlight build.

## Required app identifiers

Before EAS/TestFlight QA:
- `expo.ios.bundleIdentifier` is set to `com.studi.app` — register/confirm this exact id in App Store Connect.
- Populate `expo.extra.eas.projectId` via `eas init` (empty placeholder until then).
- `expo.android.package` is deferred (iOS-only launch).
- Keep the existing `scheme` value unless deep-link behavior is intentionally changed.

## Privacy policy update

Status: **done.** The in-app policy (`app/privacy.tsx`) and hosted policy (`frontend/website/app/privacy/page.tsx`) both mention:
- Expo push tokens/device notification identifiers.
- Notification delivery through Expo Push Service.
- That tokens are used only to send Studi notifications such as messages and session updates.
- How users can disable notifications through OS settings.

Still required before release: update the App Store Connect privacy answers to match (push token as a collected identifier used for app functionality, not tracking).

## Manual QA checklist

- Fresh verified/onboarded user reaches the tab shell and is prompted for notification permission.
- Permission denied: app continues normally and does not repeatedly prompt.
- Permission granted in an EAS development or TestFlight build: private token doc is created under `users/{uid}/private/pushTokens/tokens/{tokenHash}`.
- Web: no prompt, no crash.
- Expo Go/local dev: no crash if token registration is unsupported.
- Direct message from User A to User B sends a push only to User B.
- Tapping a direct-message notification opens `/conversation/{conversationId}`.
- Joining another user's hosted session sends a push to the host.
- Host joining or already being in their own session sends no push.
- Tapping a session notification opens `/session/{sessionId}`.
- Invalid/stale Expo tokens are disabled without breaking message/session writes.
