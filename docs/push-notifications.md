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
  `session_reminder`, and `group_message` (session group chat —
  `onSessionMessageCreated` notifies every participant except the sender and
  stamps `lastMessageAt`/`lastMessageSenderId` onto the session doc for the
  unread indicator; never message content, since session docs are readable by
  all verified users). `friend_request` and `friend_accepted` are reserved in
  the schema but not produced.
- `/notifications` screen (protected) with unread badge on the Profile tab.

Not implemented: App Check, RNFirebase messaging, friend notifications,
client dismiss (no delete rule; records expire via TTL).

Group-message notifications are **block-filtered server-side**: before
`notifyUser()` runs, `onSessionMessageCreated` checks both directions of the
deterministic `userBlocks/{blocker}__{blocked}` docs in one batched `getAll`
and drops blocked recipients entirely — no record, no push, regardless of any
preference setting (the filter runs upstream of the pref check). The chat
message itself stays stored for the remaining participants; client
bubble-hiding is a UI courtesy on top, not the enforcement.

Group-chat fanout is **capped at 20 participants**
(`MAX_GROUP_CHAT_PARTICIPANTS`), judged on the ACTUAL `participantIds`
length — never the optional capacity field — so legacy uncapped sessions
cannot force unbounded fanout. The same ceiling is enforced in three places
(change them together): the messages create rule in `firestore.rules`
(`participantIds.size() <= 20`), the client's read-only chat state
(`lib/firestore.ts` `isGroupChatAvailable`), and the Cloud Function, which
skips metadata + notifications entirely for oversized sessions rather than
silently notifying a subset. Exact read cost: **at most 38 block-doc reads
per message** — a full 20-participant session minus the sender is 19
recipients × 2 directions, fetched in a single RPC.

A cancelled session is read-only — rules deny new sends while retained
participants keep the history — and group messages are fully immutable from
the client (no edits, no deletes; account deletion cleans them up via the
Admin SDK).

## Payload validation & deep-link safety

Every payload passes through `normalizeNotificationPayload()`
(`functions/notification-validation.js`) before `notifyUser()` writes or
pushes anything: type must be one of the 8 schema types, title/body are
trimmed and bounded (120/300 chars), optional actor/session/conversation IDs
must match `[A-Za-z0-9_-]{1,200}`, and the URL must pass the internal-route
allowlist. Invalid payloads are dropped — no record, no push.

URL rules (server and client — the client mirror is
`isAllowedNotificationUrl()` in `lib/notifications.ts`; change both
together): exactly `/notifications`, `/conversation/{id}`, `/session/{id}`,
or `/session-chat/{id}`, where `{id}` matches the safe-ID pattern and decodes
to itself. Traversal (`.`/`..`), percent-encoded separators (`%2F`, `%5C`),
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
| Group message | `gm_{sessionId}_{eventId}` | participants except sender; session-scoped like the DM equivalent |

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
- Deleting an account removes the user's notification records and chat read
  markers (covered by the existing `recursiveDelete` on `users/{uid}`), the
  full hosted-session trees including their chat messages, and every group
  message the user sent elsewhere (collection-group query on `senderId` —
  needs the `messages.senderId` `COLLECTION_GROUP` field override in
  `firestore.indexes.json`, deployed with `firebase deploy --only
  firestore:indexes`).

Group chat (this PR):
- A message from A creates a `group_message` record for every other
  participant (never A) and pushes unless `groupMessages` is toggled off;
  tap opens `/session-chat/{id}`.
- A blocked pair (either direction) gets neither the record nor the push,
  even with every preference enabled; an unrelated participant in the same
  session still gets both.
- Cancelling a session flips its chat to read-only: the notice renders, the
  composer disables, failed sends stop offering retry, and a deep link into
  the cancelled chat shows history without crashing.
- Account deletion is job-tracked and resumable. A fresh request (recent
  auth + rate limit) writes a durable `accountDeletionJobs/{uid}` marker
  (Admin-only; clients denied by rules), then disables the account and
  revokes refresh tokens, then runs the idempotent, page-bounded cleanup —
  auth-user deletion last, `status: complete` after that. Resume requires
  the marker: re-calling the callable continues the caller's own active job
  (a **moderation-disabled account without a job is rejected and never
  enters cleanup**), and after the user's ID token expires (≤1 h), ops
  resumes with
  `GOOGLE_APPLICATION_CREDENTIALS=<service-account.json> node scripts/resume-account-deletion.js <uid>`
  — the script strictly validates the uid before touching Firebase, pins the
  Admin SDK to `studi-b02c3` (any other ambient/resolved project aborts),
  and refuses to run unless a well-formed active job naming that exact uid
  exists — so ops can't delete a merely-disabled account either. Every
  lifecycle phase (lock, running-write, each step, auth deletion, final
  complete-write) persists failures to the job doc (`status: failed`,
  bounded `errorCode`, failing phase in `lastStep`, `attemptCount`).
  State machine unit tests: `npm run test:deletion`. Remaining live QA: one
  end-to-end deletion against a dev project (no CF integration harness in
  the repo).
- The Session Details chat card shows the unread dot only for someone else's
  message arriving after your last visit to the chat, and clears when you
  come back from the chat.
- Joining a session lands you in its chat; sends appear instantly, a failed
  send shows "Not sent · Tap to retry", and retrying never duplicates.
- Scrolling up pages older messages 30 at a time; messages from blocked
  users stay hidden.
