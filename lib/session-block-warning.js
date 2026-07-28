// Pre-join safety check for sessions that already contain someone the current
// user has blocked.
//
// Why this lives outside the screens: blocked attendees are filtered out of the
// "Going" list (see visibleAttendees in app/session/[sessionId].tsx), so the
// only place a user can learn a blocked person is in the room is right here.
// Three surfaces can start a join — the session detail screen, the Today hero,
// and the sessions tab — and all three route through requestGuardedSessionJoin
// so the check exists once rather than three times.
//
// Everything here is framework-free and takes its data through injected
// fetchers, so all of it runs under plain mocha; this repo still has no jest or
// react-test-renderer harness. The screens stay responsible for their own
// Alert, toast, navigation, and post-join UI — this layer only answers "may
// this join proceed?".
//
// The one hard rule: only users the CURRENT user has blocked are ever
// considered. fetchBlockedUserIds is backed by getBlockedUserIds(), which
// queries blockerUserId == me, so nothing here can observe — let alone
// disclose — a block pointing the other way. A user who blocked *you* is
// indistinguishable from any other attendee, which is the intended asymmetry.
//
// Plain CommonJS (like lib/map-markers.js) so `npm run test:session-blocks`
// runs it without a transpile step; TypeScript sees it through
// lib/session-block-warning.d.ts.

const BLOCKED_WARNING_TITLE =
  "Someone you’ve blocked is participating in this study session.";

const BLOCKED_WARNING_BODY =
  "Blocking prevents direct communication, but shared study sessions may still contain blocked users.\n\nWould you still like to join?";

const BLOCKED_WARNING_CANCEL_LABEL = "Cancel";
const BLOCKED_WARNING_CONFIRM_LABEL = "Join Anyway";

// Shown whenever the roster or the block list could not be verified. Says
// nothing about blocks — a user who cannot be told "someone you blocked is
// here" must also not be told "we checked and something about blocks failed".
const BLOCKED_WARNING_VERIFICATION_ERROR =
  "We couldn’t verify the session participants. Please try again.";

// Sessions with a guarded join currently running. Module-level and keyed by
// session so the guard is shared across surfaces: the Today hero and the
// sessions tab can render the same session at once, and a double tap across
// the two is still one join attempt.
const inFlightJoins = new Set();

function isGuardedJoinInFlight(sessionId) {
  return inFlightJoins.has(sessionId);
}

// Test-only. Production code never needs this — every path releases its own
// session in a finally — but a test that leaves a confirm dialog unanswered
// would otherwise leak the claim into the next test.
function __resetGuardedJoinsForTests() {
  inFlightJoins.clear();
}

// null (not []) for anything that is not a verified list of ids. The
// distinction is the whole point of failing closed: "verified nobody" and
// "could not check" must not collapse into the same value.
//
// Verification is all-or-nothing: one malformed element invalidates the whole
// list. Filtering the bad entries out instead would be the dangerous move — a
// roster of [blockedUid, null] would sanitize to [blockedUid], and a *block
// list* of [blockedUid, null] would sanitize to a list that silently lost an
// entry, turning "this document is not what we think it is" into a confident
// "you have not blocked anyone here". A doc we cannot fully parse is a doc we
// cannot reason about.
function verifiedIdList(value) {
  if (!Array.isArray(value)) {
    return null;
  }

  for (const uid of value) {
    if (typeof uid !== "string" || uid.length === 0) {
      return null;
    }
  }

  return value;
}

// Participants the current user has blocked, deduplicated and in roster order.
// Reads participantIds rather than attendeeProfiles: the roster is the
// authoritative membership list, so a profile that failed to load can never
// hide a blocked participant from the warning. The host is a participant, so
// a blocked host is covered too.
function blockedParticipantIds(participantIds, blockedUserIds) {
  if (!Array.isArray(participantIds) || !Array.isArray(blockedUserIds)) {
    return [];
  }

  const blocked = new Set(
    blockedUserIds.filter((uid) => typeof uid === "string" && uid.length > 0)
  );
  const seen = new Set();
  const found = [];

  for (const uid of participantIds) {
    if (typeof uid !== "string" || !blocked.has(uid) || seen.has(uid)) {
      continue;
    }
    seen.add(uid);
    found.push(uid);
  }

  return found;
}

function failVerification(onVerificationError) {
  if (typeof onVerificationError === "function") {
    onVerificationError(BLOCKED_WARNING_VERIFICATION_ERROR);
  }

  return {
    status: "verification-failed",
    warned: false,
    blockedCount: 0,
  };
}

