# Notifications — push + in-app pipeline

## Status

Push V1 (`feature/push-notifications-v1`) is **merged to main**: Expo push
registration, private token storage via callables, direct-message and
session-join pushes, and allowlisted tap routing all ship in the app.

The notifications-center PR extends that into a persistent pipeline:

- `users/{uid}/notifications/{id}` records written by a shared `notifyUser()`
  helper in `functions/index.js` — the in-app Notifications Center is a
  complete activity history.
- Preferences (`users/{uid}/private/settings.notificationPrefs`) suppress
  **push delivery only**; in-app records are always created. A missing doc or
  key means enabled.
- Events wired now: `dm_message`, `session_joined`, `session_updated`
  (material time/location edits only), `session_cancelled`,
  `session_reminder`. `group_message`, `friend_request`, and
  `friend_accepted` are reserved in the schema but not produced.
- `/notifications` screen (protected) with unread badge on the Profile tab.

Not implemented: App Check, RNFirebase messaging, group/friend notifications,
client dismiss (no delete rule; records expire via TTL).

## Payload validation & deep-link safety

Every payload passes through `normalizeNotificationPayload()`
(`functions/notification-validation.js`) before `notifyUser()` writes or
pushes anything: type must be one of the 8 schema types, title/body are
trimmed and bounded (120/300 chars), optional actor/session/conversation IDs
must match `[A-Za-z0-9_-]{1,200}`, and the URL must pass the internal-route
allowlist. Invalid payloads are dropped — no record, no push.

URL rules (server and client — the client mirror is
`isAllowedNotificationUrl()` in `lib/notifications.ts`; change both
together): exactly `/notifications`, `/conversation/{id}`, or
`/session/{id}`, where `{id}` matches the safe-ID pattern and decodes to
itself. Traversal (`.`/`..`), percent-encoded separators (`%2F`, `%5C`),
malformed escapes, extra segments, query/hash suffixes, and external schemes
all fail. Push taps additionally dedupe on the delivered notification's
request identifier (module-level set surviving listener re-mounts), so one
physical tap routes — and fires `notification_opened` — exactly once even
when the live listener and `getLastNotificationResponseAsync` both surface
the same response.

Unit tests for all of the above: `npm run test:notifications`.

## Idempotency

Trigger-driven records are keyed on the **CloudEvent ID** (`event.id`):
Eventarc reuses it across retries of one delivery and mints a new one for
every legitimate later event. Records are written with `create()`, so a retry
finds the record already present (`ALREADY_EXISTS`) and skips both the write
and the push — while leave/rejoin, cancel/reopen/re-cancel, and reverting a
session to a prior time/location all notify again. No state hashing. ID
builders live in `functions/notification-validation.js` and are unit-tested
by `npm run test:notifications`.

| Event | Record ID | Notes |
|---|---|---|
| Direct message | `dm_{conversationId}_{eventId}` | recipient only; conversation-scoped against cross-conversation collisions |
| Session join | `join_{eventId}` | host only; a leave/rejoin is a new event and notifies again |
| Session cancelled | `cancel_{eventId}` | participants except host; each real open→cancelled transition notifies |
| Session updated | `update_{eventId}` | participants except host; every distinct material edit notifies, retries dedupe |
| Session reminder | `reminder_{sessionId}_{uid}_{startTimeMillis}` | host + participants; one per recipient per session **start occurrence** — a reschedule reminds again |

## Scheduled reminders

`sendSessionReminders` (v2 `onSchedule`, every 10 minutes) queries sessions
with `status in [open, full]` and `startTime` in `(now + 20 min, now + 30 min]`.
Consecutive runs tile the timeline without overlap, so each start time is
examined by exactly one run and the reminder lands 20–30 minutes before
start; the occurrence-keyed record ID additionally dedupes scheduler retries.

**Beta trade-off (explicit):** a session created less than ~20 minutes before
its own start never enters the query band and receives **no reminder**. A
skipped/failed scheduler run likewise drops that run's 10-minute band rather
than double-sending later.

Deploy prerequisites (not yet deployed):

- **Blaze plan** — scheduled functions require billing.
- **Cloud Scheduler API** — enabled automatically the first time a v2
  `onSchedule` function deploys (the job is provisioned by the deploy).
- **Composite index** `sessions(status ASC, startTime ASC)` — in
  `firestore.indexes.json`, created by `firebase deploy --only firestore:indexes`.

## Firestore TTL (60-day retention)

Every record carries `expiresAt = createdAt + 60 days`. TTL policies cannot be
declared in `firebase.json` / repo config — after deploy, enable it once:

```
gcloud firestore fields ttls update expiresAt \
  --collection-group=notifications --enable-ttl
```

(or Console → Firestore → Time-to-live → add policy on collection group
`notifications`, field `expiresAt`). Until that policy is enabled, records
older than 60 days persist — the client is unaffected either way.

## Required EAS setup

Launch scope: **iOS / TestFlight only** for V1. Android is deferred, so
`android.package` and FCM credentials are intentionally not configured.

- `expo.ios.bundleIdentifier` is `com.joinstudi.app` — registered in App
  Store Connect.
- `expo.extra.eas.projectId` is populated (`eas init` done).
- Configure/verify APNs credentials through EAS (`eas credentials`).
- Remote push must be verified in an EAS development or TestFlight build;
  Expo Go degrades gracefully but is not a valid push test.

## Privacy policy

Status: **done.** In-app (`app/privacy.tsx`) and hosted policies cover Expo
push tokens, delivery through Expo Push Service, purpose limitation, and OS
opt-out. Before release: match the App Store Connect privacy answers (push
token = identifier collected for app functionality, not tracking).

## Manual QA checklist

Push (unchanged from V1):
- Fresh verified user reaches the tab shell and is prompted once for permission.
- Permission denied: app continues, no repeat prompts. Web/Expo Go: no crash.
- DM from A to B pushes only to B; tap opens `/conversation/{id}`.
- Joining a hosted session pushes the host; tap opens `/session/{id}`.
- Invalid/stale Expo tokens are disabled without breaking the source write.

Pipeline + center (this PR):
- Every event above also creates a row in `/notifications` for the recipient,
  even when the matching preference toggle is off (push suppressed only).
- Toggling a preference off in Settings stops pushes for that category.
- Host cancelling a session notifies participants but not the host.
- Host moving a session's time or location notifies participants; a join,
  leave, or capacity-only edit does not.
- Reminder arrives once, 20–30 minutes before start, for host and joiners;
  cancelled sessions produce no reminder.
- Notifications screen: unread rows show the crimson dot/border; tapping a
  row marks it read and routes to the conversation/session; Mark all read
  clears every unread row and survives pull-to-refresh; pagination loads
  older pages; empty and error states render.
- Profile tab badge shows the unread count and clears after reading.
- Deleting an account removes the user's notification records (covered by
  the existing `recursiveDelete` on `users/{uid}`).
