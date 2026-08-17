# New-conversation quota — rollout & operations notes

Two-phase rollout for the `createConversation` quota (security audit finding
H3). Read this before deploying rules. **Phase 2 is a separate, deliberate
deploy — it is not part of the Phase 1 PR.**

## What the finding was

Starting a DM was the only abuse-prone create in the ruleset with no throttle
at all. Conversation IDs are deterministic sorted pairs, so one account could
create a thread with every other user; each create pins `lastMessageAt` to the
server clock and `app/(tabs)/messages.tsx` renders a message-less thread as a
normal inbox row (`"Say hi to your new study buddy"`). The payload is a
top-of-inbox row on every user in the beta, with no message to report.

## Why a counter, not the usual interval throttle

The other five rate-limited actions use a minimum-interval shape — one
`updatedAt`, valid when enough time has passed. That bounds **rate**, not
**reach**: at a 10s interval an attacker still reaches ~8,600 users/day. H3 is
a reach problem, so `createConversation` uses a fixed 24h window with a hard
cap instead.

Both shapes share `rateLimits/{uid}/actions/{action}`. They are kept strictly
separate in `isValidRateLimitWrite` — the five interval actions keep their
exact prior schema and semantics, and only `createConversation` may use the
counter shape. Tests pin both directions (interval actions reject the counter
shape and vice versa).

**Counting creates counts distinct counterparts exactly.** A conversation ID is
the deterministic sorted pair and can only ever be *created* once (`update`
cannot touch `participantIds`), so no separate distinct-tracking is needed.

## Parameters

| Parameter | Value | Where |
|---|---|---|
| Cap | **10** new conversation partners | `conversationQuotaMax()` / `CONVERSATION_QUOTA_MAX` |
| Window | **24h**, fixed (not rolling) | `conversationQuotaWindow()` / `CONVERSATION_QUOTA_WINDOW_MS` |
| TTL horizon | written as +48h, rules accept 24–72h | `expiresAt` |
| User-facing copy | "You've started several new chats recently. Try again later." | `ConversationQuotaError` |

The copy deliberately does not disclose the cap or when it resets.

**Known imprecision:** a fixed window permits up to 2× the cap across a
boundary (10 at 23:59, 10 at 00:01). Accepted at this cap; a rolling window
costs materially more complexity for little gain at N=10.

**Reopening an existing thread is always free** — the transaction returns
before it reads the counter, so it neither reads nor consumes quota.

## Why the counter cannot be forged

- A new window may start **only** when no doc exists or the stored `windowStart`
  is genuinely older than 24h — no early reset.
- A reset pins `windowStart == request.time` — no backdating.
- An increment must carry the **same** `windowStart` and exactly `count + 1`,
  capped at 10 — no skipping, no rewriting history.
- `delete` is denied outright, so the counter cannot be cleared.
- `expiresAt` is bounded against the server clock on both sides, so TTL can only
  ever remove a doc whose window is already dead — and removing one of those is
  behaviourally identical to the reset branch, never a way to recycle quota.
- Writing the counter without creating a conversation only burns the caller's
  own quota.

**Residual risk:** multi-account amplification. The real gate there is verified
`@wisc.edu` signup, not this counter.

## Phase 1 (shipped in this PR) — validation, no enforcement

- Counter schema validated wherever it is written.
- `rateLimits` read relaxed from `false` to **owner-only *and* scoped to
  `createConversation`**, so the client can read its own quota inside the
  transaction and after a denial. The five interval actions stay fully denied,
  including to their owner — no client reads them, and their `updatedAt` would
  disclose exactly when a throttle lifts.
- Client `getOrCreateDirectConversation` rewritten as a transaction that writes
  the counter alongside the conversation.
- **Conversation create does NOT yet require the counter** — already-installed
  clients write none and must keep working.

Both screens that can start a DM (`app/user/[userId].tsx`,
`app/session/[sessionId].tsx`) show the approved copy for
`ConversationQuotaError` and one fixed generic string for **every** other error.
Raw `error.message` is never shown: it could leak Firebase internals, and a
distinguishable failure would hint at whether the other user blocked you.

> **No UI unit test.** The repo has no React-Native test harness — no `jest`,
> `react-test-renderer`, or `@testing-library/react-native`; every suite is
> Node/mocha over pure modules plus the emulator rules suite. Standing one up to
> cover a two-line ternary is out of scope for a review-fix commit. The branch
> was instead verified manually against real `ConversationQuotaError`,
> `FirebaseError('permission-denied')`, `FirebaseError('unavailable')`, a plain
> `Error`, and a non-`Error` throw: only the first yields the quota copy. The
> same `instanceof` pattern is already load-bearing in production one handler
> up, via `SessionFullError`.

