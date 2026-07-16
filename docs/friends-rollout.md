# Friends / Study Buddies — rollout & operations notes

Operational notes for shipping the Friends feature (PR 6 / PR #55). Read this
before deploying rules + Functions.

## Deterministic pair-ID encoding & the UID constraint

Friend documents use plain `${uidA}__${uidB}` IDs, consistent with the rest of
the app (`conversations`, `userBlocks`, `locationRatings`):

- **friendRequests/{fromUid}__{toUid}** — directed (order = request direction).
- **friendships/{sortedA}__{sortedB}** — sorted (order-independent).

This is unambiguous **only** because every Studi account is created through
Firebase email/password auth. `createUserWithEmailAndPassword` (lib/auth.ts) is
the **sole** account-creation path in the codebase — there is no Admin
`createUser`/`importUsers`, no custom tokens, no OAuth/SAML/phone/anonymous
providers. Firebase-generated UIDs are `[A-Za-z0-9]` (28 chars), so they never
contain `_`, `-`, or `__`.

That constraint is **enforced**, not merely assumed:

- `functions/pair-id.js` `SAFE_UID_PATTERN = /^[A-Za-z0-9]{1,128}$/` — the single
  source of truth, mirrored by `lib/friends.ts` (`isSafeUid`) and
  `firestore.rules` (`isSafeUidComponent`).
- Rules validate every UID component on friend-request/friendship **create**, and
  the `get` membership check requires exactly two safe, non-empty `__`-separated
  segments — so empty segments (`__x`), `>2`-part IDs, and any non-conforming UID
  **fail closed** (denied), never misattributed.

Why not a different encoding (e.g. base64url)? Firestore rules cannot
base64-encode `request.auth.uid`, so the finding-1 missing-document membership
check (member-only `get` on a not-yet-existing pair doc, without leaking
existence) could not be validated in rules under any alternative encoding.
Truly supporting `__`-in-UID is therefore incompatible with rules-validatable
deterministic IDs; we constrain-and-enforce instead. No friend data exists yet
(unmerged/undeployed), so this is a clean pre-deploy decision, not a migration.
**If a non-email/password provider or custom UIDs are ever added, revisit this.**

## `displayNameLower` — two-phase rollout

Friend search does a case-insensitive prefix query on a `displayNameLower` shadow
field (Firestore range scans are case-sensitive). Current production clients do
**not** write it, so deploying strict rules first would break profile
creation/renames for already-installed apps.

**Phase 1 — this release (rules are permissive):**
- `displayNameLower` is OPTIONAL on profile create and update.
- When present, `isValidPublicProfile` pins it to `displayName.lower()` (can't drift).
- The new app **always** writes it (`createOrUpdateUserProfile`, `updateUserDisplayName`).
- Deploy order: **rules + Functions + indexes first**, then run
  `scripts/backfill-display-name-lower.mjs` (idempotent, project-pinned) to fill
  legacy docs, then ship the app that writes the field. Legacy docs also self-heal
  the next time the user saves their name.

**Phase 2 — follow-up hardening (separate issue, do NOT do it in this PR):**
- Once the **minimum supported app version writes `displayNameLower`**, tighten
  `firestore.rules` to require it on named create and on rename (the exact clauses
  removed from this PR are in the PR history). Gate this on the real minimum
  version — there is currently no in-app min-version gate, so do not fake one.

## `getFriendSuggestions` callable — cost & abuse controls

- **Auth:** verified UW caller only (`isVerifiedUwCallable`).
- **Rate limit:** 3s per user via `rateLimits/{uid}/actions/friendSuggestions`
  (same transaction pattern as `deleteUserAccount`).
- **App Check:** intentionally NOT enforced — no existing callable in this project
  enforces App Check, and a half-configured requirement would be worse than none.
  Add it project-wide as a separate change if desired.
- **Errors:** normalized to `HttpsError` (`unauthenticated`, `resource-exhausted`,
  `internal`).
- **Returned fields:** only public allowlisted `{ uid, displayName, classes,
  sharedClasses }`.
- **Worst-case reads per call:** `1 (caller) + 40 (class-overlap scan) + 40×5
  (one getAll over each candidate's five deterministic relationship/block docs) =
  241`. No full-collection or full-relationship scan; exclusion is per-candidate,
  so friends/requests/blocks beyond any page cap can never reappear.
