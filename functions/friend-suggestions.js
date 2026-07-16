// functions/friend-suggestions.js — pure ranking/filtering for the friend
// suggestions callable (PR 6). Kept free of firebase-admin so the exclusion
// and bounds logic is unit-testable; the callable in functions/index.js wires
// the bounded Admin reads to it.

const { blockPairIdsFor } = require("./notification-validation");
const { directedPairId, sortedPairId } = require("./pair-id");

// Hard caps — every value the callable reads is bounded by one of these, so a
// suggestion request can never fan out into an unbounded scan.
const CANDIDATE_SCAN_LIMIT = 40; // users pulled from the class overlap query
// Deterministic relationship/block docs checked PER candidate — friendship,
// both request directions, both block directions. Exclusion is per-pair, not a
// scan of the caller's whole relationship set, so a friend/request/block beyond
// any page cap can never leak back in as an actionable suggestion.
const RELATIONSHIP_DOCS_PER_CANDIDATE = 5;
const MAX_SUGGESTIONS = 15; // rows actually returned

// Worst-case reads per getFriendSuggestions invocation:
//   1 (caller profile)
// + CANDIDATE_SCAN_LIMIT (class-overlap query)
// + CANDIDATE_SCAN_LIMIT * RELATIONSHIP_DOCS_PER_CANDIDATE (one batched getAll)
// = 1 + 40 + 200 = 241. No full-collection or full-relationship scan.
const MAX_SUGGESTION_READS =
  1 + CANDIDATE_SCAN_LIMIT + CANDIDATE_SCAN_LIMIT * RELATIONSHIP_DOCS_PER_CANDIDATE;

/**
 * The exactly-five deterministic docs whose existence means "already related"
 * for one caller/candidate pair. Returned as {collection, id} so the caller can
 * build refs and, from a set of existing "collection/id" keys, decide exclusion
 * WITHOUT reading the caller's full friendships/requests.
 */
function relationshipDocRefsForCandidate(caller, candidate) {
  return [
    { collection: "friendships", id: sortedPairId(caller, candidate) },
    { collection: "friendRequests", id: directedPairId(caller, candidate) },
    { collection: "friendRequests", id: directedPairId(candidate, caller) },
    { collection: "userBlocks", id: directedPairId(caller, candidate) },
    { collection: "userBlocks", id: directedPairId(candidate, caller) },
  ];
}

/** A candidate is excluded iff any of its five deterministic docs exists. */
function isCandidateExcludedByExistence(caller, candidate, existingDocKeys) {
  const keys = existingDocKeys instanceof Set ? existingDocKeys : new Set(existingDocKeys || []);
  return relationshipDocRefsForCandidate(caller, candidate).some((ref) =>
    keys.has(`${ref.collection}/${ref.id}`)
  );
}

function sharedClassCodes(mine, theirs) {
  const theirSet = new Set(
    (theirs || [])
      .filter((code) => typeof code === "string")
      .map((code) => code.trim().toUpperCase())
  );
  return (mine || [])
    .filter((code) => typeof code === "string")
    .filter((code) => theirSet.has(code.trim().toUpperCase()));
}

/**
 * Rank and bound suggestions from already-fetched inputs.
 *   senderUid       — the caller
 *   myClasses       — the caller's class codes
 *   candidates      — [{ uid, displayName, classes }] from the overlap query
 *   excludedUids    — Set of uids to drop (self + friends + pending either way)
 *   existingBlockIds— Set of userBlocks doc IDs that exist (both directions)
 *   limit           — max rows out (defaults to MAX_SUGGESTIONS)
 * Returns [{ uid, displayName, classes, sharedClasses }], deduped by uid,
 * only real class overlaps, ranked by overlap count then name, capped.
 */
function buildFriendSuggestions({
  senderUid,
  myClasses,
  candidates,
  excludedUids,
  existingBlockIds,
  limit = MAX_SUGGESTIONS,
}) {
  const excluded = excludedUids instanceof Set ? excludedUids : new Set(excludedUids || []);
  const blocks = existingBlockIds instanceof Set ? existingBlockIds : new Set(existingBlockIds || []);
  const seen = new Set();
  const rows = [];

  for (const candidate of candidates || []) {
    const uid = candidate?.uid;
    if (typeof uid !== "string" || !uid) continue;
    if (uid === senderUid) continue;
    if (seen.has(uid)) continue; // dedupe
    if (excluded.has(uid)) continue;
    // Blocked in either direction — never surface as an actionable suggestion.
    if (blockPairIdsFor(senderUid, uid).some((id) => blocks.has(id))) continue;

    const shared = sharedClassCodes(myClasses, candidate.classes);
    if (shared.length === 0) continue;

    seen.add(uid);
    rows.push({
      uid,
      displayName: typeof candidate.displayName === "string" ? candidate.displayName : "",
      classes: Array.isArray(candidate.classes)
        ? candidate.classes.filter((c) => typeof c === "string")
        : [],
      sharedClasses: shared,
    });
  }

  return rows
    .sort(
      (a, b) =>
        b.sharedClasses.length - a.sharedClasses.length ||
        a.displayName.localeCompare(b.displayName)
    )
    .slice(0, Math.max(0, limit));
}

module.exports = {
  CANDIDATE_SCAN_LIMIT,
  RELATIONSHIP_DOCS_PER_CANDIDATE,
  MAX_SUGGESTIONS,
  MAX_SUGGESTION_READS,
  buildFriendSuggestions,
  isCandidateExcludedByExistence,
  relationshipDocRefsForCandidate,
  sharedClassCodes,
};