/**
 * The single guarded entry point in front of every join.
 *
 * Order matters and is load-bearing:
 *   1. claim the in-flight guard synchronously, before any await or confirm();
 *   2. fetch the authoritative roster and the outbound block list *now*, so a
 *      participant who joined after the screen loaded still counts;
 *   3. fail closed if either could not be verified — no join, no outcome event;
 *   4. pass straight through to join() when nobody in the room is blocked;
 *   5. otherwise ask once, and join only on confirmation.
 *
 * join() is the caller's own join routine. Its errors propagate to the caller
 * (every surface already wraps its own), and the guard is released either way.
 */
async function requestGuardedSessionJoin({
  sessionId,
  fetchParticipantIds,
  fetchBlockedUserIds,
  confirm,
  join,
  onVerificationError,
  track,
}) {
  const emit = typeof track === "function" ? track : () => {};

  if (typeof sessionId !== "string" || sessionId.length === 0) {
    return failVerification(onVerificationError);
  }

  // Claimed before the first await: two taps in the same tick cannot both get
  // past this line, so at most one alert opens and at most one join runs.
  if (inFlightJoins.has(sessionId)) {
    return { status: "ignored", warned: false, blockedCount: 0 };
  }
  inFlightJoins.add(sessionId);

  try {
    let participantIds = null;
    let blockedUserIds = null;

    try {
      const [roster, blocks] = await Promise.all([
        fetchParticipantIds(sessionId),
        fetchBlockedUserIds(sessionId),
      ]);
      // A deleted session yields a null roster, which is unverifiable rather
      // than empty — joinSession() would reject it anyway, but failing here
      // keeps the reason generic.
      participantIds = verifiedIdList(roster);
      blockedUserIds = verifiedIdList(blocks);
    } catch {
      // Permission, network, offline — indistinguishable from here, and all of
      // them mean the same thing: we do not know who is in this room.
      return failVerification(onVerificationError);
    }

    if (participantIds === null || blockedUserIds === null) {
      return failVerification(onVerificationError);
    }

    const blocked = blockedParticipantIds(participantIds, blockedUserIds);

    if (blocked.length === 0) {
      await join();
      return { status: "joined", warned: false, blockedCount: 0 };
    }

    // Count only — never the uids. Which specific people a user has blocked is
    // not something analytics needs (see docs/metrics.md).
    const properties = { sessionId, blockedCount: blocked.length };
    emit("blocked_session_warning_shown", properties);

    let confirmed;
    try {
      confirmed = await new Promise((resolve) => {
        // One outcome per warning. Guards against a platform firing both a
        // button press and a dismiss callback (Android's Alert onDismiss),
        // which would otherwise double-count the event or join after a cancel.
        let settled = false;
        const once = (answer) => () => {
          if (settled) {
            return;
          }
          settled = true;
          resolve(answer);
        };

        confirm({
          title: BLOCKED_WARNING_TITLE,
          body: BLOCKED_WARNING_BODY,
          cancelLabel: BLOCKED_WARNING_CANCEL_LABEL,
          confirmLabel: BLOCKED_WARNING_CONFIRM_LABEL,
          onCancel: once(false),
          onConfirm: once(true),
        });
      });
    } catch {
      // The dialog could not be presented. That is a failure to ask, not an
      // answer, so it must not be recorded as a cancel.
      return failVerification(onVerificationError);
    }

    if (!confirmed) {
      emit("blocked_session_cancel", properties);
      return { status: "cancelled", warned: true, blockedCount: blocked.length };
    }

    emit("blocked_session_join_anyway", properties);
    await join();
    return { status: "joined", warned: true, blockedCount: blocked.length };
  } finally {
    // Every exit releases the session: cancel, dismissal, failed verification,
    // a join that succeeded, a join that threw, and any unexpected throw above.
    inFlightJoins.delete(sessionId);
  }
}

module.exports = {
  BLOCKED_WARNING_BODY,
  BLOCKED_WARNING_CANCEL_LABEL,
  BLOCKED_WARNING_CONFIRM_LABEL,
  BLOCKED_WARNING_TITLE,
  BLOCKED_WARNING_VERIFICATION_ERROR,
  __resetGuardedJoinsForTests,
  blockedParticipantIds,
  isGuardedJoinInFlight,
  requestGuardedSessionJoin,
};
