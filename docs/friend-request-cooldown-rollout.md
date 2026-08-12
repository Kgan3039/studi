# Friend-request cooldown bound-limiter rollout

The 10-second friend-request throttle uses
`rateLimits/{uid}/actions/friendRequest`. Older clients write only
`updatedAt`. Updated clients also write `lastRequestId`, the exact deterministic
`friendRequests/{fromUid}__{toUid}` document id created in the same batch.

This is a two-phase rollout because Studi has no minimum-version enforcement.
Deploying the final rule immediately would reject every request from an
already-installed client.

## Phase 1: this PR

- Updated clients write `{ updatedAt, lastRequestId }` atomically with the
  request.
- Rules strictly validate the bound shape and require its `lastRequestId` to
  match the request create.
- Rules temporarily continue accepting the legacy `{ updatedAt }` shape.
- `friend_request_sent` includes `limiter_bound: true` only after an updated
  client successfully commits the bound write.
- The rules suite explicitly proves both the bound protection and the remaining
  legacy same-batch bypass. The gap is not hidden.

The server remains authoritative for the 10-second interval in both shapes.
The Phase 1 residual risk is that a modified client can deliberately choose the
legacy shape and reuse one limiter update for more than one create in a batch.

### Phase 1 deployment order

1. Deploy `firestore.rules` first. Current clients keep working because the
   legacy shape remains accepted.
2. Release the updated app. Do not reverse this order: the pre-Phase-1 rules
   reject the new `lastRequestId` field.
3. Observe the adoption signal below. No Functions, indexes, migration, or
   dependency deployment is required.

## Deployment gate for Phase 2

Cut over only when all of the following are true:

1. `friend_request_sent` events with `limiter_bound = true` are 100% of those
   events over a rolling 48-hour window, with enough successful sends to make
   the ratio meaningful.
2. TestFlight/App Store adoption confirms active users are on the updated build.
3. Support and error telemetry show no unexpected bound-limiter denials.

## Phase 2: exact enforcement change

1. In `isValidFriendRequestRateLimitWrite`, remove the
   `incoming().keys().hasOnly(['updatedAt'])` compatibility branch. Require only
   `['updatedAt', 'lastRequestId']` plus `isValidBoundFriendRequestId(userId)`.
2. Replace the friend-request create clause:

```diff
- && hasFreshFriendRequestRateLimitPhase1(request.auth.uid, requestId);
+ && hasFreshBoundFriendRequestRateLimit(request.auth.uid, requestId);
```

3. Remove `hasFreshFriendRequestRateLimitPhase1` after its last caller is gone.
4. In the emulator suite:
   - change `PHASE 1: temporarily accepts the legacy updatedAt-only client
     shape` from success to failure and rename it;
   - change `PHASE 1 GAP: a legacy limiter can still authorize two creates in
     one batch` from success to failure and rename it;
   - retain all bound-shape, cooldown, mismatch, forged-owner, concurrent, and
     unrelated-action regression tests.

After Phase 2, one limiter document contains one `lastRequestId`. Every request
create compares its own document id to that value through `getAfter()`. Two
different request creates therefore cannot both be authorized by one limiter
write: at most one id can match, and an atomic batch fails if any create fails.

## Phase 2 deployment order

1. Confirm the adoption gate.
2. Deploy the Phase 2 Firestore rules and tests together.
3. Monitor friend-request permission failures.
4. Keep the updated client unchanged; it already emits the required bound
   shape.

Rollback is the Phase 1 rules only. No data migration is required because both
limiter shapes use the same document and the next valid write replaces the old
shape.
