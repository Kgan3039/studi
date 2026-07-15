// functions/friend-suggestions.js — pure ranking/filtering for the friend
// suggestions callable (PR 6). Kept free of firebase-admin so the exclusion
// and bounds logic is unit-testable; the callable in functions/index.js wires
// the bounded Admin reads to it.

const { blockPairIdsFor } = require("./notification-validation");

// Hard caps — every value the callable reads is bounded by one of these, so a
// suggestion request can never fan out into an unbounded scan.
const CANDIDATE_SCAN_LIMIT = 40; // users pulled from the class overlap query
const RELATIONSHIP_SCAN_LIMIT = 500; // friends / requests loaded for exclusion
const MAX_SUGGESTIONS = 15; // rows actually returned

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
  RELATIONSHIP_SCAN_LIMIT,
  MAX_SUGGESTIONS,
  buildFriendSuggestions,
  sharedClassCodes,
};
