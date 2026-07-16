// functions/pair-id.js — the single source of truth for deterministic
// pair/relationship document IDs (PR 6). Dependency-free so it is unit-testable
// and shareable across the Cloud Functions. The client mirrors this exactly in
// lib/friends.ts (SAFE_UID_PATTERN / buildFriendRequestId / buildFriendshipId),
// and firestore.rules mirrors the same shape checks — change all three together.
//
// Encoding decision (documented in docs/friends-rollout.md): IDs are a plain
// `${uidA}__${uidB}` join, consistent with the rest of the app (conversations,
// userBlocks, locationRatings). This is unambiguous ONLY because every Studi
// account is created through Firebase email/password auth
// (createUserWithEmailAndPassword — the sole account-creation path in the
// codebase; no Admin createUser/importUsers/custom tokens), so UIDs are
// Firebase-generated and match [A-Za-z0-9]{1,128} — they never contain `_`,
// `-`, or `__`. That constraint is ENFORCED at every friend write (rules +
// client validate each component against SAFE_UID_PATTERN), so a UID that
// somehow fell outside it fails closed rather than producing an ambiguous ID.

const SAFE_UID_PATTERN = /^[A-Za-z0-9]{1,128}$/;

function isSafeUid(uid) {
  return typeof uid === "string" && SAFE_UID_PATTERN.test(uid);
}

/** Directed pair id — order is meaningful (friend REQUESTS: from → to). */
function directedPairId(fromUid, toUid) {
  return `${fromUid}__${toUid}`;
}

/** Sorted pair id — order-independent (FRIENDSHIPS, blocks-as-a-pair). */
function sortedPairId(userA, userB) {
  return [userA, userB].sort().join("__");
}

/**
 * Parse a deterministic pair id into its two members, or null if the id is
 * malformed: not exactly two `__`-separated parts, an empty/unsafe component,
 * or a self-pair. This is the canonical "is this a well-formed pair id"
 * validator — rules mirror the same checks (size == 2, non-empty, distinct).
 */
function parsePairMembers(docId) {
  if (typeof docId !== "string") {
    return null;
  }
  const parts = docId.split("__");
  if (parts.length !== 2) {
    return null;
  }
  const [a, b] = parts;
  if (!isSafeUid(a) || !isSafeUid(b) || a === b) {
    return null;
  }
  return [a, b];
}

module.exports = {
  SAFE_UID_PATTERN,
  isSafeUid,
  directedPairId,
  sortedPairId,
  parsePairMembers,
};
