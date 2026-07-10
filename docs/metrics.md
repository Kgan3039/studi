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
| `session_create_started` | Create-session screen opened | `fromClassId?`, `fromLocationId?` |
| `session_created` | `createSession()` succeeds | `classId`, `hoursUntilStart`, `capacity` |
| `session_joined` | `joinSession()` performs a real join | `classId`, `participantCountAfter` |
| `session_join_blocked_full` | Join attempt lost the race for the last seat (SessionFullError) | `classId` |
| `session_viewed` | Session detail opened | `classId`, `isHost` |
| `session_left` | `leaveSession()` succeeds | `classId` |
| `map_directions_opened` | Directions tapped from the study map | `locationId` |
| `uw_map_opened` | UW layers tapped from the study map | — |
| `conversation_started` | New conversation doc created | — |
| `message_sent` | `sendDirectMessage()` succeeds | `length` (number, not content) |
| `report_submitted` | Report saved | `reason`, `context` |
| `user_blocked` | Block saved | `context` |
| `account_deleted` | Deletion callable succeeds | — |
| `screen_view` | expo-router pathname change | `pathname` |

**Never** put message text, emails, names, or any PII in properties. uid is the identity
key (PostHog `identify`), traits limited to `classCount`.

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
