# New-conversation quota — rollout & operations notes

Two-phase rollout for the `createConversation` quota (security audit finding
H3). **Phase 2 is active for the first public release.** Conversation creation
must atomically advance the counter, and `lastConversationId` binds that
advance to the exact conversation document. Studi has no earlier public App
Store client; internal builds must upgrade before the rules deployment.

## What the finding was

Starting a DM was the only abuse-prone create in the ruleset with no throttle
at all. Conversation IDs are deterministic sorted pairs, so one account could
create a thread with every other user; each create pins `lastMessageAt` to the
server clock and `app/(tabs)/messages.tsx` renders a message-less thread as a
normal inbox row (`"Say hi to your new study buddy."`). The payload is a
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

## Current enforcement

- The owner alone may read the `createConversation` counter; the five interval
  limiter documents remain unreadable to clients.
- `getOrCreateDirectConversation` creates the conversation and advances the
  counter in one transaction.
- Every new conversation requires that transaction. `lastConversationId` must
  equal the deterministic conversation document id, so one counter transition
  cannot authorize two creates.
- Existing conversations return before the quota read and remain free to open.
- Both DM entry points expose the controlled `ConversationQuotaError` copy and
  collapse all other failures to fixed safe copy.

The historical Phase-1 unbound path has been removed. Because this is Studi's
first public App Store release, no public production client requires it.
Before deploying these rules, confirm every internal/TestFlight build in active
use contains the transaction above. Rollback requires a deliberate security
decision; restoring Phase 1 would reopen the direct-write bypass.

## Deployment prerequisites

1. Configure the Firestore TTL policy on collection group `actions`, field
   `expiresAt`. Interval limiter documents lack this field and are unaffected.
2. Follow `docs/first-public-release-cutover.md`. In particular, retire every
   old internal/TestFlight build before enabling strict rules; there is no public
   Phase-1 compatibility period.
3. Verify a real new DM, an existing DM reopen, and quota denial end to end.
