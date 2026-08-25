# Bound interval rate-limit rollout

## First public release status

Phase 2 is active. All current clients write `{ updatedAt, lastResourceId }`,
and rules reject the legacy unbound shape. Studi has no earlier public App
Store client; internal development/TestFlight builds must be upgraded before
these rules are deployed.

## Historical Phase 1

Updated clients write `{ updatedAt, lastResourceId }` for `createSession`,
`sendMessage`, `updateMessage`, `reportUser`, and `locationRating`. `lastResourceId` is the exact
Firestore path created by the same batch. Rules verify the path at the protected
write, so one bound limiter cannot authorize two distinct resources.

Historical clients wrote `{ updatedAt }`, so Phase 1 accepted both shapes. This was
backward compatible, but a deliberately modified legacy client could reuse
one old-shape limiter write within a batch. Phase 1 therefore improved updated
clients without claiming to close the bypass globally.

| Action | Resource |
|---|---|
| `createSession` | `sessions/{sessionId}` |
| `sendMessage` | `conversations/{conversationId}/messages/{messageId}` or `sessions/{sessionId}/messages/{messageId}` |
| `updateMessage` | The exact DM or session message edited or reacted to; 1-second interval |
| `reportUser` | `reports/{reportId}` |
| `locationRating` | `locationRatings/{locationId}__{uid}` |

`catalogRequest` and `friendRequest` retain their existing
`lastRequestId` designs. `createConversation` retains its fixed-window counter.

## Completed Phase 2 cutover

The legacy branches have been removed. The release candidate already contains
every required bound write; old internal/TestFlight builds are unsupported once
strict rules are enabled.

Message edits and reactions use the strict `updateMessage` shape: the limiter
write must be atomic with a real mutation of the bound message, and a one-second
server interval limits automated churn without changing the 15-minute edit or
2-minute unsend windows. Unsend does not consume this limiter.

Before deploying the current rules, verify the build on iOS and Android for session create,
DM send, session-chat send, report submission, and rating create/edit. These
actions do not emit a limiter-shape adoption property, so use the minimum
supported version policy and release telemetry rather than unrelated events.
The exact first-public-release order and rollback plan are in
`docs/first-public-release-cutover.md`.
