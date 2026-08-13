# Bound interval rate-limit rollout

## Phase 1 (this change)

Updated clients write `{ updatedAt, lastResourceId }` for `createSession`,
`sendMessage`, `reportUser`, and `locationRating`. `lastResourceId` is the exact
Firestore path created by the same batch. Rules verify the path at the protected
write, so one bound limiter cannot authorize two distinct resources.

Released clients write `{ updatedAt }`, so Phase 1 accepts both shapes. This is
backward compatible, but a deliberately modified legacy client can still reuse
one old-shape limiter write within a batch. Phase 1 therefore improves updated
clients without claiming to close the bypass globally.

| Action | Resource |
|---|---|
| `createSession` | `sessions/{sessionId}` |
| `sendMessage` | `conversations/{conversationId}/messages/{messageId}` or `sessions/{sessionId}/messages/{messageId}` |
| `reportUser` | `reports/{reportId}` |
| `locationRating` | `locationRatings/{locationId}__{uid}` |

`catalogRequest` and updated `friendRequest` clients retain their existing
`lastRequestId` designs. `createConversation` retains its fixed-window counter.

## Phase 2

After the minimum supported app version contains bound writes, remove the
legacy `incoming().keys().hasOnly(['updatedAt'])` branch from
`isValidIntervalRateLimitWrite` and the legacy branch from
`hasFreshBoundRateLimitPhase1`. No client change is required after adoption;
Phase 2 is a rules-only deployment.

Before cutover, verify the released build on iOS and Android for session create,
DM send, session-chat send, report submission, and rating create/edit. These
actions do not emit a limiter-shape adoption property, so use the minimum
supported version policy and release telemetry rather than unrelated events.