Net effect: updated clients **self-enforce** the cap (the client refuses to
write past 10), and every counter write is server-validated — but a legacy or
modified client can still bypass by writing the conversation directly. That
gap is exactly what Phase 2 closes.

This ordering is deliberate: Phase 1 gives real-user telemetry on whether a cap
of 10 hurts anyone **before** it becomes a hard block.

## Signal to check before enabling Phase 2

Deploy Phase 2 only when **all three** hold:

1. **Adoption — the gating signal.** In PostHog, `conversation_started` events
   carrying `quota_written = true` are **100%** of all `conversation_started`
   events over a rolling 48h, with a minimum of ~20 events so the ratio is not
   just silence. Any event without the property is a client that still creates
   conversations without a counter — Phase 2 would break it.
2. **Tester coverage.** TestFlight shows every active tester on the Phase 1
   build or later. There is no in-app min-version gate (see
   `docs/friends-rollout.md`) — do not fake one; this manual check is the
   substitute, which is why the cutover is same-day and controlled.
3. **Cap sanity.** `conversation_quota_blocked` is ~0. A non-trivial count means
   real users are hitting 10/day and the cap should be **retuned before**
   enforcement, since Phase 2 converts a client-side soft stop into a hard
   server denial.

## Phase 2 — the exact rules diff

One clause, reusing the same helper every other throttled create already uses.
Replace the Phase 1 comment block above `allow create` with:

```diff
     match /conversations/{conversationId} {
-      // createConversation quota — PHASE 1 (this release): the counter doc is
-      // validated wherever it is written (see isValidQuotaCounterWrite) and the
-      // updated client writes it inside the creation transaction, but create
-      // does NOT yet require it — already-installed clients write no counter
-      // and must keep working. There is therefore NO enforcement yet.
-      // PHASE 2 (deploy promptly after the client rollout is verified — see
-      // docs/conversation-quota-rollout.md) adds exactly one line here:
-      //     && hasFreshRateLimit(request.auth.uid, 'createConversation')
-      // which is the same helper every other throttled create already uses.
-      allow create: if isVerifiedUwUser() && isValidNewConversation(conversationId);
+      // createConversation quota — PHASE 2 (enforcing). The counter write must
+      // ride the same atomic commit as the conversation, so the cap cannot be
+      // skipped by writing the conversation directly. See
+      // docs/conversation-quota-rollout.md.
+      allow create: if isVerifiedUwUser()
+        && isValidNewConversation(conversationId)
+        && hasFreshRateLimit(request.auth.uid, 'createConversation');
```

### Tests that must be updated in the same Phase 2 commit

In `tests/firestore-rules.test.mjs`, under `PR B conversation quota`, three
assertions invert. They are written to fail loudly rather than silently pass:

| Test | Phase 1 | Phase 2 |
|---|---|---|
| `still succeeds WITHOUT a counter (already-installed clients)` | `assertSucceeds` | `assertFails` — rename to `denies a create with no counter` |
| `a spent quota does not block create yet (phase 1 has no enforcement)` | `assertSucceeds` | `assertFails` — rename to `denies a create once the quota is spent` |
| `succeeds WITH the counter written in the same atomic commit` | unchanged | unchanged (this is the path that must keep working) |

The `client transaction shape` tests need no changes — they already write the
counter atomically, which is exactly what Phase 2 requires.

## Deployment order

**Phase 1**
1. Deploy rules (`firebase deploy --only firestore:rules`).
2. Configure the Firestore TTL policy on collection group `actions`, field
   `expiresAt`. Existing interval docs lack the field and TTL ignores them.
3. Ship the TestFlight build containing the client transaction.
4. Watch the three signals above.

**Phase 2** (same-day once signals are green, do not batch with other changes)
5. Apply the rules diff above + the test updates, run the suite, deploy rules.
6. Confirm a real new DM still works end to end from an updated build.

## Rollback

- **Phase 2 → Phase 1:** revert the one clause and redeploy rules. Enforcement
  stops; nothing breaks; no data to undo.
- **Phase 1 → pre-PR:** revert the rules change. Counter docs become inert and
  TTL clears them within 48h. The updated client keeps working (its counter
  writes are simply no longer validated), though it will still self-enforce the
  cap until a build without the client change ships.
- No migration is needed in either direction. Existing conversations are never
  touched — the quota gates `create` only.
