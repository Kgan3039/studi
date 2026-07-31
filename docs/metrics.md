# Studi metrics definitions

Single source of truth for every product event and the resume-facing metrics derived
from them. If a number ends up on a slide or a resume, its definition lives here.

## Events

| Event | Fired where | Properties |
|---|---|---|
| `sign_up_started` | Create-account form submitted | — |
| `sign_up_completed` | `signUp()` succeeds (account exists, unverified) | — |
| `email_verified` | `refreshVerificationState()` returns verified=true (first time) | — |
| `sign_in_completed` | `signIn()` succeeds | — |
| `classes_saved` | Profile classes save succeeds | `count` |
| `profile_updated` | Profile edit save succeeds (name/year/major/pronouns/bio) | `fieldsChanged` (count, never values) |
| `settings_viewed` | Settings screen opened | — |
| `notification_pref_toggled` | Notification preference save succeeds | `category` (pref key), `enabled` |
| `notifications_viewed` | Notifications Center gains focus | `unreadCount` |
| `notification_opened` | Notification acted on — center row tap or push tap (push taps navigate straight to content, so one tap never fires both sources) | `type` (notification type), `source` (`center` \| `push`) |
| `notifications_mark_all_read` | Mark-all-read persists | `count` (rows updated) |
| `session_create_started` | Create-session screen opened | `fromClassId?`, `fromLocationId?` |
| `session_created` | `createSession()` succeeds | `classId`, `hoursUntilStart`, `capacity` |
| `session_joined` | `joinSession()` performs a real join | `classId`, `participantCountAfter` |
| `session_join_blocked_full` | Join attempt lost the race for the last seat (SessionFullError) | `classId` |
| `blocked_session_warning_shown` | Join tapped on a session already containing someone the user has blocked, on any of the three join surfaces. Once per guarded attempt, however many blocked participants are present; repeat taps while one attempt is in flight are dropped. | `sessionId`, `blockedCount` (count only, never uids), `classId` |
| `blocked_session_join_anyway` | "Join Anyway" chosen on that warning; the ordinary join then runs | `sessionId`, `blockedCount`, `classId` |
| `blocked_session_cancel` | Warning dismissed via Cancel (or an Android dialog dismiss); no join attempt. **Never** fired when the roster or block list could not be verified — that path emits nothing at all, so `shown - join_anyway - cancel` is a real "asked but never answered" count, not a bucket of read failures. | `sessionId`, `blockedCount`, `classId` |
| `session_viewed` | Session detail opened | `classId`, `isHost` |
| `session_left` | `leaveSession()` succeeds | `classId` |
| `map_directions_opened` | Directions tapped from the study map | `locationId` |
| `uw_map_opened` | UW layers tapped from the study map | — |
| `conversation_started` | `getOrCreateDirectConversation()` commits a NEW conversation. Never fires when an existing thread is reopened. | `quota_written` (`true` on any client that writes the quota counter; absent on pre-quota builds) |
| `conversation_quota_blocked` | The new-conversation quota is spent, so the transaction is refused client-side and no conversation is created. Fires once per refused attempt, outside the transaction callback so retries never inflate it. | — |
| `message_sent` | `sendDirectMessage()` succeeds | `length` (number, not content) |
| `session_chat_opened` | Session chat screen gains focus (once per focus) | `classId`, `source` (`session_detail` \| `auto_join` \| `deeplink`) |
| `group_message_sent` | `sendSessionMessage()` succeeds | `length` (number, not content) |
| `report_submitted` | Report saved | `reason`, `context` |
| `catalog_request_submitted` | Missing course or location request saved | `type`, `source` |
| `user_blocked` | Block saved | `context` |
| `friends_viewed` | Friends screen gains focus or switches tab | `tab` (`friends` \| `requests` \| `suggested`) |
| `friend_request_sent` | `sendFriendRequest()` succeeds | `source` (`search` \| `suggested` \| `profile`) |
| `friend_request_accepted` | `acceptFriendRequest()` succeeds | — |
| `friend_request_declined` | `declineFriendRequest()` succeeds | — |
| `friend_request_cancelled` | `cancelFriendRequest()` succeeds | — |
| `friend_removed` | `removeFriend()` succeeds | — |
| `account_deleted` | Deletion callable succeeds | — |
| `screen_view` | expo-router pathname change | `pathname` |

**Never** put message text, emails, names, or any PII in properties. uid is the identity
key (PostHog `identify`), traits limited to `classCount`.

### Conversation-quota rollout query

`quota_written` exists for exactly one purpose: proving client adoption before the
new-conversation quota starts being enforced. Full context in
`docs/conversation-quota-rollout.md`.

- **Adoption (the Phase 2 gate)** — `conversation_started` where `quota_written = true`,
  ÷ all `conversation_started`, over a rolling 48h with ≥20 events in the denominator.
  Must be **100%**. The property is absent (not `false`) on pre-quota builds, so anything
  under 100% is a still-installed client that Phase 2 would break.
- **Cap sanity** — count of `conversation_quota_blocked` over the same window. Must be ~0.
  A non-trivial count means real users hit the cap and it should be retuned *before*
  enforcement turns a client-side soft stop into a hard server denial.

Both are pre-enforcement signals. Once Phase 2 ships, a spent quota is denied by rules and
`conversation_quota_blocked` becomes an ordinary abuse/cap-tuning metric instead of a gate.

## Derived metrics (the resume numbers)

- **Verified signups** — count of `email_verified` (unique users). The honest "users" number.
- **Activation rate** — users with `classes_saved` within 1 day of `email_verified`, ÷ verified signups.
- **Liquidity** — weekly `session_created` and `session_joined`; joins-per-created-session
  (target ≥ 1.5 means sessions attract non-hosts).
- **Core action rate** — verified users with ≥1 `session_created` OR `session_joined` in week 1.
- **D7 / D30 retention** — PostHog retention chart anchored on `email_verified`, return
  event = any of session_created / session_joined / message_sent (not mere app opens —
  opens flatter you; actions don't lie).
- **Safety health** — `report_submitted` per WAU (watch for spikes), median time-to-triage
  (manual, from the report inbox process).

## Funnel to watch daily during launch week

`sign_up_started → sign_up_completed → email_verified → classes_saved → (session_joined | session_created)`

The step with the biggest drop is the next week's work. Pre-register your guesses before
launch: the classic killers are verification-email spam-foldering (step 3) and empty class
feeds (step 5).
