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

## Idempotency

Notification records use deterministic IDs derived from the source event and
are written with `create()` — a trigger retry or overlapping scheduler run
finds the record already present and skips both the write and the push:

| Event | Record ID | Notes |
|---|---|---|
| Direct message | `dm_{messageId}` | recipient only |
| Session join | `join_{sessionId}_{joinerUid}` | host only; a leave/rejoin by the same user intentionally reuses the ID (one alert per person per session) |
| Session cancelled | `cancel_{sessionId}` | participants except host; cancel/reopen/re-cancel can't spam |
| Session updated | `update_{sessionId}_{hash(startTime,endTime,locationId)}` | participants except host; a second *distinct* edit notifies again |
| Session reminder | `reminder_{sessionId}` | host + participants, one per user per session |

## Scheduled reminders

`sendSessionReminders` (v2 `onSchedule`, every 10 minutes) queries sessions
with `status in [open, full]` and `startTime` in `(now, now + 30 min]`, then
notifies every participant. With a 10-minute cadence the reminder lands 20–30
minutes before start; the deterministic record ID keeps it to exactly one per
user per session.

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
