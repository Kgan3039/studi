# Bound interval rate-limit rollout

## First public release status

Phase 2 is active. All current clients write `{ updatedAt, lastResourceId }`,
and rules reject the legacy unbound shape. Studi has no earlier public App
Store client; internal development/TestFlight builds must be upgraded before
these rules are deployed.

## Historical Phase 1

Updated clients write `{ updatedAt, lastResourceId }` for `createSession`,
`sendMessage`, `reportUser`, and `locationRating`. `lastResourceId` is the exact
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
| `reportUser` | `reports/{reportId}` |
| `locationRating` | `locationRatings/{locationId}__{uid}` |

`catalogRequest` and updated `friendRequest` clients retain their existing
`lastRequestId` designs. `createConversation` retains its fixed-window counter.

## Completed Phase 2 cutover

The legacy branches have been removed. No additional client change is needed.

Before deploying the current rules, verify the build on iOS and Android for session create,
DM send, session-chat send, report submission, and rating create/edit. These
actions do not emit a limiter-shape adoption property, so use the minimum
supported version policy and release telemetry rather than unrelated events.
